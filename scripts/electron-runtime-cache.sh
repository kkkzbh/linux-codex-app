#!/bin/bash

electron_runtime_arch() {
    case "$1" in
        x86_64)  echo "x64" ;;
        aarch64) echo "arm64" ;;
        armv7l)  echo "armv7l" ;;
        *)       echo "Unsupported architecture: $1" >&2; return 1 ;;
    esac
}

electron_runtime_zip_name() {
    local version="$1"
    local electron_arch="$2"
    echo "electron-v${version}-linux-${electron_arch}.zip"
}

electron_runtime_cache_dir() {
    if [ -n "${CODEX_ELECTRON_CACHE_DIR:-}" ]; then
        echo "$CODEX_ELECTRON_CACHE_DIR"
        return
    fi
    echo "${XDG_CACHE_HOME:-$HOME/.cache}/codex-app/electron"
}

electron_runtime_url() {
    local version="$1"
    local electron_arch="$2"
    echo "https://github.com/electron/electron/releases/download/v${version}/$(electron_runtime_zip_name "$version" "$electron_arch")"
}

electron_runtime_zip_is_valid() {
    local path="$1"
    [ -s "$path" ] && unzip -tq "$path" >/dev/null 2>&1
}

ensure_electron_runtime_zip() {
    local version="$1"
    local host_arch="$2"
    local work_dir="$3"
    local electron_arch
    local cache_dir
    local zip_name
    local cache_path
    local download_path
    local url

    electron_arch="$(electron_runtime_arch "$host_arch")"
    cache_dir="$(electron_runtime_cache_dir)"
    zip_name="$(electron_runtime_zip_name "$version" "$electron_arch")"
    cache_path="$cache_dir/$zip_name"

    if electron_runtime_zip_is_valid "$cache_path"; then
        echo "$cache_path"
        return
    fi

    if [ -e "$cache_path" ]; then
        rm -f "$cache_path"
    fi

    mkdir -p "$cache_dir" "$work_dir"
    download_path="$work_dir/${zip_name}.download"
    url="$(electron_runtime_url "$version" "$electron_arch")"
    rm -f "$download_path"

    curl -fL \
        --retry 4 \
        --retry-all-errors \
        --retry-delay 2 \
        --connect-timeout 30 \
        --max-time 900 \
        --progress-bar \
        -o "$download_path" \
        "$url"

    if ! electron_runtime_zip_is_valid "$download_path"; then
        rm -f "$download_path"
        echo "Downloaded Electron runtime zip is invalid: $url" >&2
        return 1
    fi

    mv -f "$download_path" "$cache_path"
    echo "$cache_path"
}
