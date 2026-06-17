#!/bin/bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALLER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$INSTALLER_DIR/.." && pwd)"
DEFAULT_STAGING_ROOT="$REPO_ROOT/staged-installs"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
DEFAULT_ACTIVE_LINK="${CODEX_APP_ACTIVE_LINK:-$DATA_HOME/codex-app/current}"
VERIFIED_MARKER=".codex-linux-verified"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*" >&2; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*" >&2; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

usage() {
    cat >&2 <<EOF
Usage: $0 [--dry-run] [--staging-root DIR] [--active-link LINK] [--pin DIR] [--keep N]

Prune old Codex Linux staged installs while preserving the active install,
explicitly pinned installs, and installs whose Codex binary is still running.

Defaults:
  --staging-root $DEFAULT_STAGING_ROOT
  --active-link  $DEFAULT_ACTIVE_LINK
  --keep         ${CODEX_STAGED_INSTALLS_KEEP:-3}

Set CODEX_STAGED_INSTALLS_PRUNE=0 to disable pruning.
EOF
}

DRY_RUN=0
STAGING_ROOT="$DEFAULT_STAGING_ROOT"
ACTIVE_LINK="$DEFAULT_ACTIVE_LINK"
KEEP="${CODEX_STAGED_INSTALLS_KEEP:-3}"
PINS=()

while [ $# -gt 0 ]; do
    case "$1" in
        --dry-run)
            DRY_RUN=1
            shift
            ;;
        --staging-root)
            [ $# -ge 2 ] || error "--staging-root requires a directory"
            STAGING_ROOT="$2"
            shift 2
            ;;
        --active-link)
            [ $# -ge 2 ] || error "--active-link requires a path"
            ACTIVE_LINK="$2"
            shift 2
            ;;
        --pin)
            [ $# -ge 2 ] || error "--pin requires a directory"
            PINS+=("$2")
            shift 2
            ;;
        --keep)
            [ $# -ge 2 ] || error "--keep requires a number"
            KEEP="$2"
            shift 2
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

if [ "${CODEX_STAGED_INSTALLS_PRUNE:-1}" = "0" ]; then
    info "Staged install pruning disabled by CODEX_STAGED_INSTALLS_PRUNE=0"
    exit 0
fi

case "$KEEP" in
    ''|*[!0-9]*)
        error "--keep must be a positive integer: $KEEP"
        ;;
esac

if [ "$KEEP" -lt 1 ]; then
    error "--keep must be at least 1"
fi
if [ "$KEEP" -gt 3 ]; then
    error "--keep above 3 is not allowed; set CODEX_STAGED_INSTALLS_PRUNE=0 to disable pruning instead"
fi

if [ ! -d "$STAGING_ROOT" ]; then
    info "No staged install root found: $STAGING_ROOT"
    exit 0
fi

require_cmd() {
    command -v "$1" >/dev/null 2>&1 || error "Missing required command: $1"
}

require_cmd realpath
require_cmd stat
require_cmd find
require_cmd sort

STAGING_ROOT="$(realpath "$STAGING_ROOT")"

declare -A KEEP_PATHS=()
declare -A KEEP_REASONS=()
DIRS=()
KEEP_COUNT=0

is_direct_staged_install() {
    local path="$1"
    local base parent
    base="$(basename "$path")"
    parent="$(dirname "$path")"
    [ "$parent" = "$STAGING_ROOT" ] || return 1
    case "$base" in
        codex-app-*) return 0 ;;
        *) return 1 ;;
    esac
}

mark_keep() {
    local path="$1"
    local reason="$2"

    if [ -z "${KEEP_PATHS[$path]+x}" ]; then
        KEEP_PATHS["$path"]=1
        KEEP_REASONS["$path"]="$reason"
        KEEP_COUNT=$((KEEP_COUNT + 1))
    else
        KEEP_REASONS["$path"]="${KEEP_REASONS[$path]},$reason"
    fi
}

