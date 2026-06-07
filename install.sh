#!/bin/bash
set -Eeuo pipefail

# ============================================================================
# Codex Desktop for Linux — Installer
# Converts the official macOS Codex Desktop app to run on Linux
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=scripts/dmg-cache.sh
source "$SCRIPT_DIR/scripts/dmg-cache.sh"
# shellcheck source=scripts/electron-runtime-cache.sh
source "$SCRIPT_DIR/scripts/electron-runtime-cache.sh"
DEFAULT_INSTALL_ROOT="$REPO_ROOT/staged-installs"
INSTALL_DIR=""
ELECTRON_VERSION="42.1.0"
WORK_DIR="$(mktemp -d)"
ARCH="$(uname -m)"
DMG_URL="https://persistent.oaistatic.com/codex-app-prod/Codex.dmg"
ACTIVATE_SCRIPT="$SCRIPT_DIR/scripts/activate-install.sh"
ENSURE_CODEX_CLI_SCRIPT="$SCRIPT_DIR/scripts/ensure-codex-cli.sh"
PATCH_NATIVE_MODULE_SOURCES_SCRIPT="$SCRIPT_DIR/scripts/patch-native-module-sources.mjs"
WRITE_LINUX_PATCH_STATE_SCRIPT="$SCRIPT_DIR/scripts/write-linux-patch-state.mjs"
APP_ICON_SOURCE="$SCRIPT_DIR/assets/codex-app-icon.png"
SEVENZIP_BIN="${CODEX_SEVENZIP:-7z}"
LINUX_BUNDLED_PLUGIN_NAMES=("browser" "chrome" "latex")
LINUX_LOCAL_PLUGIN_NAMES=("dolphin" "kitty" "kde-computer-use=computer-use")
LINUX_LOCAL_PLUGIN_SOURCE_ROOT="$SCRIPT_DIR/plugins"
LINUX_NODE_REPL_SOURCE="$SCRIPT_DIR/scripts/linux-node-repl.mjs"
LINUX_BROWSER_RUNTIME_DIR="$SCRIPT_DIR/scripts/linux-browser-runtime"
LINUX_CHROME_EXTENSION_HOST_SOURCE="$LINUX_BROWSER_RUNTIME_DIR/chrome-extension-host.mjs"
REFRESH_DMG=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*" >&2; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*" >&2; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

configure_local_plugins() {
    if [ "${CODEX_LOCAL_PLUGIN_NAMES+x}" = "x" ]; then
        local requested="${CODEX_LOCAL_PLUGIN_NAMES//,/ }"
        LINUX_LOCAL_PLUGIN_NAMES=()
        if [ -n "$requested" ]; then
            # shellcheck disable=SC2206
            LINUX_LOCAL_PLUGIN_NAMES=($requested)
        fi
    fi
}

usage() {
    cat >&2 <<EOF
Usage: $0 [--refresh-dmg|--no-refresh-dmg] [/path/to/Codex.dmg]

By default, an existing cached Codex.dmg is reused without checking or
refreshing the upstream DMG. Use --refresh-dmg only when the user explicitly
wants to refresh the cached upstream DMG.
EOF
}

cleanup() {
    rm -rf "$WORK_DIR"
}
trap cleanup EXIT
trap 'error "Failed at line $LINENO (exit code $?)"' ERR

unique_staging_dir() {
    local base="$DEFAULT_INSTALL_ROOT/codex-app-$(date +%Y%m%d-%H%M%S)"
    local candidate="$base"
    local suffix=1

    while [ -e "$candidate" ]; do
        candidate="${base}-${suffix}"
        suffix=$((suffix + 1))
    done

    echo "$candidate"
}

resolve_install_dir() {
    if [ -n "${CODEX_INSTALL_DIR:-}" ]; then
        INSTALL_DIR="$CODEX_INSTALL_DIR"
        info "Using explicit install directory: $INSTALL_DIR"
        return
    fi

    mkdir -p "$DEFAULT_INSTALL_ROOT"
    INSTALL_DIR="$(unique_staging_dir)"
    info "Using fresh staging install directory: $INSTALL_DIR"
    info "Activate later with: $ACTIVATE_SCRIPT $INSTALL_DIR"
}

