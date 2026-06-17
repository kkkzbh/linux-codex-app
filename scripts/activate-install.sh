#!/bin/bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VERIFY_SCRIPT="$SCRIPT_DIR/verify-install.sh"
DOLPHIN_WINDOW_ACCESS_SCRIPT="$SCRIPT_DIR/install-dolphin-window-access.sh"
KITTY_WINDOW_ACCESS_SCRIPT="$SCRIPT_DIR/install-kitty-window-access.sh"
COMPUTER_USE_ACCESS_SCRIPT="$SCRIPT_DIR/install-computer-use-access.sh"
PRUNE_STAGED_INSTALLS_SCRIPT="$SCRIPT_DIR/prune-staged-installs.sh"
VERIFIED_MARKER=".codex-linux-verified"

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
    local codex_runtime_path="$INSTALL_DIR/resources/codex"
    local node_runtime_path="$INSTALL_DIR/resources/node"
    local browser_automation_path="$INSTALL_DIR/resources/browser_automation"

    if [ ! -f "$install_manifest" ]; then
        warn "Chrome native host installer is missing: $install_manifest"
        return
    fi

    if [ ! -x "$codex_runtime_path" ]; then
        warn "Chrome native host setup skipped because staged codex runtime helper is missing: $codex_runtime_path"
        return
    fi

    if [ ! -x "$node_runtime_path" ]; then
        warn "Chrome native host setup skipped because staged node runtime helper is missing: $node_runtime_path"
        return
    fi

    if [ ! -x "$browser_automation_path" ]; then
        warn "Chrome native host setup skipped because staged browser_automation is missing: $browser_automation_path"
        return
    fi

    CODEX_CHROME_PLUGIN_ROOT="$chrome_root" \
    CODEX_CHROME_CODEX_CLI_PATH="$codex_runtime_path" \
    CODEX_CHROME_NODE_PATH="$node_runtime_path" \
    CODEX_CHROME_BROWSER_AUTOMATION_PATH="$browser_automation_path" \
    node --input-type=module <<'EOF'
const pluginRoot = process.env.CODEX_CHROME_PLUGIN_ROOT;
const codexCliPath = process.env.CODEX_CHROME_CODEX_CLI_PATH;
const nodePath = process.env.CODEX_CHROME_NODE_PATH;
const browserAutomationPath = process.env.CODEX_CHROME_BROWSER_AUTOMATION_PATH;

if (!pluginRoot || !codexCliPath || !nodePath || !browserAutomationPath) {
  throw new Error("Missing Chrome native host activation environment");
}

const { install } = await import(`${pluginRoot}/scripts/installManifest.mjs`);
await install({
  appServerRuntimePaths: {
    codexCliPath,
    nodePath,
    browserAutomationPath,
  },
});
EOF
}

remove_legacy_node_repl_mcp_config() {
    local codex_home="${CODEX_HOME:-$HOME/.codex}"
    local config_path="$codex_home/config.toml"

    [ -f "$config_path" ] || return 0

    CODEX_CONFIG_PATH="$config_path" node --input-type=module <<'EOF'
import { copyFile, readFile, writeFile } from "node:fs/promises";

const configPath = process.env.CODEX_CONFIG_PATH;
if (!configPath) {
  throw new Error("Missing CODEX_CONFIG_PATH");
}

const source = await readFile(configPath, "utf8");
const lines = source.split("\n");
const tables = [];
let current = null;

for (const line of lines) {
  const match = line.match(/^\s*\[([^\]]+)\]\s*$/);
  if (match) {
    if (current) tables.push(current);
    current = { name: match[1], lines: [line] };
  } else if (current) {
    current.lines.push(line);
  } else {
    if (!tables.length || tables[tables.length - 1].name !== null) {
      tables.push({ name: null, lines: [] });
    }
    tables[tables.length - 1].lines.push(line);
  }
}
if (current) tables.push(current);

let changed = false;
const filtered = [];
for (const table of tables) {
  if (table.name === "mcp_servers.node_repl" || table.name === "mcp_servers.node_repl.env") {
    const body = table.lines.join("\n");
    const isLegacyBrowserAutomation =
      body.includes("resources/node_repl") ||
      body.includes("NODE_REPL_") ||
      body.includes("mcp__node_repl__js") ||
      body.includes("node_repl");
    if (isLegacyBrowserAutomation) {
      changed = true;
      continue;
    }
  }
  filtered.push(table);
}

