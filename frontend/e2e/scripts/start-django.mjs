// Starts Django for the end-to-end run: fresh SQLite file, migrate, createcachetable, runserver.
// Playwright's webServer launches this, so the whole sequence is one process to start and stop.
//
// Environment (all optional):
//   E2E_PYTHON         Python to use. Default: backend/.venv, then python3 (python on Windows).
//   E2E_DJANGO_PORT    Default 8000.
//   FAKE_UPSTREAM_PORT Default 8787. Django's OSRM, Photon and Nominatim URLs point here.
//   E2E_LIVE=1         Leave the upstream URLs alone so Django talks to the real services.
//   E2E_DB_PATH        SQLite file. Default frontend/test-results/e2e.sqlite3, wiped on start.
//   --dry-run          Print what would run and exit.

import { spawn, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const frontendDir = path.resolve(here, '..', '..')
export const repoRoot = path.resolve(frontendDir, '..')
export const backendDir = path.join(repoRoot, 'backend')

/** @param {NodeJS.ProcessEnv} env */
export function resolvePython(env = process.env) {
  if (env.E2E_PYTHON) return env.E2E_PYTHON
  const windows = process.platform === 'win32'
  const venvPython = windows
    ? path.join(backendDir, '.venv', 'Scripts', 'python.exe')
    : path.join(backendDir, '.venv', 'bin', 'python')
  if (existsSync(venvPython)) return venvPython
  return windows ? 'python' : 'python3'
}

/**
 * dj-database-url wants three slashes plus the path. An absolute POSIX path adds its own
 * leading slash, and a Windows path (C:/...) needs the forward slashes.
 * @param {string} file
 */
export function sqliteUrl(file) {
  return `sqlite:///${path.resolve(file).replaceAll('\\', '/')}`
}

/** @param {NodeJS.ProcessEnv} env */
export function buildDjangoEnv(env = process.env) {
  const upstream = `http://127.0.0.1:${env.FAKE_UPSTREAM_PORT ?? 8787}`
  const dbPath = env.E2E_DB_PATH ?? path.join(frontendDir, 'test-results', 'e2e.sqlite3')
  /** @type {Record<string, string>} */
  const overrides = {
    DJANGO_SECRET_KEY: env.DJANGO_SECRET_KEY ?? crypto.randomBytes(32).toString('hex'),
    DJANGO_DEBUG: '1',
    DJANGO_ALLOWED_HOSTS: '127.0.0.1,localhost',
    CSRF_TRUSTED_ORIGINS: 'http://127.0.0.1:5173,http://127.0.0.1:4173,http://localhost:5173',
    DATABASE_URL: sqliteUrl(dbPath),
    HTTP_USER_AGENT: 'eld-trip-planner-e2e',
    // Lets each test pick its own client IP with X-Forwarded-For, so the per-IP throttles
    // do not make one test depend on how many others ran in the last minute.
    TRUST_PROXY_HEADERS: '1',
    PYTHONUNBUFFERED: '1',
    PYTHONUTF8: '1',
  }
  if (env.E2E_LIVE !== '1') {
    overrides.OSRM_BASE_URL = `${upstream}/osrm`
    overrides.PHOTON_BASE_URL = `${upstream}/photon`
    overrides.NOMINATIM_BASE_URL = `${upstream}/nominatim`
  }
  return { env: { ...env, ...overrides }, dbPath }
}

/** @param {string} dbPath */
function wipeDatabase(dbPath) {
  mkdirSync(path.dirname(dbPath), { recursive: true })
  for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true })
}

function main() {
  const python = resolvePython()
  const port = process.env.E2E_DJANGO_PORT ?? '8000'
  const { env, dbPath } = buildDjangoEnv()
  const steps = [
    ['manage.py', 'migrate', '--noinput'],
    ['manage.py', 'createcachetable'],
  ]
  const serve = ['manage.py', 'runserver', `127.0.0.1:${port}`, '--noreload']

  if (process.argv.includes('--dry-run')) {
    const shown = Object.fromEntries(
      Object.entries(env).filter(([key]) =>
        /^(DJANGO_|DATABASE_URL|OSRM_|PHOTON_|NOMINATIM_|TRUST_|CSRF_|HTTP_)/.test(key),
      ),
    )
    shown.DJANGO_SECRET_KEY = '<random>'
    console.log(
      JSON.stringify({ python, cwd: backendDir, dbPath, steps, serve, env: shown }, null, 2),
    )
    return
  }

  wipeDatabase(dbPath)
  for (const args of steps) {
    const result = spawnSync(python, args, { cwd: backendDir, env, stdio: 'inherit' })
    if (result.status !== 0) {
      console.error(`[start-django] "${args.join(' ')}" failed (${result.status ?? result.error})`)
      process.exit(result.status ?? 1)
    }
  }

  const child = spawn(python, serve, { cwd: backendDir, env, stdio: 'inherit' })
  const stop = () => child.kill()
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  child.on('exit', (code) => process.exit(code ?? 0))
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (invokedDirectly) main()
