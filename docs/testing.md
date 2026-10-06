# Testing

Four layers, each with its own command. CI runs all of them on every push and pull request.

| Layer | Lives in | Needs | Runs in CI |
|---|---|---|---|
| Backend | `backend/tests` | Python 3.12+, nothing else | `backend` job |
| Frontend unit | `frontend/src/**/*.test.ts(x)` | Node 22 | `frontend` job |
| Fake upstream | `frontend/e2e/fake-upstream/server.test.mjs` | Node 22 | `frontend` job |
| End to end | `frontend/e2e/specs` | Node 22, Python, Chromium | `e2e` job, after the other two |

Nothing in the suites calls the live internet, except specs tagged `@live`, which only run when you ask for them.

## Backend

From `backend/`, with the virtual environment active:

```powershell
.\.venv\Scripts\python.exe -m pytest                       # everything
.\.venv\Scripts\python.exe -m pytest tests/engine -p no:django   # the engine, without Django
.\.venv\Scripts\python.exe -m pytest --cov=apps --cov-report=term-missing   # with coverage
.\.venv\Scripts\python.exe -m ruff check .; .\.venv\Scripts\python.exe -m ruff format --check .
```

CI fails under 85 percent line coverage of `apps/`.

What's in there:

- `tests/engine`: the hours-of-service simulation, log splitting at midnight, geometry. A fuzz test with Hypothesis feeds random trips to an independent compliance checker written inside the tests. It shares no helper with the engine. It covers daylight saving changes in `America/Chicago`, plus `America/Phoenix` and `Pacific/Honolulu`, which have no clock changes.
- `tests/gazetteer`: nearest-town lookup, the "12 mi SW of Kearney, NE" wording, coordinates outside coverage.
- `tests/api`: serializers, every endpoint, the OSRM, Photon and Nominatim parsers against realistic fixtures, caching, throttling. Outbound calls are mocked with `responses`, so a missed mock fails the test.
- `tests/accounts`, `tests/trips`: registration, login, sessions, ownership. User B gets a 404 for user A's trip.
- `tests/security`: CSRF, cookie flags under production settings, security headers, injection strings stored as plain text, oversized bodies, `NaN` and `Infinity`, user enumeration, and the rule that outbound hosts come only from settings.

The CI job also runs `manage.py makemigrations --check` and `manage.py check --deploy` with production-like settings.

## Frontend unit tests

From `frontend/`:

```powershell
npm run lint
npm run typecheck
npm run format:check
npm test                    # Vitest, once
npm test -- --coverage      # with a V8 coverage report in coverage/
npm run build               # type check, then the production bundle
```

These cover the library code (share links, time and format helpers), the API client's CSRF handling, the place combobox, form validation, results rendering from a fixture, and the log sheet (geometry, remark layout, totals, PDF export, viewer navigation).

## End to end

Playwright drives Chromium against a complete local stack, so the specs exercise the real Django API and the real React app. The only fake part is the world outside: routing, search and reverse lookups.

```powershell
cd frontend
npx playwright install chromium     # once
npx playwright test                 # all specs, the `chromium` project
npx playwright test e2e/specs/auth.spec.ts
npx playwright test -g "share link"
npx playwright test --ui            # pick tests, watch them, time travel
npx playwright test --headed --workers=1
npx playwright show-report          # the HTML report from the last run
```

`playwright.config.ts` starts three servers and stops them when the run ends:

| Server | Port | Started with |
|---|---|---|
| Fake OSRM, Photon and Nominatim | 8787 | `node e2e/fake-upstream/server.mjs` |
| Django, on a fresh SQLite file | 8000 | `node e2e/scripts/start-django.mjs` (migrate, `createcachetable`, `runserver`) |
| Vite dev server | 5173 | `npm run dev` |

Stop anything already on those ports first. The scripts `scripts/dev.ps1` and `scripts/dev.sh` use 8000 and 5173 too.

### Environment variables

| Variable | Effect |
|---|---|
| `E2E_BASE_URL` | Test a deployed site. Starts no servers and skips specs tagged `@fake`. |
| `E2E_LIVE=1` | Run the local stack against the real OSRM, Photon and Nominatim, and enable the `live` project. |
| `E2E_PREVIEW=1` | Serve the production build with `vite preview` on port 4173. Turns on the content security policy checks. CI does this. |
| `E2E_REUSE_SERVERS=1` | Reuse servers already running on the ports instead of failing. |
| `E2E_WORKERS` | Parallel workers. Default 3 locally, 2 in CI. |
| `E2E_PYTHON` | The Python for Django. Default `backend/.venv`, then `python3`. |
| `E2E_DJANGO_PORT`, `FAKE_UPSTREAM_PORT`, `E2E_DB_PATH`, `FAKE_SLOW_MS` | Overrides for the helper scripts. |
| `CI` | Set by GitHub Actions. One retry per test, `forbidOnly`, the GitHub reporter. |

