#!/usr/bin/env bash
#
# Start (or build / stop) the PhysicsLab backend and frontend locally.
#
# Modes:
#   dev   (default)  backend : uvicorn --reload on http://127.0.0.1:8001
#                    frontend: Next.js dev server on http://localhost:3000
#   build            npm run build -> frontend/out, then exit
#   prod             npm run build, then serve frontend/out statically and run
#                    uvicorn without --reload (fast, production-like preview)
#
# By default the services take over this terminal: log lines are streamed with
# [api] / [web] prefixes and Ctrl+C stops both. Pass --detach to run them in the
# background instead (logs in .dev-logs/).
#
# Works on Git Bash / MSYS2 (Windows), Linux and macOS.
#
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
OUT_DIR="$FRONTEND_DIR/out"
VENV_DIR="$ROOT_DIR/.venv"
LOG_DIR="$ROOT_DIR/.dev-logs"
REQUIREMENTS="$BACKEND_DIR/requirements.txt"
SERVE_STATIC="$SCRIPT_DIR/serve-static.mjs"

BACKEND_PORT=8001
FRONTEND_PORT=3000
MODE=dev
DETACH=0
FORCE_INSTALL=0
DO_STOP=0
OPEN_BROWSER=1

usage() {
    cat <<'EOF'
Usage: scripts/dev.sh [mode] [options]

Modes:
      --build               build the frontend (npm run build -> frontend/out) and exit
      --prod                build, then run backend + static server for frontend/out

Options:
  -d, --detach              run in the background, logs in .dev-logs/
      --install             force reinstall of Python and npm dependencies
      --stop                stop whatever listens on the two ports, then exit
      --no-browser          do not open the browser when the frontend is ready
  -b, --backend-port PORT   backend port (default 8001)
  -f, --frontend-port PORT  frontend port (default 3000)
  -h, --help                show this help

Default mode is `dev` (hot reload). Ctrl+C stops both services in the foreground.
EOF
}

die() {
    echo "error: $*" >&2
    exit 1
}

need() {
    command -v "$1" >/dev/null 2>&1 || die "'$1' not found on PATH."
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        -d|--detach)          DETACH=1; shift ;;
        --build)              MODE=build; shift ;;
        --prod)               MODE=prod; shift ;;
        --install)            FORCE_INSTALL=1; shift ;;
        --stop)               DO_STOP=1; shift ;;
        --no-browser)         OPEN_BROWSER=0; shift ;;
        -b|--backend-port)    BACKEND_PORT="${2:-}"; shift 2 || die "missing value for $0" ;;
        -f|--frontend-port)   FRONTEND_PORT="${2:-}"; shift 2 || die "missing value for $0" ;;
        -h|--help)            usage; exit 0 ;;
        *)                    echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
    esac
done

[[ "$BACKEND_PORT" =~ ^[0-9]+$ ]] || die "invalid backend port: $BACKEND_PORT"
[[ "$FRONTEND_PORT" =~ ^[0-9]+$ ]] || die "invalid frontend port: $FRONTEND_PORT"

case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) IS_WINDOWS=1 ;;
    *)                    IS_WINDOWS=0 ;;
esac

# --- port helpers ------------------------------------------------------------
kill_by_port() {
    local port="$1" pids="" pid

    if [[ $IS_WINDOWS -eq 1 ]]; then
        pids="$(netstat -ano -p tcp 2>/dev/null |
            awk -v p=":$port" '$2 ~ p"$" && $4 == "LISTENING" {print $5}' |
            sort -u)"
        for pid in $pids; do
            echo "  port $port: killing PID $pid"
            taskkill //F //T //PID "$pid" >/dev/null 2>&1 || true
        done
        return 0
    fi

    if command -v lsof >/dev/null 2>&1; then
        pids="$(lsof -ti "tcp:$port" 2>/dev/null || true)"
    elif command -v fuser >/dev/null 2>&1; then
        pids="$(fuser "$port"/tcp 2>/dev/null || true)"
    elif command -v ss >/dev/null 2>&1; then
        pids="$(ss -lptnH "sport = :$port" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u || true)"
    fi
    for pid in $pids; do
        echo "  port $port: killing PID $pid"
        kill -TERM "$pid" 2>/dev/null || true
    done
    return 0
}

