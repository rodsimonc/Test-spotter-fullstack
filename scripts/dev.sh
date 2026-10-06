#!/usr/bin/env bash
# Starts Django (port 8000) and Vite (port 5173) for local work.
#
# First run: creates backend/.venv and installs the Python and npm packages.
# Every run: applies migrations, creates the throttle cache table, starts Django in the
# background and Vite in the foreground. Ctrl+C stops both.
# Django runs with DJANGO_DEBUG=1, so no secret key is needed.
#
# Usage: scripts/dev.sh [--check] [--skip-install]
#   --check          Print what would run and which ports are free, then exit.
#   --skip-install   Skip the package install, even on a first run.

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backend="$root/backend"
frontend="$root/frontend"
venv="$backend/.venv"
django_port=8000
vite_port=5173

check=0
skip_install=0
for arg in "$@"; do
  case "$arg" in
    --check) check=1 ;;
    --skip-install) skip_install=1 ;;
    -h|--help) sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

# Windows (Git Bash) keeps the interpreter in Scripts/, Linux and macOS in bin/.
if [ -x "$venv/Scripts/python.exe" ]; then python_bin="$venv/Scripts/python.exe"; else python_bin="$venv/bin/python"; fi

port_busy() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$1" -sTCP:LISTEN -t >/dev/null 2>&1
  elif command -v ss >/dev/null 2>&1; then
    ss -ltn "sport = :$1" 2>/dev/null | grep -q LISTEN
  else
    (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
  fi
}

for tool in node npm; do
  command -v "$tool" >/dev/null 2>&1 || { echo "$tool is not on PATH. Install Node 22 or newer." >&2; exit 1; }
done

busy=""
for port in "$django_port" "$vite_port"; do
  if port_busy "$port"; then busy="$busy $port"; fi
done
if [ -n "$busy" ]; then
  echo "Port(s)$busy already in use. Stop whatever holds them and run this again." >&2
  exit 1
fi

if [ "$check" -eq 1 ]; then
  echo "Root:         $root"
  if [ -e "$python_bin" ]; then echo "Python:       $python_bin (found)"; else echo "Python:       $python_bin (will be created)"; fi
  if [ -d "$frontend/node_modules" ]; then echo "node_modules: found"; else echo "node_modules: will be installed"; fi
  echo "Ports $django_port and $vite_port are free."
  echo "Would run: manage.py migrate, manage.py createcachetable, manage.py runserver, npm run dev"
  exit 0
fi

if [ "$skip_install" -eq 0 ]; then
  if [ ! -e "$python_bin" ]; then
    echo "Creating backend/.venv ..."
    if command -v python3 >/dev/null 2>&1; then python3 -m venv "$venv"; else python -m venv "$venv"; fi
    if [ -x "$venv/Scripts/python.exe" ]; then python_bin="$venv/Scripts/python.exe"; else python_bin="$venv/bin/python"; fi
  fi
  echo "Installing Python packages ..."
  "$python_bin" -m pip install --quiet --disable-pip-version-check \
    -r "$root/requirements.txt" -r "$backend/requirements-dev.txt"

  if [ ! -d "$frontend/node_modules" ]; then
    echo "Installing npm packages ..."
    (cd "$frontend" && npm ci)
  fi
fi

export DJANGO_DEBUG=1
(
  cd "$backend"
  "$python_bin" manage.py migrate --noinput
  "$python_bin" manage.py createcachetable
)

echo
echo "Django  http://127.0.0.1:$django_port/api/health"
echo "App     http://127.0.0.1:$vite_port"
echo "Press Ctrl+C to stop both."
echo

django_pid=""
cleanup() {
  if [ -n "$django_pid" ] && kill -0 "$django_pid" 2>/dev/null; then
    kill "$django_pid" 2>/dev/null || true
    wait "$django_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

(cd "$backend" && exec "$python_bin" manage.py runserver "127.0.0.1:$django_port") &
django_pid=$!

cd "$frontend"
npm run dev