# ---- Check dependencies ----
check_deps() {
    local missing=()
    for cmd in node npm npx python3 curl unzip; do
        command -v "$cmd" &>/dev/null || missing+=("$cmd")
    done
    if [ ${#missing[@]} -ne 0 ]; then
        error "Missing dependencies: ${missing[*]}
Install them first:
  sudo apt install nodejs npm python3 curl unzip build-essential  # Debian/Ubuntu
  sudo dnf install nodejs npm python3 curl unzip && sudo dnf groupinstall 'Development Tools'  # Fedora
  sudo pacman -S nodejs npm python curl unzip base-devel  # Arch
Set CODEX_SEVENZIP=/path/to/7zz when your system 7-Zip cannot extract APFS DMGs."
    fi

    [ -x "$SEVENZIP_BIN" ] || command -v "$SEVENZIP_BIN" &>/dev/null || error "Missing executable 7-Zip command: $SEVENZIP_BIN"

    NODE_MAJOR=$(node -v | cut -d. -f1 | tr -d v)
    if [ "$NODE_MAJOR" -lt 20 ]; then
        error "Node.js 20+ required (found $(node -v))"
    fi

    if ! command -v make &>/dev/null || ! command -v g++ &>/dev/null; then
        error "Build tools (make, g++) required:
  sudo apt install build-essential   # Debian/Ubuntu
  sudo dnf groupinstall 'Development Tools'  # Fedora
  sudo pacman -S base-devel          # Arch"
    fi

    info "All dependencies found"
}

# ---- Download or find Codex DMG ----
get_dmg() {
    local dmg_dest="$SCRIPT_DIR/Codex.dmg"
    local metadata_path="$SCRIPT_DIR/Codex.dmg.remote"
    local remote_headers="$WORK_DIR/codex-dmg.headers"
    local downloaded_dmg="$WORK_DIR/Codex.dmg.download"
    local remote_etag=""
    local remote_last_modified=""
    local remote_length=""
    local cached_etag=""
    local cached_last_modified=""
    local cached_length=""

    if [ -s "$dmg_dest" ] && [ "$REFRESH_DMG" != "1" ]; then
        info "Using cached DMG without upstream refresh: $dmg_dest ($(du -h "$dmg_dest" | cut -f1))"
        info "Use --refresh-dmg only when the user explicitly requests a DMG refresh"
        echo "$dmg_dest"
        return
    fi

    if [ -s "$dmg_dest" ]; then
        info "Explicit DMG refresh requested; checking remote metadata"
    fi

    if curl -fsSLI --connect-timeout 30 --max-time 60 -o "$remote_headers" "$DMG_URL"; then
        remote_etag="$(awk -F': ' 'tolower($1)=="etag" {gsub(/\r/,"",$2); print $2}' "$remote_headers" | tail -n1)"
        remote_last_modified="$(awk -F': ' 'tolower($1)=="last-modified" {gsub(/\r/,"",$2); print $2}' "$remote_headers" | tail -n1)"
        remote_length="$(awk -F': ' 'tolower($1)=="content-length" {gsub(/\r/,"",$2); print $2}' "$remote_headers" | tail -n1)"
    else
        warn "Could not check remote DMG metadata; falling back to local cache if present"
    fi

    if [ -f "$metadata_path" ]; then
        # shellcheck disable=SC1090
        source "$metadata_path"
        cached_etag="${DMG_REMOTE_ETAG:-}"
        cached_last_modified="${DMG_REMOTE_LAST_MODIFIED:-}"
        cached_length="${DMG_REMOTE_CONTENT_LENGTH:-}"
    fi

    if [ -s "$dmg_dest" ]; then
        local refresh_cached=0
        local local_size
        local_size="$(stat -c %s "$dmg_dest" 2>/dev/null || echo "")"

        if [ -n "$remote_length" ] && [ "$local_size" != "$remote_length" ]; then
            refresh_cached=1
        elif [ -n "$remote_etag" ] && [ "$cached_etag" != "$remote_etag" ]; then
            refresh_cached=1
        elif [ -n "$remote_last_modified" ] && [ "$cached_last_modified" != "$remote_last_modified" ]; then
            refresh_cached=1
        fi

        if [ "$refresh_cached" -eq 0 ]; then
            info "Using cached DMG: $dmg_dest ($(du -h "$dmg_dest" | cut -f1))"
            echo "$dmg_dest"
            return
        fi

        info "Remote DMG changed and explicit refresh is enabled; refreshing local cache"
    fi

    info "Downloading Codex Desktop DMG..."
    info "URL: $DMG_URL"

    if ! curl -L --progress-bar --max-time 600 --connect-timeout 30 \
            -o "$downloaded_dmg" "$DMG_URL"; then
        rm -f "$downloaded_dmg"
        error "Download failed. Download manually and place as: $dmg_dest"
    fi

    if [ ! -s "$downloaded_dmg" ]; then
        rm -f "$downloaded_dmg"
        error "Download produced empty file. Download manually and place as: $dmg_dest"
    fi

    commit_refreshed_dmg "$dmg_dest" "$metadata_path" "$downloaded_dmg" "$remote_etag" "$remote_last_modified" "$remote_length"

    info "Saved: $dmg_dest ($(du -h "$dmg_dest" | cut -f1))"
    if [ -s "$(dmg_previous_path "$dmg_dest")" ]; then
        info "Previous cached DMG retained: $(dmg_previous_path "$dmg_dest")"
    fi
    echo "$dmg_dest"
}

# ---- Extract app from DMG ----
extract_dmg() {
    local dmg_path="$1"
    info "Extracting DMG with 7z..."

    "$SEVENZIP_BIN" x -y "$dmg_path" -o"$WORK_DIR/dmg-extract" >&2 || \
        error "Failed to extract DMG"

    local app_dir
    app_dir=$(find "$WORK_DIR/dmg-extract" -maxdepth 3 -name "*.app" -type d | head -1)
    [ -n "$app_dir" ] || error "Could not find .app bundle in DMG"

    info "Found: $(basename "$app_dir")"
    echo "$app_dir"
}

# ---- Build native modules in a clean directory ----
build_native_modules() {
    local app_extracted="$1"

    # Read versions from extracted app
    local bs3_ver npty_ver
    bs3_ver=$(node -p "require('$app_extracted/node_modules/better-sqlite3/package.json').version" 2>/dev/null || echo "")
    npty_ver=$(node -p "require('$app_extracted/node_modules/node-pty/package.json').version" 2>/dev/null || echo "")

    [ -n "$bs3_ver" ] || error "Could not detect better-sqlite3 version"
    [ -n "$npty_ver" ] || error "Could not detect node-pty version"

    info "Native modules: better-sqlite3@$bs3_ver, node-pty@$npty_ver"

    # Build in a CLEAN directory (asar doesn't have full source)
    local build_dir="$WORK_DIR/native-build"
    mkdir -p "$build_dir"
    cd "$build_dir"

    echo '{"private":true}' > package.json

    info "Installing fresh sources from npm..."
    npm install "electron@$ELECTRON_VERSION" --save-dev --ignore-scripts 2>&1 >&2
    npm install "better-sqlite3@$bs3_ver" "node-pty@$npty_ver" --ignore-scripts 2>&1 >&2

    info "Patching native module sources for Electron v$ELECTRON_VERSION..."
    node "$PATCH_NATIVE_MODULE_SOURCES_SCRIPT" "$build_dir" 2>&1 >&2

    local electron_abi
    electron_abi="$(tr -d '[:space:]' < "$build_dir/node_modules/electron/abi_version" 2>/dev/null || echo "")"
    [ -n "$electron_abi" ] || error "Could not detect Electron ABI from node_modules/electron/abi_version"

    info "Compiling for Electron v$ELECTRON_VERSION (this takes ~1 min)..."
    npx --yes @electron/rebuild -v "$ELECTRON_VERSION" --force --force-abi "$electron_abi" --build-from-source 2>&1 >&2

    info "Native modules built successfully"

    # Copy compiled modules back into extracted app
    rm -rf "$app_extracted/node_modules/better-sqlite3"
    rm -rf "$app_extracted/node_modules/node-pty"
    cp -r "$build_dir/node_modules/better-sqlite3" "$app_extracted/node_modules/"
    cp -r "$build_dir/node_modules/node-pty" "$app_extracted/node_modules/"
}

# ---- Extract and patch app.asar ----
patch_asar() {
    local app_dir="$1"
    local resources_dir="$app_dir/Contents/Resources"

    [ -f "$resources_dir/app.asar" ] || error "app.asar not found in $resources_dir"

    info "Extracting app.asar..."
    cd "$WORK_DIR"
    npx --yes asar extract "$resources_dir/app.asar" app-extracted

    # Copy unpacked native modules if they exist
    if [ -d "$resources_dir/app.asar.unpacked" ]; then
        cp -r "$resources_dir/app.asar.unpacked/"* app-extracted/ 2>/dev/null || true
    fi

    # Remove macOS-only modules
    rm -rf "$WORK_DIR/app-extracted/node_modules/sparkle-darwin" 2>/dev/null || true
    find "$WORK_DIR/app-extracted" -name "sparkle.node" -delete 2>/dev/null || true

    # Build native modules in clean environment and copy back
    build_native_modules "$WORK_DIR/app-extracted"

    info "Applying Linux runtime patches..."
    node "$SCRIPT_DIR/scripts/patch-linux-runtime.mjs" "$WORK_DIR/app-extracted"

    # Repack
    info "Repacking app.asar..."
    cd "$WORK_DIR"
    npx asar pack app-extracted app.asar --unpack "{*.node,*.so,*.dylib}" 2>/dev/null

    info "app.asar patched"
}

# ---- Copy Linux-usable bundled plugin resources ----
copy_bundled_plugins() {
    local app_dir="$1"
    local resources_dir="$app_dir/Contents/Resources"
    local source_root="$resources_dir/plugins/openai-bundled"
    local source_marketplace="$source_root/.agents/plugins/marketplace.json"
    local dest_root="$WORK_DIR/plugins/openai-bundled"
    local dest_marketplace="$dest_root/.agents/plugins/marketplace.json"

    if [ ! -f "$source_marketplace" ]; then
        warn "Bundled plugin marketplace not found in upstream resources; Browser Use plugin will be unavailable"
        return
    fi

    mkdir -p "$dest_root/.agents/plugins" "$dest_root/plugins"

    local copied_plugins=()
    local plugin_name
    for plugin_name in "${LINUX_BUNDLED_PLUGIN_NAMES[@]}"; do
        if [ -d "$source_root/plugins/$plugin_name" ]; then
            cp -r "$source_root/plugins/$plugin_name" "$dest_root/plugins/"
            copied_plugins+=("$plugin_name")
        else
            warn "Bundled plugin missing in upstream resources: $plugin_name"
        fi
    done

    find "$dest_root" -name '*:com.apple.*' -delete 2>/dev/null || true

    if [ -f "$dest_root/plugins/browser/scripts/browser-client.mjs" ]; then
        node "$SCRIPT_DIR/scripts/patch-browser-use-plugin.mjs" \
            "$dest_root/plugins/browser/scripts/browser-client.mjs"
    fi

    if [ -d "$dest_root/plugins/chrome" ]; then
        local chrome_host_arch=""
        case "$ARCH" in
            x86_64)  chrome_host_arch="x64" ;;
            aarch64) chrome_host_arch="arm64" ;;
            *)       error "Unsupported Chrome extension host architecture: $ARCH" ;;
        esac

        local chrome_host_dir="$dest_root/plugins/chrome/extension-host/linux/$chrome_host_arch"
        mkdir -p "$chrome_host_dir"
        cp "$LINUX_CHROME_EXTENSION_HOST_SOURCE" "$chrome_host_dir/extension-host"
        cp "$LINUX_BROWSER_RUNTIME_DIR/constants.mjs" "$chrome_host_dir/constants.mjs"
        cp "$LINUX_BROWSER_RUNTIME_DIR/frame.mjs" "$chrome_host_dir/frame.mjs"
        cp "$LINUX_BROWSER_RUNTIME_DIR/registry.mjs" "$chrome_host_dir/registry.mjs"
        chmod +x "$chrome_host_dir/extension-host"

        node "$SCRIPT_DIR/scripts/patch-chrome-plugin.mjs" "$dest_root/plugins/chrome"
    fi

    if [ ${#copied_plugins[@]} -eq 0 ]; then
        warn "No Linux bundled plugins copied"
        return
    fi

    node "$SCRIPT_DIR/scripts/filter-bundled-marketplace.mjs" \
        "$source_marketplace" \
        "$dest_marketplace" \
        "${copied_plugins[@]}"

    local copied_local_plugins=()
    local local_plugin_spec
    for local_plugin_spec in "${LINUX_LOCAL_PLUGIN_NAMES[@]}"; do
        local local_plugin_name="${local_plugin_spec%%=*}"
        local local_plugin_dir="$local_plugin_name"
        if [[ "$local_plugin_spec" == *=* ]]; then
            local_plugin_dir="${local_plugin_spec#*=}"
        fi
        local local_plugin_root="$LINUX_LOCAL_PLUGIN_SOURCE_ROOT/$local_plugin_dir"
        [ -d "$local_plugin_root" ] || error "Linux local plugin missing: $local_plugin_root"
        cp -r "$local_plugin_root" "$dest_root/plugins/"
        find "$dest_root/plugins/$local_plugin_dir" -type d -name '__pycache__' -prune -exec rm -rf {} + 2>/dev/null || true
        find "$dest_root/plugins/$local_plugin_dir" -type f -name '*.pyc' -delete 2>/dev/null || true
        copied_local_plugins+=("$local_plugin_name=$local_plugin_dir")
    done

    if [ ${#copied_local_plugins[@]} -gt 0 ]; then
        node "$SCRIPT_DIR/scripts/add-local-bundled-marketplace-plugins.mjs" \
            "$dest_marketplace" \
            "${copied_local_plugins[@]}"
    fi

    info "Bundled plugin resources copied: ${copied_plugins[*]}${copied_local_plugins[*]:+; local: ${copied_local_plugins[*]}}"
}

# ---- Download Linux Electron ----
download_electron() {
    info "Downloading Electron v${ELECTRON_VERSION} for Linux..."

    local electron_zip
    electron_zip="$(ensure_electron_runtime_zip "$ELECTRON_VERSION" "$ARCH" "$WORK_DIR")"
    info "Using Electron runtime zip: $electron_zip"

    mkdir -p "$INSTALL_DIR"
    cd "$INSTALL_DIR"
    unzip -qo "$electron_zip"

    if [ -f "$INSTALL_DIR/electron" ]; then
        mv "$INSTALL_DIR/electron" "$INSTALL_DIR/Codex"
        ln -sfn Codex "$INSTALL_DIR/electron"
    else
        error "Expected Electron binary after unzip: $INSTALL_DIR/electron"
    fi

    info "Electron ready"
}

# ---- Export app icon ----
export_app_icon() {
    [ -f "$APP_ICON_SOURCE" ] || error "Expected installer app icon not found: $APP_ICON_SOURCE"
    cp "$APP_ICON_SOURCE" "$INSTALL_DIR/icon.png"
    info "App icon exported from installer asset: assets/codex-app-icon.png"
}

# ---- Install app.asar ----
install_runtime_helper_wrappers() {
    cat > "$INSTALL_DIR/resources/codex" <<'SCRIPT'
#!/usr/bin/env bash
set -Eeuo pipefail

SELF="$(readlink -f "$0" 2>/dev/null || printf '%s\n' "$0")"
CODEX_HOME_DIR="${CODEX_HOME:-$HOME/.codex}"
CODEX_STANDALONE_CLI_PATH="${CODEX_STANDALONE_CLI_PATH:-$CODEX_HOME_DIR/packages/standalone/current/codex}"

exec_if_distinct() {
    local candidate="$1"
    shift
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
        local resolved
        resolved="$(readlink -f "$candidate" 2>/dev/null || printf '%s\n' "$candidate")"
        if [ "$resolved" != "$SELF" ]; then
            exec "$candidate" "$@"
        fi
    fi
}

exec_if_distinct "${CODEX_CLI_PATH:-}" "$@"
exec_if_distinct "$CODEX_STANDALONE_CLI_PATH" "$@"

if command -v codex >/dev/null 2>&1; then
    candidate="$(command -v codex)"
    exec_if_distinct "$candidate" "$@"
fi

echo "Error: official standalone Codex CLI not found. Install with: curl -fsSL https://chatgpt.com/codex/install.sh | sh" >&2
exit 1
SCRIPT

    cat > "$INSTALL_DIR/resources/node" <<'SCRIPT'
#!/usr/bin/env bash
set -Eeuo pipefail

SELF="$(readlink -f "$0" 2>/dev/null || printf '%s\n' "$0")"
PRIMARY_RUNTIME_NODE="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"

exec_if_distinct() {
    local candidate="$1"
    shift
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
        local resolved
        resolved="$(readlink -f "$candidate" 2>/dev/null || printf '%s\n' "$candidate")"
        if [ "$resolved" != "$SELF" ]; then
            exec "$candidate" "$@"
        fi
    fi
}

exec_if_distinct "${CODEX_BROWSER_USE_NODE_PATH:-}" "$@"
exec_if_distinct "$PRIMARY_RUNTIME_NODE" "$@"

if command -v node >/dev/null 2>&1; then
    candidate="$(command -v node)"
    exec_if_distinct "$candidate" "$@"
fi

echo "Error: Node.js runtime not found for Codex browser plugins." >&2
exit 1
SCRIPT

    chmod +x "$INSTALL_DIR/resources/codex" "$INSTALL_DIR/resources/node"
}

install_app() {
    cp "$WORK_DIR/app.asar" "$INSTALL_DIR/resources/"
    if [ -d "$WORK_DIR/app.asar.unpacked" ]; then
        cp -r "$WORK_DIR/app.asar.unpacked" "$INSTALL_DIR/resources/"
    fi
    if [ -d "$WORK_DIR/plugins" ]; then
        cp -r "$WORK_DIR/plugins" "$INSTALL_DIR/resources/"
    fi
    cp "$LINUX_NODE_REPL_SOURCE" "$INSTALL_DIR/resources/node_repl"
    chmod +x "$INSTALL_DIR/resources/node_repl"
    install_runtime_helper_wrappers
    info "app.asar installed"
}

# ---- Verify packaged Linux patches and write patch state ----
write_packaged_linux_patch_state() {
    node "$WRITE_LINUX_PATCH_STATE_SCRIPT" "$INSTALL_DIR"
    info "Linux patch state written"
}

# ---- Create start script ----
create_start_script() {
    cat > "$INSTALL_DIR/start.sh" << 'SCRIPT'
#!/bin/bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

CODEX_STANDALONE_CLI_PATH="${CODEX_STANDALONE_CLI_PATH:-$HOME/.codex/packages/standalone/current/codex}"

if [ -x "$CODEX_STANDALONE_CLI_PATH" ]; then
    export CODEX_CLI_PATH="${CODEX_CLI_PATH:-$CODEX_STANDALONE_CLI_PATH}"
else
    export CODEX_CLI_PATH="${CODEX_CLI_PATH:-$(which codex 2>/dev/null)}"
fi

export CHROME_DESKTOP="${CHROME_DESKTOP:-Codex.desktop}"
export CODEX_DESKTOP_AUTH_FETCH_SOCKET="${CODEX_DESKTOP_AUTH_FETCH_SOCKET:-/tmp/codex-desktop-auth-fetch-$(id -u).sock}"
CODEX_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/tmp}"
export CODEX_DESKTOP_BROWSER_APPROVAL_SOCKET="${CODEX_DESKTOP_BROWSER_APPROVAL_SOCKET:-$CODEX_RUNTIME_DIR/codex-browser-approval-$(id -u).sock}"

PRIMARY_RUNTIME_NODE="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
if [ -z "${CODEX_BROWSER_USE_NODE_PATH:-}" ] && [ -x "$PRIMARY_RUNTIME_NODE" ]; then
    export CODEX_BROWSER_USE_NODE_PATH="$PRIMARY_RUNTIME_NODE"
fi

if [ -z "${CODEX_NODE_REPL_PATH:-}" ] && [ -x "$SCRIPT_DIR/resources/node_repl" ]; then
    export CODEX_NODE_REPL_PATH="$SCRIPT_DIR/resources/node_repl"
fi

if [ "${CODEX_ELECTRON_ENABLE_LINUX_BROWSER_USE:-}" = "1" ] && [ -z "${CODEX_NODE_REPL_PATH:-}" ]; then
    echo "Warning: Linux Browser Use is enabled but CODEX_NODE_REPL_PATH is not set and resources/node_repl is missing." >&2
fi

if [ -z "${CODEX_CLI_PATH:-}" ] || [ ! -x "$CODEX_CLI_PATH" ]; then
    echo "Error: official standalone Codex CLI not found. Install with: curl -fsSL https://chatgpt.com/codex/install.sh | sh"
    exit 1
fi

cd "$SCRIPT_DIR"
exec "$SCRIPT_DIR/Codex" --no-sandbox "$@"
SCRIPT

    chmod +x "$INSTALL_DIR/start.sh"
    info "Start script created"
}

# ---- Main ----
main() {
    echo "============================================" >&2
    echo "  Codex Desktop for Linux — Installer"       >&2
    echo "============================================" >&2
    echo ""                                             >&2

    local provided_dmg=""
    while [ $# -gt 0 ]; do
        case "$1" in
            --refresh-dmg)
                REFRESH_DMG=1
                shift
                ;;
            --no-refresh-dmg)
                REFRESH_DMG=0
                shift
                ;;
            -h|--help)
                usage
                exit 0
                ;;
            *)
                if [ -f "$1" ] && [ -z "$provided_dmg" ]; then
                    provided_dmg="$(realpath "$1")"
                    shift
                else
                    usage
                    error "Unknown argument: $1"
                fi
                ;;
        esac
    done

    configure_local_plugins
    check_deps
    if [ "${CODEX_SKIP_CODEX_CLI:-0}" = "1" ]; then
        info "Skipping user Codex CLI install/update because CODEX_SKIP_CODEX_CLI=1"
    else
        info "Ensuring official standalone Codex CLI is installed and current"
        "$ENSURE_CODEX_CLI_SCRIPT"
    fi
    resolve_install_dir

    local dmg_path=""
    if [ -n "$provided_dmg" ]; then
        dmg_path="$provided_dmg"
        info "Using provided DMG: $dmg_path"
    else
        dmg_path=$(get_dmg)
    fi

    local app_dir
    app_dir=$(extract_dmg "$dmg_path")

    patch_asar "$app_dir"
    copy_bundled_plugins "$app_dir"
    download_electron
    export_app_icon
    install_app
    write_packaged_linux_patch_state
    create_start_script
    echo ""                                             >&2
    echo "============================================" >&2
    info "Installation complete!"
    echo "  Run:      $INSTALL_DIR/start.sh"            >&2
    echo "  Activate: $ACTIVATE_SCRIPT $INSTALL_DIR"    >&2
    echo "============================================" >&2
}

main "$@"
