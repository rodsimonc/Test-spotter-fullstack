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

#### Directions

`PlanResponse.directions` is the road-by-road list behind the Directions tab. The field is always there. It holds two legs (current to pickup, pickup to dropoff) or it is `[]`.

A leg has `from`, `to`, `title`, `distance_miles` and `steps`. The title is the first part of each place label, like "Dallas to Memphis". The distance is the same number as the matching entry in `summary.legs`, and the steps add up to it. A step has `kind` (`depart`, `road` or `arrive`), `instruction`, `road`, `heading`, `distance_miles`, `mile`, `lat` and `lon`. The first step of a leg is `depart`, the last is `arrive` with a distance of 0, and everything between is `road`. `mile` counts from the start of the whole trip, so leg 2 begins at the pickup mile, on the same scale as `stops[].mile`. Text fields are plain text. Road names come from map data, so clients render them as text and never as HTML.

The router sends one step per turn, ramp and name change. The server boils that down with these rules:

1. A step's road is the first reference in its `ref` (`I 40;US 64` gives `I 40`), written with a hyphen: `I-40`, `US-287`, `TX-183`. With no reference the road is the street name. With neither, the step has no road.
2. A step shorter than half a mile joins the step before it. The first step always stays.
3. A step on the same road as the line before it joins that line. A step with no road joins it too.
4. The heading is the router's bearing at the start of the line, rounded to N, NE, E, SE, S, SW, W or NW.
5. The wording follows from the line. `depart`: "Head south on Main St", or "Head south" with no road. A numbered road such as I-40: "Take I-40 W". A street: "Continue on Main St". `arrive`: "Arrive at Memphis", the first part of the place label from the request.
6. A leg has at most 120 steps, counting `depart` and `arrive`. When there would be more, the shortest road is folded into the line before it, again and again, until it fits.
7. Distances are rounded to 0.1 mile and add up exactly to the leg's distance. `mile` is rounded to 0.1 from the exact figure, so the ends of a leg land on the same miles as the pickup and dropoff stops and a line's `mile` can sit 0.1 away from the sum of the lines before it.
8. Anything odd in the router's data (a step with no location, no steps at all, steps that describe a different route) gives fewer lines, or `[]`. It never gives an error.

The steps come from a second request to the router, made after the route request so the big geometry answer stays small: `GET /route/v1/driving/{lon,lat;lon,lat;lon,lat}?overview=false&steps=true&geometries=polyline&annotations=false`. It is best effort. It gets one try, a 6 second read timeout and a 4 MiB size limit (a 2,783 mile trip measured 479 KB and 1.6 seconds). If it fails, times out, answers with a code other than `Ok` or is too large, the plan still succeeds with `directions: []`. The client sees no error and no entry in `warnings`. The server logs it.

The condensed lines are cached in the same row as the route, without their wording, so a hit needs no router call and two trips with different place labels share a row. A row with no directions yet (an older row, or a failed first try) asks for the steps again the next time it is used. An answer that came back but held nothing usable is stored as "none" and is not asked for again until the row expires. Saved trips planned before this field existed read back with `directions: []`.

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
