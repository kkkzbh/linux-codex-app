#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_ROOT="${LINUX_CODEX_APP_BUILD_ROOT:-$REPO_ROOT/.build/release}"
DIST_DIR="${LINUX_CODEX_APP_DIST_DIR:-$REPO_ROOT/dist}"

resolve_manifest_path() {
    local manifest="${1:-latest}"
    if [ "$manifest" = "latest" ]; then
        manifest="$(find "$REPO_ROOT/upstream" -maxdepth 1 -type f -name 'codex-app-*.json' | sort | tail -n 1)"
        [ -n "$manifest" ] || {
            printf '[ERROR] No codex-app manifests found under: %s\n' "$REPO_ROOT/upstream" >&2
            exit 1
        }
    fi
    printf '%s\n' "$manifest"
}

MANIFEST_PATH="$(resolve_manifest_path "${1:-latest}")"

info() { printf '[INFO] %s\n' "$*" >&2; }
warn() { printf '[WARN] %s\n' "$*" >&2; }
error() { printf '[ERROR] %s\n' "$*" >&2; exit 1; }

require_cmd() {
    command -v "$1" >/dev/null 2>&1 || error "Missing required command: $1"
}

json_field() {
    local key_path="$1"
    node - "$MANIFEST_PATH" "$key_path" <<'NODE'
const fs = require("node:fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const value = process.argv[3].split(".").reduce((acc, key) => acc?.[key], manifest);
if (value === undefined || value === null) process.exit(2);
process.stdout.write(String(value));
NODE
}

json_file_field() {
    local file_path="$1"
    local key_path="$2"
    node - "$file_path" "$key_path" <<'NODE'
const fs = require("node:fs");
const data = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const value = process.argv[3].split(".").reduce((acc, key) => acc?.[key], data);
if (value === undefined || value === null) process.exit(2);
process.stdout.write(String(value));
NODE
}

sha256_file() {
    sha256sum "$1" | awk '{print $1}'
}

download_pinned_file() {
    local url="$1"
    local output_path="$2"

    curl -L --fail --show-error \
        --retry 4 \
        --retry-all-errors \
        --retry-delay 2 \
        --connect-timeout 30 \
        --max-time 900 \
        --output "$output_path" \
        "$url"
}

require_cmd node
require_cmd curl
require_cmd sha256sum
require_cmd rsync
require_cmd tar
require_cmd rpmbuild

node "$REPO_ROOT/scripts/check-release-inputs.mjs"

manifest_id="$(json_field id)"
app_version="$(json_field appVersion)"
rpm_version="$(json_field rpmVersion)"
rpm_release="$(json_field rpmRelease)"
target_arch="$(json_field targetArch)"
dmg_url="$(json_field dmg.url)"
dmg_size="$(json_field dmg.size)"
dmg_sha256="$(json_field dmg.sha256)"
app_asar_path="$(json_field dmg.appAsarPath)"
app_asar_sha256="$(json_field dmg.appAsarSha256)"
electron_version="$(json_field electron.version)"
sevenzip_version="$(json_field buildTools.sevenZip.version)"
sevenzip_url="$(json_field buildTools.sevenZip.url)"
sevenzip_sha256="$(json_field buildTools.sevenZip.sha256)"
cli_release="$(json_field codexCli.release)"
cli_version="$(json_field codexCli.version)"
cli_vendor_target="$(json_field codexCli.vendorTarget)"
cli_archive_url="$(json_field codexCli.archiveUrl)"
cli_archive_sha256="$(json_field codexCli.sha256)"
runtime_id="codex-${app_version}-${target_arch}"

case "$target_arch" in
    x86_64)
        ;;
    *)
        error "This release script currently builds only on x86_64; manifest targetArch=$target_arch"
        ;;
esac

if [ "$(uname -m)" != "$target_arch" ]; then
    error "Host architecture $(uname -m) does not match manifest targetArch=$target_arch"
fi

