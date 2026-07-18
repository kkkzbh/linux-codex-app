#!/bin/bash
set -Eeuo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*" >&2; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*" >&2; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
APPLICATIONS_DIR="$DATA_HOME/applications"
STATE_DIR="${CODEX_APP_STATE_DIR:-$DATA_HOME/codex-app}"
SYSTEMD_USER_DIR="$CONFIG_HOME/systemd/user"
SERVICE_PATH="$SYSTEMD_USER_DIR/codex-computer-use-ydotoold.service"
PORTAL_APP_ID="${CODEX_COMPUTER_USE_PORTAL_APP_ID:-codex}"
PORTAL_PREAUTH="${CODEX_COMPUTER_USE_PORTAL_PREAUTH:-1}"
PORTAL_PREAUTH_EMPTY="${CODEX_COMPUTER_USE_PORTAL_PREAUTH_EMPTY:-0}"
NATIVE_HELPER_SOURCE_DIR="${CODEX_COMPUTER_USE_NATIVE_SOURCE_DIR:-$SCRIPT_DIR/../plugins/computer-use/native}"
SCREENSHOT_HELPER_DIR="${CODEX_COMPUTER_USE_SCREENSHOT_HELPER_DIR:-$STATE_DIR/computer-use}"
SCREENSHOT_HELPER_PATH="${CODEX_COMPUTER_USE_SCREENSHOT_HELPER:-$SCREENSHOT_HELPER_DIR/codex-computer-use-screenshot}"
EIS_HELPER_PATH="${CODEX_COMPUTER_USE_EIS_HELPER:-$SCREENSHOT_HELPER_DIR/codex-computer-use-eis}"
LEGACY_GLOW_HELPER_PATH="$SCREENSHOT_HELPER_DIR/codex-computer-use-glow"
CURSOR_GLOW_THEME_NAME="Codex-Computer-Use-Glow"
CURSOR_GLOW_THEME_DIR="${CODEX_COMPUTER_USE_CURSOR_GLOW_THEME_PATH:-$DATA_HOME/icons/$CURSOR_GLOW_THEME_NAME}"
SCREENSHOT_DESKTOP_ENTRY_PATH="${CODEX_COMPUTER_USE_SCREENSHOT_DESKTOP_ENTRY_PATH:-$APPLICATIONS_DIR/codex-computer-use-screenshot.desktop}"

require_cmd() {
    command -v "$1" >/dev/null 2>&1 || error "Missing required command: $1"
}

