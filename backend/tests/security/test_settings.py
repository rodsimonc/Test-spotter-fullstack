"""`config/settings.py` under different environments. Each case loads the file fresh."""

from __future__ import annotations

import pytest
from django.core.exceptions import ImproperlyConfigured

from tests.support.prod_settings import PROD_ENV, load_settings

SECRET = PROD_ENV["DJANGO_SECRET_KEY"]


# Secret key and debug -----------------------------------------------------------------------


def test_production_needs_a_secret_key():
    with pytest.raises(ImproperlyConfigured, match="DJANGO_SECRET_KEY is required"):
        load_settings(DJANGO_SECRET_KEY=None)


def test_a_blank_secret_key_counts_as_missing():
    with pytest.raises(ImproperlyConfigured):
        load_settings(DJANGO_SECRET_KEY="")


def test_debug_is_off_unless_asked_for():
    assert load_settings(DJANGO_DEBUG=None).DEBUG is False


@pytest.mark.parametrize("value", ["1", "true", "TRUE", "yes", "on", " On "])
def test_debug_accepts_the_usual_spellings_of_yes(value):
    assert load_settings(DJANGO_DEBUG=value).DEBUG is True


@pytest.mark.parametrize("value", ["0", "false", "no", "off", "", "maybe", "2"])
def test_anything_else_leaves_debug_off(value):
    assert load_settings(DJANGO_DEBUG=value).DEBUG is False


def test_debug_without_a_key_gets_an_obviously_insecure_one():
    module = load_settings(DJANGO_DEBUG="1", DJANGO_SECRET_KEY=None)
    assert module.SECRET_KEY.startswith("django-insecure-")


def test_the_insecure_fallback_never_applies_in_production():
    assert load_settings().SECRET_KEY == SECRET


# Security settings --------------------------------------------------------------------------


def test_production_turns_on_every_browser_protection():
    s = load_settings()
    assert s.SESSION_COOKIE_SECURE is True
    assert s.SESSION_COOKIE_HTTPONLY is True
    assert s.SESSION_COOKIE_SAMESITE == "Lax"
    assert s.CSRF_COOKIE_SECURE is True
    assert s.CSRF_COOKIE_SAMESITE == "Lax"
    assert s.SECURE_HSTS_SECONDS == 31_536_000
    assert s.SECURE_HSTS_INCLUDE_SUBDOMAINS is True
    assert s.SECURE_HSTS_PRELOAD is True
    assert s.SECURE_CONTENT_TYPE_NOSNIFF is True
    assert s.SECURE_SSL_REDIRECT is True
    assert s.X_FRAME_OPTIONS == "DENY"
    assert s.SECURE_REFERRER_POLICY == "strict-origin-when-cross-origin"


def test_debug_skips_the_https_only_settings():
    s = load_settings(DJANGO_DEBUG="1")
    assert not hasattr(s, "SECURE_HSTS_SECONDS")
    assert not hasattr(s, "SESSION_COOKIE_SECURE")
    assert not hasattr(s, "SECURE_SSL_REDIRECT")
    assert s.X_FRAME_OPTIONS == "DENY" and s.SECURE_CONTENT_TYPE_NOSNIFF is True


def test_the_https_redirect_can_be_switched_off_for_a_proxy_that_does_it_already():
    assert load_settings(DJANGO_SECURE_SSL_REDIRECT="0").SECURE_SSL_REDIRECT is False


def test_request_bodies_are_capped_at_64_kb():
    assert load_settings().DATA_UPLOAD_MAX_MEMORY_SIZE == 64 * 1024


def test_password_validators_are_all_on():
    names = [v["NAME"].rsplit(".", 1)[1] for v in load_settings().AUTH_PASSWORD_VALIDATORS]
    assert names == [
        "UserAttributeSimilarityValidator",
        "MinimumLengthValidator",
        "CommonPasswordValidator",
        "NumericPasswordValidator",
    ]


def test_the_api_speaks_json_only_with_session_auth():
    rest = load_settings().REST_FRAMEWORK
    assert rest["DEFAULT_RENDERER_CLASSES"] == ["rest_framework.renderers.JSONRenderer"]
    assert rest["DEFAULT_AUTHENTICATION_CLASSES"] == ["rest_framework.authentication.SessionAuthentication"]


def test_there_is_no_admin_and_no_browsable_api():
    s = load_settings()
    assert "django.contrib.admin" not in s.INSTALLED_APPS
    assert "django.contrib.messages" not in s.INSTALLED_APPS
    assert s.TEMPLATES == []
    assert not any("BrowsableAPI" in r for r in s.REST_FRAMEWORK["DEFAULT_RENDERER_CLASSES"])