kill_tree() {
    local pid="${1:-}"
    [[ -z "$pid" ]] && return 0

    if [[ $IS_WINDOWS -eq 1 ]]; then
        # $! is an MSYS pseudo pid, so taskkill cannot use it; MSYS kill can.
        # Grandchildren (uvicorn reload worker, npm's node) are reaped by the
        # kill_by_port fallback that runs afterwards.
        kill -TERM "$pid" 2>/dev/null || true
        return 0
    fi

    pkill -TERM -P "$pid" 2>/dev/null || true
    kill -TERM "$pid" 2>/dev/null || true
    return 0
}

url_ready() {
    local url="$1"

    if command -v curl >/dev/null 2>&1; then
        if curl -fsS -m 2 -o /dev/null "$url" 2>/dev/null; then
            return 0
        fi
        return 1
    fi

    local hostport="${url#http://}"
    hostport="${hostport%%/*}"
    local host="${hostport%%:*}" port="${hostport##*:}"
    if (exec 3<>"/dev/tcp/$host/$port") >/dev/null 2>&1; then
        return 0
    fi
    return 1
}

wait_for_url() {
    local url="$1" timeout="${2:-180}" ticks=$(( ${2:-180} * 2 )) i=0

    while [[ $i -lt $ticks ]]; do
        if url_ready "$url"; then
            return 0
        fi
        sleep 0.5
        i=$((i + 1))
    done
    return 1
}

open_browser() {
    local url="$1"

    if [[ $IS_WINDOWS -eq 1 ]]; then
        cmd //c start "" "$url" >/dev/null 2>&1 || true
    elif [[ "$(uname -s)" == "Darwin" ]]; then
        open "$url" >/dev/null 2>&1 || true
    elif command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$url" >/dev/null 2>&1 || true
    fi
    return 0
}

# --- dependency handling -----------------------------------------------------
PY_LAUNCHER=""
for candidate in python3 python; do
    if command -v "$candidate" >/dev/null 2>&1; then
        PY_LAUNCHER="$candidate"
        break
    fi
done

venv_python=""
if [[ -x "$VENV_DIR/Scripts/python.exe" ]]; then
    venv_python="$VENV_DIR/Scripts/python.exe"
elif [[ -x "$VENV_DIR/bin/python" ]]; then
    venv_python="$VENV_DIR/bin/python"
fi

ensure_python() {
    local need_install=0

    if [[ $FORCE_INSTALL -eq 1 || -z "$venv_python" ]]; then
        need_install=1
    elif ! "$venv_python" -c 'import uvicorn' >/dev/null 2>&1; then
        need_install=1
    fi

    if [[ $need_install -eq 0 ]]; then
        echo "Python environment looks ready (.venv)."
        return 0
    fi

    echo "Preparing Python environment (.venv) ..."
    if [[ -z "$venv_python" ]]; then
        [[ -n "$PY_LAUNCHER" ]] || die "python not found on PATH."
        "$PY_LAUNCHER" -m venv "$VENV_DIR" || die "failed to create the virtual environment."
        if [[ -x "$VENV_DIR/Scripts/python.exe" ]]; then
            venv_python="$VENV_DIR/Scripts/python.exe"
        else
            venv_python="$VENV_DIR/bin/python"
        fi
    fi
    "$venv_python" -m pip install --upgrade pip --quiet || die "pip upgrade failed."
    "$venv_python" -m pip install -r "$REQUIREMENTS" || die "failed to install backend requirements."
    return 0
}

ensure_node() {
    if [[ $FORCE_INSTALL -eq 1 || ! -d "$FRONTEND_DIR/node_modules" ]]; then
        echo "Installing frontend dependencies (npm ci) ..."
        ( cd "$FRONTEND_DIR" && npm ci ) || die "npm ci failed."
    else
        echo "Frontend dependencies look ready (node_modules)."
    fi
    return 0
}

