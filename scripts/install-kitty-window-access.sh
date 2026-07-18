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

if [ "${CODEX_KITTY_WINDOW_ACCESS:-1}" = "0" ]; then
    info "Kitty window access disabled by CODEX_KITTY_WINDOW_ACCESS=0"
    exit 0
fi

require_cmd python3

LOCAL_BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"
KITTY_WRAPPER_PATH="$LOCAL_BIN_DIR/kitty"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
APPLICATIONS_DIR="$DATA_HOME/applications"

find_real_kitty() {
    local candidate=""

    if [ -n "${CODEX_KITTY_REAL_BIN:-}" ] && [ -x "$CODEX_KITTY_REAL_BIN" ]; then
        echo "$CODEX_KITTY_REAL_BIN"
        return 0
    fi

    for candidate in /usr/bin/kitty /usr/local/bin/kitty; do
        if [ -x "$candidate" ] && [ "$candidate" != "$KITTY_WRAPPER_PATH" ]; then
            echo "$candidate"
            return 0
        fi
    done

    candidate="$(command -v kitty 2>/dev/null || true)"
    if [ -n "$candidate" ] && [ "$candidate" != "$KITTY_WRAPPER_PATH" ]; then
        echo "$candidate"
        return 0
    fi

    return 1
}

REAL_KITTY="$(find_real_kitty || true)"
if [ -z "$REAL_KITTY" ]; then
    warn "Could not find the real kitty binary; skipping Kitty window access"
    exit 0
fi

install_kitty_wrapper() {
    mkdir -p "$LOCAL_BIN_DIR"

    if [ -e "$KITTY_WRAPPER_PATH" ] && ! grep -q "Codex Kitty window access wrapper" "$KITTY_WRAPPER_PATH" 2>/dev/null; then
        cp -p "$KITTY_WRAPPER_PATH" "$KITTY_WRAPPER_PATH.codex-backup-$(date +%Y%m%d-%H%M%S)"
    fi

    cat > "$KITTY_WRAPPER_PATH" <<EOF
#!/usr/bin/env bash
# Codex Kitty window access wrapper
set -euo pipefail

real_kitty="$REAL_KITTY"

if [ "\${CODEX_KITTY_WRAPPER_BYPASS:-0}" = "1" ]; then
    exec "\$real_kitty" "\$@"
fi

has_listen_on=0
for arg in "\$@"; do
    case "\$arg" in
        --listen-on|--listen-on=*)
            has_listen_on=1
            ;;
    esac
done

if [ "\$has_listen_on" = "1" ]; then
    exec "\$real_kitty" "\$@"
fi

uid="\$(id -u 2>/dev/null || printf '%s' "\${USER:-unknown}")"
if [ -n "\${CODEX_KITTY_STATE_DIR:-}" ]; then
    state_root="\$CODEX_KITTY_STATE_DIR"
elif [ -n "\${XDG_RUNTIME_DIR:-}" ]; then
    state_root="\$XDG_RUNTIME_DIR/codex/plugins/kitty"
else
    state_root="/tmp/codex-plugin-kitty-\$uid"
fi

socket="\$state_root/main.sock"
mkdir -p "\$state_root"

if [ -S "\$socket" ]; then
    if command -v kitten >/dev/null 2>&1 && kitten @ --to "unix:\$socket" ls >/dev/null 2>&1; then
        if [ "\$#" -eq 0 ]; then
            exec kitten @ --to "unix:\$socket" launch --type=tab --cwd "\$PWD"
        fi
        exec "\$real_kitty" "\$@"
    fi
    rm -f "\$socket"
fi

export CODEX_KITTY_INSTANCE_ID=ki_singleton_main
export CODEX_KITTY_INSTANCE_KIND=singleton
export CODEX_KITTY_SOCKET="\$socket"

exec "\$real_kitty" \
    -o allow_remote_control=socket-only \
    --listen-on "unix:\$socket" \
    "\$@"
EOF
    chmod +x "$KITTY_WRAPPER_PATH"
}

