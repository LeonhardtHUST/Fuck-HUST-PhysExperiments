<#
.SYNOPSIS
    Start (or build / stop) the PhysicsLab backend and frontend locally.

.DESCRIPTION
    Default (dev) mode:
      - backend : FastAPI via uvicorn on http://127.0.0.1:8001 with --reload
      - frontend: Next.js dev server on http://localhost:3000

    -Build mode:
      - runs npm run build for the frontend (static export -> frontend/out) and exits

    -Prod mode:
      - runs the build, then serves frontend/out statically and runs uvicorn
        without --reload (fast, production-like preview)

    By default both services take over the current console: log lines are
    streamed with [api] / [web] prefixes and Ctrl+C stops both.
    Use -Detach to run them in the background instead (logs in .dev-logs/).

    Dependencies are installed on first run (Python venv at .venv, npm ci in frontend).

.PARAMETER Build
    Build the frontend for production (npm run build -> frontend/out) and exit.

.PARAMETER Prod
    Build first, then start backend + static server for the exported frontend.

.PARAMETER Detach
    Run in the background instead of occupying this console. Logs go to .dev-logs/.

.PARAMETER Install
    Force reinstall of Python and npm dependencies before starting.

.PARAMETER Stop
    Stop whatever is listening on the backend and frontend ports, then exit.

.PARAMETER NoBrowser
    Do not open the browser after the frontend is ready.

.PARAMETER BackendPort
    Backend port, defaults to 8001.

.PARAMETER FrontendPort
    Frontend port, defaults to 3000.

.EXAMPLE
    .\scripts\dev.ps1

.EXAMPLE
    .\scripts\dev.ps1 -Prod -NoBrowser

.EXAMPLE
    .\scripts\dev.ps1 -Build

.EXAMPLE
    .\scripts\dev.ps1 -Detach

.EXAMPLE
    .\scripts\dev.ps1 -Stop
#>
[CmdletBinding()]
param(
    [switch]$Build,
    [switch]$Prod,
    [switch]$Detach,
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
$outDir   = Join-Path $frontend 'out'
$serveStatic = Join-Path $PSScriptRoot 'serve-static.mjs'

function Stop-Port {
    param(
        [int]$Port,
        [switch]$Quiet
    )

    $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if (-not $connections) {
        if (-not $Quiet) { Write-Host ("  port {0}: nothing listening" -f $Port) }
        return
    }
    foreach ($procId in ($connections.OwningProcess | Sort-Object -Unique)) {
        $processName = (Get-Process -Id $procId -ErrorAction SilentlyContinue).ProcessName
        Write-Host ("  port {0}: killing {1} (PID {2})" -f $Port, $processName, $procId)
        & taskkill.exe /PID $procId /T /F 2>&1 | Out-Null
    }
}

function Test-Url {
    param([string]$Url)

    try {
        $response = Invoke-WebRequest -Uri $Url -TimeoutSec 3 -UseBasicParsing
        return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500)
    } catch {
        return $false
    }
}

function Wait-Http {
    param(
        [string]$Url,
        [int]$TimeoutSec = 180,
        [string]$LogPath
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (Test-Url $Url) { return $true }
        Start-Sleep -Milliseconds 500
    }
    Write-Warning ("Timed out after {0}s waiting for {1}. Log: {2}" -f $TimeoutSec, $Url, $LogPath)
    return $false
}

# Streams job output while waiting, so the console is never silent for minutes.
function Wait-Ready {
    param(
        [object[]]$Jobs,
        [string]$Url,
        [int]$TimeoutSec = 180,
        [string]$Label
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        # Write-Host, not bare output: callers capture this function's success
        # stream (e.g. $ok = Wait-Ready ...), which would swallow log lines.
        Receive-Job -Job $Jobs | ForEach-Object { Write-Host $_ }
        if (Test-Url $Url) { return $true }
        Start-Sleep -Milliseconds 400
    }
    Write-Warning ("Timed out after {0}s waiting for {1}." -f $TimeoutSec, $Label)
    return $false
}

function Show-Banner {
    param(
        [string]$Mode,
        [string]$BackendState,
        [string]$FrontendState,
        [string]$LogHint
    )

    $backendUrl  = "http://127.0.0.1:$BackendPort"
    $frontendUrl = "http://localhost:$FrontendPort"

    Write-Host ''
    Write-Host 'PhysicsLab local development'
    Write-Host ("  backend  : {0}   (API docs: {0}/docs)  {1}" -f $backendUrl, $BackendState)
    Write-Host ("  frontend : {0}   {1}" -f $frontendUrl, $FrontendState)
    Write-Host ("  mode     : {0}" -f $Mode)
    Write-Host ("  {0}" -f $LogHint)
    Write-Host ''
}

