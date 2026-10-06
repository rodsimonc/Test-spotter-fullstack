# Deploying

The app runs as one Vercel project. `vercel.json` at the repository root builds the React app into `frontend/dist`, serves it as static files, and sends every `/api/*` request to the Python function in `api/index.py`, which loads Django. The database is Postgres on Neon. A small project is plenty.

Order of work: database first, then the Vercel project and its settings, then deploy, then migrate.

## 1. Create the database

1. Create a project on [Neon](https://neon.tech) and copy the connection string.
2. Use the **pooled** one (the host contains `-pooler`). Functions open a new connection on every cold start, and the pooler keeps that cheap.
3. The string must end in `?sslmode=require`:

```
postgresql://USER:PASSWORD@ep-example-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require
```

Django reads it from `DATABASE_URL`. With no `DATABASE_URL`, local runs use SQLite at `backend/db.sqlite3`. On Vercel that's refused at startup, because a function's disk is read-only and wiped between runs.

## 2. Settings

Set these in the Vercel dashboard under **Settings, Environment Variables**, or with the CLI. Use the Production scope. Add Preview too if you want preview deployments to work.

| Variable | Needed | What it does |
|---|---|---|
| `DJANGO_SECRET_KEY` | Yes | Signs sessions and CSRF tokens. Make a long random one. Never reuse the one from your machine. |
| `DATABASE_URL` | Yes | The Neon connection string above. |
| `DJANGO_ALLOWED_HOSTS` | For a custom domain | Comma-separated host names. Vercel's own `*.vercel.app` hosts are allowed automatically. |
| `CSRF_TRUSTED_ORIGINS` | For a custom domain | Comma-separated origins with the scheme, like `https://trips.example.com`. |
| `OSRM_BASE_URL` | No | Default `https://router.project-osrm.org`. |
| `PHOTON_BASE_URL` | No | Default `https://photon.komoot.io`. |
| `NOMINATIM_BASE_URL` | No | Default `https://nominatim.openstreetmap.org`. |
| `HTTP_USER_AGENT` | Recommended | Sent to the three services above. Nominatim's policy asks for one that names the app and a way to reach you. |
| `ROUTE_CACHE_TTL_HOURS` | No | How long a cached route is reused. Default 168 (7 days). |
| `TRUST_PROXY_HEADERS` | No | Read the client address from `X-Forwarded-For`. On by default on Vercel, which overwrites the header. Off elsewhere. |
| `TRUSTED_PROXY_COUNT` | No | How many proxies append to that header. Default 1. |
| `DJANGO_SECURE_SSL_REDIRECT` | No | Redirect HTTP to HTTPS. On by default outside debug mode. |
| `DJANGO_DEBUG` | Never in production | Leave it unset. |

Vercel sets `VERCEL`, `VERCEL_URL` and `VERCEL_PROJECT_PRODUCTION_URL` itself. The settings use them to allow the deployment's own host.

`.env.example` at the repository root lists the same names with no values.

### Make a secret key

```powershell
python -c "import secrets; print(secrets.token_urlsafe(64))"
```

## 3. Vercel

Install the CLI once, link the folder, add the variables and deploy. `npx vercel` works if you'd rather not install anything.

```powershell
npm install --global vercel      # or prefix each command below with npx
vercel login
vercel link                      # run from the repository root, not from frontend/
vercel env add DJANGO_SECRET_KEY production
vercel env add DATABASE_URL production
vercel env add HTTP_USER_AGENT production
vercel deploy --prod
```

`vercel env add` asks for the value, so it never lands in your shell history. To pull the variables down for local use, `vercel env pull .env.local`. That file is ignored by git.

You can skip the CLI. Import the GitHub repository in the dashboard, keep the root directory at the repository root, and let `vercel.json` decide the build. Every push to `main` then deploys on its own.

<!-- VERCEL_NOTES: the lead adds the runtime details checked against current Vercel docs here
     (Python version, bundle size, function duration, region). -->

## 4. Migrate

A fresh database has no tables. Apply the migrations and create the throttle table. Do this once, and again after any release that adds a migration.

**With the workflow.** Add a repository secret named `DATABASE_URL` (Settings, Secrets and variables, Actions). Optionally add `DJANGO_SECRET_KEY` too. Then open the Actions tab, pick **Migrate production database**, choose Run workflow, and type `migrate` to confirm. It runs `migrate`, `createcachetable` and `showmigrations --plan`. If you create an environment called `production` with a required reviewer, the run waits for approval.

**From your machine.**

```powershell
cd backend
$env:DATABASE_URL = "postgresql://USER:PASSWORD@HOST/neondb?sslmode=require"
$env:DJANGO_SECRET_KEY = "any value, migrations don't use it"
.\.venv\Scripts\python.exe manage.py migrate
.\.venv\Scripts\python.exe manage.py createcachetable
Remove-Item Env:DATABASE_URL, Env:DJANGO_SECRET_KEY
```

```bash
cd backend
export DATABASE_URL="postgresql://USER:PASSWORD@HOST/neondb?sslmode=require"
export DJANGO_SECRET_KEY="any value, migrations don't use it"
.venv/bin/python manage.py migrate
.venv/bin/python manage.py createcachetable
unset DATABASE_URL DJANGO_SECRET_KEY
```

`createcachetable` is safe to run again.

## 5. Check it

```powershell
curl https://YOUR-APP.vercel.app/api/health
# {"status":"ok"}
```

Then run the smoke and results specs against the live site. See [docs/testing.md](docs/testing.md#against-a-deployed-site) for why you should keep it to a few files:

```powershell
cd frontend
$env:E2E_BASE_URL = "https://YOUR-APP.vercel.app"
npx playwright test --workers=1 e2e/specs/smoke.spec.ts e2e/specs/security.spec.ts
```

The security spec also checks the production content security policy and the cookie flags over HTTPS.

## What the deployment sets for you

`vercel.json` adds these headers to every response:

- A strict content security policy: scripts from the same origin only, images from the same origin and `*.tile.openstreetmap.org`, `connect-src 'self'`, no framing, no plugins.
- `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, a `Referrer-Policy`, and a `Permissions-Policy` that turns geolocation, camera and microphone off.

Django adds its own on API responses: secure and HttpOnly session cookie, a secure CSRF cookie, HSTS for a year, `X-Frame-Options: DENY`, and `nosniff`. CI runs `manage.py check --deploy` with production-like settings and fails on any warning.

## When it goes wrong

| Symptom | Likely cause |
|---|---|
| Every `/api` call returns 500, and the function log says `DJANGO_SECRET_KEY is required` | The variable is missing in this scope (Production or Preview). |
| The log says `DATABASE_URL is required on Vercel` | Same, for the database. |
| `DisallowedHost` or a 400 on a custom domain | Add the host to `DJANGO_ALLOWED_HOSTS`. |
| Sign in fails with a 403 on a custom domain | Add the origin, with `https://`, to `CSRF_TRUSTED_ORIGINS`. |
| `relation "django_cache" does not exist`, or throttling errors | Run `createcachetable` (step 4). |
| `relation "accounts_user" does not exist` | Run `migrate` (step 4). |
| Planning returns 502 and the message mentions the routing service | OSRM's public server is slow or down. Retry, or set `OSRM_BASE_URL` to another server. |
| Everything is throttled for everyone | The client address isn't being read. Check `TRUST_PROXY_HEADERS` and `TRUSTED_PROXY_COUNT`. |
| The page loads but the map is grey | Tiles are blocked. Check the browser console for a content security policy message. |

## Running somewhere else

Nothing ties the app to Vercel except `api/index.py` and `vercel.json`. Any host that can run a WSGI app behind HTTPS works. Serve `frontend/dist` and proxy `/api` to Django on the same origin, set the variables above, and run the two management commands. Don't run `runserver` in production.
