# API contract

Everything lives under `/api`. JSON in, JSON out. The TypeScript types in `frontend/src/api/types.ts` mirror this file.

## Conventions

- Timestamps are ISO 8601 with the home terminal offset, like `2026-10-07T06:00:00-05:00`.
- Distances are miles. Durations are whole minutes.
- Every error has the same JSON body, `{ "error": { "code", "message", "fields"? } }`. [ERROR-CONTRACT.md](../ERROR-CONTRACT.md) lists the shape and every status and code.

## Auth and CSRF

Sessions use an HttpOnly cookie. Unsafe requests (`POST`, `PATCH`, `DELETE`) need the `X-CSRFToken` header. Call `GET /api/auth/csrf` once on page load, which sets the `csrftoken` cookie and returns `{ "csrf": "<token>" }`.

Planning (`POST /api/plan`) and geocoding work without an account. Saved trips need one.

## Endpoints

### `GET /api/health`

`200 {"status": "ok"}`

### `GET /api/geocode/search?q=<text>&limit=<1-8>`

Typeahead through Photon. `q` is 2 to 120 characters. Optional `lat` and `lon` bias results toward a point. Returns `{"results": GeocodeResult[]}`. An empty list is a valid answer.

### `GET /api/geocode/reverse?lat=<n>&lon=<n>`

Name a map click. Tries Nominatim, falls back to the bundled town list, and finally to coordinates. Returns `{"place": Place}`.

### `POST /api/plan`

Body is a `PlanRequest`. Returns a `PlanResponse`. See `types.ts` for every field.

Rules the server enforces:

- Latitude -90 to 90, longitude -180 to 180.
- `cycle_used_hours` from 0 to 70.
- `departure` is `YYYY-MM-DDTHH:mm`, `timezone` is a valid IANA name.
- Labels are at most 200 characters. Header fields are at most 120.
- Current, pickup and dropoff must not all be the same point.

### Auth

| Method and path | Body | Result |
|---|---|---|
| `GET /api/auth/csrf` | none | `{"csrf": string}` |
| `GET /api/auth/me` | none | `{"user": User or null}`, always 200 |
| `POST /api/auth/register` | `{email, password, name?}` | 201 `{"user": User}`, signs in |
| `POST /api/auth/login` | `{email, password}` | `{"user": User}` |
| `POST /api/auth/logout` | none | 204 |

Emails are lowercased. Passwords go through Django's validators (8 or more characters, not common, not all digits, not too close to the email).

### Trips (sign-in required)

| Method and path | Body | Result |
|---|---|---|
| `GET /api/trips?limit=&offset=` | none | `{"results": TripSummary[], "count": number}` newest first, max 100 per page |
| `POST /api/trips` | `{title?, request: PlanRequest}` | 201 `Trip` |
| `GET /api/trips/<uuid>` | none | `Trip` |
| `PATCH /api/trips/<uuid>` | `{title}` | `Trip` |
| `DELETE /api/trips/<uuid>` | none | 204 |

Saving re-plans from `request` on the server, so the stored `result` is never client-supplied. Route lookups are cached, so a save right after a plan is quick. Another user's trip returns 404, never 403.

## Share links

The page URL carries the request, not an ID: `/?trip=<base64url JSON of PlanRequest>`. Opening it plans the trip again. No account needed.