if ($Stop) {
    Write-Host 'Stopping local dev services...'
    Stop-Port $BackendPort
    Stop-Port $FrontendPort
    Write-Host 'Done.'
    exit 0
}

# --- prerequisite checks -----------------------------------------------------
$requiredTools = if ($Build) { @('node', 'npm') } else { @('python', 'node', 'npm') }
foreach ($tool in $requiredTools) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
        throw "'$tool' was not found on PATH."
    }
}
if (-not $Build -and -not (Test-Path $requirements)) { throw "Missing $requirements" }
if (-not (Test-Path $serveStatic)) { throw "Missing $serveStatic" }

# npm on Windows may be npm.cmd, a shim npm.exe (nvm/volta/vite-plus), or npm.ps1.
# Start-Process needs a real executable path, so resolve it once here.
$npmExe = (Get-Command 'npm' -CommandType Application -ErrorAction SilentlyContinue |
    Select-Object -First 1).Source
if (-not $npmExe) { throw 'Could not resolve the npm executable on PATH.' }

$nodeExe = (Get-Command 'node' -CommandType Application -ErrorAction SilentlyContinue |
    Select-Object -First 1).Source
if (-not $nodeExe) { throw 'Could not resolve the node executable on PATH.' }

function Invoke-FrontendBuild {
    Write-Host 'Building frontend (npm run build) ...'
    # A killed build can leave .next/lock behind, which makes next refuse to
    # start with "Another next build process is already running". Clear it only
    # when no live next build owns it.
    $lockFile = Join-Path $frontend '.next\lock'
    if (Test-Path $lockFile) {
        $activeBuild = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
            Where-Object { $_.CommandLine -like '*next*' -and $_.CommandLine -like '*build*' }
        if ($activeBuild) {
            throw 'Another next build is running. Wait for it to finish (or stop it), then retry.'
        }
        Remove-Item -Force $lockFile
        Write-Host 'Removed stale .next/lock left by an interrupted build.'
    }
    # Clean the export ourselves: next build deletes it through fs.rm, which
    # bulk-delete guards (IDE shims) can block with a confusing error.
    if (Test-Path $outDir) { Remove-Item -Recurse -Force $outDir }
    Push-Location $frontend
    try {
        & $npmExe run build
        if ($LASTEXITCODE -ne 0) { throw 'npm run build failed.' }
    } finally {
        Pop-Location
    }
    $index = Join-Path $outDir 'index.html'
    if (-not (Test-Path $index)) { throw "Build finished but $index is missing." }
    Write-Host ("Built: {0}" -f $outDir)
}

# --- dependencies ------------------------------------------------------------
$needsPythonInstall = -not $Build -and ($Install -or -not (Test-Path $venvPy))
if (-not $Build -and -not $needsPythonInstall) {
    & $venvPy -c 'import uvicorn' 2>$null
    $needsPythonInstall = ($LASTEXITCODE -ne 0)
}

