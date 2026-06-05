#!/bin/bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VERIFY_SCRIPT="$SCRIPT_DIR/verify-install.sh"
DOLPHIN_WINDOW_ACCESS_SCRIPT="$SCRIPT_DIR/install-dolphin-window-access.sh"
KITTY_WINDOW_ACCESS_SCRIPT="$SCRIPT_DIR/install-kitty-window-access.sh"
COMPUTER_USE_ACCESS_SCRIPT="$SCRIPT_DIR/install-computer-use-access.sh"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*" >&2; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*" >&2; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

usage() {
    cat >&2 <<EOF
Usage: $0 <install-dir>

Activate a verified Codex staged install by updating the stable launcher and
desktop entry to point at that install.
EOF
}

require_cmd() {
    command -v "$1" >/dev/null 2>&1 || error "Missing required command: $1"
}

install_chrome_native_host() {
    local chrome_root="$INSTALL_DIR/resources/plugins/openai-bundled/plugins/chrome"
    local install_manifest="$chrome_root/scripts/installManifest.mjs"
    local node_repl_path="$INSTALL_DIR/resources/node_repl"
    local codex_cli_path="${CODEX_CLI_PATH:-}"

    if [ ! -f "$install_manifest" ]; then
        warn "Chrome native host installer is missing: $install_manifest"
        return
    fi

    if [ ! -x "$node_repl_path" ]; then
        warn "Chrome native host setup skipped because staged node_repl is missing: $node_repl_path"
        return
    fi

    if [ -z "$codex_cli_path" ]; then
        codex_cli_path="$(command -v codex || true)"
    fi
    if [ -z "$codex_cli_path" ] && [ -x "$INSTALL_DIR/Codex" ]; then
        codex_cli_path="$INSTALL_DIR/Codex"
    fi
    if [ -z "$codex_cli_path" ]; then
        warn "Chrome native host setup skipped because the Codex CLI was not found"
        return
    fi

    CODEX_CHROME_PLUGIN_ROOT="$chrome_root" \
    CODEX_CHROME_CODEX_CLI_PATH="$codex_cli_path" \
    CODEX_CHROME_NODE_REPL_PATH="$node_repl_path" \
    node --input-type=module <<'EOF'
const pluginRoot = process.env.CODEX_CHROME_PLUGIN_ROOT;
const codexCliPath = process.env.CODEX_CHROME_CODEX_CLI_PATH;
const nodeReplPath = process.env.CODEX_CHROME_NODE_REPL_PATH;

if (!pluginRoot || !codexCliPath || !nodeReplPath) {
  throw new Error("Missing Chrome native host activation environment");
}

const { install } = await import(`${pluginRoot}/scripts/installManifest.mjs`);
await install({
  appServerRuntimePaths: {
    codexCliPath,
    nodePath: process.execPath,
    nodeReplPath,
  },
});
EOF
}