# next build removes frontend/out through fs.rm, which bulk-delete guards
# (IDE shims on Windows) can block with a confusing error. Removing the export
# ourselves keeps the build independent of those guards.
remove_dir() {
    local dir="$1"
    [[ -d "$dir" ]] || return 0

    if [[ $IS_WINDOWS -eq 1 ]]; then
        local win_dir
        win_dir="$(cygpath -w "$dir" 2>/dev/null || printf '%s' "$dir")"
        powershell.exe -NoProfile -NonInteractive -Command \
            "Remove-Item -LiteralPath '$win_dir' -Recurse -Force -ErrorAction SilentlyContinue" \
            >/dev/null 2>&1 || true
    fi
    rm -rf "$dir" 2>/dev/null || true
    return 0
}

build_frontend() {
    echo "Building frontend (npm run build) ..."
    # A killed build can leave .next/lock behind, which makes next refuse to
    # start with "Another next build process is already running". Clear it only
    # when no live next build owns it.
    local lock_file="$FRONTEND_DIR/.next/lock"
    if [[ -e "$lock_file" ]]; then
        if command -v pgrep >/dev/null 2>&1 && pgrep -f "next.*build" >/dev/null 2>&1; then
            die "another next build is running; wait for it to finish (or stop it), then retry"
        fi
        rm -f "$lock_file"
        echo "Removed stale .next/lock left by an interrupted build."
    fi
    remove_dir "$OUT_DIR"
    ( cd "$FRONTEND_DIR" && npm run build ) || die "npm run build failed."
    [[ -f "$OUT_DIR/index.html" ]] ||
        die "build finished but $OUT_DIR/index.html is missing."
    echo "Built: $OUT_DIR"
}

show_banner() {
    local mode="$1" backend_state="$2" frontend_state="$3" hint="$4"

    echo ""
    echo "PhysicsLab local development"
    printf '  backend  : %s   (API docs: %s/docs)  %s\n' \
        "http://127.0.0.1:$BACKEND_PORT" "http://127.0.0.1:$BACKEND_PORT" "$backend_state"
    printf '  frontend : %s   %s\n' "http://localhost:$FRONTEND_PORT" "$frontend_state"
    printf '  mode     : %s\n' "$mode"
    printf '  %s\n' "$hint"
    echo ""
}

mode_label() {
    local where="$1"

    if [[ $MODE == prod ]]; then
        printf 'production build, %s' "$where"
    else
        printf 'development, %s' "$where"
    fi
}

# --- commands ----------------------------------------------------------------
API_ARGS=()
build_api_args() {
    API_ARGS=( -m uvicorn app.main:app --host 127.0.0.1 --port "$BACKEND_PORT" )
    if [[ $MODE == dev ]]; then
        API_ARGS+=( --reload )
    fi
}

# dev mode: Next.js dev server; prod mode: static server over frontend/out.
run_web_fg() {
    if [[ $MODE == prod ]]; then
        exec node "$SERVE_STATIC" "$OUT_DIR" "$FRONTEND_PORT" 127.0.0.1
    fi
    exec npm run dev -- --port "$FRONTEND_PORT"
}

run_web_bg() {
    if [[ $MODE == prod ]]; then
        exec nohup node "$SERVE_STATIC" "$OUT_DIR" "$FRONTEND_PORT" 127.0.0.1
    fi
    exec nohup npm run dev -- --port "$FRONTEND_PORT"
}

# --- stop --------------------------------------------------------------------
if [[ $DO_STOP -eq 1 ]]; then
    echo "Stopping local dev services..."
    kill_by_port "$BACKEND_PORT"
    kill_by_port "$FRONTEND_PORT"
    echo "Done."
    exit 0
fi

# --- prerequisites -----------------------------------------------------------
need node
need npm
[[ -f "$REQUIREMENTS" ]] || die "missing $REQUIREMENTS"
[[ -f "$SERVE_STATIC" ]] || die "missing $SERVE_STATIC"

if [[ $MODE == build ]]; then
    ensure_node
    build_frontend
    exit 0
fi

ensure_python
ensure_node