### Tags

- `@fake` needs the scripted upstream, for example the magic places below. It's skipped against a deployed site and against `E2E_LIVE=1`.
- `@live` needs the real services. It runs in the `live` project only, and `live.spec.ts` skips itself unless `E2E_LIVE=1` or `E2E_BASE_URL` is set. Run it with `E2E_LIVE=1 npx playwright test --project=live`.

### The fake upstream

`e2e/fake-upstream/server.mjs` speaks the real response shapes from the build spec. OSRM answers with a great-circle line scaled by a road factor of 1.2. Photon knows about 40 US cities and a few streets. Nominatim reverse finds the nearest city. A handful of magic places make it misbehave on purpose:

| Place | Coordinates | What the fake does |
|---|---|---|
| Nowhere Reef | 30.0, -40.0 | OSRM answers `NoRoute`, so the API returns 422 `no_route` |
| Brokenbridge, KS | 38.4, -98.8 | OSRM answers HTTP 500, so the API returns 502 `upstream_error` |
| Garbled Gulch, OK | 36.0, -100.0 | OSRM answers 200 with text that isn't JSON, so 502 |
| Slowpoke Springs, NE | 40.2, -99.9 | OSRM waits `FAKE_SLOW_MS` (2.5 s), then answers |
| Pwned Plains, TX | 32.95, -97.2 | A place whose name is HTML, for the injection specs |

Searching for `boom` makes Photon answer 503. `GET /__calls?service=osrm&contains=<text>` lists what the fake was asked, and `POST /__reset` clears the log. Its own tests run with `node --test e2e/fake-upstream/server.test.mjs`.

### The specs

| File | Covers |
|---|---|
| `smoke.spec.ts` | First load, CSRF then session bootstrap, deep links, health check |
| `trip-form.spec.ts` | Typeahead, clear, swap, reset, example, cycle hours, departure and zone, log details, validation, pick on map |
| `planning.spec.ts` | Planning the example trip, stress trips, the 34-hour restart, errors with retry, route cache, share link on load |
| `results.spec.ts` | Tabs, cycle meter, legs table, assumptions |
| `map.spec.ts` | Markers, legend, stop card to popup, attribution |
| `logs.spec.ts` | Log viewer, sheet numbers, PDF download, print |
| `export.spec.ts` | PDF names and toasts, page counts on long trips, print from either tab |
| `share.spec.ts` | Copy, open in a fresh browser, same summary, damaged links |
| `auth.spec.ts` | Sign up, sign in, wrong password, sign out, dialog focus and keyboard behavior |
| `trips.spec.ts` | Save signed out then in, history, open, rename, delete with confirm, isolation between users |
| `errors.spec.ts` | Network loss, failed saves, a failing trips drawer, map and search failures |
| `mobile.spec.ts` | A 390 px phone: no sideways scroll, tap targets, dialogs and drawer fit |
| `a11y.spec.ts` | axe scans of every screen, landmarks and names, focus rings, keyboard-only flows, reduced motion |
| `security.spec.ts` | Hostile text stays text, cookie flags, CSRF, access control, input limits, security headers |
| `live.spec.ts` | The real OSRM, Photon and Nominatim: search, route size, rules, town names, no-route (`@live`) |
| `helpers.spec.ts` | The helpers themselves, so a broken helper can't fake a pass |

Every spec imports `test` and `expect` from `e2e/helpers/test.ts`. That file adds three things to every test: a different client IP (`X-Forwarded-For`), so each test gets its own throttle counters; a flat grey tile for any OpenStreetMap tile request; and a failure on any uncaught page error or content security policy violation.

### Writing a spec that stays green

- Use web-first assertions (`await expect(locator).toBeVisible()`) and wait on the thing you need. There are no fixed sleeps, with one exception: proving a request does _not_ happen (the typeahead debounce) has to let time pass.
- Make accounts with `newUser()`. Emails are `e2e-<label>-<timestamp><random>@example.com`, and the database starts empty on every run.
- Set up state through the API (`registerViaApi`, `saveTripViaApi`, `seedTrip`) and test the UI path you care about. Clicking through sign up in forty tests only slows them.
- A second user needs a second browser context: the `openSession()` fixture.
- Read numbers back with `firstNumber`, `numbersIn` and `parseMinutes` from `helpers/parse.ts`, so a wording change in the UI doesn't break a test about distance.
- Check a plan against `checkPlan()` in `helpers/hos-check.ts`. It's a referee written from the FMCSA numbers and reads only the API response.
- Never put a real credential in a test. Passwords come from `helpers/auth.ts`, and every email uses `example.com`.

