# Changelog

Every notable change to this project is recorded here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-06

First release. Built for the Spotter full-stack assessment.

### Added

- **Hours-of-service engine** (`backend/apps/planner/hos/`). Walks a trip minute by minute: drive to the pickup, 1 hour on duty, drive to the dropoff, 1 hour on duty. Inserts fuel stops (30 minutes, at least every 1,000 miles), 30-minute breaks, 10-hour sleeper rests and a 34-hour restart when the 70-hour cycle runs out. Rules are in `docs/hos-rules.md`.
- **Daily logs.** One sheet per calendar day at the home terminal, cut at midnight, with status totals that add up to 24 hours, remarks at every duty change, miles driven and the 70-hour/8-day recap.
- **Place names** from a bundled GeoNames list (`cities5000`, US, Canada, Mexico), for remarks like "12 mi SW of Kearney, NE".
- **API** (`/api`): `plan`, `geocode/search`, `geocode/reverse`, `auth/*` and `trips`. Same JSON error shape everywhere. See `docs/api-contract.md`, `ERROR-CONTRACT.md` and `openapi.yaml`.
- **Route lookups** through OSRM with a database cache, Photon typeahead and Nominatim reverse lookups. Drive time is the slower of OSRM and 60 mph.
- **Accounts and saved trips.** Email and password, session cookie, CSRF on every unsafe request, per-user trips that return 404 to anyone else.
- **React app.** Trip form with typeahead and pick-on-map, route map with stop markers and legend, itinerary, summary, and the daily log viewer.
- **Log sheet as SVG**, rebuilt from the paper form, with Download PDF (vector, one page per day), Print and day navigation.
- **Share link** that re-plans a trip from the URL. No account needed.
- **Tests.** Engine unit, golden and fuzz tests with an independent compliance checker, API and security tests, component tests, and a Playwright suite that covers every button, accessibility scans and a phone layout.
- **CI and security.** GitHub Actions for lint, tests and `check --deploy`; scans for secrets, dependencies and code; a manual migrate workflow; Dependabot.
- **Project docs** in the bootcamp structure: `AGENTS.md`, `CLAUDE.md`, `DESIGN.md`, `specs.md`, `CHANGELOG.md`, `DEPLOY.md`, `ERROR-CONTRACT.md`, `openapi.yaml`, `requests.http`.
- **Vercel setup**: `vercel.json` with security headers and a strict content security policy, `api/index.py`, pinned `requirements.txt`.

### Known limits

- OSRM, Photon and Nominatim are shared public servers with fair-use limits.
- OSRM routes like a car. The 60 mph floor keeps drive times honest for a truck, but road restrictions aren't modeled.
- Hours that were already used in the cycle never drop out of the 8-day window during the trip.
