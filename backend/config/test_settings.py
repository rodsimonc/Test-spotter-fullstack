"""Settings for the test suite.

The same as production, minus the parts that need real HTTPS and a real database. Tests that
care about the production values load `config.settings` under a controlled environment instead
(see `tests/support/prod_settings.py`).
"""

import os

# Set before importing the real settings so a developer's own environment can't leak in.
os.environ["DJANGO_DEBUG"] = "0"
os.environ["DJANGO_SECRET_KEY"] = "test-only-secret-key-do-not-use-anywhere-else-0123456789"
os.environ["DJANGO_ALLOWED_HOSTS"] = "testserver,localhost"
os.environ["TRUST_PROXY_HEADERS"] = "0"
for name in ("DATABASE_URL", "VERCEL", "CSRF_TRUSTED_ORIGINS", "ROUTE_CACHE_TTL_HOURS"):
    os.environ.pop(name, None)
os.environ["OSRM_BASE_URL"] = "https://osrm.test"
os.environ["PHOTON_BASE_URL"] = "https://photon.test"
os.environ["NOMINATIM_BASE_URL"] = "https://nominatim.test"

from config.settings import *  # noqa: E402, F403

DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}}
SECURE_SSL_REDIRECT = False
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False
# Hashing is slow on purpose. Tests make hundreds of users.
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
