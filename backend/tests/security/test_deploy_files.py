"""The files that carry the app to Vercel: `vercel.json`, `api/index.py`, the requirement files
and `.env.example`. Nothing here runs on Vercel, so these tests check what can be checked at home."""

from __future__ import annotations

import ast
import importlib.metadata as metadata
import importlib.util
import json
import re
import sys
from pathlib import Path
from wsgiref.util import setup_testing_defaults

import pytest
from packaging.requirements import Requirement
from packaging.utils import canonicalize_name

from tests.support.prod_settings import ENV_NAMES

ROOT = Path(__file__).resolve().parents[3]
BACKEND = ROOT / "backend"
VERCEL = json.loads((ROOT / "vercel.json").read_text(encoding="utf-8"))

# The policy from the build spec, written out in full so a change to it has to be deliberate.
SPEC_CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob: https://*.tile.openstreetmap.org; connect-src 'self'; "
    "font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
)


def site_headers() -> dict[str, str]:
    block = next(h for h in VERCEL["headers"] if h["source"] == "/(.*)")
    return {item["key"]: item["value"] for item in block["headers"]}


def csp_directives() -> dict[str, list[str]]:
    policy = site_headers()["Content-Security-Policy"]
    return {d.split()[0]: d.split()[1:] for d in (part.strip() for part in policy.split(";")) if d}


# vercel.json -----------------------------------------------------------------------------------


def test_vercel_json_builds_the_frontend_into_the_output_folder():
    assert VERCEL["buildCommand"] == "cd frontend && npm ci && npm run build"
    assert VERCEL["outputDirectory"] == "frontend/dist"
    assert VERCEL["framework"] is None


def test_the_python_function_gets_the_backend_and_thirty_seconds():
    function = VERCEL["functions"]["api/index.py"]
    assert function["maxDuration"] == 30
    assert function["includeFiles"] == "backend/**"


def test_the_function_bundle_leaves_out_tests_and_local_tooling():
    excluded = VERCEL["functions"]["api/index.py"]["excludeFiles"]
    for folder in ("tests", ".venv", ".pytest_cache", ".ruff_cache", ".hypothesis"):
        assert folder in excluded


def test_api_calls_go_to_the_function_and_everything_else_to_the_app():
    assert VERCEL["rewrites"] == [
        {"source": "/api/(.*)", "destination": "/api/index"},
        {"source": "/(.*)", "destination": "/index.html"},
    ]


def test_the_function_file_the_rewrite_points_at_exists():
    assert (ROOT / "api" / "index.py").is_file()
    assert not [p for p in (ROOT / "api").iterdir() if p.suffix == ".py" and p.name != "index.py"], (
        "every .py file in api/ becomes its own function"
    )


def test_the_content_security_policy_is_the_one_in_the_spec():
    assert site_headers()["Content-Security-Policy"] == SPEC_CSP


def test_scripts_cannot_be_inline_or_from_elsewhere():
    directives = csp_directives()
    assert directives["script-src"] == ["'self'"]
    assert directives["default-src"] == ["'self'"]
    assert directives["connect-src"] == ["'self'"], "the page only talks to its own /api"
    assert directives["object-src"] == ["'none'"]
    assert directives["frame-ancestors"] == ["'none'"]
    assert "'unsafe-eval'" not in SPEC_CSP and "*" not in SPEC_CSP.replace("https://*.tile.openstreetmap.org", "")


def test_images_may_come_from_the_page_data_blobs_and_openstreetmap_tiles_only():
    assert csp_directives()["img-src"] == ["'self'", "data:", "blob:", "https://*.tile.openstreetmap.org"]


def test_the_other_security_headers_are_set_for_every_route():
    headers = site_headers()
    assert headers["Strict-Transport-Security"].startswith("max-age=31536000")
    assert "includeSubDomains" in headers["Strict-Transport-Security"]
    assert headers["X-Content-Type-Options"] == "nosniff"
    assert headers["X-Frame-Options"] == "DENY"
    assert headers["Referrer-Policy"] == "strict-origin-when-cross-origin"
    permissions = headers["Permissions-Policy"]
    for feature in ("geolocation", "camera", "microphone"):
        assert f"{feature}=()" in permissions


def test_the_referrer_policy_matches_what_django_sends(settings):
    assert site_headers()["Referrer-Policy"] == settings.SECURE_REFERRER_POLICY
    assert site_headers()["X-Frame-Options"] == settings.X_FRAME_OPTIONS