work_dir="$BUILD_ROOT/$manifest_id"
upstream_dir="$work_dir/upstream"
payload_root="$work_dir/payload"
rpm_top="$work_dir/rpmbuild"
dmg_path="$upstream_dir/Codex.dmg"
tools_dir="$work_dir/tools"
runtime_dir="$payload_root/opt/linux-codex-app/runtime/$runtime_id"
codex_app_root="$payload_root/opt/linux-codex-app"
cli_dir="$codex_app_root/codex-cli/$cli_version"

rm -rf "$work_dir"
mkdir -p "$upstream_dir" "$tools_dir" "$payload_root" "$rpm_top/SOURCES" "$DIST_DIR"

sevenzip_archive="$tools_dir/7zip-${sevenzip_version}-linux-x64.tar.xz"
sevenzip_extract_dir="$tools_dir/7zip-${sevenzip_version}"
sevenzip_bin="$sevenzip_extract_dir/7zz"
info "Downloading pinned 7-Zip extractor: $sevenzip_version"
download_pinned_file "$sevenzip_url" "$sevenzip_archive"
actual_sevenzip_sha="$(sha256_file "$sevenzip_archive")"
if [ "$actual_sevenzip_sha" != "$sevenzip_sha256" ]; then
    error "7-Zip archive sha256 mismatch: expected $sevenzip_sha256, got $actual_sevenzip_sha"
fi
mkdir -p "$sevenzip_extract_dir"
tar -xJf "$sevenzip_archive" -C "$sevenzip_extract_dir"
[ -x "$sevenzip_bin" ] || error "Expected pinned 7-Zip executable after extraction: $sevenzip_bin"

cached_dmg_candidates=()
if [ -n "${LINUX_CODEX_APP_DMG_PATH:-}" ]; then
    cached_dmg_candidates+=("$LINUX_CODEX_APP_DMG_PATH")
fi
cached_dmg_candidates+=(
    "$REPO_ROOT/../codex-app/codex-desktop-linux-installer/Codex.dmg"
    "$HOME/code/codex-app/codex-desktop-linux-installer/Codex.dmg"
)

for cached_dmg in "${cached_dmg_candidates[@]}"; do
    if [ -f "$cached_dmg" ] && [ "$(sha256_file "$cached_dmg")" = "$dmg_sha256" ]; then
        info "Using cached pinned Codex DMG: $cached_dmg"
        cp "$cached_dmg" "$dmg_path"
        break
    fi
done

if [ ! -f "$dmg_path" ]; then
    info "Downloading pinned Codex DMG"
    download_pinned_file "$dmg_url" "$dmg_path"
fi

actual_size="$(stat -c %s "$dmg_path")"
if [ "$actual_size" != "$dmg_size" ]; then
    error "DMG size mismatch: expected $dmg_size, got $actual_size"
fi

actual_sha="$(sha256_file "$dmg_path")"
if [ "$actual_sha" != "$dmg_sha256" ]; then
    error "DMG sha256 mismatch: expected $dmg_sha256, got $actual_sha"
fi

info "Verifying upstream app.asar hash"
actual_app_asar_sha="$("$sevenzip_bin" e -so "$dmg_path" "$app_asar_path" | sha256sum | awk '{print $1}')"
if [ "$actual_app_asar_sha" != "$app_asar_sha256" ]; then
    error "app.asar sha256 mismatch: expected $app_asar_sha256, got $actual_app_asar_sha"
fi

info "Building converted runtime into RPM payload"
CODEX_INSTALL_DIR="$runtime_dir" \
CODEX_SKIP_CODEX_CLI=1 \
CODEX_LOCAL_PLUGIN_NAMES="${CODEX_RELEASE_LOCAL_PLUGINS:-}" \
CODEX_LINUX_DESKTOP_ASSETS=0 \
CODEX_SEVENZIP="$sevenzip_bin" \
"$REPO_ROOT/install.sh" "$dmg_path"

