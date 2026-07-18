#!/bin/bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHECK_SCRIPT="$SCRIPT_DIR/check-codex-cli-update.sh"
GITHUB_AUTHENTICATED_CURL_SCRIPT="$SCRIPT_DIR/github-authenticated-curl.sh"
OFFICIAL_INSTALL_URL="${CODEX_CLI_INSTALL_URL:-https://chatgpt.com/codex/install.sh}"
CODEX_HOME_DIR="${CODEX_HOME:-$HOME/.codex}"
STANDALONE_CURRENT="${CODEX_STANDALONE_CURRENT:-$CODEX_HOME_DIR/packages/standalone/current}"
STANDALONE_CODEX="$STANDALONE_CURRENT/codex"
VISIBLE_CODEX="${CODEX_VISIBLE_BIN:-$HOME/.local/bin/codex}"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*" >&2; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*" >&2; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

usage() {
    cat >&2 <<EOF
Usage: $0

Ensure the official standalone Codex CLI managed install exists under
\${CODEX_HOME:-~/.codex}/packages/standalone/current. This is the install type
used by Linux Desktop for its own stdio app-server runtime.
EOF
}

extract_field() {
    local key="$1"
    local text="$2"
    printf '%s\n' "$text" | awk -F= -v key="$key" '$1 == key { print substr($0, length(key) + 2) }' | tail -n1
}

download_file() {
    local url="$1"
    local output="$2"

    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "$url" -o "$output"
        return
    fi

    if command -v wget >/dev/null 2>&1; then
        wget -q -O "$output" "$url"
        return
    fi

    error "curl or wget is required to install the standalone Codex CLI"
}

install_standalone_cli() {
    local tmp_dir install_script authenticated_bin real_curl
    tmp_dir="$(mktemp -d)"
    install_script="$tmp_dir/codex-install.sh"
    authenticated_bin="$tmp_dir/authenticated-bin"

    info "Installing official standalone Codex CLI"
    download_file "$OFFICIAL_INSTALL_URL" "$install_script"
    sed -i '/^handle_conflicting_install$/d;/^maybe_launch_codex_now$/d' "$install_script"

    [ -x "$GITHUB_AUTHENTICATED_CURL_SCRIPT" ] || error \
        "Missing authenticated GitHub transport: $GITHUB_AUTHENTICATED_CURL_SCRIPT"
    real_curl="$(command -v curl)"
    mkdir -p "$authenticated_bin"
    ln -s "$GITHUB_AUTHENTICATED_CURL_SCRIPT" "$authenticated_bin/curl"

    local args=()
    if [ -n "${CODEX_CLI_RELEASE:-}" ]; then
        args+=(--release "$CODEX_CLI_RELEASE")
    fi

    # The official installer uses CODEX_INSTALL_DIR as its bin directory, while
    # this Linux desktop installer uses CODEX_INSTALL_DIR as the staged app
    # destination. Unset it here so the standalone CLI always lands in the
    # official managed layout and visible bin path.
    env -u CODEX_INSTALL_DIR \
        CODEX_REAL_CURL="$real_curl" \
        PATH="$authenticated_bin:$PATH" \
        sh "$install_script" "${args[@]}"
    rm -rf "$tmp_dir"
}

verify_standalone_cli() {
    [ -x "$STANDALONE_CODEX" ] || error "Standalone Codex CLI is missing: $STANDALONE_CODEX"

    local actual
    actual="$("$STANDALONE_CODEX" --version 2>/dev/null | awk 'NF { print $NF }' | tail -n1)"
    [ -n "$actual" ] || error "Failed to read standalone Codex CLI version"

    if [ -e "$VISIBLE_CODEX" ] || [ -L "$VISIBLE_CODEX" ]; then
        local visible_real standalone_real
        visible_real="$(readlink -f "$VISIBLE_CODEX" 2>/dev/null || true)"
        standalone_real="$(readlink -f "$STANDALONE_CODEX")"
        if [ "$visible_real" != "$standalone_real" ]; then
            warn "Visible codex command does not point at standalone install: $VISIBLE_CODEX -> ${visible_real:-unknown}"
        fi
    fi

    info "Standalone Codex CLI is ready at $actual"
}

if [ $# -ne 0 ]; then
    usage
    exit 1
fi

check_output=""
check_exit=0
if check_output="$("$CHECK_SCRIPT")"; then
    check_exit=0
else
    check_exit=$?
fi

local_version="$(extract_field "local_version" "$check_output")"
latest_version="$(extract_field "latest_version" "$check_output")"
reason="$(extract_field "reason" "$check_output")"

case "$check_exit" in
    20)
        info "Standalone Codex CLI already current (${local_version:-unknown})"
        verify_standalone_cli
        exit 0
        ;;
    30)
        if [ -x "$STANDALONE_CODEX" ]; then
            warn "Could not reach Codex release metadata; keeping standalone CLI (${local_version:-unknown})"
            verify_standalone_cli
            exit 0
        fi
        error "Standalone Codex CLI is missing and release metadata is unavailable"
        ;;
    0)
        case "$reason" in
            missing-standalone-cli)
                info "Standalone Codex CLI not found; installing ${latest_version:-latest}"
                ;;
            version-mismatch)
                info "Updating standalone Codex CLI from ${local_version:-unknown} to ${latest_version:-latest}"
                ;;
            *)
                info "Refreshing standalone Codex CLI"
                ;;
        esac
        install_standalone_cli
        verify_standalone_cli
        exit 0
        ;;
    *)
        printf '%s\n' "$check_output" >&2
        error "Unexpected exit code from check-codex-cli-update.sh: $check_exit"
        ;;
esac
