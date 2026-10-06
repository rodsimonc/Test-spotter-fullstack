"""Server-side request forgery: outbound calls go to the three hosts in settings and nowhere else,
whatever a visitor types, and redirects are never followed."""

from __future__ import annotations

import ast
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import pytest
import responses

from apps.planner.providers import osrm
from tests.support.contract import assert_error
from tests.support.osrm import (
    CHICAGO,
    NOMINATIM_REVERSE,
    OSRM_ROUTE,
    PHOTON_SEARCH,
    osrm_payload,
    photon_payload,
    register_osrm,
)

ALLOWED_HOSTS = {"osrm.test", "photon.test", "nominatim.test"}
APPS = Path(__file__).resolve().parents[2] / "apps"

HOSTILE_TARGETS = [
    "http://169.254.169.254/latest/meta-data/",
    "http://localhost:8000/api/health",
    "http://127.0.0.1:22",
    "http://[::1]/",
    "https://evil.example/",
    "//evil.example/path",
    "evil.example",
    "file:///etc/passwd",
    "gopher://evil.example:70/_x",
    "http://osrm.test@evil.example/",
    "http://evil.example#@osrm.test/",
    "https://photon.test.evil.example/",
    "\\\\evil.example\\share",
    "http://0x7f000001/",
    "http://2130706433/",
]


@pytest.fixture
def upstreams(rsps):
    register_osrm(rsps)
    rsps.add("GET", PHOTON_SEARCH, json=photon_payload(CHICAGO))
    rsps.add("GET", NOMINATIM_REVERSE, json={"error": "Unable to geocode"})
    return rsps


def assert_only_configured_hosts(rsps) -> None:
    assert rsps.calls, "the test never reached an upstream"
    for call in rsps.calls:
        parts = urlsplit(call.request.url)
        assert parts.scheme == "https", call.request.url
        assert parts.hostname in ALLOWED_HOSTS, call.request.url
        assert parts.username is None and parts.password is None and parts.port is None, call.request.url
        assert parts.fragment == "", call.request.url


@pytest.mark.parametrize("target", HOSTILE_TARGETS)
def test_urls_typed_into_place_labels_are_never_fetched(api, plan_payload, upstreams, target):
    for place in ("current", "pickup", "dropoff"):
        plan_payload[place]["label"] = target
    plan_payload["header"]["shipper"] = target

    api.post("/api/plan", plan_payload, format="json")

    assert_only_configured_hosts(upstreams)
    assert len(upstreams.calls) == 2, "one call for the route and one for the turn list"


@pytest.mark.parametrize("target", HOSTILE_TARGETS)
def test_urls_typed_into_a_search_stay_in_the_query_string(api, upstreams, target):
    api.get("/api/geocode/search", {"q": target})

    assert_only_configured_hosts(upstreams)
    for call in upstreams.calls:
        parts = urlsplit(call.request.url)
        assert parts.path == "/api/"
        assert parse_qs(parts.query)["q"] == [target.strip()]


@pytest.mark.parametrize("params", ["lat=1.5&lon=2.5", "lat=1e1&lon=1e2", "lat=-0&lon=%2B3"])
def test_reverse_lookups_send_numbers_only(api, upstreams, params):
    api.get(f"/api/geocode/reverse?{params}")

    assert_only_configured_hosts(upstreams)
    query = parse_qs(urlsplit(upstreams.calls[0].request.url).query)
    float(query["lat"][0])
    float(query["lon"][0])
    assert set(query) == {"format", "lat", "lon", "zoom", "addressdetails"}


def test_the_route_path_is_built_from_numbers_alone(plan_payload, upstreams, api):
    api.post("/api/plan", plan_payload, format="json")
    path = urlsplit(upstreams.calls[0].request.url).path
    assert path == "/route/v1/driving/-96.797000,32.776700;-90.049000,35.149500;-104.990300,39.739200"


def test_route_urls_are_made_only_of_digits_signs_and_separators():
    url = osrm.route_url([(1.5, -2.25), (3.0, 4.0), (-5.5, 6.75)])
    tail = url.removeprefix("https://osrm.test/route/v1/driving/")
    assert tail == "-2.250000,1.500000;4.000000,3.000000;6.750000,-5.500000"


