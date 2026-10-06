"""Fixtures that swap the bundled town list for a few hand-placed towns."""

from __future__ import annotations

import csv
import gzip
from collections.abc import Callable, Iterable
from pathlib import Path

import pytest

from apps.planner import gazetteer

#: (name, region, country, lat, lon, population)
TownRow = tuple[str, str, str, float, float, int]


@pytest.fixture
def fresh_grid(monkeypatch: pytest.MonkeyPatch) -> None:
    """Forget the loaded grid so the next lookup reads the file again. The test's end restores it."""
    monkeypatch.setattr(gazetteer, "_grid", None)


@pytest.fixture
def install_towns(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Callable[[Iterable[TownRow]], None]:
    """Point the gazetteer at a small CSV written for the test."""

    def install(rows: Iterable[TownRow]) -> None:
        path = tmp_path / "places.csv.gz"
        with gzip.open(path, "wt", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(["name", "region", "country", "lat", "lon", "population"])
            writer.writerows(rows)
        monkeypatch.setattr(gazetteer, "DATA_FILE", path)
        monkeypatch.setattr(gazetteer, "_grid", None)

    return install
