"""Build the bundled town list from the GeoNames cities5000 dump.

Run it when you want fresh data:

    curl -O https://download.geonames.org/export/dump/cities5000.zip
    unzip cities5000.zip
    python scripts/build_gazetteer.py --source cities5000.txt

It keeps the United States, Canada and Mexico and writes
apps/planner/gazetteer/places.csv.gz with the columns
name, region, country, lat, lon, population.

Names come from GeoNames' ASCII column so log sheets stay plain ASCII. Regions are the US
state code, the Canadian province code, or the ISO 3166-2 code for a Mexican state.

Rows for sections of a city (feature code PPLX, such as "Moss Park" in Toronto) and for
abandoned places are skipped. The city they belong to is in the list, and a log remark
that says "Toronto, ON" reads better than one that names a neighborhood.

Names are tidied so they fit on one line of a log sheet. A trailing note such as
"(village)" or "[Fraccionamiento]" is dropped. Names that list several places ("A / B / C"),
contain a comma, say "(historical)" or run past 40 characters are skipped.

Data: GeoNames, https://www.geonames.org, CC BY 4.0. See GEONAMES_ATTRIBUTION.md.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import re
import sys
from pathlib import Path

DEFAULT_OUTPUT = Path(__file__).resolve().parent.parent / "apps" / "planner" / "gazetteer" / "places.csv.gz"
COUNTRIES = ("US", "CA", "MX")
#: Section of a populated place, and abandoned, historical or destroyed places.
SKIPPED_FEATURE_CODES = ("PPLX", "PPLQ", "PPLH", "PPLW")
MAX_BYTES = 400 * 1024
#: Longest name that still reads well in a remark. Real cities top out near 38.
MAX_NAME_LENGTH = 40

_NOTE = re.compile(r"\s*(\([^)]*\)|\[[^\]]*\])")

# GeoNames column positions (tab separated, no header).
COL_ASCII_NAME = 2
COL_LAT = 4
COL_LON = 5
COL_FEATURE_CODE = 7
COL_COUNTRY = 8
COL_ADMIN1 = 10
COL_POPULATION = 14

# GeoNames numeric admin1 codes for Canada.
CANADA = {
    "01": "AB",
    "02": "BC",
    "03": "MB",
    "04": "NB",
    "05": "NL",
    "07": "NS",
    "08": "ON",
    "09": "PE",
    "10": "QC",
    "11": "SK",
    "12": "YT",
    "13": "NT",
    "14": "NU",
}

# GeoNames numeric admin1 codes for Mexico, mapped to ISO 3166-2:MX.
MEXICO = {
    "01": "AGU",
    "02": "BCN",
    "03": "BCS",
    "04": "CAM",
    "05": "CHP",
    "06": "CHH",
    "07": "COA",
    "08": "COL",
    "09": "CMX",
    "10": "DUR",
    "11": "GUA",
    "12": "GRO",
    "13": "HID",
    "14": "JAL",
    "15": "MEX",
    "16": "MIC",
    "17": "MOR",
    "18": "NAY",
    "19": "NLE",
    "20": "OAX",
    "21": "PUE",
    "22": "QUE",
    "23": "ROO",
    "24": "SLP",
    "25": "SIN",
    "26": "SON",
    "27": "TAB",
    "28": "TAM",
    "29": "TLA",
    "30": "VER",
    "31": "YUC",
    "32": "ZAC",
}


def region_for(country: str, admin1: str) -> str | None:
    if country == "US":
        return admin1 if len(admin1) == 2 and admin1.isalpha() else None
    if country == "CA":
        return CANADA.get(admin1)
    return MEXICO.get(admin1)


def clean_name(raw: str) -> str | None:
    """The name as it should read in a remark, or None when the place is better left out."""
    if "historical" in raw.lower():
        return None
    name = " ".join(_NOTE.sub("", raw).split())
    if not name or "/" in name or "," in name or len(name) > MAX_NAME_LENGTH:
        return None
    return name


def read_rows(source: Path) -> tuple[list[tuple[str, str, str, str, str, int]], int]:
    # Tidying a name can make two GeoNames rows identical ("Jesus Gomez Portugal" and
    # "Jesus Gomez Portugal (Margaritas)"). The bigger one stays.
    kept: dict[tuple[str, str, str, str, str], int] = {}
    skipped = 0
    with source.open(encoding="utf-8", newline="") as handle:
        for record in csv.reader(handle, delimiter="\t", quoting=csv.QUOTE_NONE):
            country = record[COL_COUNTRY]
            if country not in COUNTRIES or record[COL_FEATURE_CODE] in SKIPPED_FEATURE_CODES:
                continue
            region = region_for(country, record[COL_ADMIN1])
            name = clean_name(record[COL_ASCII_NAME])
            if region is None or name is None:
                skipped += 1
                continue
            lat, lon = float(record[COL_LAT]), float(record[COL_LON])
            key = (name, region, country, f"{lat:.3f}", f"{lon:.3f}")
            kept[key] = max(kept.get(key, 0), int(record[COL_POPULATION]))
    rows = [(*key, population) for key, population in kept.items()]
    rows.sort(key=lambda r: (r[2], r[1], r[0], r[3], r[4]))
    return rows, skipped


def write_rows(rows: list[tuple[str, str, str, str, str, int]], output: Path) -> int:
    output.parent.mkdir(parents=True, exist_ok=True)
    # mtime=0 keeps the file byte-for-byte the same on every run.
    with (
        output.open("wb") as raw,
        gzip.GzipFile(filename="", mode="wb", fileobj=raw, compresslevel=9, mtime=0) as gz,
    ):
        writer = csv.writer(_TextWriter(gz), lineterminator="\n")
        writer.writerow(["name", "region", "country", "lat", "lon", "population"])
        writer.writerows(rows)
    return output.stat().st_size


class _TextWriter:
    """Adapts a binary stream to the text interface csv.writer expects."""

    def __init__(self, binary) -> None:
        self._binary = binary

    def write(self, text: str) -> int:
        self._binary.write(text.encode("utf-8"))
        return len(text)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", type=Path, default=Path("cities5000.txt"), help="GeoNames cities5000.txt")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="where to write places.csv.gz")
    args = parser.parse_args(argv)

    if not args.source.is_file():
        print(f"Source file not found: {args.source}", file=sys.stderr)
        return 2
    rows, skipped = read_rows(args.source)
    size = write_rows(rows, args.output)
    print(
        f"Wrote {len(rows)} places to {args.output} ({size / 1024:.0f} KB). "
        f"Skipped {skipped} without a known region or a usable name."
    )
    if size > MAX_BYTES:
        print(f"File is over the {MAX_BYTES // 1024} KB budget.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
