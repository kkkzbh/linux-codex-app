#!/bin/bash
set -Eeuo pipefail

CODEX_HOME_DIR="${CODEX_HOME:-$HOME/.codex}"
STANDALONE_CURRENT="${CODEX_STANDALONE_CURRENT:-$CODEX_HOME_DIR/packages/standalone/current}"
STANDALONE_CODEX="$STANDALONE_CURRENT/codex"
RELEASE="${CODEX_CLI_RELEASE:-latest}"
OFFICIAL_INSTALL_URL="${CODEX_CLI_INSTALL_URL:-https://chatgpt.com/codex/install.sh}"

usage() {
    cat >&2 <<EOF
Usage: $0

Check whether the official standalone Codex CLI managed install is present and
matches the requested GitHub release.

Exit codes:
  0  install or update needed
  20 local standalone CLI already matches requested release
  30 release metadata unavailable
EOF
}

normalize_version() {
    case "$1" in
        "" | latest)
            printf 'latest\n'
            ;;
        rust-v*)
            printf '%s\n' "${1#rust-v}"
            ;;
        v*)
            printf '%s\n' "${1#v}"
            ;;
        *)
            printf '%s\n' "$1"
            ;;
    esac
}

download_text() {
    local url="$1"

    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "$url"
        return
    fi

    if command -v wget >/dev/null 2>&1; then
        wget -q -O - "$url"
        return
    fi

    return 1
}

resolve_latest_version() {
    local normalized
    normalized="$(normalize_version "$RELEASE")"

    if [ "$normalized" != "latest" ]; then
        printf '%s\n' "$normalized"
        return
    fi

    command -v curl >/dev/null 2>&1 || return 1

    local headers resolved
    headers="$(curl -fsSLI "$OFFICIAL_INSTALL_URL" 2>/dev/null || true)"
    resolved="$(printf '%s\n' "$headers" | tr -d '\r' | sed -n 's#^[Ll]ocation: .*/releases/download/rust-v\([^/[:space:]]*\)/.*#\1#p' | tail -n 1)"

    [ -n "$resolved" ] || return 1
    printf '%s\n' "$resolved"
}

get_local_version() {
    [ -x "$STANDALONE_CODEX" ] || return 1
    "$STANDALONE_CODEX" --version 2>/dev/null | awk 'NF { print $NF }' | tail -n1
}

if [ $# -ne 0 ]; then
    usage
    exit 1
fi

latest_version="$(resolve_latest_version || true)"
local_version="$(get_local_version || true)"

if [ -z "$latest_version" ]; then
    echo "status=unknown"
    echo "reason=release-metadata-unavailable"
    echo "standalone_path=$STANDALONE_CODEX"
    if [ -n "$local_version" ]; then
        echo "local_version=$local_version"
    fi
    exit 30
fi

echo "standalone_path=$STANDALONE_CODEX"

if [ -z "$local_version" ]; then
    echo "status=changed"
    echo "reason=missing-standalone-cli"
    echo "latest_version=$latest_version"
    exit 0
fi

echo "local_version=$local_version"
echo "latest_version=$latest_version"

if [ "$local_version" != "$latest_version" ]; then
    echo "status=changed"
    echo "reason=version-mismatch"
    exit 0
fi

echo "status=unchanged"
echo "reason=version-match"
exit 20