if (changed) {
  const next = filtered.map((table) => table.lines.join("\n")).join("\n");
  const backupPath = `${configPath}.bak-remove-node-repl-${new Date().toISOString().replaceAll(/[-:.TZ]/g, "").slice(0, 14)}`;
  await copyFile(configPath, backupPath);
  await writeFile(configPath, next.endsWith("\n") ? next : `${next}\n`, "utf8");
  console.error(`[INFO] Removed legacy node_repl MCP config from ${configPath}; backup: ${backupPath}`);
}
EOF
}

mark_verified_install() {
    local marker_path="$INSTALL_DIR/$VERIFIED_MARKER"
    {
        printf 'verified_at=%s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
        printf 'install_dir=%s\n' "$INSTALL_DIR"
    } > "$marker_path"
}

prune_staged_installs() {
    [ "${CODEX_STAGED_INSTALLS_PRUNE:-1}" != "0" ] || return 0

    local staging_root=""
    case "$INSTALL_DIR" in
        */staged-installs/codex-app-*)
            staging_root="${INSTALL_DIR%/codex-app-*}"
            ;;
        *)
            info "Skipping staged install pruning for non-staged install: $INSTALL_DIR"
            return 0
            ;;
    esac

    [ -x "$PRUNE_STAGED_INSTALLS_SCRIPT" ] || error "Expected executable staged install prune helper: $PRUNE_STAGED_INSTALLS_SCRIPT"
    "$PRUNE_STAGED_INSTALLS_SCRIPT" \
        --staging-root "$staging_root" \
        --active-link "$ACTIVE_LINK" \
        --pin "$INSTALL_DIR"
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

ACTIVE_TARGET="\$(realpath "\$ACTIVE_LINK")"

terminate_stale_codex_instances() {
    [ "\${CODEX_APP_TERMINATE_STALE_INSTANCES:-1}" != "0" ] || return 0
    command -v ps >/dev/null 2>&1 || return 0
    command -v kill >/dev/null 2>&1 || return 0

    local active_staging_root=""
    case "\$ACTIVE_TARGET" in
        */staged-installs/codex-app-*)
            active_staging_root="\${ACTIVE_TARGET%/codex-app-*}"
            ;;
        *)
            return 0
            ;;
    esac

    local stale_pids=()
    local pid args exe_path install_dir
    while read -r pid args; do
        [ -n "\${pid:-}" ] || continue
        [ -n "\${args:-}" ] || continue
        exe_path="\${args%% *}"
        case "\$exe_path" in
            */staged-installs/codex-app-*/Codex)
                install_dir="\${exe_path%/Codex}"
                case "\$install_dir" in
                    "\$active_staging_root"/codex-app-*)
                        ;;
                    *)
                        continue
                        ;;
                esac
                if [ "\$install_dir" != "\$ACTIVE_TARGET" ]; then
                    stale_pids+=("\$pid")
                fi
                ;;
        esac
    done < <(ps -eo pid=,args=)

    [ "\${#stale_pids[@]}" -gt 0 ] || return 0

    echo "Stopping stale Codex instance(s) from previous staged install: \${stale_pids[*]}" >&2
    kill "\${stale_pids[@]}" 2>/dev/null || true

    local deadline=\$((SECONDS + 5))
    while [ "\$SECONDS" -lt "\$deadline" ]; do
        local still_running=()
        for pid in "\${stale_pids[@]}"; do
            if kill -0 "\$pid" 2>/dev/null; then
                still_running+=("\$pid")
            fi
        done
        [ "\${#still_running[@]}" -gt 0 ] || return 0
        sleep 0.2
    done

    local still_running=()
    for pid in "\${stale_pids[@]}"; do
        if kill -0 "\$pid" 2>/dev/null; then
            still_running+=("\$pid")
        fi
    done
    if [ "\${#still_running[@]}" -gt 0 ]; then
        echo "Force-stopping stale Codex instance(s): \${still_running[*]}" >&2
        kill -KILL "\${still_running[@]}" 2>/dev/null || true
    fi
}

terminate_stale_codex_instances

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
remove_legacy_node_repl_mcp_config
mark_verified_install
prune_staged_installs

info "Activated install: $INSTALL_DIR"
info "Launcher: $LAUNCHER_PATH"
info "Desktop entry: $DESKTOP_ENTRY_PATH"
info "Desktop alias: $DESKTOP_ENTRY_ALIAS_PATH"
info "KWin desktop alias: $DESKTOP_ENTRY_KWIN_ALIAS_PATH"
