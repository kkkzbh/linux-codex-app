#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_ROOT="${1:-${LINUX_CODEX_APP_REPO:-$HOME/code/linux-codex-app}}"
MANIFEST_PATH="${2:-}"

info() { printf '[INFO] %s\n' "$*" >&2; }
error() { printf '[ERROR] %s\n' "$*" >&2; exit 1; }

require_cmd() {
    command -v "$1" >/dev/null 2>&1 || error "Missing required command: $1"
}

require_cmd npm
require_cmd gh

if [ -z "${RPM_SIGNING_KEY_ID:-}" ] && command -v gpg >/dev/null 2>&1; then
    discovered_key="$(
        gpg --list-secret-keys --with-colons "linux-codex-app RPM signing key" 2>/dev/null \
            | awk -F: '$1 == "fpr" { print $10; exit }'
    )"
    if [ -n "$discovered_key" ]; then
        export RPM_SIGNING_KEY_ID="$discovered_key"
        info "Using discovered linux-codex-app RPM signing key: $RPM_SIGNING_KEY_ID"
    fi
fi

info "Syncing linux-codex-app from current installer state"
"$SCRIPT_DIR/sync-linux-codex-app.sh" "$TARGET_ROOT"

[ -f "$TARGET_ROOT/package.json" ] || error "Missing linux-codex-app package.json: $TARGET_ROOT"
[ -x "$TARGET_ROOT/scripts/release-local.sh" ] || error "Missing executable local release script: $TARGET_ROOT/scripts/release-local.sh"

info "Running linux-codex-app local release"
if [ -n "$MANIFEST_PATH" ]; then
    (cd "$TARGET_ROOT" && npm run release:local -- "$MANIFEST_PATH")
else
    (cd "$TARGET_ROOT" && npm run release:local)
fi

info "linux-codex-app sync and release complete"
