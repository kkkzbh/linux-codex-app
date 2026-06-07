#!/bin/bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALLER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$INSTALLER_DIR/.." && pwd)"
INSTALL_SCRIPT="$INSTALLER_DIR/install.sh"
VERIFY_SCRIPT="$SCRIPT_DIR/verify-install.sh"
ACTIVATE_SCRIPT="$SCRIPT_DIR/activate-install.sh"
STAGING_ROOT="$REPO_ROOT/staged-installs"
STATE_HOME="${XDG_STATE_HOME:-$HOME/.local/state}"
LOG_DIR="${CODEX_APP_LOG_DIR:-$STATE_HOME/codex-app}"
RUN_ID="$(date +%Y%m%d-%H%M%S)"
LOG_PATH="$LOG_DIR/silent-update-$RUN_ID.log"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*" >&2; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*" >&2; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

usage() {
    cat >&2 <<EOF
Usage: $0 [--no-activate] [--refresh-dmg]

Run the installer against a fresh staging directory, verify the resulting
install, and activate it unless --no-activate is provided.

Existing cached Codex.dmg files are reused by default. Use --refresh-dmg only
when the user explicitly requests an upstream DMG refresh.
EOF
}

on_error() {
    local exit_code=$?
    echo -e "${RED}[ERROR]${NC} Silent update failed (exit ${exit_code}). Log: $LOG_PATH" >&2
    exit "$exit_code"
}

trap on_error ERR

AUTO_ACTIVATE=1
INSTALL_ARGS=()

while [ $# -gt 0 ]; do
    case "$1" in
        --no-activate)
            AUTO_ACTIVATE=0
            shift
            ;;
        --refresh-dmg)
            INSTALL_ARGS+=("--refresh-dmg")
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            usage
            error "Unknown argument: $1"
            ;;
    esac
done

mkdir -p "$STAGING_ROOT" "$LOG_DIR"

BEFORE_SNAPSHOT="$(mktemp)"
AFTER_SNAPSHOT="$(mktemp)"
cleanup() {
    rm -f "$BEFORE_SNAPSHOT" "$AFTER_SNAPSHOT"
}
trap cleanup EXIT

find "$STAGING_ROOT" -mindepth 1 -maxdepth 1 -type d -name 'codex-app-*' -printf '%f\n' | sort > "$BEFORE_SNAPSHOT"

info "Running installer; log: $LOG_PATH"
"$INSTALL_SCRIPT" "${INSTALL_ARGS[@]}" 2>&1 | tee "$LOG_PATH"

find "$STAGING_ROOT" -mindepth 1 -maxdepth 1 -type d -name 'codex-app-*' -printf '%f\n' | sort > "$AFTER_SNAPSHOT"

NEW_INSTALL_NAME="$(sed -n 's/^[[:space:]]*Run:[[:space:]]*\(.*\)\/start\.sh[[:space:]]*$/\1/p' "$LOG_PATH" | tail -n 1)"
if [ -z "$NEW_INSTALL_NAME" ]; then
    NEW_INSTALL_NAME="$(comm -13 "$BEFORE_SNAPSHOT" "$AFTER_SNAPSHOT" | tail -n 1)"
    if [ -n "$NEW_INSTALL_NAME" ]; then
        NEW_INSTALL_NAME="$STAGING_ROOT/$NEW_INSTALL_NAME"
    fi
fi
if [ -z "$NEW_INSTALL_NAME" ]; then
    NEW_INSTALL_NAME="$(find "$STAGING_ROOT" -mindepth 1 -maxdepth 1 -type d -name 'codex-app-*' -printf '%T@ %p\n' | sort -n | tail -n 1 | cut -d' ' -f2-)"
fi

[ -n "$NEW_INSTALL_NAME" ] || error "Failed to locate the new staged install under: $STAGING_ROOT"
NEW_INSTALL_DIR="$(realpath "$NEW_INSTALL_NAME")"

info "Verifying staged install: $NEW_INSTALL_DIR"
"$VERIFY_SCRIPT" "$NEW_INSTALL_DIR"

if [ "$AUTO_ACTIVATE" -eq 1 ]; then
    info "Activating staged install"
    "$ACTIVATE_SCRIPT" "$NEW_INSTALL_DIR"
    warn "Any Codex instance already running keeps its current binaries. The activated build is used on the next launch."
else
    info "Skipping activation; staged install ready at: $NEW_INSTALL_DIR"
fi

info "Silent update completed successfully"
echo "install_dir=$NEW_INSTALL_DIR"
echo "log_path=$LOG_PATH"
