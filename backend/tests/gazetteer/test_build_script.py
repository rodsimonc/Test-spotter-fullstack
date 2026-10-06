"""scripts/build_gazetteer.py: filters, region codes, name tidying and repeatable output."""

from __future__ import annotations

import csv
import gzip
import importlib.util
import os
from pathlib import Path

import pytest

from .helpers import DATA_FILE

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "build_gazetteer.py"


def _load_script():
    spec = importlib.util.spec_from_file_location("build_gazetteer", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


build = _load_script()


def geonames_line(
    name: str,
    country: str = "US",
    admin1: str = "NE",
    lat: float = 40.699,
    lon: float = -99.081,
    population: int = 33021,
    feature_code: str = "PPL",
    ascii_name: str | None = None,
) -> str:
    """One row in the 19-column tab-separated layout of the GeoNames dump."""
    columns = [
        "1",
        name,
        ascii_name if ascii_name is not None else name,
        "",
        str(lat),
        str(lon),
        "P",
        feature_code,
        country,
        "",
        admin1,
        "",
        "",
        "",
        str(population),
        "",
        "",
        "America/Chicago",
        "2024-01-01",
    ]
    return "\t".join(columns)


def write_dump(path: Path, lines: list[str]) -> Path:
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def read_csv_gz(path: Path) -> list[list[str]]:
    with gzip.open(path, "rt", encoding="utf-8", newline="") as handle:
        return list(csv.reader(handle))


# --- regions -------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("country", "admin1", "expected"),
    [
        ("US", "NE", "NE"),
        ("US", "DC", "DC"),
        ("US", "00", None),
        ("US", "", None),
        ("US", "NEB", None),
        ("CA", "08", "ON"),
        ("CA", "01", "AB"),
        ("CA", "10", "QC"),
        ("CA", "06", None),  # GeoNames has no province 06
        ("MX", "19", "NLE"),
        ("MX", "14", "JAL"),
        ("MX", "09", "CMX"),
        ("MX", "99", None),
    ],
)
def test_region_codes(country, admin1, expected):
    assert build.region_for(country, admin1) == expected


def test_every_canadian_and_mexican_code_maps_to_a_distinct_region():
    assert len(set(build.CANADA.values())) == len(build.CANADA) == 13
    assert len(set(build.MEXICO.values())) == len(build.MEXICO) == 32


# --- names ---------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Kearney", "Kearney"),
        ("Middlebury (village)", "Middlebury"),
        ("Real del Valle (El Paraiso) [Fraccionamiento]", "Real del Valle"),
        ("Villas de la Hacienda [Fraccionamiento]", "Villas de la Hacienda"),
        ("Cuitzeo  (La Estancia)", "Cuitzeo"),
        ("Portugal Cove-St. Phillip's", "Portugal Cove-St. Phillip's"),
        ("Riviere-des-Prairies-Pointe-aux-Trembles", "Riviere-des-Prairies-Pointe-aux-Trembles"),  # 40 characters
        ("Pope Air Force Base  (historical)", None),
        ("Alton North (HISTORICAL)", None),
        ("Diamond Head / Kapahulu / Saint Louis Heights", None),
        ("West Cambridge/Harvard Square", None),
        ("VA Boston Healthcare System, Brockton Campus", None),
        ("Unidad Habitacional Jose Maria Morelos y Pavon", None),  # 46 characters
        ("(just a note)", None),
        ("", None),
    ],
)
def test_clean_name(raw, expected):
    assert build.clean_name(raw) == expected


# --- reading the dump ----------------------------------------------------------------------------


def test_read_rows_keeps_the_three_countries_and_drops_the_rest(tmp_path):
    dump = write_dump(
        tmp_path / "cities5000.txt",
        [
            geonames_line("Kearney", "US", "NE", 40.699, -99.081, 33021, ascii_name="Kearney"),
            geonames_line("Toronto", "CA", "08", 43.70011, -79.4163, 2794356, ascii_name="Toronto"),
            geonames_line("Monterrey", "MX", "19", 25.67507, -100.31847, 1135512, ascii_name="Monterrey"),
            geonames_line("Paris", "FR", "11", 48.85341, 2.3488, 2138551, ascii_name="Paris"),
        ],
    )
    rows, skipped = build.read_rows(dump)
    assert skipped == 0
    assert rows == [
        ("Toronto", "ON", "CA", "43.700", "-79.416", 2794356),
        ("Monterrey", "NLE", "MX", "25.675", "-100.318", 1135512),
        ("Kearney", "NE", "US", "40.699", "-99.081", 33021),
    ]


def test_read_rows_uses_the_ascii_name_column(tmp_path):
    dump = write_dump(tmp_path / "d.txt", [geonames_line("Montréal", "CA", "10", ascii_name="Montreal")])
    rows, _ = build.read_rows(dump)
    assert rows[0][0] == "Montreal"


def test_read_rows_skips_sections_of_a_city_and_abandoned_places(tmp_path):
    dump = write_dump(
        tmp_path / "d.txt",
        [
            geonames_line("Moss Park", "CA", "08", feature_code="PPLX"),
            geonames_line("Ghost Town", "US", "NV", feature_code="PPLQ"),
            geonames_line("Old Place", "US", "NV", feature_code="PPLH"),
            geonames_line("Drowned Place", "US", "NV", feature_code="PPLW"),
            geonames_line("Reno", "US", "NV", feature_code="PPLA2"),
        ],
    )
    rows, skipped = build.read_rows(dump)
    assert [r[0] for r in rows] == ["Reno"]
    assert skipped == 0


