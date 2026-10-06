"""`manage.py check --deploy` is the last gate before a release, and `migrate` plus
`createcachetable` are the two commands a deploy runs. The slow tests start the real command in a
subprocess. The rest run the same checks in-process."""

from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
from io import StringIO
from pathlib import Path

import pytest
from django.core.management import call_command
from django.core.management.base import SystemCheckError

BACKEND = Path(__file__).resolve().parents[2]
SECRET = "k7#Qp9vX!m2Zr8Lw4Tn6Yb1Hc5Jd3Fs0Gx-Aa_Ee+Uu%Oo^Ii&Kk*Mm(Nn)Pp"
KEEP_FROM_SHELL = {"PATH", "SYSTEMROOT", "TEMP", "TMP", "HOME", "USERPROFILE"}


def manage(*args: str, database: Path, **env: str | None) -> subprocess.CompletedProcess:
    """Run manage.py in a clean, production-like environment. Pass None to unset a variable."""
    clean = {k: v for k, v in os.environ.items() if k in KEEP_FROM_SHELL}
    clean.update(
        {
            "DJANGO_SETTINGS_MODULE": "config.settings",
            "DJANGO_SECRET_KEY": SECRET,
            "DJANGO_ALLOWED_HOSTS": "trips.example.com",
            "DATABASE_URL": f"sqlite:///{database.as_posix()}",
            "PYTHONDONTWRITEBYTECODE": "1",
        }
    )
    for name, value in env.items():
        if value is None:
            clean.pop(name, None)
        else:
            clean[name] = value
    return subprocess.run(
        [sys.executable, "manage.py", *args],
        cwd=BACKEND,
        env=clean,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )


# The real command ---------------------------------------------------------------------------


@pytest.mark.slow
def test_check_deploy_is_clean_with_a_production_like_environment(tmp_path):
    result = manage("check", "--deploy", "--fail-level", "WARNING", database=tmp_path / "db.sqlite3")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "no issues" in result.stdout


@pytest.mark.slow
def test_check_deploy_is_clean_with_vercel_and_postgres_settings(tmp_path):
    result = manage(
        "check",
        "--deploy",
        "--fail-level",
        "WARNING",
        database=tmp_path / "unused.sqlite3",
        VERCEL="1",
        VERCEL_URL="trips-abc.vercel.app",
        DATABASE_URL="postgresql://user:pw@ep-pooler.neon.example/trips?sslmode=require",
    )
    assert result.returncode == 0, result.stdout + result.stderr


@pytest.mark.slow
def test_a_missing_secret_key_stops_the_command_before_it_runs(tmp_path):
    result = manage("check", "--deploy", database=tmp_path / "db.sqlite3", DJANGO_SECRET_KEY=None)
    assert result.returncode != 0
    assert "DJANGO_SECRET_KEY is required" in result.stderr


@pytest.fixture(scope="module")
def deployed(tmp_path_factory):
    """What a deploy does to an empty database: migrate, then createcachetable (twice, to prove it repeats)."""
    database = tmp_path_factory.mktemp("deploy") / "db.sqlite3"
    runs = [
        manage("migrate", "--noinput", database=database),
        manage("createcachetable", database=database),
        manage("createcachetable", database=database),
    ]
    return database, runs


@pytest.mark.slow
def test_migrate_and_createcachetable_succeed_on_a_fresh_sqlite_database(deployed):
    for run in deployed[1]:
        assert run.returncode == 0, run.stdout + run.stderr


@pytest.mark.slow
def test_a_deploy_creates_every_table_the_app_reads_and_writes(deployed):
    with sqlite3.connect(deployed[0]) as db:
        tables = {row[0] for row in db.execute("select name from sqlite_master where type = 'table'")}
    assert {"accounts_user", "trips_trip", "planner_routecache", "django_session", "django_cache"} <= tables


