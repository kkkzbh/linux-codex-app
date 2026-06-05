#!/bin/bash
set -Eeuo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*" >&2; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*" >&2; }

CONFIG_HOME="${XDG_CONFIG_HOME:-$HOME/.config}"
SYSTEMD_USER_DIR="$CONFIG_HOME/systemd/user"
SERVICE_PATH="$SYSTEMD_USER_DIR/codex-computer-use-ydotoold.service"
PORTAL_APP_ID="${CODEX_COMPUTER_USE_PORTAL_APP_ID:-codex}"
PORTAL_PREAUTH="${CODEX_COMPUTER_USE_PORTAL_PREAUTH:-1}"
PORTAL_PREAUTH_EMPTY="${CODEX_COMPUTER_USE_PORTAL_PREAUTH_EMPTY:-0}"

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

install_portal_preauthorization
disable_stale_direct_input_service

info "Computer Use KWin screenshot access is granted by the activated Codex.desktop entries; restart Codex from the activated launcher for direct screenshot capture"
info "Computer Use foreground input uses the pre-authorized KDE RemoteDesktop portal"
