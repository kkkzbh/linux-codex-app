#!/bin/bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=scripts/electron-runtime-cache.sh
source "$SCRIPT_DIR/electron-runtime-cache.sh"

fail() {
    echo "test-electron-runtime-cache: $*" >&2
    exit 1
}

make_zip() {
    local path="$1"
    python3 - "$path" <<'PY'
import sys
import zipfile

with zipfile.ZipFile(sys.argv[1], "w") as archive:
    archive.writestr("electron", "runtime")
PY
}

with_temp_dir() {
    local temp_dir
    temp_dir="$(mktemp -d)"
    "$@" "$temp_dir"
    rm -rf "$temp_dir"
}

write_fake_curl() {
    local bin_dir="$1"
    local source_zip="$2"
    cat >"$bin_dir/curl" <<'EOF'
#!/bin/bash
set -Eeuo pipefail
: "${FAKE_CURL_SOURCE:?}"
: "${FAKE_CURL_MARKER:?}"
output=""
while [ $# -gt 0 ]; do
    case "$1" in
        -o)
            output="$2"
            shift 2
            ;;
        *)
            shift
            ;;
    esac
done
[ -n "$output" ] || exit 64
printf 'called\n' >"$FAKE_CURL_MARKER"
cp "$FAKE_CURL_SOURCE" "$output"
EOF
    chmod +x "$bin_dir/curl"
    export FAKE_CURL_SOURCE="$source_zip"
}

test_reuses_valid_cache_without_downloading() {
    local temp_dir="$1"
    local cache_dir="$temp_dir/cache"
    local work_dir="$temp_dir/work"
    local bin_dir="$temp_dir/bin"
    local cached_zip="$cache_dir/electron-v42.1.0-linux-x64.zip"
    mkdir -p "$cache_dir" "$work_dir" "$bin_dir"
    make_zip "$cached_zip"
    cat >"$bin_dir/curl" <<'EOF'
#!/bin/sh
exit 99
EOF
    chmod +x "$bin_dir/curl"

    local result
    result="$(CODEX_ELECTRON_CACHE_DIR="$cache_dir" PATH="$bin_dir:$PATH" ensure_electron_runtime_zip "42.1.0" "x86_64" "$work_dir")"

    [ "$result" = "$cached_zip" ] || fail "expected cached zip path, got $result"
}

test_downloads_missing_cache_atomically() {
    local temp_dir="$1"
    local cache_dir="$temp_dir/cache"
    local work_dir="$temp_dir/work"
    local bin_dir="$temp_dir/bin"
    local source_zip="$temp_dir/source.zip"
    local marker="$temp_dir/curl-called"
    local cached_zip="$cache_dir/electron-v42.1.0-linux-x64.zip"
    mkdir -p "$cache_dir" "$work_dir" "$bin_dir"
    make_zip "$source_zip"
    write_fake_curl "$bin_dir" "$source_zip"

    local result
    result="$(CODEX_ELECTRON_CACHE_DIR="$cache_dir" FAKE_CURL_MARKER="$marker" PATH="$bin_dir:$PATH" ensure_electron_runtime_zip "42.1.0" "x86_64" "$work_dir")"

    [ "$result" = "$cached_zip" ] || fail "expected committed cache path, got $result"
    [ -f "$marker" ] || fail "expected curl to run"
    unzip -tq "$cached_zip" >/dev/null || fail "cached zip is invalid"
    [ ! -e "$work_dir/electron-v42.1.0-linux-x64.zip.download" ] || fail "download temp file was not removed"
}

test_replaces_invalid_cache() {
    local temp_dir="$1"
    local cache_dir="$temp_dir/cache"
    local work_dir="$temp_dir/work"
    local bin_dir="$temp_dir/bin"
    local source_zip="$temp_dir/source.zip"
    local marker="$temp_dir/curl-called"
    local cached_zip="$cache_dir/electron-v42.1.0-linux-x64.zip"
    mkdir -p "$cache_dir" "$work_dir" "$bin_dir"
    printf 'not a zip' >"$cached_zip"
    make_zip "$source_zip"
    write_fake_curl "$bin_dir" "$source_zip"

    local result
    result="$(CODEX_ELECTRON_CACHE_DIR="$cache_dir" FAKE_CURL_MARKER="$marker" PATH="$bin_dir:$PATH" ensure_electron_runtime_zip "42.1.0" "x86_64" "$work_dir")"

    [ "$result" = "$cached_zip" ] || fail "expected committed cache path after replacement, got $result"
    [ -f "$marker" ] || fail "expected curl to replace invalid cache"
    unzip -tq "$cached_zip" >/dev/null || fail "replacement cache is invalid"
}

with_temp_dir test_reuses_valid_cache_without_downloading
with_temp_dir test_downloads_missing_cache_atomically
with_temp_dir test_replaces_invalid_cache
echo "Electron runtime cache tests passed"
