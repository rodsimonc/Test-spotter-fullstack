"""Nothing secret reaches a response body, a header or a cookie, and nothing debuggable is exposed."""

from __future__ import annotations

import re

import pytest
from django.conf import settings

from tests.support.osrm import CHICAGO, PHOTON_SEARCH, photon_payload, register_osrm

PASSWORD = "Zx9-battery-staple-42"


@pytest.fixture(autouse=True)
def upstreams(rsps):
    register_osrm(rsps)
    rsps.add("GET", PHOTON_SEARCH, json=photon_payload(CHICAGO))
    rsps.add("GET", "https://nominatim.test/reverse", json={"error": "Unable to geocode"})


def everything_a_client_could_read(response) -> str:
    headers = "\n".join(f"{k}: {v}" for k, v in response.headers.items())
    cookies = "\n".join(f"{name}={morsel.value}" for name, morsel in response.cookies.items())
    return response.content.decode(errors="replace") + "\n" + headers + "\n" + cookies


def sweep(api, plan_payload, user) -> list[str]:
    """Responses from every endpoint, good and bad, as one list of text blobs."""
    seen = [
        api.get("/api/health"),
        api.get("/api/auth/csrf"),
        api.get("/api/auth/me"),
        api.get("/api/geocode/search?q=chicago"),
        api.get("/api/geocode/reverse?lat=41.9&lon=-87.6"),
        api.post("/api/plan", plan_payload, format="json"),
        api.post("/api/plan", {}, format="json"),
        api.get("/api/trips"),
        api.get("/api/nope"),
        api.post("/api/auth/login", {"email": user.email, "password": "wrong-password-1"}, format="json"),
        api.post("/api/auth/login", {"email": user.email, "password": PASSWORD}, format="json"),
        api.get("/api/auth/me"),
        api.post("/api/trips", {"request": plan_payload}, format="json"),
        api.get("/api/trips"),
        api.post("/api/auth/logout"),
    ]
    return [everything_a_client_could_read(r) for r in seen]


@pytest.fixture
def known_secrets(user):
    user.set_password(PASSWORD)
    user.save()
    return {
        "the secret key": settings.SECRET_KEY,
        "the password": PASSWORD,
        "the password hash": user.password,
        "the hash salt": user.password.split("$")[1] if "$" in user.password else "no-salt",
    }


def test_no_response_contains_a_secret(api, plan_payload, user, known_secrets):
    for blob in sweep(api, plan_payload, user):
        for label, secret in known_secrets.items():
            assert secret not in blob, f"{label} leaked"


def test_responses_never_name_the_stack(api, plan_payload, user):
    for blob in sweep(api, plan_payload, user):
        for word in (
            "Traceback",
            "site-packages",
            "Django version",
            "settings.py",
            "DEBUG = True",
            "/backend/",
            "\\backend\\",
        ):
            assert word not in blob, word


def test_the_session_id_only_ever_travels_in_the_cookie(api, user):
    response = api.post("/api/auth/login", {"email": user.email, "password": PASSWORD}, format="json")
    session_id = response.cookies["sessionid"].value
    assert session_id and session_id not in response.content.decode()
    assert session_id not in "".join(f"{k}{v}" for k, v in response.headers.items() if k.lower() != "set-cookie")


def test_the_user_object_is_only_id_email_and_name(api, user):
    data = api.post("/api/auth/login", {"email": user.email, "password": PASSWORD}, format="json").json()["user"]
    assert set(data) == {"id", "email", "name"}


def test_trips_list_never_includes_another_users_email_or_id(auth_api, other_api_for_secrets, plan_payload):
    auth_api.post("/api/trips", {"request": plan_payload}, format="json")
    text = auth_api.get("/api/trips").content.decode()
    assert "other.driver@example.com" not in text
    assert '"owner"' not in text


@pytest.fixture
def other_api_for_secrets(make_user):
    make_user("other.driver@example.com", PASSWORD)


@pytest.mark.parametrize(
    "path",
    [
        "/admin/",
        "/admin/login/",
        "/api/admin",
        "/api/schema",
        "/api/docs",
        "/api/swagger",
        "/api/settings",
        "/api/debug",
        "/api/env",
        "/api/users",
        "/api/auth/users",
        "/api/auth/password",
        "/api/auth/password-reset",
        "/static/admin/css/base.css",
        "/.env",
        "/.git/config",
        "/backend/config/settings.py",
        "/manage.py",
        "/db.sqlite3",
        "/api/..%2f..%2fetc%2fpasswd",
        "/api/%2e%2e/%2e%2e/etc/passwd",
    ],
)
def test_debug_and_admin_urls_do_not_exist(api, path):
    response = api.get(path)
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_the_browsable_api_is_off(api):
    for accept in ("text/html", "text/html,application/xhtml+xml,*/*;q=0.8"):
        response = api.get("/api/health", HTTP_ACCEPT=accept)
        assert "text/html" not in response["Content-Type"]


def test_debug_is_off_under_test_settings():
    assert settings.DEBUG is False


def test_the_secret_key_in_use_is_not_the_development_fallback():
    assert not settings.SECRET_KEY.startswith("django-insecure-")


def test_the_test_secret_key_is_not_a_value_a_deployment_would_copy():
    assert "test-only" in settings.SECRET_KEY


def test_set_cookie_headers_never_carry_the_secret_key(api, user):
    response = api.post("/api/auth/login", {"email": user.email, "password": PASSWORD}, format="json")
    assert all(settings.SECRET_KEY not in str(m.coded_value) for m in response.cookies.values())


def test_the_csrf_token_is_not_the_cookie_secret(api):
    """Django hands the page a masked copy, so the cookie value can't be read off the body."""
    response = api.get("/api/auth/csrf")
    assert response.json()["csrf"] != response.cookies["csrftoken"].value
    assert len(response.json()["csrf"]) == 64 and len(response.cookies["csrftoken"].value) == 32


# Files that ship ------------------------------------------------------------------------------

ROOT = __import__("pathlib").Path(__file__).resolve().parents[3]
SHIPPED = [
    *ROOT.joinpath("backend", "apps").rglob("*.py"),
    *ROOT.joinpath("backend", "config").rglob("*.py"),
    ROOT / "api" / "index.py",
    ROOT / "vercel.json",
    ROOT / ".env.example",
    ROOT / "requirements.txt",
]
SECRET_PATTERNS = {
    "a private key": re.compile(r"-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"),
    "an AWS access key": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    "a GitHub token": re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}\b"),
    "a Slack token": re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}\b"),
    # The placeholder PASSWORD in `.env.example` is fine. A real-looking value is not.
    "a URL with a password": re.compile(
        r"\b[a-z+]+://[^/\s:@'\"]+:(?!PASSWORD@)[^/\s@'\"<>]{3,}@(?!example\.|localhost|127\.)"
    ),
    # The loud `django-insecure-` fallback for DJANGO_DEBUG=1 is allowed. Anything else is not.
    "a long hex or base64 secret assigned to a key": re.compile(
        r"(?i)(secret|token|password|api_key)\w*\s*[:=]\s*['\"](?!django-insecure-)[A-Za-z0-9+/=_-]{32,}['\"]"
    ),
}


@pytest.mark.parametrize("path", SHIPPED, ids=lambda p: p.relative_to(ROOT).as_posix())
def test_shipped_files_hold_no_credentials(path):
    text = path.read_text(encoding="utf-8")
    for label, pattern in SECRET_PATTERNS.items():
        match = pattern.search(text)
        assert not match, f"{path.name} looks like it contains {label}: {match.group(0)[:40]!r}"