def test_throttle_rates_match_the_spec():
    assert load_settings().REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"] == {
        "plan": "30/min",
        "geocode_search": "90/min",
        "geocode_reverse": "30/min",
        "login": "10/min",
        "register": "10/min",
        "trips": "60/min",
    }


def test_the_host_check_middleware_is_installed():
    assert "django.middleware.common.CommonMiddleware" in load_settings().MIDDLEWARE


# Hosts and origins --------------------------------------------------------------------------


def test_allowed_hosts_come_from_the_environment():
    s = load_settings(DJANGO_ALLOWED_HOSTS="a.example.com, b.example.com ,,")
    assert s.ALLOWED_HOSTS == ["a.example.com", "b.example.com"]


def test_no_allowed_hosts_means_none_are_allowed():
    assert load_settings(DJANGO_ALLOWED_HOSTS=None).ALLOWED_HOSTS == []


def test_csrf_trusted_origins_come_from_the_environment():
    s = load_settings(CSRF_TRUSTED_ORIGINS="https://a.example.com,https://b.example.com")
    assert s.CSRF_TRUSTED_ORIGINS == ["https://a.example.com", "https://b.example.com"]


def test_vercel_adds_its_own_hosts_and_origins():
    s = load_settings(
        VERCEL="1",
        DATABASE_URL="sqlite:///db.sqlite3",
        VERCEL_URL="trip-abc123.vercel.app",
        VERCEL_PROJECT_PRODUCTION_URL="trips.example.com",
    )
    assert ".vercel.app" in s.ALLOWED_HOSTS
    assert {"trip-abc123.vercel.app", "trips.example.com"} <= set(s.ALLOWED_HOSTS)
    assert "https://trip-abc123.vercel.app" in s.CSRF_TRUSTED_ORIGINS
    assert "https://trips.example.com" in s.CSRF_TRUSTED_ORIGINS


def test_vercel_hosts_are_not_added_elsewhere():
    s = load_settings(VERCEL_URL="trip-abc123.vercel.app")
    assert ".vercel.app" not in s.ALLOWED_HOSTS and "trip-abc123.vercel.app" not in s.ALLOWED_HOSTS


# Proxy headers ------------------------------------------------------------------------------


def test_proxy_headers_are_not_trusted_by_default():
    s = load_settings()
    assert s.TRUST_PROXY_HEADERS is False
    assert not hasattr(s, "SECURE_PROXY_SSL_HEADER")


def test_proxy_headers_are_trusted_on_vercel_and_mark_the_request_secure():
    s = load_settings(VERCEL="1", DATABASE_URL="sqlite:///db.sqlite3")
    assert s.TRUST_PROXY_HEADERS is True
    assert s.SECURE_PROXY_SSL_HEADER == ("HTTP_X_FORWARDED_PROTO", "https")
    assert s.TRUSTED_PROXY_COUNT == 1


def test_proxy_trust_can_be_switched_on_by_hand_with_a_hop_count():
    s = load_settings(TRUST_PROXY_HEADERS="1", TRUSTED_PROXY_COUNT="2")
    assert s.TRUST_PROXY_HEADERS is True and s.TRUSTED_PROXY_COUNT == 2


def test_the_hop_count_never_drops_below_one():
    assert load_settings(TRUSTED_PROXY_COUNT="0").TRUSTED_PROXY_COUNT == 1
    assert load_settings(TRUSTED_PROXY_COUNT="-4").TRUSTED_PROXY_COUNT == 1


def test_a_hop_count_that_is_not_a_number_is_an_error():
    with pytest.raises(ImproperlyConfigured, match="TRUSTED_PROXY_COUNT must be a whole number"):
        load_settings(TRUSTED_PROXY_COUNT="two")


# Database -----------------------------------------------------------------------------------


def test_the_default_database_is_a_local_sqlite_file():
    db = load_settings().DATABASES["default"]
    assert db["ENGINE"] == "django.db.backends.sqlite3"
    assert str(db["NAME"]).endswith("db.sqlite3")


def test_database_url_selects_postgres_with_no_persistent_connections():
    db = load_settings(DATABASE_URL="postgresql://u:p@db.example.com:5432/trips?sslmode=require").DATABASES["default"]
    assert db["ENGINE"] == "django.db.backends.postgresql"
    assert (db["HOST"], db["NAME"], db["USER"], db["PORT"]) == ("db.example.com", "trips", "u", 5432)
    assert db["CONN_MAX_AGE"] == 0
    assert db["OPTIONS"]["sslmode"] == "require"