### Test ids

Elements the specs touch carry `data-testid`. Names are lowercase and hyphenated, with the kind first: `btn-` for buttons, `input-` and `field-` for inputs, `form-error-<field>` for the message under one, `tab-` and `panel-` for tabs, `stat-` for numbers in the results strip. Things that repeat end with their id: `stop-card-<stop id>`, `day-chip-<n>`, `trip-row-<trip id>`, `btn-open-trip-<trip id>`.

| Area | Ids |
|---|---|
| Form | `field-current`, `field-pickup`, `field-dropoff`, `suggestion`, `btn-clear-*`, `btn-pick-*`, `btn-swap`, `input-cycle`, `slider-cycle`, `input-departure`, `select-timezone`, `btn-log-details`, `input-driver-name` and the other nine header inputs, `btn-plan`, `btn-example`, `btn-reset`, `form-error-*` |
| Map | `map`, `pick-banner`, `marker-<stop id>`, `map-legend`, `empty-state` |
| Results | `stats-strip`, `stat-distance`, `stat-driving`, `stat-trip-time`, `stat-arrival`, `stat-days`, `stat-fuel`, `warnings`, `tab-*`, `panel-*`, `stop-card-<id>`, `day-group-<n>`, `btn-share`, `btn-pdf`, `btn-print`, `btn-save`, `cycle-meter`, `assumptions`, `loading`, `error-banner`, `btn-retry`, `toast` |
| Logs | `log-viewer`, `log-sheet-<day>`, `btn-prev-day`, `btn-next-day`, `day-chip-<n>`, `btn-pdf-logs`, `btn-print-logs`, `log-print-root` |
| Auth | `btn-sign-in`, `btn-sign-up`, `auth-dialog`, `tab-auth-login`, `tab-auth-register`, `input-auth-email`, `input-auth-password`, `input-auth-name`, `btn-auth-submit`, `btn-auth-close`, `auth-error`, `btn-toggle-password`, `account-menu`, `btn-my-trips`, `btn-sign-out` |
| Trips | `trips-drawer`, `trip-row-<id>`, `btn-open-trip-<id>`, `btn-rename-trip-<id>`, `input-rename-trip-<id>`, `btn-delete-trip-<id>`, `btn-confirm-delete`, `btn-cancel-delete`, `trips-empty`, `btn-close-trips`, `btn-retry-trips` |

Add an id in the component first, then use it. Don't invent one in a spec.

### Accessibility checks

`helpers/a11y.ts` runs axe-core against the WCAG 2.0 and 2.1 A and AA rules and fails on `serious` or `critical` findings. Lesser findings print to the test output. The exclusion list is empty on purpose. If a rule has to be skipped for one element, add the selector there with the reason next to it.

Scans run on the first screen, the form with errors, an open suggestion list, each results tab, a stop popup, both auth dialog tabs (with errors too), the account menu and the trips drawer (empty, full, with a delete question and a rename box open). Axe can't judge everything, so the specs also check landmarks, names, focus order, focus rings, `prefers-reduced-motion`, and a keyboard-only run through planning and sign in.

## Against a deployed site

```powershell
$env:E2E_BASE_URL = "https://your-app.vercel.app"
npx playwright test --workers=1 e2e/specs/smoke.spec.ts e2e/specs/results.spec.ts
```

This starts no servers. Specs tagged `@fake` drop out, and `@live` specs run in the `live` project.

The deployed API throttles per client IP: 10 sign in or sign up attempts a minute and 30 plans a minute. Playwright can't fake its address against a real host, so a full run from one machine hits those limits and fails for that reason. Run a few files at a time with `--workers=1`. The sign-in flood spec skips itself against a remote site, since it would lock your address out for a minute.

## When something fails

- **"http://127.0.0.1:5173 is already used"**: another dev server holds the port. Stop it, or run with `E2E_REUSE_SERVERS=1` if it's the stack Playwright started.
- **Django never becomes ready**: run `node e2e/scripts/start-django.mjs --dry-run` to see the Python and environment it would use.
- **Every spec fails on the first assertion**: open `playwright-report/index.html`, or `npx playwright show-trace test-results/artifacts/<test>/trace.zip`. A page error or a CSP violation shows up as its own failure.
- **A 404 comes back as HTML locally**: Django runs with `DJANGO_DEBUG=1` in local runs, and then it answers unknown URLs with its debug page. The specs that care skip themselves when they see it. Deployed sites answer in JSON.