if ($Build) {
    Write-Host 'Skipping Python environment (build only).'
} elseif ($needsPythonInstall) {
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

if ($Build) {
    Invoke-FrontendBuild
    exit 0
}

if ($Prod) {
    Invoke-FrontendBuild
}

Write-Host 'Clearing ports:'
Stop-Port $BackendPort -Quiet
Stop-Port $FrontendPort -Quiet

$backendUrl  = "http://127.0.0.1:$BackendPort"
$frontendUrl = "http://localhost:$FrontendPort"
$backendHealth = "$backendUrl/health"
$modeName = if ($Prod) { 'production build' } else { 'development' }

if ($Detach) {
    # ---------------- detached mode ----------------
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    $backendOut = Join-Path $logDir 'backend.log'
    $backendErr = Join-Path $logDir 'backend.err.log'
    $frontOut   = Join-Path $logDir 'frontend.log'
    $frontErr   = Join-Path $logDir 'frontend.err.log'

    Write-Host ("Starting backend on {0} ..." -f $backendUrl)
    $apiArgs = @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', "$BackendPort")
    if (-not $Prod) { $apiArgs += '--reload' }
    $backendProc = Start-Process -FilePath $venvPy `
        -ArgumentList $apiArgs `
        -WorkingDirectory $backend `
        -RedirectStandardOutput $backendOut `
        -RedirectStandardError $backendErr `
        -WindowStyle Hidden `
        -PassThru

    $backendOk = Wait-Http -Url $backendHealth -TimeoutSec 180 -LogPath $backendOut

    Write-Host ("Starting frontend on {0} ..." -f $frontendUrl)
    if ($Prod) {
        $webExe     = $nodeExe
        $webArgs    = @($serveStatic, $outDir, "$FrontendPort", '127.0.0.1')
        $webWorkDir = $root
    } else {
        $webExe     = $npmExe
        $webArgs    = @('run', 'dev', '--', '--port', "$FrontendPort")
        $webWorkDir = $frontend
    }
    $frontendProc = Start-Process -FilePath $webExe `
        -ArgumentList $webArgs `
        -WorkingDirectory $webWorkDir `
        -RedirectStandardOutput $frontOut `
        -RedirectStandardError $frontErr `
        -WindowStyle Hidden `
        -PassThru

    $frontendOk = Wait-Http -Url "$frontendUrl/" -TimeoutSec 180 -LogPath $frontOut

    Show-Banner -Mode ("{0}, detached (background)" -f $modeName) `
        -BackendState $(if ($backendOk) { 'ready' } else { 'FAILED - see .dev-logs\backend.err.log' }) `
        -FrontendState $(if ($frontendOk) { 'ready' } else { 'FAILED - see .dev-logs\frontend.err.log' }) `
        -LogHint ("logs: {0}   PIDs: api {1}, web {2}" -f $logDir, $backendProc.Id, $frontendProc.Id)

    Write-Host 'Stop with: .\scripts\dev.ps1 -Stop'
    Write-Host 'Optional backend switches: create backend\.env.local with'
    Write-Host '  ENABLE_DATA_COLLECTION=true'
    Write-Host '  PHYSICSLAB_DEV_MODE=true'

    if ($frontendOk -and -not $NoBrowser) { Start-Process $frontendUrl }
    exit 0
}

# ---------------- foreground mode ----------------
Write-Host ("Starting backend on {0} ..." -f $backendUrl)
$apiJob = Start-Job -Name 'physicslab-api' -ScriptBlock {
    param($PythonExe, $BackendDir, $Port, $Reload)

    $env:NO_COLOR = '1'
    Set-Location -LiteralPath $BackendDir
    $uvicornArgs = @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', "$Port", '--no-use-colors')
    if ($Reload) { $uvicornArgs += '--reload' }
    & $PythonExe @uvicornArgs 2>&1 | ForEach-Object { "[api] $_" }
} -ArgumentList $venvPy, $backend, $BackendPort, (-not $Prod)

$backendOk = $false
try {
    $backendOk = Wait-Ready -Jobs $apiJob -Url $backendHealth -TimeoutSec 180 -Label $backendUrl

    Write-Host ("Starting frontend on {0} ..." -f $frontendUrl)
    $webJob = Start-Job -Name 'physicslab-web' -ScriptBlock {
        param($Prod, $NodeExe, $ServeScript, $OutDir, $NpmExe, $FrontendDir, $Port)

        $env:NO_COLOR = '1'
        if ($Prod) {
            & $NodeExe $ServeScript $OutDir "$Port" 127.0.0.1 2>&1 |
                ForEach-Object { "[web] $_" }
        } else {
            Set-Location -LiteralPath $FrontendDir
            & $NpmExe run dev -- --port $Port 2>&1 | ForEach-Object { "[web] $_" }
        }
    } -ArgumentList $Prod.IsPresent, $nodeExe, $serveStatic, $outDir, $npmExe, $frontend, $FrontendPort

    $jobs = @($apiJob, $webJob)
    $frontendOk = Wait-Ready -Jobs $jobs -Url "$frontendUrl/" -TimeoutSec 180 -Label $frontendUrl

    Show-Banner -Mode ("{0}, foreground (this console, Ctrl+C to stop)" -f $modeName) `
        -BackendState $(if ($backendOk) { 'ready' } else { 'FAILED - see output above' }) `
        -FrontendState $(if ($frontendOk) { 'ready' } else { 'FAILED - see output above' }) `
        -LogHint 'Ctrl+C stops both services; -Detach runs them in the background instead.'

    if ($frontendOk -and -not $NoBrowser) { Start-Process $frontendUrl }

    while ($true) {
        Receive-Job -Job $jobs | ForEach-Object { Write-Host $_ }
        Start-Sleep -Milliseconds 200
    }
} finally {
    Write-Host ''
    Write-Host 'Stopping local dev services...'
    Get-Job -Name 'physicslab-api', 'physicslab-web' -ErrorAction SilentlyContinue |
        Stop-Job -ErrorAction SilentlyContinue
    Get-Job -Name 'physicslab-api', 'physicslab-web' -ErrorAction SilentlyContinue |
        Remove-Job -Force -ErrorAction SilentlyContinue
    Stop-Port $BackendPort -Quiet
    Stop-Port $FrontendPort -Quiet
    Write-Host 'Done.'
}
