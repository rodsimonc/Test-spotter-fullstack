"""The shared outbound HTTP helper: timeouts, retries, size caps and what it refuses to do."""

from __future__ import annotations

import gzip
import json

import pytest
import requests
import responses

from apps.common.errors import UpstreamError
from apps.planner.providers import http

URL = "https://osrm.test/thing"


def test_a_good_answer_is_parsed(rsps):
    rsps.add(responses.GET, URL, json={"a": 1})
    reply = http.get_json(URL, service="routing service")
    assert (reply.status, reply.data) == (200, {"a": 1})


def test_params_are_encoded_into_the_query_string_never_the_path(rsps):
    rsps.add(responses.GET, URL, json={})
    http.get_json(URL, service="x", params={"q": "a b&c=d/../e", "limit": 5})
    sent = rsps.calls[0].request
    assert sent.url.startswith(URL + "?")
    assert "q=a+b%26c%3Dd%2F..%2Fe" in sent.url or "q=a%20b%26c%3Dd%2F..%2Fe" in sent.url
    assert sent.params["q"] == "a b&c=d/../e"


def test_the_user_agent_comes_from_settings(rsps, settings):
    settings.HTTP_USER_AGENT = "Probe/9 (me@example.com)"
    rsps.add(responses.GET, URL, json={})
    http.get_json(URL, service="x")
    assert rsps.calls[0].request.headers["User-Agent"] == "Probe/9 (me@example.com)"


def test_timeouts_are_3_seconds_to_connect_and_8_to_read(monkeypatch, rsps):
    seen = {}

    def fake_get(url, **kwargs):
        seen.update(kwargs)
        raise requests.ConnectionError

    monkeypatch.setattr(http._session, "get", fake_get)
    with pytest.raises(UpstreamError):
        http.get_json(URL, service="x", retries=0)
    assert seen["timeout"] == (3.0, 8.0)
    assert seen["allow_redirects"] is False
    assert seen["stream"] is True


def test_connection_errors_are_retried_once(rsps):
    rsps.add(responses.GET, URL, body=requests.ConnectionError("down"))
    rsps.add(responses.GET, URL, json={"ok": True})
    assert http.get_json(URL, service="x").data == {"ok": True}
    assert len(rsps.calls) == 2


def test_two_connection_failures_in_a_row_give_up(rsps):
    rsps.add(responses.GET, URL, body=requests.ConnectionError("down"))
    with pytest.raises(UpstreamError, match="Couldn't reach the x"):
        http.get_json(URL, service="x")
    assert len(rsps.calls) == 2


def test_connect_timeouts_count_as_connection_errors(rsps):
    rsps.add(responses.GET, URL, body=requests.ConnectTimeout("slow"))
    rsps.add(responses.GET, URL, json={})
    assert http.get_json(URL, service="x").status == 200


def test_read_timeouts_are_not_retried(rsps):
    rsps.add(responses.GET, URL, body=requests.ReadTimeout("slow"))
    with pytest.raises(UpstreamError, match="took too long"):
        http.get_json(URL, service="x")
    assert len(rsps.calls) == 1


@pytest.mark.parametrize("status", [500, 502, 503, 504])
def test_5xx_is_retried_once_then_fails(rsps, status):
    rsps.add(responses.GET, URL, status=status, body="busy")
    with pytest.raises(UpstreamError, match="problem on its side"):
        http.get_json(URL, service="x")
    assert len(rsps.calls) == 2


def test_retries_can_be_turned_off(rsps):
    rsps.add(responses.GET, URL, status=503)
    with pytest.raises(UpstreamError):
        http.get_json(URL, service="x", retries=0)
    assert len(rsps.calls) == 1


def test_4xx_is_returned_so_the_caller_can_read_the_body(rsps):
    rsps.add(responses.GET, URL, status=400, json={"code": "NoRoute"})
    reply = http.get_json(URL, service="x")
    assert (reply.status, reply.data) == (400, {"code": "NoRoute"})
    assert len(rsps.calls) == 1


@pytest.mark.parametrize(
    "body", ["", "not json", "<html>", "{", "NaN", '{"a": NaN}', '{"a": Infinity}', '{"a": -Infinity}']
)
def test_unreadable_bodies_are_upstream_errors(rsps, body):
    rsps.add(responses.GET, URL, body=body)
    with pytest.raises(UpstreamError, match="couldn't read"):
        http.get_json(URL, service="x")


def test_absurdly_nested_json_is_an_upstream_error_not_a_crash(rsps):
    rsps.add(responses.GET, URL, body="[" * 200_000)
    with pytest.raises(UpstreamError):
        http.get_json(URL, service="x")


def test_redirects_are_refused(rsps):
    rsps.add(responses.GET, URL, status=301, headers={"Location": "https://169.254.169.254/latest/meta-data"})
    with pytest.raises(UpstreamError, match="somewhere else"):
        http.get_json(URL, service="x")
    assert len(rsps.calls) == 1


def test_the_size_cap_applies_while_streaming(rsps):
    rsps.add(responses.GET, URL, body=b" " * (http.SMALL_MAX_BYTES + 1))
    with pytest.raises(UpstreamError, match="more data"):
        http.get_json(URL, service="x")


def test_a_body_exactly_at_the_cap_is_accepted(rsps):
    padding = " " * (http.SMALL_MAX_BYTES - len("{}"))
    rsps.add(responses.GET, URL, body="{}" + padding)
    assert http.get_json(URL, service="x").data == {}


def test_the_size_cap_is_checked_on_the_declared_length_first(rsps):
    rsps.add(responses.GET, URL, body="{}", headers={"Content-Length": "999999999"})
    with pytest.raises(UpstreamError, match="more data"):
        http.get_json(URL, service="x")


def test_a_larger_cap_can_be_passed_for_osrm(rsps):
    rsps.add(responses.GET, URL, body=json.dumps({"pad": "x" * (http.SMALL_MAX_BYTES * 2)}))
    assert "pad" in http.get_json(URL, service="x", max_bytes=http.OSRM_MAX_BYTES).data


def test_the_caps_are_5_mb_and_256_kb():
    assert http.OSRM_MAX_BYTES == 5 * 1024 * 1024
    assert http.SMALL_MAX_BYTES == 256 * 1024


def test_a_gzip_bomb_is_stopped_by_counting_decompressed_bytes(rsps):
    bomb = gzip.compress(b'{"pad": "' + b"a" * (8 * 1024 * 1024) + b'"}')
    assert len(bomb) < 100 * 1024
    rsps.add(responses.GET, URL, body=bomb, headers={"Content-Encoding": "gzip"})
    with pytest.raises(UpstreamError, match="more data"):
        http.get_json(URL, service="x", max_bytes=http.OSRM_MAX_BYTES)


def test_other_requests_errors_become_upstream_errors(rsps):
    rsps.add(responses.GET, URL, body=requests.exceptions.ChunkedEncodingError("cut off"))
    with pytest.raises(UpstreamError, match="Couldn't talk to the x"):
        http.get_json(URL, service="x")


def test_error_messages_never_contain_the_url(rsps):
    rsps.add(responses.GET, URL, status=500)
    with pytest.raises(UpstreamError) as caught:
        http.get_json(URL, service="routing service")
    assert "osrm.test" not in str(caught.value.detail)
