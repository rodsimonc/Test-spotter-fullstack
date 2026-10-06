"""Django settings. Everything that changes between machines comes from the environment.

See `.env.example` at the repo root for the full list of variables.
"""

from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlsplit

import dj_database_url
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent


def env_bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def env_list(name: str) -> list[str]:
    return [item.strip() for item in os.environ.get(name, "").split(",") if item.strip()]


def env_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ImproperlyConfigured(f"{name} must be a whole number, got {raw!r}.") from exc


def env_url(name: str, default: str) -> str:
    """Read a base URL for an upstream service and refuse anything that is not http(s)."""
    value = (os.environ.get(name, "").strip() or default).rstrip("/")
    parts = urlsplit(value)
    if parts.scheme not in {"http", "https"} or not parts.hostname:
        raise ImproperlyConfigured(f"{name} must be an http(s) URL, got {value!r}.")
    return value


DEBUG = env_bool("DJANGO_DEBUG", default=False)
ON_VERCEL = bool(os.environ.get("VERCEL"))

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    if not DEBUG:
        raise ImproperlyConfigured("DJANGO_SECRET_KEY is required. Set it, or set DJANGO_DEBUG=1 for local work.")
    SECRET_KEY = "django-insecure-local-development-only"  # noqa: S105

# Hosts and origins -----------------------------------------------------------------------

_vercel_hosts = [
    host for host in (os.environ.get("VERCEL_URL"), os.environ.get("VERCEL_PROJECT_PRODUCTION_URL")) if host
]

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS")
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS")
if ON_VERCEL:
    ALLOWED_HOSTS += [*_vercel_hosts, ".vercel.app"]
    CSRF_TRUSTED_ORIGINS += [f"https://{host}" for host in _vercel_hosts]

# Proxy handling. Off by default because X-Forwarded-* headers are trivial to spoof when the app
# is reachable without a proxy. Vercel overwrites them, so it is on by default there.
TRUST_PROXY_HEADERS = env_bool("TRUST_PROXY_HEADERS", default=ON_VERCEL)
# How many proxies append to X-Forwarded-For before a request reaches the app.
TRUSTED_PROXY_COUNT = max(1, env_int("TRUSTED_PROXY_COUNT", 1))
if TRUST_PROXY_HEADERS:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# Apps and middleware ---------------------------------------------------------------------

INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "rest_framework",
    "apps.accounts",
    "apps.planner",
    "apps.trips",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    # Checks the Host header against ALLOWED_HOSTS on every request, GETs included.
    "django.middleware.common.CommonMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
TEMPLATES: list[dict] = []  # JSON only. No admin, no browsable API, nothing renders HTML.
APPEND_SLASH = False

# Database --------------------------------------------------------------------------------

_database_url = os.environ.get("DATABASE_URL", "").strip()
if _database_url:
    # Serverless functions open a fresh connection per invocation, so none are kept alive.
    DATABASES = {"default": dj_database_url.parse(_database_url, conn_max_age=0)}
    if "postgresql" in DATABASES["default"]["ENGINE"]:
        # Pooled Postgres endpoints (Neon, pgbouncer) do not support server-side cursors.
        DATABASES["default"]["DISABLE_SERVER_SIDE_CURSORS"] = True
elif ON_VERCEL:
    raise ImproperlyConfigured("DATABASE_URL is required on Vercel. The function's disk is read-only and short-lived.")
else:
    DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": BASE_DIR / "db.sqlite3"}}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# The database cache backs request throttling, so counters are shared by every serverless
# instance. Create the table once with `manage.py createcachetable`.
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.db.DatabaseCache",
        "LOCATION": "django_cache",
        "OPTIONS": {"MAX_ENTRIES": 10_000, "CULL_FREQUENCY": 4},
    }
}

# Accounts --------------------------------------------------------------------------------

AUTH_USER_MODEL = "accounts.User"
SESSION_ENGINE = "django.contrib.sessions.backends.db"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"
CSRF_FAILURE_VIEW = "apps.common.views.csrf_failure"

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator",
        "OPTIONS": {"user_attributes": ("email", "name")},
    },
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# API -------------------------------------------------------------------------------------

REST_FRAMEWORK = {
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["apps.common.parsers.BoundedJSONParser"],
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.AllowAny"],
    "DEFAULT_THROTTLE_CLASSES": ["apps.common.throttling.ScopedIPThrottle"],
    "DEFAULT_THROTTLE_RATES": {
        "plan": "30/min",
        "geocode_search": "90/min",
        "geocode_reverse": "30/min",
        "login": "10/min",
        "register": "10/min",
        "trips": "60/min",
    },
    "EXCEPTION_HANDLER": "apps.common.exceptions.api_exception_handler",
    "URL_FORMAT_OVERRIDE": None,
    "UNAUTHENTICATED_USER": "django.contrib.auth.models.AnonymousUser",
    "TEST_REQUEST_DEFAULT_FORMAT": "json",
}

# Upstream services ------------------------------------------------------------------------

OSRM_BASE_URL = env_url("OSRM_BASE_URL", "https://router.project-osrm.org")
PHOTON_BASE_URL = env_url("PHOTON_BASE_URL", "https://photon.komoot.io")
NOMINATIM_BASE_URL = env_url("NOMINATIM_BASE_URL", "https://nominatim.openstreetmap.org")
# Nominatim's usage policy asks for a User-Agent that identifies the app and a way to reach you.
HTTP_USER_AGENT = os.environ.get("HTTP_USER_AGENT", "ELDTripPlanner/1.0 (assessment project; github.com/rodsimonc)")
ROUTE_CACHE_TTL_HOURS = env_int("ROUTE_CACHE_TTL_HOURS", 168)

# Limits ----------------------------------------------------------------------------------

DATA_UPLOAD_MAX_MEMORY_SIZE = 64 * 1024
MAX_TRIPS_PER_USER = 100
MAX_TRIP_RESULT_BYTES = 2 * 1024 * 1024
MAX_ROUTE_MILES = 10_000

# Security --------------------------------------------------------------------------------

SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
# OpenStreetMap's tile servers want a Referer, so cross-origin requests keep the origin.
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"

if not DEBUG:
    SECURE_SSL_REDIRECT = env_bool("DJANGO_SECURE_SSL_REDIRECT", default=True)
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = 31_536_000
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    # The preload token only signals eligibility. Nothing is submitted to the browser list.
    SECURE_HSTS_PRELOAD = True

# Internationalisation --------------------------------------------------------------------

LANGUAGE_CODE = "en-us"
USE_I18N = False  # Skips loading translation catalogs on every cold start.
USE_TZ = True
TIME_ZONE = "UTC"

# Logging ---------------------------------------------------------------------------------

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {"plain": {"format": "%(levelname)s %(name)s: %(message)s"}},
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "plain"}},
    "root": {"handlers": ["console"], "level": os.environ.get("DJANGO_LOG_LEVEL", "INFO")},
}