if [[ $MODE == prod ]]; then
    build_frontend
fi

build_api_args

echo "Clearing ports:"
kill_by_port "$BACKEND_PORT"
kill_by_port "$FRONTEND_PORT"

api_pid=""
web_pid=""

cleanup() {
    trap - INT TERM
    echo ""
    echo "Stopping ..."
    kill_tree "$web_pid"
    kill_tree "$api_pid"
    # Safety net: uvicorn's reload worker and npm's node child outlive their
    # launcher, so close the ports by pid as well.
    kill_by_port "$FRONTEND_PORT"
    kill_by_port "$BACKEND_PORT"
    wait 2>/dev/null || true
    echo "Done."
    exit 0
}

# --- foreground --------------------------------------------------------------
start_foreground() {
    echo "Starting backend on http://127.0.0.1:$BACKEND_PORT ..."
    (
        cd "$BACKEND_DIR"
        exec "$venv_python" "${API_ARGS[@]}"
    ) > >(sed -u 's/^/[api] /') 2>&1 &
    api_pid=$!

    trap cleanup INT TERM

    local backend_state="ready"
    if ! wait_for_url "http://127.0.0.1:$BACKEND_PORT/health" 180; then
        backend_state="FAILED - see output above"
        echo "warning: backend did not answer /health within 180s." >&2
    fi

    echo "Starting frontend on http://localhost:$FRONTEND_PORT ..."
    (
        cd "$FRONTEND_DIR"
        run_web_fg
    ) > >(sed -u 's/^/[web] /') 2>&1 &
    web_pid=$!

    local frontend_state="ready"
    if ! wait_for_url "http://localhost:$FRONTEND_PORT/" 180; then
        frontend_state="FAILED - see output above"
    fi

    show_banner "$(mode_label 'this terminal, Ctrl+C to stop')" \
        "$backend_state" "$frontend_state" \
        "Ctrl+C stops both services; --detach runs them in the background instead."

    if [[ $OPEN_BROWSER -eq 1 && "$frontend_state" == "ready" ]]; then
        open_browser "http://localhost:$FRONTEND_PORT/"
    fi

    wait
}

# --- detached ----------------------------------------------------------------
start_detached() {
    mkdir -p "$LOG_DIR"
    local backend_log="$LOG_DIR/backend.log"
    local frontend_log="$LOG_DIR/frontend.log"

    echo "Starting backend on http://127.0.0.1:$BACKEND_PORT ..."
    (
        cd "$BACKEND_DIR"
        exec nohup "$venv_python" "${API_ARGS[@]}"
    ) >"$backend_log" 2>&1 &
    api_pid=$!
    disown "$api_pid" 2>/dev/null || true

    local backend_state="ready"
    if ! wait_for_url "http://127.0.0.1:$BACKEND_PORT/health" 180; then
        backend_state="FAILED - see $backend_log"
        echo "warning: backend did not answer /health within 180s." >&2
    fi

    echo "Starting frontend on http://localhost:$FRONTEND_PORT ..."
    (
        cd "$FRONTEND_DIR"
        run_web_bg
    ) >"$frontend_log" 2>&1 &
    web_pid=$!
    disown "$web_pid" 2>/dev/null || true

    local frontend_state="ready"
    if ! wait_for_url "http://localhost:$FRONTEND_PORT/" 180; then
        frontend_state="FAILED - see $frontend_log"
    fi

    show_banner "$(mode_label 'detached (background)')" "$backend_state" "$frontend_state" \
        "logs: $LOG_DIR   PIDs: api $api_pid, web $web_pid"

    echo "Stop with: ./scripts/dev.sh --stop"
    echo "Optional backend switches: create backend/.env.local with"
    echo "  ENABLE_DATA_COLLECTION=true"
    echo "  PHYSICSLAB_DEV_MODE=true"

    if [[ $OPEN_BROWSER -eq 1 && "$frontend_state" == "ready" ]]; then
        open_browser "http://localhost:$FRONTEND_PORT/"
    fi
}

if [[ $DETACH -eq 1 ]]; then
    start_detached
else
    start_foreground
fi
