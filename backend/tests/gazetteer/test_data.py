"""The bundled places.csv.gz: size, columns, and values a log remark can print."""

from __future__ import annotations

import csv
import gzip
from collections import Counter

import pytest

from apps.planner import gazetteer

from .helpers import DATA_FILE, towns

COLUMNS = ["name", "region", "country", "lat", "lon", "population"]
US_REGIONS = {
    "AK",
    "AL",
    "AR",
    "AZ",
    "CA",
    "CO",
    "CT",
    "DC",
    "DE",
    "FL",
    "GA",
    "HI",
    "IA",
    "ID",
    "IL",
    "IN",
    "KS",
    "KY",
    "LA",
    "MA",
    "MD",
    "ME",
    "MI",
    "MN",
    "MO",
    "MS",
    "MT",
    "NC",
    "ND",
    "NE",
    "NH",
    "NJ",
    "NM",
    "NV",
    "NY",
    "OH",
    "OK",
    "OR",
    "PA",
    "RI",
    "SC",
    "SD",
    "TN",
    "TX",
    "UT",
    "VA",
    "VT",
    "WA",
    "WI",
    "WV",
    "WY",
}
CA_REGIONS = {"AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"}
MX_REGIONS = {
    "AGU",
    "BCN",
    "BCS",
    "CAM",
    "CHH",
    "CHP",
    "CMX",
    "COA",
    "COL",
    "DUR",
    "GRO",
    "GUA",
    "HID",
    "JAL",
    "MEX",
    "MIC",
    "MOR",
    "NAY",
    "NLE",
    "OAX",
    "PUE",
    "QUE",
    "ROO",
    "SIN",
    "SLP",
    "SON",
    "TAB",
    "TAM",
    "TLA",
    "VER",
    "YUC",
    "ZAC",
}
#: Latitude and longitude boxes that hold every town of a country. Loose on purpose.
BOXES = {"US": (18.0, 72.0, -170.0, -66.0), "CA": (41.0, 84.0, -142.0, -52.0), "MX": (14.0, 33.0, -118.5, -86.0)}


def raw_rows() -> list[list[str]]:
    with gzip.open(DATA_FILE, "rt", encoding="utf-8", newline="") as handle:
        return list(csv.reader(handle))


def test_file_is_under_400_kb():
    assert DATA_FILE.stat().st_size < 400 * 1024


def test_file_is_not_a_stub():
    assert DATA_FILE.stat().st_size > 50 * 1024


def test_header_is_the_six_documented_columns():
    assert raw_rows()[0] == COLUMNS


def test_every_row_has_six_filled_fields():
    for row in raw_rows()[1:]:
        assert len(row) == 6, row
        assert all(field.strip() for field in row), row


def test_names_have_no_surrounding_space_and_read_on_one_line():
    for town in towns():
        assert town.name == town.name.strip()
        assert town.name.isascii(), town.name
        assert not any(mark in town.name for mark in ",/()[]"), town.name
        assert len(town.name) <= 40, town.name


def test_names_with_a_note_in_the_source_are_tidied():
    names = {t.name for t in towns()}
    assert not any("historical" in n.lower() for n in names)
    assert "Middlebury" in names
    assert "Middlebury (village)" not in names


def test_countries_and_regions():
    by_country: dict[str, set[str]] = {"US": set(), "CA": set(), "MX": set()}
    for town in towns():
        by_country[town.country].add(town.region)  # a KeyError means a country that should not be here
    assert by_country == {"US": US_REGIONS, "CA": CA_REGIONS, "MX": MX_REGIONS}


def test_every_town_sits_inside_its_country_box():
    for town in towns():
        south, north, west, east = BOXES[town.country]
        assert south <= town.lat <= north and west <= town.lon <= east, town


def test_every_town_has_at_least_5000_people():
    assert min(t.population for t in towns()) >= 5000


def test_no_town_is_listed_twice():
    keys = Counter((t.name, t.region, t.lat, t.lon) for t in towns())
    assert [k for k, n in keys.items() if n > 1] == []


def test_counts_are_plausible_for_cities5000():
    counts = Counter(t.country for t in towns())
    assert counts["US"] > 6500
    assert counts["CA"] > 600
    assert counts["MX"] > 1700


def test_rows_are_sorted_so_a_rebuild_changes_no_bytes():
    keys = [(t.country, t.region, t.name) for t in towns()]
    assert keys == sorted(keys)


def test_gzip_header_has_no_timestamp():
    with DATA_FILE.open("rb") as handle:
        header = handle.read(10)
    assert header[:2] == b"\x1f\x8b"
    assert header[4:8] == b"\x00\x00\x00\x00"


@pytest.mark.parametrize(
    ("name", "region", "country"),
    [
        ("Dallas", "TX", "US"),
        ("Memphis", "TN", "US"),
        ("Denver", "CO", "US"),
        ("Kearney", "NE", "US"),
        ("Chicago", "IL", "US"),
        ("Honolulu", "HI", "US"),
        ("Toronto", "ON", "CA"),
        ("Calgary", "AB", "CA"),
        ("Monterrey", "NLE", "MX"),
        ("Tijuana", "BCN", "MX"),
    ],
)
def test_well_known_towns_are_listed(name, region, country):
    assert any((t.name, t.region, t.country) == (name, region, country) for t in towns())


def test_the_lookup_loads_every_row():
    assert gazetteer.place_count() == len(towns())


def test_the_attribution_note_sits_next_to_the_data():
    note = (DATA_FILE.parent / "GEONAMES_ATTRIBUTION.md").read_text(encoding="utf-8")
    assert "GeoNames" in note
    assert "CC BY 4.0" in note
    assert "https://www.geonames.org" in note
