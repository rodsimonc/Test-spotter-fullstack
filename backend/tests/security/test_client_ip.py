"""Which address a request counts against. Spoofable headers are ignored unless a proxy is trusted."""

from __future__ import annotations

import pytest
from django.test import RequestFactory

from apps.common.client_ip import UNKNOWN, client_ip


def request(remote_addr: str | None = "198.51.100.5", forwarded: str | None = None):
    extra = {}
    if remote_addr is not None:
        extra["REMOTE_ADDR"] = remote_addr
    if forwarded is not None:
        extra["HTTP_X_FORWARDED_FOR"] = forwarded
    req = RequestFactory().get("/", **extra)
    if remote_addr is None:
        req.META.pop("REMOTE_ADDR", None)
    return req


def trust(settings, count: int = 1):
    settings.TRUST_PROXY_HEADERS = True
    settings.TRUSTED_PROXY_COUNT = count


def test_the_peer_address_is_used_by_default():
    assert client_ip(request()) == "198.51.100.5"


def test_a_forwarded_header_is_ignored_by_default():
    assert client_ip(request(forwarded="203.0.113.77")) == "198.51.100.5"


def test_a_forwarded_header_is_used_when_proxies_are_trusted(settings):
    trust(settings)
    assert client_ip(request(forwarded="203.0.113.77")) == "203.0.113.77"


def test_one_trusted_proxy_means_the_right_most_entry(settings):
    trust(settings, 1)
    assert client_ip(request(forwarded="6.6.6.6, 7.7.7.7, 203.0.113.77")) == "203.0.113.77"


def test_two_trusted_proxies_mean_the_second_from_the_right(settings):
    trust(settings, 2)
    assert client_ip(request(forwarded="6.6.6.6, 203.0.113.77, 10.0.0.2")) == "203.0.113.77"


def test_fewer_entries_than_proxies_falls_back_to_the_first(settings):
    trust(settings, 3)
    assert client_ip(request(forwarded="203.0.113.77, 10.0.0.2")) == "203.0.113.77"


@pytest.mark.parametrize("header", ["", "   ", ",", "not-an-ip", "999.1.1.1", "203.0.113.77:8080", "unknown"])
def test_an_unusable_header_falls_back_to_the_peer(settings, header):
    trust(settings)
    assert client_ip(request(forwarded=header)) == "198.51.100.5"


def test_a_missing_header_falls_back_to_the_peer(settings):
    trust(settings)
    assert client_ip(request()) == "198.51.100.5"


def test_spaces_around_entries_are_ignored(settings):
    trust(settings)
    assert client_ip(request(forwarded="  203.0.113.77  ")) == "203.0.113.77"


def test_ipv6_clients_share_a_counter_per_64(settings):
    first = client_ip(request("2001:db8:aaaa:bbbb::1"))
    second = client_ip(request("2001:db8:aaaa:bbbb:1234:5678:9abc:def0"))
    other = client_ip(request("2001:db8:aaaa:cccc::1"))
    assert first == second == "2001:db8:aaaa:bbbb::/64"
    assert other != first


def test_ipv6_in_a_forwarded_header_is_grouped_too(settings):
    trust(settings)
    assert client_ip(request(forwarded="2001:db8::1")) == "2001:db8::/64"


def test_an_ipv4_address_in_ipv6_form_counts_as_ipv4():
    assert client_ip(request("::ffff:198.51.100.5")) == "198.51.100.5"


def test_no_address_at_all_is_one_shared_bucket():
    assert client_ip(request(None)) == UNKNOWN


def test_a_garbage_peer_address_is_one_shared_bucket():
    assert client_ip(request("not-an-address")) == UNKNOWN
