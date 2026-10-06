# Error contract

Every error response has the same JSON body. The handler lives in `backend/apps/common/exceptions.py` and the error classes in `backend/apps/common/errors.py`.

## Structure

```json
{
  "error": {
    "code": "validation_error",
    "message": "Check the highlighted fields.",
    "fields": { "cycle_used_hours": ["Must be between 0 and 70."] }
  }
}
```

| Field | Description |
|---|---|
| `error.code` | Stable, machine-readable name. Safe to branch on. |
| `error.message` | A sentence for the person using the app. Never a stack trace or exception text. |
| `error.fields` | Optional. Field name (or dotted path like `header.driver_name`) to a list of messages. Only on `validation_error`. Errors that belong to no field use the key `non_field_errors`. |

A `429` also sets a `Retry-After` header, in seconds.

## Codes used

| Status | `code` | When |
|---|---|---|
| 400 | `validation_error` | Missing, malformed or out-of-range input, a body that isn't JSON, or a request Django flags as suspicious. `fields` says which. |
| 400 | `invalid_credentials` | Wrong email or wrong password. One message for both, so the API never says which one was wrong. |
| 401 | `not_authenticated` | The route needs a signed-in user. |
| 403 | `forbidden` | The CSRF or session check failed. Reload the page to get a fresh token. |
| 404 | `not_found` | No such route or trip. A trip that belongs to someone else also returns 404, never 403. |
| 405 | `method_not_allowed` | The path exists but not for this HTTP method. |
| 406 | `not_acceptable` | The client asked for something other than JSON. |
| 413 | `payload_too_large` | The request body is over the limit (64 KB). |
| 415 | `unsupported_media_type` | The body wasn't sent as JSON. |
| 422 | `no_route` | OSRM found no driving route between the places. |
| 422 | `route_too_long` | The route is longer than the planner supports. |
| 422 | `plan_failed` | The engine refused a trip that passed validation. Treat it as a bug report. |
| 422 | `trip_limit_reached` | The account already holds the maximum number of saved trips. |
| 422 | `trip_too_large` | The planned trip is too big to store. |
| 429 | `throttled` | Too many requests for this client. See `Retry-After`. |
| 500 | `server_error` | Anything unexpected. The details go to the server log only. |
| 502 | `upstream_error` | OSRM, Photon or Nominatim failed, timed out or sent something unreadable. |

## How the client uses it

`frontend/src/api/client.ts` turns every non-2xx response into an `ApiError` with `status`, `code`, `message` and `fields`. Forms map `fields` back onto inputs. Banners show `message`. A `502` or `429` offers Retry.

## Why not RFC 7807

Problem Details (`application/problem+json`) is a fine standard. This API uses a smaller envelope because it has one client, which reads `code` and `fields` directly. The shape is covered by `backend/tests/security/test_error_shape.py` and by the E2E specs for the error states, so changing it means changing both.
