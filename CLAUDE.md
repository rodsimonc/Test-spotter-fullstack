# CLAUDE.md

Context for Claude Code (and compatible agents) when working in this repo. Keep it **short, specific and checkable**. It extends [`AGENTS.md`](./AGENTS.md).

## Project summary

A trip planner for property-carrying truck drivers. Input: current location, pickup, dropoff and the hours already used in the 70-hour/8-day cycle. Output: a map with the route and every stop (fuel, break, rest, restart), and one filled-out daily log sheet per day, drawn as SVG and exportable as PDF. Django REST API behind a React single-page app. Accounts are optional and only needed to save trips.

## Frequent commands

```bash
# Backend (from backend/)
python -m venv .venv && .venv/bin/pip install -r ../requirements.txt -r requirements-dev.txt
DJANGO_DEBUG=1 .venv/bin/python manage.py migrate
DJANGO_DEBUG=1 .venv/bin/python manage.py createcachetable
DJANGO_DEBUG=1 .venv/bin/python manage.py runserver     # http://127.0.0.1:8000
.venv/bin/python -m pytest                                # all backend tests
.venv/bin/python -m ruff check . && .venv/bin/python -m ruff format --check .

# Frontend (from frontend/)
npm ci
npm run dev                                               # http://127.0.0.1:5173, proxies /api to Django
npm run lint && npm run typecheck && npm test && npm run build
npx playwright test                                       # starts a fake upstream, Django and Vite

# Both servers at once (from the repo root)
./scripts/dev.sh        # or .\scripts\dev.ps1 on Windows
```

On Windows use `.venv\Scripts\python.exe`.

## Architecture on one screen

- **Entry.** `frontend/src/main.tsx` (React) and `api/index.py` (Vercel loads Django from here). `vercel.json` rewrites `/api/*` to the function and everything else to `index.html`.
- **Routing and views.** `backend/config/urls.py` includes `apps/planner`, `apps/accounts` and `apps/trips`. Views are thin.
- **Planning.** `apps/planner/services.py` fetches a route (`providers/osrm.py`, cached in `RouteCache`) and calls `apps/planner/assemble.build_plan`.
- **Engine.** `apps/planner/hos/`: `simulate.py` walks the trip minute by minute, `logs.py` cuts it into daily sheets, `geometry.py` places stops on the route. `gazetteer/` names places from a bundled GeoNames file.
- **Data.** `accounts.User` (email login), `trips.Trip` (UUID, owner, request, result), `planner.RouteCache`.
- **Errors, throttling, client IP.** `apps/common/`.
- **Contract.** `docs/api-contract.md` is the source of truth. Mirrored in `frontend/src/api/types.ts` and `backend/apps/planner/types.py`.
- **Frontend features.** `frontend/src/features/`: `trip-form`, `map`, `results`, `logs`, `auth`, `trips`. Shared pieces in `components/ui/`, helpers in `lib/`, API client in `api/`.
- **Log sheet.** `features/logs/` rebuilds the paper form as SVG. Geometry constants live in `geometry.ts`; PDF export loads jsPDF on demand.

## Code conventions

- Python 3.12 compatible, `ruff` for lint and format, line length 120.
- TypeScript in strict mode. No `any` without a comment saying why.
- Colors come from the Tailwind tokens in `frontend/src/styles/index.css` (see [`DESIGN.md`](./DESIGN.md)). No loose hex values in components.
- Text that users read follows the rules in `DESIGN.md`: plain, specific, no hype.
- The 70-hour recap prints A as last 8 days, B as 70 minus A, C as last 7 days. The blank form we were given has the 70-hour and 60-hour labels swapped; don't copy that.

## What to avoid

- Don't put the engine's rules anywhere else. Change them in `docs/hos-rules.md` and `hos/`, with tests.
- Don't render API text as HTML. Map markers and popups use static markup or React children only.
- Don't call live OSRM, Photon or Nominatim from tests.
- Don't commit `.env`, keys or `backend/db.sqlite3`.
- Don't add a mapping or UI library without discussing it.
- Don't edit `frontend/package-lock.json` by hand.

## Cross references

- [AGENTS.md](./AGENTS.md): conventions shared by all agents.
- [DESIGN.md](./DESIGN.md): visual system and UI standards.
- [specs.md](./specs.md): the project contract (stack, structure, decisions).
- [docs/architecture.md](./docs/architecture.md), [docs/hos-rules.md](./docs/hos-rules.md), [docs/api-contract.md](./docs/api-contract.md), [docs/testing.md](./docs/testing.md).
- [DEPLOY.md](./DEPLOY.md) and [ERROR-CONTRACT.md](./ERROR-CONTRACT.md).