@pytest.mark.slow
def test_the_database_enforces_lowercase_emails_after_a_real_migrate(deployed):
    with sqlite3.connect(deployed[0]) as db, pytest.raises(sqlite3.IntegrityError):
        db.execute(
            "insert into accounts_user (password, is_superuser, email, name, is_active, is_staff, date_joined)"
            " values ('x', 0, 'Upper@Example.com', '', 1, 0, '2026-01-01')"
        )


# The same checks without a subprocess --------------------------------------------------------


def run_deploy_check() -> None:
    call_command("check", deploy=True, fail_level="WARNING", stdout=StringIO(), stderr=StringIO())


def test_the_production_security_settings_pass_the_deploy_check_in_process(prod_security):
    run_deploy_check()


def test_a_weak_secret_key_is_caught(prod_security, settings):
    settings.SECRET_KEY = "short"
    with pytest.raises(SystemCheckError, match="security.W009"):
        run_deploy_check()


def test_no_https_redirect_is_caught(prod_security, settings):
    settings.SECURE_SSL_REDIRECT = False
    with pytest.raises(SystemCheckError, match="security.W008"):
        run_deploy_check()


def test_insecure_cookies_are_caught(prod_security, settings):
    settings.SESSION_COOKIE_SECURE = False
    settings.CSRF_COOKIE_SECURE = False
    with pytest.raises(SystemCheckError) as caught:
        run_deploy_check()
    assert "security.W012" in str(caught.value) and "security.W016" in str(caught.value)


def test_missing_hsts_is_caught(prod_security, settings):
    settings.SECURE_HSTS_SECONDS = 0
    with pytest.raises(SystemCheckError, match="security.W004"):
        run_deploy_check()


def test_debug_mode_is_caught(prod_security, settings):
    settings.DEBUG = True
    with pytest.raises(SystemCheckError, match="security.W018"):
        run_deploy_check()


def test_every_model_change_has_a_migration():
    out = StringIO()
    try:
        call_command("makemigrations", check=True, dry_run=True, stdout=out)
    except SystemExit:
        pytest.fail("A model changed without a migration:\n" + out.getvalue())


def sql_for(app: str, migration: str = "0001") -> str:
    out = StringIO()
    call_command("sqlmigrate", app, migration, stdout=out)
    return out.getvalue()


# SQLite's schema editor can't run inside the transaction that wraps an ordinary test.
@pytest.mark.django_db(transaction=True)
def test_the_trips_migration_makes_a_uuid_keyed_table_with_the_owner_index():
    sql = sql_for("trips")
    assert 'CREATE TABLE "trips_trip"' in sql
    assert '"id" char(32) NOT NULL PRIMARY KEY' in sql, "SQLite stores UUIDs as char(32). Postgres gets uuid."
    assert 'CREATE INDEX "trips_owner_created_idx" ON "trips_trip" ("owner_id", "created_at" DESC)' in sql


@pytest.mark.django_db(transaction=True)
def test_the_user_migration_has_the_lowercase_check_constraint():
    assert 'CHECK ("email" = (LOWER("email")))' in sql_for("accounts")


@pytest.mark.django_db(transaction=True)
def test_the_route_cache_migration_indexes_created_at():
    assert 'CREATE INDEX "planner_routecache_created_at' in sql_for("planner")


def test_only_portable_field_types_are_used():
    """JSONField, UUIDField and CharField behave the same on SQLite and Postgres."""
    from django.apps import apps

    allowed = {
        "BigAutoField",
        "CharField",
        "EmailField",
        "BooleanField",
        "DateTimeField",
        "JSONField",
        "UUIDField",
        "ForeignKey",
        "ManyToManyField",
    }
    used = {
        type(field).__name__
        for label in ("accounts", "trips", "planner")
        for model in apps.get_app_config(label).get_models()
        for field in model._meta.get_fields()
        if getattr(field, "column", None) or field.many_to_many
    }
    assert used <= allowed, used - allowed