def test_the_policy_matches_the_one_vite_preview_serves():
    """`npm run preview` is how the production build is checked locally. Both must agree."""
    source = (ROOT / "frontend" / "vite.config.ts").read_text(encoding="utf-8")
    block = re.search(r"const csp = \[(.*?)\]\.join\('; '\)", source, re.S)
    assert block, "vite.config.ts no longer defines `const csp`"
    assert "; ".join(re.findall(r'"([^"]+)"', block.group(1))) == SPEC_CSP


def test_hashed_assets_are_cached_for_a_year_and_nothing_else_is():
    rule = next(h for h in VERCEL["headers"] if h["source"] == "/assets/(.*)")
    assert rule["headers"] == [{"key": "Cache-Control", "value": "public, max-age=31536000, immutable"}]
    assert not [h for h in VERCEL["headers"] if h["source"] == "/(.*)" and "Cache-Control" in str(h)]


# api/index.py ----------------------------------------------------------------------------------


@pytest.fixture
def entry_point():
    spec = importlib.util.spec_from_file_location("vercel_entry_point", ROOT / "api" / "index.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def call_wsgi(app, path: str, method: str = "GET") -> tuple[str, dict[str, str], bytes]:
    environ = {"PATH_INFO": path, "REQUEST_METHOD": method}
    setup_testing_defaults(environ)
    environ["HTTP_HOST"] = "testserver"
    seen: dict = {}

    def start_response(status, headers, exc_info=None):
        seen["status"], seen["headers"] = status, dict(headers)

    body = b"".join(app(environ, start_response))
    return seen["status"], seen["headers"], body


def test_the_entry_point_exposes_a_wsgi_callable_named_app(entry_point):
    assert callable(entry_point.app)
    assert entry_point.__all__ == ["app"]


def test_the_entry_point_answers_a_request_through_django(entry_point):
    status, headers, body = call_wsgi(entry_point.app, "/api/health")
    assert status == "200 OK"
    assert json.loads(body) == {"status": "ok"}
    assert headers["Content-Type"] == "application/json"


def test_the_entry_point_keeps_the_original_path_so_routing_works(entry_point):
    status, _headers, body = call_wsgi(entry_point.app, "/api/nope")
    assert status == "404 Not Found"
    assert json.loads(body)["error"]["code"] == "not_found"


def test_the_entry_point_puts_the_backend_folder_on_the_path(entry_point):
    assert str(BACKEND) in sys.path


def test_importing_the_entry_point_twice_does_not_grow_the_path(entry_point):
    before = sys.path.count(str(BACKEND))
    spec = importlib.util.spec_from_file_location("vercel_entry_point_again", ROOT / "api" / "index.py")
    spec.loader.exec_module(importlib.util.module_from_spec(spec))
    assert sys.path.count(str(BACKEND)) == before


# Requirements ----------------------------------------------------------------------------------


def read_pins(path: Path) -> dict[str, str]:
    pins = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line or line.startswith("-"):
            continue
        requirement = Requirement(line)
        specifier = str(requirement.specifier)
        assert specifier.startswith("=="), f"{line!r} is not pinned with =="
        pins[canonicalize_name(requirement.name)] = specifier[2:]
    return pins


PROD = read_pins(ROOT / "requirements.txt")
DEV = read_pins(BACKEND / "requirements-dev.txt")
TARGET = {  # what Vercel and CI run: Linux on Python 3.12
    "python_version": "3.12",
    "python_full_version": "3.12.0",
    "sys_platform": "linux",
    "platform_system": "Linux",
    "os_name": "posix",
    "implementation_name": "cpython",
    "platform_python_implementation": "CPython",
    "extra": "",
}


def test_every_production_requirement_is_pinned_to_the_version_installed_here():
    for name, version in PROD.items():
        try:
            installed = metadata.version(name)
        except metadata.PackageNotFoundError:
            continue  # a marker-only package, such as typing-extensions on Python 3.14
        assert installed == version, f"{name}: requirements.txt pins {version}, the venv has {installed}"


def test_every_dev_requirement_is_pinned_to_the_version_installed_here():
    for name, version in DEV.items():
        assert metadata.version(name) == version, name


def test_production_requirements_hold_no_test_or_lint_tools():
    tools = {"pytest", "pytest-django", "pytest-cov", "coverage", "hypothesis", "responses", "ruff", "pip-audit"}
    assert not tools & PROD.keys()


def test_dev_requirements_include_production_ones_and_every_tool_the_tests_use():
    text = (BACKEND / "requirements-dev.txt").read_text(encoding="utf-8")
    assert "-r ../requirements.txt" in text
    assert {"pytest", "pytest-django", "pytest-cov", "hypothesis", "responses", "ruff", "pip-audit"} <= DEV.keys()


def test_the_production_pins_cover_every_dependency_pip_would_install_on_linux_and_python_312():
    needed: set[str] = set()

    def walk(name: str) -> None:
        try:
            requires = metadata.requires(name) or []
        except metadata.PackageNotFoundError:
            return
        for line in requires:
            requirement = Requirement(line)
            if requirement.marker and not requirement.marker.evaluate(TARGET):
                continue
            key = canonicalize_name(requirement.name)
            if key not in needed:
                needed.add(key)
                walk(key)

    for name in PROD:
        walk(name)
    missing = needed - PROD.keys()
    assert not missing, f"not pinned in requirements.txt: {sorted(missing)}"


def test_the_code_imports_nothing_that_requirements_txt_lacks():
    modules: set[str] = set()
    for folder in (BACKEND / "apps", BACKEND / "config", ROOT / "api"):
        for path in folder.rglob("*.py"):
            for node in ast.walk(ast.parse(path.read_text(encoding="utf-8-sig"))):
                if isinstance(node, ast.Import):
                    modules |= {a.name.split(".")[0] for a in node.names}
                elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
                    modules.add(node.module.split(".")[0])
    local = {"apps", "config"}
    third_party = {m for m in modules - local if m not in sys.stdlib_module_names and m != "__future__"}
    owners = metadata.packages_distributions()
    for module in sorted(third_party):
        distributions = {canonicalize_name(d) for d in owners.get(module, [])}
        assert distributions & PROD.keys(), f"{module} is imported but no package in requirements.txt provides it"


def test_psycopg_has_the_binary_wheel_so_vercel_needs_no_compiler():
    assert "psycopg-binary" in PROD and PROD["psycopg"] == PROD["psycopg-binary"]


def test_the_python_version_file_asks_for_3_12():
    assert (ROOT / ".python-version").read_text(encoding="utf-8").strip() == "3.12"


# .env.example -----------------------------------------------------------------------------------


def env_example() -> dict[str, str]:
    values = {}
    for line in (ROOT / ".env.example").read_text(encoding="utf-8").splitlines():
        if line.strip() and not line.lstrip().startswith("#"):
            key, _, value = line.partition("=")
            values[key.strip()] = value.strip()
    return values


def test_env_example_lists_every_variable_the_settings_read():
    listed = env_example()
    provided_by_vercel = {name for name in ENV_NAMES if name.startswith("VERCEL")}
    missing = [name for name in ENV_NAMES if name not in provided_by_vercel and name not in listed]
    assert not missing, f".env.example doesn't mention {missing}"


def test_env_example_has_no_secret_values():
    listed = env_example()
    for name in ("DJANGO_SECRET_KEY", "DATABASE_URL", "DJANGO_DEBUG", "CSRF_TRUSTED_ORIGINS"):
        assert listed[name] == "", f"{name} should be blank in the example file"
    assert "@" not in listed["HTTP_USER_AGENT"].replace("you@example.com", "")


def test_blank_values_in_env_example_behave_like_unset_variables():
    """Copying the file and filling in only the secret key must give the documented defaults."""
    from tests.support.prod_settings import load_settings

    copied = {name: (value or None) for name, value in env_example().items() if name != "DJANGO_SECRET_KEY"}
    module = load_settings(**copied)

    assert module.DEBUG is False
    assert module.SECURE_SSL_REDIRECT is True
    assert module.TRUST_PROXY_HEADERS is False and module.TRUSTED_PROXY_COUNT == 1
    assert module.CSRF_TRUSTED_ORIGINS == []
    assert module.DATABASES["default"]["ENGINE"] == "django.db.backends.sqlite3"
    assert module.OSRM_BASE_URL == "https://router.project-osrm.org"
    assert module.PHOTON_BASE_URL == "https://photon.komoot.io"
    assert module.NOMINATIM_BASE_URL == "https://nominatim.openstreetmap.org"
    assert module.ROUTE_CACHE_TTL_HOURS == 168


def test_env_example_without_a_secret_key_fails_fast_unless_debug_is_on():
    from django.core.exceptions import ImproperlyConfigured

    from tests.support.prod_settings import load_settings

    copied = {name: (value or None) for name, value in env_example().items()}
    with pytest.raises(ImproperlyConfigured):
        load_settings(**copied)
    assert load_settings(**{**copied, "DJANGO_DEBUG": "1"}).DEBUG is True