def test_the_hosts_come_from_settings_not_from_the_code(api, plan_payload, rsps, settings):
    settings.OSRM_BASE_URL = "https://routing.internal.example:8443/osrm"
    settings.PHOTON_BASE_URL = "https://places.internal.example"
    settings.NOMINATIM_BASE_URL = "https://reverse.internal.example"
    rsps.add(
        responses.GET,
        "https://routing.internal.example:8443/osrm/route/v1/driving/"
        "-96.797000,32.776700;-90.049000,35.149500;-104.990300,39.739200",
        json=osrm_payload(),
    )
    rsps.add(responses.GET, "https://places.internal.example/api/", json=photon_payload(CHICAGO))
    rsps.add(responses.GET, "https://reverse.internal.example/reverse", json={"error": "x"})

    assert api.post("/api/plan", plan_payload, format="json").status_code == 200
    assert api.get("/api/geocode/search?q=chicago").status_code == 200
    assert api.get("/api/geocode/reverse?lat=1&lon=2").status_code == 200

    hosts = {urlsplit(c.request.url).netloc for c in rsps.calls}
    assert hosts == {"routing.internal.example:8443", "places.internal.example", "reverse.internal.example"}


def test_forwarded_host_headers_do_not_steer_outbound_calls(api, plan_payload, upstreams):
    api.post(
        "/api/plan",
        plan_payload,
        format="json",
        HTTP_X_FORWARDED_HOST="evil.example",
        HTTP_HOST="testserver",
        HTTP_REFERER="https://evil.example/",
        HTTP_ORIGIN="https://evil.example",
    )
    assert_only_configured_hosts(upstreams)


def test_a_redirect_from_the_router_is_not_followed(api, plan_payload, rsps):
    rsps.add(responses.GET, OSRM_ROUTE, status=302, headers={"Location": "http://169.254.169.254/latest/meta-data/"})
    evil = rsps.add(responses.GET, "http://169.254.169.254/latest/meta-data/", body="secret")

    assert_error(api.post("/api/plan", plan_payload, format="json"), 502, "upstream_error")

    assert evil.call_count == 0


@pytest.mark.parametrize("status", [301, 302, 303, 307, 308])
def test_no_upstream_redirect_is_followed(api, rsps, status):
    rsps.add(responses.GET, PHOTON_SEARCH, status=status, headers={"Location": "https://evil.example/steal"})
    evil = rsps.add(responses.GET, "https://evil.example/steal", json=photon_payload(CHICAGO))

    assert_error(api.get("/api/geocode/search?q=chicago"), 502, "upstream_error")
    assert evil.call_count == 0


def test_a_redirect_from_the_address_lookup_falls_back_instead_of_following(api, rsps):
    rsps.add(responses.GET, NOMINATIM_REVERSE, status=302, headers={"Location": "https://evil.example/"})
    evil = rsps.add(responses.GET, "https://evil.example/", json={"display_name": "x"})

    response = api.get("/api/geocode/reverse?lat=41.9&lon=-87.6")

    assert response.status_code == 200
    assert evil.call_count == 0


def test_a_call_to_any_other_host_would_fail_the_suite_not_reach_the_network(rsps):
    import requests

    with pytest.raises(requests.ConnectionError):
        requests.get("https://evil.example/", timeout=1)


# What the code is allowed to import --------------------------------------------------------------

NETWORK_MODULES = {
    "requests",
    "urllib",
    "urllib3",
    "http",
    "httpx",
    "aiohttp",
    "socket",
    "ftplib",
    "smtplib",
    "telnetlib",
    "xmlrpc",
}


def imported_modules(path: Path) -> set[str]:
    found: set[str] = set()
    # utf-8-sig: some files carry a byte order mark, which Python accepts but `ast.parse` doesn't.
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8-sig"))):
        if isinstance(node, ast.Import):
            found |= {alias.name.split(".")[0] for alias in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
            found.add(node.module.split(".")[0])
    return found


def test_only_one_module_in_the_project_can_open_a_connection():
    offenders = {}
    for path in APPS.rglob("*.py"):
        if "migrations" in path.parts:
            continue
        used = imported_modules(path) & NETWORK_MODULES
        if used:
            offenders[path.relative_to(APPS).as_posix()] = sorted(used)
    assert offenders == {"planner/providers/http.py": ["requests"]}


def test_no_code_builds_a_url_from_the_request_object():
    """`request.META["HTTP_HOST"]` and friends must never reach an outbound URL."""
    for path in (APPS / "planner" / "providers").glob("*.py"):
        source = path.read_text(encoding="utf-8")
        for needle in ("request.META", "request.get_host", "HTTP_HOST", "build_absolute_uri", "X-Forwarded"):
            assert needle not in source, f"{path.name} reads {needle}"


def test_every_provider_url_starts_with_a_setting():
    for name, setting in (
        ("osrm", "OSRM_BASE_URL"),
        ("photon", "PHOTON_BASE_URL"),
        ("nominatim", "NOMINATIM_BASE_URL"),
    ):
        source = (APPS / "planner" / "providers" / f"{name}.py").read_text(encoding="utf-8")
        assert f"settings.{setting}" in source, name
        assert "http://" not in source and "https://" not in source, f"{name}.py hard-codes a host"
