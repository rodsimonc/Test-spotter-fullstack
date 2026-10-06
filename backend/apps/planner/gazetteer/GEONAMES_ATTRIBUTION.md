# GeoNames attribution

`places.csv.gz` is derived from the GeoNames `cities5000` extract, which lists populated places with at least 5,000 people.

- Source: GeoNames, https://www.geonames.org
- Download: https://download.geonames.org/export/dump/cities5000.zip
- License: Creative Commons Attribution 4.0 (CC BY 4.0), https://creativecommons.org/licenses/by/4.0/

## What changed

`backend/scripts/build_gazetteer.py` keeps the United States, Canada and Mexico and writes six columns: `name` (GeoNames' ASCII name), `region`, `country`, `lat`, `lon` and `population`. Coordinates are rounded to three decimals.

Regions are the US state code, the Canadian province code, and the ISO 3166-2 code for each Mexican state. GeoNames numbers Canadian and Mexican regions, so the script maps those numbers to codes.

The planner uses the list to turn a coordinate into text such as "Kearney, NE" for log remarks. It never calls GeoNames at run time.