if [ $# -ne 1 ]; then
    usage
    exit 1
fi

require_cmd realpath
require_cmd node

INSTALL_DIR="$(realpath "$1")"
[ -x "$VERIFY_SCRIPT" ] || error "Expected executable verify helper: $VERIFY_SCRIPT"
"$VERIFY_SCRIPT" "$INSTALL_DIR"

LOCAL_BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
APPLICATIONS_DIR="$DATA_HOME/applications"
STATE_DIR="${CODEX_APP_STATE_DIR:-$DATA_HOME/codex-app}"
ACTIVE_LINK="${CODEX_APP_ACTIVE_LINK:-$STATE_DIR/current}"
LAUNCHER_PATH="${CODEX_APP_LAUNCHER_PATH:-$LOCAL_BIN_DIR/codex-app-v1-launcher}"
DESKTOP_ENTRY_PATH="${CODEX_APP_DESKTOP_ENTRY_PATH:-$APPLICATIONS_DIR/codex-app.desktop}"
DESKTOP_ENTRY_ALIAS_PATH="${CODEX_APP_DESKTOP_ENTRY_ALIAS_PATH:-$APPLICATIONS_DIR/Codex.desktop}"
DESKTOP_ENTRY_KWIN_ALIAS_PATH="${CODEX_APP_DESKTOP_ENTRY_KWIN_ALIAS_PATH:-$APPLICATIONS_DIR/codex.desktop}"

mkdir -p "$LOCAL_BIN_DIR" "$APPLICATIONS_DIR" "$STATE_DIR"
ln -sfn "$INSTALL_DIR" "$ACTIVE_LINK"

cat > "$LAUNCHER_PATH" <<EOF
#!/usr/bin/env bash
set -euo pipefail

ACTIVE_LINK="${ACTIVE_LINK}"

if [ ! -x "\$ACTIVE_LINK/start.sh" ]; then
    echo "Error: active Codex install is missing start.sh: \$ACTIVE_LINK/start.sh" >&2
    exit 1
fi

exec "\$ACTIVE_LINK/start.sh" "\$@"
EOF
chmod +x "$LAUNCHER_PATH"

cat > "$DESKTOP_ENTRY_PATH" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Codex
Comment=OpenAI Codex Desktop (Linux)
Exec=$LAUNCHER_PATH %U
Path=$ACTIVE_LINK
Icon=$ACTIVE_LINK/icon.png
Terminal=false
Categories=Development;
StartupNotify=true
StartupWMClass=Codex
X-GNOME-WMClass=Codex
X-KDE-DBUS-Restricted-Interfaces=org.kde.KWin.ScreenShot2
X-KDE-Wayland-Interfaces=org_kde_plasma_window_management,zkde_screencast_unstable_v1
EOF

cat > "$DESKTOP_ENTRY_ALIAS_PATH" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Codex
Comment=OpenAI Codex Desktop (Linux)
Exec=$LAUNCHER_PATH %U
Path=$ACTIVE_LINK
Icon=$ACTIVE_LINK/icon.png
Terminal=false
Categories=Development;
StartupNotify=true
StartupWMClass=Codex
X-GNOME-WMClass=Codex
NoDisplay=true
X-KDE-DBUS-Restricted-Interfaces=org.kde.KWin.ScreenShot2
X-KDE-Wayland-Interfaces=org_kde_plasma_window_management,zkde_screencast_unstable_v1
EOF

cat > "$DESKTOP_ENTRY_KWIN_ALIAS_PATH" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Codex
Comment=OpenAI Codex Desktop (Linux)
Exec=$LAUNCHER_PATH %U
Path=$ACTIVE_LINK
Icon=$ACTIVE_LINK/icon.png
Terminal=false
Categories=Development;
StartupNotify=true
StartupWMClass=Codex
X-GNOME-WMClass=Codex
NoDisplay=true
X-KDE-DBUS-Restricted-Interfaces=org.kde.KWin.ScreenShot2
X-KDE-Wayland-Interfaces=org_kde_plasma_window_management,zkde_screencast_unstable_v1
EOF

if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$APPLICATIONS_DIR" >/dev/null 2>&1 || true
fi

if command -v kbuildsycoca6 >/dev/null 2>&1; then
    kbuildsycoca6 >/dev/null 2>&1 || true
elif command -v kbuildsycoca5 >/dev/null 2>&1; then
    kbuildsycoca5 >/dev/null 2>&1 || true
fi

if [ "${CODEX_DOLPHIN_WINDOW_ACCESS:-1}" != "0" ]; then
    if [ -x "$DOLPHIN_WINDOW_ACCESS_SCRIPT" ]; then
        "$DOLPHIN_WINDOW_ACCESS_SCRIPT" || warn "Could not enable Dolphin window access for user-opened Dolphin windows"
    else
        warn "Dolphin window access helper is missing: $DOLPHIN_WINDOW_ACCESS_SCRIPT"
    fi
fi

if [ "${CODEX_KITTY_WINDOW_ACCESS:-1}" != "0" ]; then
    if [ -x "$KITTY_WINDOW_ACCESS_SCRIPT" ]; then
        "$KITTY_WINDOW_ACCESS_SCRIPT" || warn "Could not enable Kitty window access for future user-opened kitty windows"
    else
        warn "Kitty window access helper is missing: $KITTY_WINDOW_ACCESS_SCRIPT"
    fi
fi

if [ "${CODEX_COMPUTER_USE_ACCESS:-1}" != "0" ]; then
    if [ -x "$COMPUTER_USE_ACCESS_SCRIPT" ]; then
        "$COMPUTER_USE_ACCESS_SCRIPT" || warn "Could not enable Computer Use direct access"
    else
        warn "Computer Use access helper is missing: $COMPUTER_USE_ACCESS_SCRIPT"
    fi
fi

install_chrome_native_host

info "Activated install: $INSTALL_DIR"
info "Launcher: $LAUNCHER_PATH"
info "Desktop entry: $DESKTOP_ENTRY_PATH"
info "Desktop alias: $DESKTOP_ENTRY_ALIAS_PATH"
info "KWin desktop alias: $DESKTOP_ENTRY_KWIN_ALIAS_PATH"
