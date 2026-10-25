<#
.SYNOPSIS
    Start (or stop) the PhysicsLab backend and frontend for local development.

.DESCRIPTION
    - backend : FastAPI via uvicorn on http://127.0.0.1:8001 (reload enabled)
    - frontend: Next.js dev server on http://localhost:3000
    Both run as detached background processes; logs go to .dev-logs/.
    Dependencies are installed on first run (Python venv at .venv, npm ci in frontend).

.PARAMETER Install
    Force reinstall of Python and npm dependencies before starting.

.PARAMETER Stop
    Stop whatever is listening on the backend and frontend ports, then exit.

.PARAMETER NoBrowser
    Do not open the browser after the frontend is ready.

.EXAMPLE
    .\scripts\dev.ps1

.EXAMPLE
    .\scripts\dev.ps1 -Stop
#>
[CmdletBinding()]
param(
    [switch]$Install,
    [switch]$Stop,
    [switch]$NoBrowser,
    [int]$BackendPort = 8001,
    [int]$FrontendPort = 3000
)

$ErrorActionPreference = 'Stop'

$root     = Split-Path -Parent $PSScriptRoot
$backend  = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'
$venv     = Join-Path $root '.venv'
$venvPy   = Join-Path $venv 'Scripts\python.exe'
$logDir   = Join-Path $root '.dev-logs'
$requirements = Join-Path $backend 'requirements.txt'

function Stop-Port {
    param([int]$Port)

    $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $connections) {
        Write-Host ("  port {0}: nothing listening" -f $Port)
        return
    }
    foreach ($procId in ($connections.OwningProcess | Sort-Object -Unique)) {
        $name = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName
        Write-Host ("  port {0}: killing {1} (PID {2})" -f $Port, $name, $procId)
        & taskkill.exe /PID $procId /T /F 2>&1 | Out-Null
    }
}

function Wait-Http {
    param(
        [string]$Url,
        [int]$TimeoutSec = 120,
        [string]$LogPath
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $Url -TimeoutSec 3 -UseBasicParsing
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) { return $true }
        } catch {
            Start-Sleep -Milliseconds 700
        }
    }
    Write-Warning ("Timed out after {0}s waiting for {1}. Log: {2}" -f $TimeoutSec, $Url, $LogPath)
    return $false
}

if ($Stop) {
    Write-Host 'Stopping local dev services...'
    Stop-Port $BackendPort
    Stop-Port $FrontendPort
    Write-Host 'Done.'
    exit 0
}

# --- prerequisite checks -----------------------------------------------------
foreach ($tool in @('python', 'node', 'npm')) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw "'$tool' was not found on PATH."
    }
}
if (-not (Test-Path $requirements)) { throw "Missing $requirements" }

# npm on Windows may be npm.cmd, a shim npm.exe (nvm/volta/vite-plus), or npm.ps1.
# Start-Process needs a real executable path, so resolve it once here.
$npmExe = (Get-Command 'npm' -CommandType Application -ErrorAction SilentlyContinue |
    Select-Object -First 1).Source
if (-not $npmExe) { throw 'Could not resolve the npm executable on PATH.' }

# --- dependencies ------------------------------------------------------------
$needsPythonInstall = $Install -or -not (Test-Path $venvPy)
if (-not $needsPythonInstall) {
    & $venvPy -c 'import uvicorn' 2>$null
    $needsPythonInstall = ($LASTEXITCODE -ne 0)
}

if ($needsPythonInstall) {
    Write-Host 'Preparing Python environment (.venv) ...'
    if (-not (Test-Path $venvPy)) {
        & python -m venv $venv
        if ($LASTEXITCODE -ne 0) { throw 'Failed to create the Python virtual environment.' }
    }
    & $venvPy -m pip install --upgrade pip --quiet
    & $venvPy -m pip install -r $requirements
    if ($LASTEXITCODE -ne 0) { throw 'Failed to install backend requirements.' }
} else {
    Write-Host 'Python environment looks ready (.venv).'
}

$nodeModules = Join-Path $frontend 'node_modules'
if ($Install -or -not (Test-Path $nodeModules)) {
    Write-Host 'Installing frontend dependencies (npm ci) ...'
    Push-Location $frontend
    try {
        & $npmExe ci
        if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
    } finally {
        Pop-Location
    }
} else {
    Write-Host 'Frontend dependencies look ready (node_modules).'
}

# --- start backend -----------------------------------------------------------
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$backendOut = Join-Path $logDir 'backend.log'
$backendErr = Join-Path $logDir 'backend.err.log'
$frontOut   = Join-Path $logDir 'frontend.log'
$frontErr   = Join-Path $logDir 'frontend.err.log'

Stop-Port $BackendPort
Stop-Port $FrontendPort

Write-Host ("Starting backend on http://127.0.0.1:{0} ..." -f $BackendPort)
$backendProc = Start-Process -FilePath $venvPy `
    -ArgumentList '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', $BackendPort, '--reload' `
    -WorkingDirectory $backend `
    -RedirectStandardOutput $backendOut `
    -RedirectStandardError $backendErr `
    -WindowStyle Hidden `
    -PassThru

$backendOk = Wait-Http -Url ("http://127.0.0.1:{0}/health" -f $BackendPort) -TimeoutSec 180 -LogPath $backendOut
if (-not $backendOk) {
    Write-Warning 'Backend did not answer /health. See .dev-logs\backend.err.log; the frontend will still start.'
}

# --- start frontend ----------------------------------------------------------
Write-Host ("Starting frontend on http://localhost:{0} ..." -f $FrontendPort)
$frontendProc = Start-Process -FilePath $npmExe `
    -ArgumentList 'run', 'dev', '--', '--port', $FrontendPort `
    -WorkingDirectory $frontend `
    -RedirectStandardOutput $frontOut `
    -RedirectStandardError $frontErr `
    -WindowStyle Hidden `
    -PassThru

$frontendOk = Wait-Http -Url ("http://localhost:{0}/" -f $FrontendPort) -TimeoutSec 180 -LogPath $frontOut

$backendUrl  = "http://127.0.0.1:$BackendPort"
$frontendUrl = "http://localhost:$FrontendPort"

Write-Host ''
Write-Host 'PhysicsLab local development'
Write-Host ("  backend  : {0}   (API docs: {0}/docs)  {1}" -f $backendUrl, $(if ($backendOk) { 'ready' } else { 'FAILED - see .dev-logs\backend.err.log' }))
Write-Host ("  frontend : {0}   {1}" -f $frontendUrl, $(if ($frontendOk) { 'ready' } else { 'FAILED - see .dev-logs\frontend.err.log' }))
Write-Host ("  logs     : {0}" -f $logDir)
Write-Host ("  backend PID {0}, frontend PID {1}" -f $backendProc.Id, $frontendProc.Id)
Write-Host ''
Write-Host 'Stop with: .\scripts\dev.ps1 -Stop'
Write-Host 'Optional backend switches: create backend\.env.local with'
Write-Host '  ENABLE_DATA_COLLECTION=true'
Write-Host '  PHYSICSLAB_DEV_MODE=true'

if ($frontendOk -and -not $NoBrowser) {
    Start-Process $frontendUrl
}