pin_install_path() {
    local raw_path="$1"
    local reason="$2"
    local resolved=""

    [ -n "$raw_path" ] || return 0
    resolved="$(realpath "$raw_path" 2>/dev/null || true)"
    [ -n "$resolved" ] || return 0

    if ! is_direct_staged_install "$resolved"; then
        warn "Ignoring $reason pin outside staged installs: $resolved"
        return 0
    fi
    [ -d "$resolved" ] || return 0
    mark_keep "$resolved" "$reason"
}

is_kept() {
    local path="$1"
    [ -n "${KEEP_PATHS[$path]+x}" ]
}

is_complete_install() {
    local path="$1"
    [ -x "$path/start.sh" ] || return 1
    [ -x "$path/Codex" ] || return 1
    [ -f "$path/resources/app.asar" ] || return 1
}

is_verified_install() {
    local path="$1"
    [ -f "$path/$VERIFIED_MARKER" ] || return 1
    is_complete_install "$path"
}

mtime_seconds() {
    stat -c %Y "$1"
}

collect_dirs() {
    local dir resolved
    while IFS= read -r dir; do
        resolved="$(realpath "$dir")"
        if ! is_direct_staged_install "$resolved"; then
            warn "Skipping unexpected staged install path outside root: $resolved"
            continue
        fi
        DIRS+=("$resolved")
    done < <(find "$STAGING_ROOT" -mindepth 1 -maxdepth 1 -type d -name 'codex-app-*' -print | sort)
}

pin_running_installs() {
    command -v ps >/dev/null 2>&1 || return 0

    local args exe_path install_dir
    while IFS= read -r args; do
        [ -n "${args:-}" ] || continue
        exe_path="${args%% *}"
        case "$exe_path" in
            "$STAGING_ROOT"/codex-app-*/Codex)
                install_dir="${exe_path%/Codex}"
                pin_install_path "$install_dir" "running"
                ;;
        esac
    done < <(ps -eo args=)
}

select_candidates() {
    local kind="$1"
    local tmp
    tmp="$(mktemp)"

    local dir
    for dir in "${DIRS[@]}"; do
        is_kept "$dir" && continue
        case "$kind" in
            verified)
                is_verified_install "$dir" || continue
                ;;
            legacy)
                [ -f "$dir/$VERIFIED_MARKER" ] && continue
                is_complete_install "$dir" || continue
                ;;
            *)
                rm -f "$tmp"
                error "Unknown candidate kind: $kind"
                ;;
        esac
        printf '%s\t%s\n' "$(mtime_seconds "$dir")" "$dir" >> "$tmp"
    done

    while IFS=$'\t' read -r _ dir; do
        [ -n "${dir:-}" ] || continue
        [ "$KEEP_COUNT" -lt "$KEEP" ] || break
        mark_keep "$dir" "$kind"
    done < <(sort -rn "$tmp")

    rm -f "$tmp"
}

prune_unkept_dirs() {
    local removed=0
    local kept=0
    local dir

    for dir in "${DIRS[@]}"; do
        if is_kept "$dir"; then
            kept=$((kept + 1))
            info "Keeping staged install: $dir (${KEEP_REASONS[$dir]})"
            continue
        fi

        if [ "$DRY_RUN" -eq 1 ]; then
            info "Would remove staged install: $dir"
        else
            info "Removing staged install: $dir"
            rm -rf -- "$dir"
        fi
        removed=$((removed + 1))
    done

    if [ "$KEEP_COUNT" -gt "$KEEP" ]; then
        warn "Pinned or running staged installs require keeping $KEEP_COUNT directories, above requested keep=$KEEP"
    fi

    if [ "$DRY_RUN" -eq 1 ]; then
        info "Dry-run staged install prune complete: keep=$kept remove=$removed root=$STAGING_ROOT"
    else
        info "Staged install prune complete: keep=$kept removed=$removed root=$STAGING_ROOT"
    fi
}

collect_dirs

if [ -e "$ACTIVE_LINK" ] || [ -L "$ACTIVE_LINK" ]; then
    pin_install_path "$ACTIVE_LINK" "active"
fi

for pin in "${PINS[@]}"; do
    pin_install_path "$pin" "pin"
done

pin_running_installs

select_candidates verified
select_candidates legacy
prune_unkept_dirs