install_desktop_overrides() {
    local desktop_launcher="kitty"
    if [ "${CODEX_KITTY_WINDOW_ACCESS_WRAPPER:-1}" != "0" ]; then
        desktop_launcher="$KITTY_WRAPPER_PATH"
    fi

    python3 - "$desktop_launcher" <<'PY'
import os
import re
import shutil
import sys
import time
from pathlib import Path

desktop_launcher = sys.argv[1]
data_home = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local/share")
applications_dir = data_home / "applications"
applications_dir.mkdir(parents=True, exist_ok=True)
xdg_data_dirs = os.environ.get("XDG_DATA_DIRS") or "/usr/local/share:/usr/share"

defaults = {
    "kitty.desktop": """[Desktop Entry]
Version=1.0
Type=Application
Name=kitty
GenericName=Terminal emulator
Comment=Fast, feature-rich, GPU based terminal
TryExec=kitty
StartupNotify=true
Exec=kitty
Icon=kitty
Categories=System;TerminalEmulator;
""",
    "kitty-open.desktop": """[Desktop Entry]
Version=1.0
Type=Application
Name=kitty URL Launcher
GenericName=Terminal emulator
Comment=Open URLs with kitty
StartupNotify=true
TryExec=kitty
Exec=kitty +open %U
Icon=kitty
Categories=System;TerminalEmulator;
NoDisplay=true
MimeType=image/*;application/x-sh;application/x-shellscript;inode/directory;text/*;x-scheme-handler/kitty;x-scheme-handler/ssh;
""",
}

exec_pattern = re.compile(r"^(Exec=)(?:(?:env\s+)?[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*(?:\S*/)?kitty(?P<args>(?:\s+.*)?)$")

for name, fallback in defaults.items():
    target = applications_dir / name
    source_candidates = [target]
    for item in xdg_data_dirs.split(":"):
        if item:
            source_candidates.append(Path(item) / "applications" / name)
    source = next((candidate for candidate in source_candidates if candidate.exists()), None)
    text = source.read_text(encoding="utf-8") if source else fallback
    if target.exists() and source == target and "X-Codex-KittyWindowAccess=true" not in text:
        backup = target.with_name(f"{target.name}.codex-backup-{time.strftime('%Y%m%d-%H%M%S')}")
        shutil.copy2(target, backup)

    lines = []
    changed_exec = False
    has_marker = False
    for line in text.splitlines():
        if line == "X-Codex-KittyWindowAccess=true":
            has_marker = True
            lines.append(line)
            continue
        match = exec_pattern.match(line)
        if match:
            args = match.group("args") or ""
            lines.append(f"Exec={desktop_launcher}{args}")
            changed_exec = True
        else:
            lines.append(line)

    if not changed_exec:
        raise SystemExit(f"Could not find a kitty Exec line to patch in {name}")

    if not has_marker:
        try:
            index = lines.index("[Desktop Entry]")
            lines.insert(index + 1, "X-Codex-KittyWindowAccess=true")
        except ValueError:
            lines.insert(0, "X-Codex-KittyWindowAccess=true")

    tmp = target.with_suffix(".desktop.tmp")
    tmp.write_text("\n".join(lines) + "\n", encoding="utf-8")
    tmp.replace(target)
    print(target)
PY
}

install_prompt_marker() {
    local config_path="${CODEX_KITTY_OH_MY_POSH_CONFIG:-$HOME/.poshthemes/catppuccin_mocha.omp.json}"
    if [ ! -f "$config_path" ]; then
        warn "oh-my-posh config not found; skipping Kitty prompt short id marker: $config_path"
        return 0
    fi

    python3 - "$config_path" <<'PY'
import json
import shutil
import sys
import time
from pathlib import Path

config_path = Path(sys.argv[1])
try:
    data = json.loads(config_path.read_text(encoding="utf-8"))
except Exception as exc:
    print(f"Could not parse oh-my-posh config; skipping Kitty prompt marker: {exc}", file=sys.stderr)
    raise SystemExit(0)

blocks = data.get("blocks")
if not isinstance(blocks, list):
    print("oh-my-posh config has no blocks array; skipping Kitty prompt marker", file=sys.stderr)
    raise SystemExit(0)

target_segments = None
for block in blocks:
    segments = block.get("segments") if isinstance(block, dict) else None
    if isinstance(segments, list) and any(isinstance(seg, dict) and seg.get("type") == "os" for seg in segments):
        target_segments = segments
        break

if target_segments is None:
    print("oh-my-posh prompt has no os segment; skipping Kitty prompt marker", file=sys.stderr)
    raise SystemExit(0)

if any(isinstance(seg, dict) and "CODEX_KITTY_TAB_ID" in str(seg.get("template", "")) for seg in target_segments):
    raise SystemExit(0)

os_index = next(index for index, seg in enumerate(target_segments) if isinstance(seg, dict) and seg.get("type") == "os")
target_segments.insert(os_index + 1, {
    "foreground": "p:lavender",
    "style": "plain",
    "template": "{{ if .Env.CODEX_KITTY_TAB_ID }}[{{ .Env.CODEX_KITTY_TAB_ID }}] {{ end }}",
    "type": "text",
})

backup = config_path.with_name(f"{config_path.name}.codex-backup-{time.strftime('%Y%m%d-%H%M%S')}")
shutil.copy2(config_path, backup)
tmp = config_path.with_suffix(config_path.suffix + ".tmp")
tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
tmp.replace(config_path)
print(config_path)
PY
}

if [ "${CODEX_KITTY_WINDOW_ACCESS_WRAPPER:-1}" != "0" ]; then
    install_kitty_wrapper
fi

if [ "${CODEX_KITTY_WINDOW_ACCESS_DESKTOP:-1}" != "0" ]; then
    install_desktop_overrides
fi


if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$APPLICATIONS_DIR" >/dev/null 2>&1 || true
fi

if command -v kbuildsycoca6 >/dev/null 2>&1; then
    kbuildsycoca6 >/dev/null 2>&1 || true
elif command -v kbuildsycoca5 >/dev/null 2>&1; then
    kbuildsycoca5 >/dev/null 2>&1 || true
fi

info "Kitty window access enabled for future kitty launches"
