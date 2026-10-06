"""Load `config/settings.py` fresh under a chosen environment, without touching the live settings."""

from __future__ import annotations

import importlib.util
import os
import types
from pathlib import Path

SETTINGS_FILE = Path(__file__).resolve().parents[2] / "config" / "settings.py"

#: Every variable settings.py reads. They are cleared first so the caller's shell can't leak in.
ENV_NAMES = (
    "DJANGO_SECRET_KEY",
    "DJANGO_DEBUG",
    "DJANGO_ALLOWED_HOSTS",
    "CSRF_TRUSTED_ORIGINS",
    "DJANGO_SECURE_SSL_REDIRECT",
    "DJANGO_LOG_LEVEL",
    "DATABASE_URL",
    "OSRM_BASE_URL",
    "PHOTON_BASE_URL",
    "NOMINATIM_BASE_URL",
    "HTTP_USER_AGENT",
    "ROUTE_CACHE_TTL_HOURS",
    "TRUST_PROXY_HEADERS",
    "TRUSTED_PROXY_COUNT",
    "VERCEL",
    "VERCEL_URL",
    "VERCEL_PROJECT_PRODUCTION_URL",
)

PROD_ENV = {
    "DJANGO_DEBUG": "0",
    "DJANGO_SECRET_KEY": "k7#Qp9vX!m2Zr8Lw4Tn6Yb1Hc5Jd3Fs0Gx-Aa_Ee+Uu%Oo^Ii&Kk*Mm(Nn)Pp",
    "DJANGO_ALLOWED_HOSTS": "trips.example.com",
}

#: Settings that decide security behaviour. Tests copy these onto the live settings object.
SECURITY_PREFIXES = (
    "SECURE_",
    "SESSION_COOKIE_",
    "CSRF_COOKIE_",
    "X_FRAME_OPTIONS",
    "TRUST_PROXY_HEADERS",
    "TRUSTED_PROXY_COUNT",
    "ALLOWED_HOSTS",
    "CSRF_TRUSTED_ORIGINS",
)


def load_settings(**env: str) -> types.ModuleType:
    """Execute settings.py with `PROD_ENV` plus `env`. Pass `None` to unset a variable."""
    saved = {name: os.environ.get(name) for name in ENV_NAMES}
    try:
        for name in ENV_NAMES:
            os.environ.pop(name, None)
        for name, value in {**PROD_ENV, **env}.items():
            if value is not None:
                os.environ[name] = value
        spec = importlib.util.spec_from_file_location("settings_under_test", SETTINGS_FILE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        for name, value in saved.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value


def security_values(module: types.ModuleType) -> dict[str, object]:
    return {
        name: getattr(module, name) for name in dir(module) if name.isupper() and name.startswith(SECURITY_PREFIXES)
    }
