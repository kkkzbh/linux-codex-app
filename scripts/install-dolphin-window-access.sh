#!/bin/bash
set -Eeuo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*" >&2; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*" >&2; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

require_cmd() {
    command -v "$1" >/dev/null 2>&1 || error "Missing required command: $1"
}

require_cmd python3

export QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1
LOCAL_BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"
DOLPHIN_WRAPPER_PATH="$LOCAL_BIN_DIR/dolphin"

python3 - <<'PY'
import os
import re
import shutil
import sys
import time
from pathlib import Path

data_home = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local/share")
applications_dir = data_home / "applications"
target = applications_dir / "org.kde.dolphin.desktop"
source_candidates = [target]

xdg_data_dirs = os.environ.get("XDG_DATA_DIRS") or "/usr/local/share:/usr/share"
for item in xdg_data_dirs.split(":"):
    if item:
        source_candidates.append(Path(item) / "applications" / "org.kde.dolphin.desktop")

source = next((candidate for candidate in source_candidates if candidate.exists()), None)
applications_dir.mkdir(parents=True, exist_ok=True)

if source is None:
    text = """[Desktop Entry]
Name=Dolphin
Exec=dolphin %u
Icon=org.kde.dolphin
Type=Application
Categories=Qt;KDE;System;FileTools;FileManager;
MimeType=inode/directory;
"""
else:
    text = source.read_text(encoding="utf-8")
    if target.exists() and source == target and "X-Codex-DolphinWindowAccess=true" not in text:
        backup = target.with_name(f"{target.name}.codex-backup-{time.strftime('%Y%m%d-%H%M%S')}")
        shutil.copy2(target, backup)

exec_pattern = re.compile(r"^(Exec=)(?:(?:env\s+)?QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1\s+)?(?:/usr/bin/)?dolphin(?P<args>(?:\s+.*)?)$")
lines = []
changed_exec = False
has_codex_marker = False

for line in text.splitlines():
    if line == "X-Codex-DolphinWindowAccess=true":
        has_codex_marker = True
        lines.append(line)
        continue

    match = exec_pattern.match(line)
    if match:
        args = match.group("args") or ""
        lines.append(f"Exec=env QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1 dolphin{args}")
        changed_exec = True
    else:
        lines.append(line)

if not changed_exec:
    for index, line in enumerate(lines):
        if line.startswith("Exec=") and "dolphin" in line and "QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1" not in line:
            lines[index] = line.replace("Exec=", "Exec=env QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1 ", 1)
            changed_exec = True
            break

if not changed_exec:
    print("Could not find a Dolphin Exec line to patch", file=sys.stderr)
    sys.exit(1)

if not has_codex_marker:
    try:
        desktop_entry_index = lines.index("[Desktop Entry]")
        lines.insert(desktop_entry_index + 1, "X-Codex-DolphinWindowAccess=true")
    except ValueError:
        lines.insert(0, "X-Codex-DolphinWindowAccess=true")

new_text = "\n".join(lines) + "\n"
tmp = target.with_suffix(".desktop.tmp")
tmp.write_text(new_text, encoding="utf-8")
tmp.replace(target)
print(target)
PY

install_dolphin_wrapper() {
    local real_dolphin=""
    local candidate=""

    for candidate in /usr/bin/dolphin /usr/local/bin/dolphin; do
        if [ -x "$candidate" ]; then
            real_dolphin="$candidate"
            break
        fi
    done

    if [ -z "$real_dolphin" ]; then
        real_dolphin="$(command -v dolphin 2>/dev/null || true)"
    fi

    if [ -z "$real_dolphin" ] || [ "$real_dolphin" = "$DOLPHIN_WRAPPER_PATH" ]; then
        warn "Could not find the real Dolphin binary for the terminal wrapper"
        return 0
    fi

    mkdir -p "$LOCAL_BIN_DIR"

    if [ -e "$DOLPHIN_WRAPPER_PATH" ] && ! grep -q "Codex Dolphin window access wrapper" "$DOLPHIN_WRAPPER_PATH" 2>/dev/null; then
        cp -p "$DOLPHIN_WRAPPER_PATH" "$DOLPHIN_WRAPPER_PATH.codex-backup-$(date +%Y%m%d-%H%M%S)"
    fi

    cat > "$DOLPHIN_WRAPPER_PATH" <<EOF
#!/usr/bin/env bash
# Codex Dolphin window access wrapper
export QT_LINUX_ACCESSIBILITY_ALWAYS_ON="\${QT_LINUX_ACCESSIBILITY_ALWAYS_ON:-1}"
exec "$real_dolphin" "\$@"
EOF
    chmod +x "$DOLPHIN_WRAPPER_PATH"
}

if [ "${CODEX_DOLPHIN_WINDOW_ACCESS_WRAPPER:-1}" != "0" ]; then
    install_dolphin_wrapper
fi

if [ "${CODEX_DOLPHIN_WINDOW_ACCESS_UPDATE_SESSION:-1}" != "0" ]; then
    if command -v systemctl >/dev/null 2>&1; then
        systemctl --user set-environment QT_LINUX_ACCESSIBILITY_ALWAYS_ON=1 >/dev/null 2>&1 || \
            warn "Could not update systemd user environment for Dolphin accessibility"
    fi

    if command -v dbus-update-activation-environment >/dev/null 2>&1; then
        dbus-update-activation-environment --systemd QT_LINUX_ACCESSIBILITY_ALWAYS_ON >/dev/null 2>&1 || \
            warn "Could not update D-Bus activation environment for Dolphin accessibility"
    fi
fi

APPLICATIONS_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"

if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$APPLICATIONS_DIR" >/dev/null 2>&1 || true
fi

if command -v kbuildsycoca6 >/dev/null 2>&1; then
    kbuildsycoca6 >/dev/null 2>&1 || true
elif command -v kbuildsycoca5 >/dev/null 2>&1; then
    kbuildsycoca5 >/dev/null 2>&1 || true
fi

info "Dolphin window access enabled for future Dolphin launches"