def test_read_rows_counts_what_it_could_not_place(tmp_path):
    dump = write_dump(
        tmp_path / "d.txt",
        [
            geonames_line("No Region", "US", "00"),
            geonames_line("Bad Province", "CA", "06"),
            geonames_line("Pope Air Force Base (historical)", "US", "NC"),
            geonames_line("Fine", "US", "NC"),
        ],
    )
    rows, skipped = build.read_rows(dump)
    assert [r[0] for r in rows] == ["Fine"]
    assert skipped == 3


def test_tidying_that_makes_two_rows_identical_keeps_the_bigger_population(tmp_path):
    dump = write_dump(
        tmp_path / "d.txt",
        [
            geonames_line("Jesus Gomez Portugal (Margaritas)", "MX", "01", 21.999, -102.291, 11589),
            geonames_line("Jesus Gomez Portugal", "MX", "01", 21.999, -102.291, 9000),
        ],
    )
    rows, _ = build.read_rows(dump)
    assert rows == [("Jesus Gomez Portugal", "AGU", "MX", "21.999", "-102.291", 11589)]


def test_two_towns_with_one_name_in_one_region_both_stay(tmp_path):
    dump = write_dump(
        tmp_path / "d.txt",
        [
            geonames_line("Franklin", "US", "TN", 35.925, -86.869, 83454),
            geonames_line("Franklin", "US", "TN", 36.7, -87.0, 6000),
        ],
    )
    rows, _ = build.read_rows(dump)
    assert [(r[0], r[3]) for r in rows] == [("Franklin", "35.925"), ("Franklin", "36.700")]


def test_row_order_does_not_depend_on_the_order_of_the_dump(tmp_path):
    lines = [
        geonames_line("Zeta", "US", "TX", 31.0, -100.0),
        geonames_line("Alpha", "US", "TX", 32.0, -100.0),
        geonames_line("Beta", "US", "AL", 33.0, -86.0),
        geonames_line("Gamma", "CA", "01", 51.0, -114.0),
    ]
    forward, _ = build.read_rows(write_dump(tmp_path / "a.txt", lines))
    backward, _ = build.read_rows(write_dump(tmp_path / "b.txt", lines[::-1]))
    assert forward == backward
    assert [r[0] for r in forward] == ["Gamma", "Beta", "Alpha", "Zeta"]


# --- writing -------------------------------------------------------------------------------------


def test_write_rows_makes_a_gzipped_csv_with_the_documented_header(tmp_path):
    rows = [("Kearney", "NE", "US", "40.699", "-99.081", 33021)]
    out = tmp_path / "places.csv.gz"
    size = build.write_rows(rows, out)
    assert size == out.stat().st_size
    assert read_csv_gz(out) == [
        ["name", "region", "country", "lat", "lon", "population"],
        ["Kearney", "NE", "US", "40.699", "-99.081", "33021"],
    ]


def test_write_rows_is_byte_for_byte_repeatable(tmp_path):
    rows = [("Kearney", "NE", "US", "40.699", "-99.081", 33021), ("Dallas", "TX", "US", "32.783", "-96.807", 1326087)]
    build.write_rows(rows, tmp_path / "one.csv.gz")
    build.write_rows(rows, tmp_path / "two" / "two.csv.gz")
    assert (tmp_path / "one.csv.gz").read_bytes() == (tmp_path / "two" / "two.csv.gz").read_bytes()


def test_names_with_commas_or_quotes_survive_the_round_trip(tmp_path):
    rows = [('Say "Hi", Texas', "TX", "US", "31.000", "-100.000", 5001)]
    out = tmp_path / "places.csv.gz"
    build.write_rows(rows, out)
    assert read_csv_gz(out)[1][0] == 'Say "Hi", Texas'


# --- command line --------------------------------------------------------------------------------


def test_main_builds_a_file_and_reports_the_count(tmp_path, capsys):
    dump = write_dump(tmp_path / "d.txt", [geonames_line("Kearney"), geonames_line("Bad", "US", "00")])
    out = tmp_path / "out" / "places.csv.gz"
    assert build.main(["--source", str(dump), "--output", str(out)]) == 0
    assert "Wrote 1 places" in capsys.readouterr().out
    assert len(read_csv_gz(out)) == 2


def test_main_says_so_when_the_source_is_missing(tmp_path, capsys):
    code = build.main(["--source", str(tmp_path / "nope.txt"), "--output", str(tmp_path / "out.csv.gz")])
    assert code == 2
    assert "Source file not found" in capsys.readouterr().err
    assert not (tmp_path / "out.csv.gz").exists()


def test_main_fails_when_the_file_is_over_budget(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(build, "MAX_BYTES", 10)
    dump = write_dump(tmp_path / "d.txt", [geonames_line("Kearney")])
    assert build.main(["--source", str(dump), "--output", str(tmp_path / "o.csv.gz")]) == 1
    assert "over the" in capsys.readouterr().err


def test_default_output_is_the_bundled_data_file():
    assert build.DEFAULT_OUTPUT.resolve() == DATA_FILE.resolve()


# --- the committed file --------------------------------------------------------------------------


@pytest.mark.skipif(
    not os.environ.get("GEONAMES_CITIES5000"),
    reason="Set GEONAMES_CITIES5000 to the path of cities5000.txt to check the committed file is reproducible.",
)
def test_committed_data_is_what_the_script_builds_from_the_dump(tmp_path):
    out = tmp_path / "rebuilt.csv.gz"
    assert build.main(["--source", os.environ["GEONAMES_CITIES5000"], "--output", str(out)]) == 0
    assert out.read_bytes() == DATA_FILE.read_bytes()