def test_pooled_postgres_gets_the_settings_a_pooler_needs():
    """Neon and pgbouncer in transaction mode reject server-side cursors and prepared statements."""
    from django.db import ConnectionHandler

    db = load_settings(DATABASE_URL="postgresql://u:p@pool.example.com/trips?sslmode=require").DATABASES["default"]
    assert db["DISABLE_SERVER_SIDE_CURSORS"] is True

    params = ConnectionHandler({"default": db})["default"].get_connection_params()  # builds, never connects
    assert params["prepare_threshold"] is None
    assert (params["host"], params["dbname"], params["user"], params["sslmode"]) == (
        "pool.example.com",
        "trips",
        "u",
        "require",
    )


def test_sqlite_through_database_url_does_not_get_postgres_options():
    db = load_settings(DATABASE_URL="sqlite:///other.sqlite3").DATABASES["default"]
    assert db["ENGINE"] == "django.db.backends.sqlite3"
    assert not db.get("DISABLE_SERVER_SIDE_CURSORS")


def test_vercel_refuses_to_start_without_a_database_url():
    with pytest.raises(ImproperlyConfigured, match="DATABASE_URL is required on Vercel"):
        load_settings(VERCEL="1")


def test_the_cache_is_the_database_so_every_instance_shares_throttle_counters():
    cache = load_settings().CACHES["default"]
    assert cache["BACKEND"] == "django.core.cache.backends.db.DatabaseCache"
    assert cache["LOCATION"] == "django_cache"


def test_sessions_live_in_the_database():
    assert load_settings().SESSION_ENGINE == "django.contrib.sessions.backends.db"


# Upstream services --------------------------------------------------------------------------


def test_upstream_defaults_are_the_public_servers():
    s = load_settings()
    assert s.OSRM_BASE_URL == "https://router.project-osrm.org"
    assert s.PHOTON_BASE_URL == "https://photon.komoot.io"
    assert s.NOMINATIM_BASE_URL == "https://nominatim.openstreetmap.org"


def test_upstream_urls_can_be_changed_and_lose_a_trailing_slash():
    s = load_settings(OSRM_BASE_URL="http://127.0.0.1:8787/", PHOTON_BASE_URL="https://photon.internal/api-root//")
    assert s.OSRM_BASE_URL == "http://127.0.0.1:8787"
    assert s.PHOTON_BASE_URL == "https://photon.internal/api-root"


@pytest.mark.parametrize(
    "bad",
    [
        "file:///etc/passwd",
        "ftp://example.com",
        "gopher://example.com",
        "javascript:alert(1)",
        "//example.com",
        "example.com",
        "http://",
        "https:///path",
    ],
)
@pytest.mark.parametrize("name", ["OSRM_BASE_URL", "PHOTON_BASE_URL", "NOMINATIM_BASE_URL"])
def test_an_upstream_that_is_not_an_http_url_stops_startup(name, bad):
    with pytest.raises(ImproperlyConfigured, match=f"{name} must be an http"):
        load_settings(**{name: bad})


def test_the_user_agent_names_the_app():
    assert "ELDTripPlanner" in load_settings().HTTP_USER_AGENT
    assert load_settings(HTTP_USER_AGENT="Custom/2 (me@example.com)").HTTP_USER_AGENT == "Custom/2 (me@example.com)"


def test_route_cache_lifetime_defaults_to_a_week():
    assert load_settings().ROUTE_CACHE_TTL_HOURS == 168
    assert load_settings(ROUTE_CACHE_TTL_HOURS="1").ROUTE_CACHE_TTL_HOURS == 1


def test_a_cache_lifetime_that_is_not_a_number_is_an_error():
    with pytest.raises(ImproperlyConfigured, match="ROUTE_CACHE_TTL_HOURS must be a whole number"):
        load_settings(ROUTE_CACHE_TTL_HOURS="a week")


def test_the_log_level_follows_the_environment():
    assert load_settings().LOGGING["root"]["level"] == "INFO"
    assert load_settings(DJANGO_LOG_LEVEL="WARNING").LOGGING["root"]["level"] == "WARNING"


def test_loading_settings_does_not_leak_into_the_running_environment():
    import os

    before = dict(os.environ)
    load_settings(DJANGO_SECRET_KEY="another-key-entirely-0123456789-abcdefghijklmnop")
    assert dict(os.environ) == before
