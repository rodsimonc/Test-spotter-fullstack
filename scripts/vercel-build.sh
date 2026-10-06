#!/usr/bin/env bash
# Build step for Vercel (see buildCommand in vercel.json).
#
# On production deploys it first brings the database schema up to date. The connection string
# is a sensitive variable that only the build and the running function can read, so this is the
# one place that can migrate without anyone copying a secret around. Both commands are safe to
# repeat. Preview builds skip this step and leave the database alone.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ "${VERCEL_ENV:-}" = "production" ]; then
  echo "Applying database migrations"
  python3 --version
  # Vercel installs the function's packages into .vercel_python_packages and puts them on PYTHONPATH.
  # They are built for the function runtime and would shadow the clean environment made below.
  unset PYTHONPATH PYTHONHOME
  export PYTHONNOUSERSITE=1
  python3 -m venv /tmp/migrate-venv
  /tmp/migrate-venv/bin/pip install --quiet --disable-pip-version-check -r requirements.txt
  (
    cd backend
    /tmp/migrate-venv/bin/python manage.py migrate --noinput
    /tmp/migrate-venv/bin/python manage.py createcachetable
  )
fi

cd frontend
npm ci
npm run build
