#!/bin/bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DMG_PATH="$SCRIPT_DIR/Codex.dmg"
METADATA_PATH="$SCRIPT_DIR/Codex.dmg.remote"
DMG_URL="https://persistent.oaistatic.com/codex-app-prod/Codex.dmg"
WORK_DIR="$(mktemp -d)"
HEADERS_PATH="$WORK_DIR/codex-dmg.headers"

cleanup() {
    rm -rf "$WORK_DIR"
}
trap cleanup EXIT

usage() {
    cat >&2 <<EOF
Usage: $0

Check whether the upstream Codex.dmg differs from the cached local copy.
This script is informational and never refreshes the cached DMG.

Exit codes:
  0  upstream changed
  20 upstream unchanged
  30 remote metadata unavailable
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
    usage
    exit 0
fi

if [ $# -ne 0 ]; then
    usage
    exit 1
fi

if [ ! -s "$DMG_PATH" ] || [ ! -f "$METADATA_PATH" ]; then
    echo "status=changed"
    echo "reason=missing-local-cache"
    exit 0
fi

if ! curl -fsSLI --connect-timeout 30 --max-time 60 -o "$HEADERS_PATH" "$DMG_URL"; then
    echo "status=unknown"
    echo "reason=remote-metadata-unavailable"
    exit 30
fi

remote_etag="$(awk -F': ' 'tolower($1)=="etag" {gsub(/\r/,"",$2); print $2}' "$HEADERS_PATH" | tail -n1)"
remote_last_modified="$(awk -F': ' 'tolower($1)=="last-modified" {gsub(/\r/,"",$2); print $2}' "$HEADERS_PATH" | tail -n1)"
remote_length="$(awk -F': ' 'tolower($1)=="content-length" {gsub(/\r/,"",$2); print $2}' "$HEADERS_PATH" | tail -n1)"

# shellcheck disable=SC1090
source "$METADATA_PATH"

local_size="$(stat -c %s "$DMG_PATH" 2>/dev/null || echo "")"

if [ -n "$remote_length" ] && [ "$local_size" != "$remote_length" ]; then
    echo "status=changed"
    echo "reason=content-length"
    exit 0
fi

if [ -n "$remote_etag" ] && [ "${DMG_REMOTE_ETAG:-}" != "$remote_etag" ]; then
    echo "status=changed"
    echo "reason=etag"
    exit 0
fi

if [ -n "$remote_last_modified" ] && [ "${DMG_REMOTE_LAST_MODIFIED:-}" != "$remote_last_modified" ]; then
    echo "status=changed"
    echo "reason=last-modified"
    exit 0
fi

echo "status=unchanged"
echo "reason=metadata-match"
exit 20