if [ -f "$runtime_dir/version" ]; then
    installed_electron="$(tr -d '\n' < "$runtime_dir/version")"
    if [ "$installed_electron" != "$electron_version" ]; then
        error "Electron version mismatch: expected $electron_version, got $installed_electron"
    fi
fi

CODEX_VERIFY_LOCAL_PLUGINS="${CODEX_RELEASE_LOCAL_PLUGINS:-}" \
CODEX_LINUX_DESKTOP_ASSETS=0 \
"$REPO_ROOT/scripts/verify-install.sh" "$runtime_dir"

info "Installing pinned Codex CLI into RPM payload"
mkdir -p "$cli_dir"
cli_archive="$upstream_dir/codex-package-${cli_vendor_target}.tar.gz"
local_cli_package_dir="${CODEX_STANDALONE_CURRENT:-${CODEX_HOME:-$HOME/.codex}/packages/standalone/current}"
local_cli_package_json="$local_cli_package_dir/codex-package.json"
if [ -f "$local_cli_package_json" ] \
    && [ "$(json_file_field "$local_cli_package_json" version)" = "$cli_version" ] \
    && [ "$(json_file_field "$local_cli_package_json" target)" = "$cli_vendor_target" ]; then
    info "Using local pinned Codex CLI package: $local_cli_package_dir"
    rsync -a "$local_cli_package_dir/" "$cli_dir/"
else
    info "Downloading pinned Codex CLI package: $cli_release / $cli_vendor_target"
    download_pinned_file "$cli_archive_url" "$cli_archive"
    actual_cli_sha="$(sha256_file "$cli_archive")"
    if [ "$actual_cli_sha" != "$cli_archive_sha256" ]; then
        error "Codex CLI package sha256 mismatch: expected $cli_archive_sha256, got $actual_cli_sha"
    fi

    tar -xzf "$cli_archive" -C "$cli_dir"
fi
[ -x "$cli_dir/bin/codex" ] || error "Expected Codex CLI binary after extraction: $cli_dir/bin/codex"
chmod +x "$cli_dir/bin/codex"
[ -x "$cli_dir/codex-path/rg" ] || error "Expected packaged ripgrep after extraction: $cli_dir/codex-path/rg"
[ -x "$cli_dir/codex-resources/bwrap" ] || error "Expected packaged bubblewrap after extraction: $cli_dir/codex-resources/bwrap"
ln -sfn bin/codex "$cli_dir/codex"

packaged_cli_version="$("$cli_dir/codex" --version 2>/dev/null | awk 'NF { print $NF }' | tail -n1)"
if [ "$packaged_cli_version" != "$cli_version" ]; then
    error "Packaged Codex CLI version mismatch: expected $cli_version, got ${packaged_cli_version:-unknown}"
fi

info "Writing package launchers and metadata"
mkdir -p \
    "$payload_root/usr/bin" \
    "$payload_root/usr/libexec/linux-codex-app" \
    "$payload_root/usr/share/applications" \
    "$payload_root/usr/share/linux-codex-app/plugins"

ln -sfn "runtime/$runtime_id" "$codex_app_root/current"
cp "$MANIFEST_PATH" "$payload_root/usr/share/linux-codex-app/upstream.json"
rsync -a "$REPO_ROOT/scripts/" "$payload_root/usr/libexec/linux-codex-app/scripts/"
cp "$REPO_ROOT/scripts/linux-codex-app" "$payload_root/usr/bin/linux-codex-app"
chmod +x "$payload_root/usr/bin/linux-codex-app"

for plugin_name in dolphin kitty computer-use; do
    if [ -d "$REPO_ROOT/plugins/$plugin_name" ]; then
        rsync -a --exclude '__pycache__/' --exclude '*.pyc' "$REPO_ROOT/plugins/$plugin_name" "$payload_root/usr/share/linux-codex-app/plugins/"
    fi
done