install_native_helpers() {
    [ -f "$NATIVE_HELPER_SOURCE_DIR/CMakeLists.txt" ] || error "Computer Use native helper build definition is missing: $NATIVE_HELPER_SOURCE_DIR/CMakeLists.txt"
    [ -f "$NATIVE_HELPER_SOURCE_DIR/codex-computer-use-screenshot.cpp" ] || error "Computer Use screenshot helper source is missing"
    [ -f "$NATIVE_HELPER_SOURCE_DIR/codex-computer-use-eis.cpp" ] || error "Computer Use EIS helper source is missing"
    [ -f "$NATIVE_HELPER_SOURCE_DIR/codex-computer-use-glow.cpp" ] || error "Computer Use cursor glow theme generator source is missing"
    require_cmd cmake
    require_cmd kreadconfig6
    require_cmd plasma-apply-cursortheme
    mkdir -p "$SCREENSHOT_HELPER_DIR" "$APPLICATIONS_DIR"

    local native_build_dir
    native_build_dir="$(mktemp -d "$SCREENSHOT_HELPER_DIR/.native-build.XXXXXX")"
    if ! cmake -S "$NATIVE_HELPER_SOURCE_DIR" -B "$native_build_dir" -DCMAKE_BUILD_TYPE=Release; then
        rm -rf "$native_build_dir"
        error "Qt6 and libXcursor development packages are required to configure the Computer Use native helpers"
    fi
    if ! cmake --build "$native_build_dir" --parallel; then
        rm -rf "$native_build_dir"
        error "Failed to build Computer Use native helpers"
    fi

    local temp_screenshot_helper
    temp_screenshot_helper="$(mktemp "$SCREENSHOT_HELPER_DIR/.codex-computer-use-screenshot.XXXXXX")"

    if ! install -m 0755 "$native_build_dir/codex-computer-use-screenshot" "$temp_screenshot_helper"; then
        rm -f "$temp_screenshot_helper"
        rm -rf "$native_build_dir"
        error "Failed to stage the Computer Use screenshot helper"
    fi
    mv -f "$temp_screenshot_helper" "$SCREENSHOT_HELPER_PATH"

    local temp_eis_helper
    temp_eis_helper="$(mktemp "$SCREENSHOT_HELPER_DIR/.codex-computer-use-eis.XXXXXX")"
    if ! install -m 0755 "$native_build_dir/codex-computer-use-eis" "$temp_eis_helper"; then
        rm -f "$temp_eis_helper"
        rm -rf "$native_build_dir"
        error "Failed to stage the Computer Use EIS helper"
    fi
    mv -f "$temp_eis_helper" "$EIS_HELPER_PATH"

    local base_cursor_theme base_cursor_size
    base_cursor_theme="${CODEX_COMPUTER_USE_CURSOR_BASE_THEME:-$(kreadconfig6 --file kcminputrc --group Mouse --key cursorTheme)}"
    base_cursor_size="${CODEX_COMPUTER_USE_CURSOR_BASE_SIZE:-$(kreadconfig6 --file kcminputrc --group Mouse --key cursorSize)}"
    [ -n "$base_cursor_theme" ] || error "Plasma cursorTheme is empty"
    [[ "$base_cursor_size" =~ ^[1-9][0-9]*$ ]] || error "Plasma cursorSize is invalid: $base_cursor_size"
    if [ "$base_cursor_theme" = "$CURSOR_GLOW_THEME_NAME" ]; then
        [ -f "$CURSOR_GLOW_THEME_DIR/index.theme" ] || error "Active Computer Use cursor theme has no recovery metadata"
        base_cursor_theme="$(kreadconfig6 --file "$CURSOR_GLOW_THEME_DIR/index.theme" --group "Icon Theme" --key X-Codex-BaseTheme)"
        base_cursor_size="$(kreadconfig6 --file "$CURSOR_GLOW_THEME_DIR/index.theme" --group "Icon Theme" --key X-Codex-BaseSize)"
        [ -n "$base_cursor_theme" ] || error "Computer Use cursor theme recovery metadata has no base theme"
        [[ "$base_cursor_size" =~ ^[1-9][0-9]*$ ]] || error "Computer Use cursor theme recovery size is invalid: $base_cursor_size"
        plasma-apply-cursortheme "$base_cursor_theme" --size "$base_cursor_size" >/dev/null \
            || error "Failed to recover the base Plasma cursor theme before activation"
    fi
    if ! "$native_build_dir/codex-computer-use-glow-theme" \
        "$base_cursor_theme" "$base_cursor_size" "$CURSOR_GLOW_THEME_DIR" "$CURSOR_GLOW_THEME_NAME"; then
        rm -rf "$native_build_dir"
        error "Failed to generate the Computer Use outward edge-light cursor theme"
    fi
    rm -rf "$native_build_dir"
    rm -f "$LEGACY_GLOW_HELPER_PATH"

    cat > "$SCREENSHOT_DESKTOP_ENTRY_PATH" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Codex Computer Use Screenshot Helper
Comment=Authorized KWin ScreenShot2 helper for Codex Computer Use
Exec=$SCREENSHOT_HELPER_PATH
NoDisplay=true
Terminal=false
X-KDE-DBUS-Restricted-Interfaces=org.kde.KWin.ScreenShot2
EOF

    if command -v update-desktop-database >/dev/null 2>&1; then
        update-desktop-database "$APPLICATIONS_DIR" >/dev/null 2>&1 || true
    fi

    if command -v kbuildsycoca6 >/dev/null 2>&1; then
        kbuildsycoca6 >/dev/null 2>&1 || true
    elif command -v kbuildsycoca5 >/dev/null 2>&1; then
        kbuildsycoca5 >/dev/null 2>&1 || true
    fi

    info "Computer Use KWin screenshot helper installed: $SCREENSHOT_HELPER_PATH"
    info "Computer Use outward edge-light cursor theme generated: $CURSOR_GLOW_THEME_DIR"
    info "Computer Use KWin screenshot authorization entry: $SCREENSHOT_DESKTOP_ENTRY_PATH"
}

install_portal_preauthorization() {
    [ "$PORTAL_PREAUTH" != "0" ] || return 0
    if ! command -v flatpak >/dev/null 2>&1; then
        warn "flatpak is not installed; KDE portal pre-authorization cannot be configured"
        return 0
    fi

    local app_id
    local authorized=()
    local seen_app_ids=" "
    for app_id in "$PORTAL_APP_ID" codex codex-app Codex; do
        [ -n "$app_id" ] || continue
        case "$seen_app_ids" in
            *" $app_id "*) continue ;;
        esac
        seen_app_ids="${seen_app_ids}${app_id} "
        if flatpak permission-set kde-authorized remote-desktop "$app_id" yes >/dev/null 2>&1; then
            authorized+=("$app_id")
        else
            warn "Could not pre-authorize KDE RemoteDesktop portal for app_id=$app_id"
        fi
    done

    if [ "$PORTAL_PREAUTH_EMPTY" = "1" ]; then
        if flatpak permission-set kde-authorized remote-desktop "" yes >/dev/null 2>&1; then
            authorized+=("<empty-app-id>")
        else
            warn "Could not pre-authorize KDE RemoteDesktop portal for empty app_id"
        fi
    fi

    if [ ${#authorized[@]} -gt 0 ]; then
        info "Computer Use KDE RemoteDesktop portal pre-authorized for: ${authorized[*]}"
    fi
}

disable_stale_direct_input_service() {
    systemctl --user disable --now codex-computer-use-ydotoold.service >/dev/null 2>&1 || true
    if [ -e "$SERVICE_PATH" ]; then
        rm -f "$SERVICE_PATH"
        systemctl --user daemon-reload >/dev/null 2>&1 || true
        info "Removed stale Computer Use direct input service"
    fi
}

install_native_helpers
install_portal_preauthorization
disable_stale_direct_input_service

info "Computer Use KWin screenshot access is granted to the dedicated screenshot helper"
info "Computer Use foreground input uses the pre-authorized KDE RemoteDesktop portal"
