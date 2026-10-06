# specs.md: ELD Trip Planner

> **Contract** of the project. It records the decisions already made on stack, structure and conventions, so the next change starts from something formal. Written from the state of the repo at the first release.

**Date:** 2026-10-06
**Owner:** @rodsimonc
**Contract version:** 0.1.0

---

## 1. Project goal

A full-stack app for a Spotter assessment. A driver gives a current location, a pickup, a dropoff and the hours already used in a 70-hour/8-day cycle. The app returns a map with the route and every stop and rest, and one filled-out daily log sheet for each day of the trip.

The brief fixes these assumptions: property-carrying driver, 70 hours in 8 days, no adverse driving conditions, fuel at least every 1,000 miles, 1 hour at pickup and 1 hour at dropoff. Deliverables: a live site on Vercel, the code on GitHub, a 3 to 5 minute Loom. Accuracy and UI quality are both graded.

Audience: a reviewer who plans trips and checks the hours by hand, then drivers and dispatchers.

## 2. Stack

| Layer | Technology | Version | Reason |
|---|---|---|---|
| Backend | Django | 5.2 LTS | The brief asks for Django. LTS gets security fixes until 2028. |
| API | Django REST framework | 3.18 | Serializers for validation, scoped throttling, session auth. |
| Language (back) | Python | 3.12 on Vercel and CI, 3.14 tested locally | Vercel's default runtime. |
| Frontend | React + TypeScript | 19 / 6 | The brief asks for React. Strict types mirror the API contract. |
| Build | Vite | 8 | Fast builds, simple static output for Vercel. |
| Styles | Tailwind CSS | 4 | Tokens in one `@theme` block. |
| Server state | TanStack Query | 5 | Caching and retries for the API client. |
| Map | Leaflet + react-leaflet | 1.9 / 5 | Free, OSM tiles, no key. |
| Routing | OSRM public server | n/a | Free, no key. Car profile, so drive time gets a 60 mph floor. |
| Search | Photon (typeahead), Nominatim (map clicks) | n/a | Nominatim's policy bans client-side autocomplete, so Photon does typeahead. |
| Place names in logs | GeoNames `cities5000` | CC BY 4.0 | A bundled nearest-town lookup. One live call per stop would break Nominatim's rate limit. |
| PDF | jsPDF + svg2pdf.js | 4 / 2 | Vector output from the same SVG as the screen. |
| Database | Postgres (Neon) in production, SQLite locally | n/a | `DATABASE_URL` decides. |
| Auth | Django sessions + CSRF | n/a | Same origin, HttpOnly cookie, no token in browser storage. |
| Tests | pytest, Hypothesis, Vitest, Playwright, axe-core | n/a | Unit, fuzz, component, end to end, accessibility. |
| Hosting | Vercel | n/a | One project: static React and Django as a Python function. |

## 3. Folder structure

```
Test-spotter-fullstack/
├── api/index.py                 # Vercel entry: exposes Django's WSGI app
├── backend/
│   ├── config/                  # settings, urls, wsgi
│   ├── apps/
│   │   ├── planner/             # plan endpoint, providers, hos/ engine, gazetteer/
│   │   ├── accounts/            # email + password accounts
│   │   ├── trips/               # saved trips
│   │   └── common/              # errors, throttling, client IP
│   ├── scripts/                 # build_gazetteer.py
│   └── tests/                   # engine, gazetteer, api, security, accounts, trips
├── frontend/
│   ├── src/
│   │   ├── api/                 # client, endpoints, hooks, types
│   │   ├── components/          # ui/ and layout/
│   │   ├── features/            # trip-form, map, results, logs, auth, trips
│   │   ├── lib/                 # share, time, format
│   │   └── styles/              # tokens
│   └── e2e/                     # Playwright specs, helpers, fake upstream
├── docs/                        # architecture, HOS rules, API contract, testing
├── scripts/                     # dev.ps1, dev.sh
├── .github/                     # CI, security scans, migrate workflow, Dependabot
├── AGENTS.md · CLAUDE.md · DESIGN.md · specs.md · CHANGELOG.md
├── DEPLOY.md · ERROR-CONTRACT.md · openapi.yaml · requests.http
└── vercel.json · requirements.txt · .env.example
```

Backend layers match the template's controller, service and data split: `views.py` (controller), `serializers.py` (input validation), `services.py` and `hos/` (logic), `providers/` (outside services), `models.py` (data).

## 4. Conventions

- **File names:** Python in `snake_case`, React components in `PascalCase.tsx`, everything else in `camelCase.ts`.
- **Wire format:** JSON with `snake_case` fields in both directions.
- **Imports:** frontend uses the `@/` alias for `src/`.
- **Engine:** pure Python in `apps/planner/hos/`. No Django, no network.
- **Commits:** Conventional Commits in English.
- **Tests:** a change in behavior comes with a test that fails without it.
- **Style:** `ruff` (line length 120) and `eslint` + `prettier`.
- **Language:** UI, docs and comments are in English.

## 5. Agreed scripts

```
Backend   pytest                      all backend tests
          ruff check . / ruff format  lint and format
Frontend  npm run dev                 local app with API proxy
          npm run build               typecheck and production build
          npm run lint                eslint
          npm run typecheck           tsc --noEmit
          npm test                    Vitest
          npm run test:e2e            Playwright
Both      scripts/dev.ps1, dev.sh     Django and Vite together
```

## 6. Closed decisions

- **Monorepo or single repo?** Single repo, two folders.
- **Hosting?** One Vercel project. Same origin for the SPA and the API, so no CORS.
- **Migrations on Vercel?** Production builds run them (`scripts/vercel-build.sh`). The Neon variables are Sensitive, so the address can't be copied out to run them by hand. The manual workflow in `.github/workflows/migrate.yml` stays for other hosts.
- **Maps?** OSM tiles, OSRM, Photon, Nominatim. No API keys.
- **Place names in logs?** Bundled GeoNames towns of 5,000 people or more.
- **Drive time?** The slower of OSRM's estimate and distance at 60 mph.
- **Overnight rest?** 10 hours in the sleeper berth. A 34-hour restart is logged Off Duty and is inserted automatically when the cycle runs out.
- **Fuel?** 30 minutes on duty, at least every 1,000 miles. No other stops are added.
- **Directions?** Condensed by road from a second, best-effort OSRM steps request. A failure returns an empty list and never fails the plan. The condensed lines are cached with the route.
- **Time zone?** The home terminal zone, with its UTC offset at departure held for the whole trip, so every sheet is 24 hours.
- **Accounts?** Django sessions with email and password. Planning, the map and the PDF work signed out. Saving trips needs an account.
- **Share links?** The request is encoded in the URL. No database row, no account.
- **Secrets?** `.env` is ignored, `.env.example` lists the names.
- **CI?** GitHub Actions: lint, tests and a production-like `check --deploy`; separate scans for secrets and dependencies.

## 7. Out of scope (v0)

- Split sleeper pairing, short-haul exceptions, personal conveyance, adverse driving conditions.
- The 60-hour/7-day rule. The recap block for it is drawn and left empty.
- Email verification and password reset (no email service).
- Real-time traffic, weather and truck-specific routing (OSRM uses a car profile).
- Languages other than English.
- Dark mode.

## 8. Contract history

- **0.1.0 (2026-10-06):** first formal version, written when the first release shipped.