for plugin_name in dolphin kitty computer-use; do
    plugin_marketplace_root="$payload_root/usr/share/linux-codex-app-plugin-$plugin_name"
    marketplace_plugin_name="$plugin_name"
    if [ "$plugin_name" = "computer-use" ]; then
        marketplace_plugin_name="kde-computer-use"
    fi
    mkdir -p "$plugin_marketplace_root/.agents/plugins" "$plugin_marketplace_root/plugins"
    rsync -a --exclude '__pycache__/' --exclude '*.pyc' "$REPO_ROOT/plugins/$plugin_name" "$plugin_marketplace_root/plugins/"
    cat > "$plugin_marketplace_root/.agents/plugins/marketplace.json" <<EOF
{
  "name": "linux-codex-app-$plugin_name",
  "interface": {
    "displayName": "linux-codex-app $plugin_name"
  },
  "plugins": [
    {
      "name": "$marketplace_plugin_name",
      "source": {
        "source": "local",
        "path": "./plugins/$plugin_name"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Productivity"
    }
  ]
}
EOF
done

cat > "$payload_root/usr/bin/codex-app" <<EOF
#!/usr/bin/env bash
set -euo pipefail

export CODEX_CLI_PATH="\${CODEX_CLI_PATH:-/opt/linux-codex-app/codex-cli/$cli_version/codex}"
exec "/opt/linux-codex-app/current/start.sh" "\$@"
EOF
chmod +x "$payload_root/usr/bin/codex-app"

cat > "$payload_root/usr/share/applications/codex-app.desktop" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Codex
Comment=OpenAI Codex Desktop (Linux)
Exec=/usr/bin/codex-app %U
Path=/opt/linux-codex-app/current
Icon=/opt/linux-codex-app/current/icon.png
Terminal=false
Categories=Development;
StartupNotify=true
StartupWMClass=Codex
X-GNOME-WMClass=Codex
EOF

: "${LINUX_CODEX_APP_REPO_BASEURL:?Set LINUX_CODEX_APP_REPO_BASEURL to the published DNF repo baseurl}"
repo_gpgkey="${LINUX_CODEX_APP_REPO_GPGKEY:-file:///etc/pki/rpm-gpg/RPM-GPG-KEY-linux-codex-app}"
repo_public_key_file="${LINUX_CODEX_APP_REPO_PUBLIC_KEY_FILE:-$REPO_ROOT/packaging/rpm/RPM-GPG-KEY-linux-codex-app}"
[ -f "$repo_public_key_file" ] || error "Missing repo public key file: $repo_public_key_file"
repo_enabled="${LINUX_CODEX_APP_REPO_ENABLED:-1}"
mkdir -p "$payload_root/etc/yum.repos.d"
mkdir -p "$payload_root/etc/pki/rpm-gpg"
install -m 0644 "$repo_public_key_file" "$payload_root/etc/pki/rpm-gpg/RPM-GPG-KEY-linux-codex-app"
cat > "$payload_root/etc/yum.repos.d/linux-codex-app.repo" <<EOF
[linux-codex-app]
name=Linux Codex App
baseurl=$LINUX_CODEX_APP_REPO_BASEURL
enabled=$repo_enabled
gpgcheck=1
repo_gpgcheck=1
gpgkey=$repo_gpgkey
EOF

payload_archive="$rpm_top/SOURCES/linux-codex-app-${rpm_version}-payload.tar.gz"
tar -C "$payload_root" -czf "$payload_archive" .

info "Building RPM"
rpmbuild -bb "$REPO_ROOT/packaging/rpm/linux-codex-app.spec" \
    --define "_topdir $rpm_top" \
    --define "linux_codex_app_version $rpm_version" \
    --define "linux_codex_app_release $rpm_release" \
    --define "linux_codex_app_manifest_id $manifest_id"

find "$rpm_top/RPMS" -type f -name '*.rpm' -exec cp -f {} "$DIST_DIR/" \;
(
    cd "$DIST_DIR"
    sha256sum ./*.rpm > SHA256SUMS
)

info "RPM artifacts written to: $DIST_DIR"
