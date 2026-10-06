<#
.SYNOPSIS
  Starts Django (port 8000) and Vite (port 5173) for local work.

.DESCRIPTION
  First run: creates backend\.venv, installs the Python and npm packages.
  Every run: applies migrations, creates the throttle cache table, starts Django in the
  background and Vite in the foreground. Ctrl+C stops both.
  Django runs with DJANGO_DEBUG=1, so no secret key is needed.

.PARAMETER Check
  Prints what would run and which ports are free, then exits. Starts nothing.

.PARAMETER SkipInstall
  Skips the package install, even on a first run.

.EXAMPLE
  .\scripts\dev.ps1
#>
[CmdletBinding()]
param(
  [switch]$Check,
  [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'
$venvDir = Join-Path $backend '.venv'
$python = Join-Path $venvDir 'Scripts\python.exe'
$djangoPort = 8000
$vitePort = 5173

function Assert-Success([string]$what) {
  if ($LASTEXITCODE -ne 0) { throw "$what failed with exit code $LASTEXITCODE." }
}

function Test-PortBusy([int]$port) {
  $null -ne (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
}

foreach ($tool in 'node', 'npm') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool is not on PATH. Install Node 22 or newer." }
}

$busy = @($djangoPort, $vitePort) | Where-Object { Test-PortBusy $_ }
if ($busy) {
  throw "Port(s) $($busy -join ', ') already in use. Stop whatever holds them and run this again."
}

if ($Check) {
  Write-Host "Root:      $root"
  Write-Host "Python:    $python $(if (Test-Path $python) { '(found)' } else { '(will be created)' })"
  Write-Host "node_modules: $(if (Test-Path (Join-Path $frontend 'node_modules')) { 'found' } else { 'will be installed' })"
  Write-Host "Ports $djangoPort and $vitePort are free."
  Write-Host 'Would run: manage.py migrate, manage.py createcachetable, manage.py runserver, npm run dev'
  return
}

if (-not $SkipInstall) {
  if (-not (Test-Path $python)) {
    Write-Host 'Creating backend\.venv ...'
    if (Get-Command py -ErrorAction SilentlyContinue) { py -3 -m venv $venvDir } else { python -m venv $venvDir }
    Assert-Success 'Creating the virtual environment'
  }
  Write-Host 'Installing Python packages ...'
  & $python -m pip install --quiet --disable-pip-version-check `
    -r (Join-Path $root 'requirements.txt') -r (Join-Path $backend 'requirements-dev.txt')
  Assert-Success 'pip install'

  if (-not (Test-Path (Join-Path $frontend 'node_modules'))) {
    Write-Host 'Installing npm packages ...'
    Push-Location $frontend
    try { npm ci; Assert-Success 'npm ci' } finally { Pop-Location }
  }
}

$env:DJANGO_DEBUG = '1'
Push-Location $backend
try {
  & $python manage.py migrate --noinput
  Assert-Success 'migrate'
  & $python manage.py createcachetable
  Assert-Success 'createcachetable'
} finally {
  Pop-Location
}

Write-Host ''
Write-Host "Django  http://127.0.0.1:$djangoPort/api/health"
Write-Host "App     http://127.0.0.1:$vitePort"
Write-Host 'Press Ctrl+C to stop both.'
Write-Host ''

$django = Start-Process -FilePath $python `
  -ArgumentList 'manage.py', 'runserver', "127.0.0.1:$djangoPort" `
  -WorkingDirectory $backend -NoNewWindow -PassThru

Push-Location $frontend
try {
  npm run dev
} finally {
  Pop-Location
  if ($django -and -not $django.HasExited) {
    # /T takes the autoreloader's child process down with it.
    taskkill /T /F /PID $django.Id | Out-Null
  }
}
