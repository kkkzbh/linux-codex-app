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

sha256_all_dist_artifacts() {
    (
        cd "$DIST_DIR"
        find . -maxdepth 1 -type f \
            \( -name '*.rpm' -o -name '*.deb' -o -name '*.AppImage' -o -name '*.tar.gz' -o -name '*.pkg.tar.zst' \) \
            -printf '%f\n' | sort | xargs -r sha256sum > SHA256SUMS
    )
}

debian_arch() {
    case "$1" in
        x86_64) printf 'amd64' ;;
        aarch64) printf 'arm64' ;;
        *) error "Unsupported Debian architecture mapping: $1" ;;
    esac
}

appimage_arch() {
    case "$1" in
        x86_64) printf 'x86_64' ;;
        aarch64) printf 'aarch64' ;;
        *) error "Unsupported AppImage architecture mapping: $1" ;;
    esac
}

resolve_appimagetool() {
    if [ -n "${APPIMAGETOOL:-}" ]; then
        [ -x "$APPIMAGETOOL" ] || error "APPIMAGETOOL is not executable: $APPIMAGETOOL"
        printf '%s\n' "$APPIMAGETOOL"
        return
    fi

    if command -v appimagetool >/dev/null 2>&1; then
        command -v appimagetool
        return
    fi

    local tools_dir="$BUILD_ROOT/tools"
    local arch
    arch="$(appimage_arch "$target_arch")"
    local tool_path="$tools_dir/appimagetool-$arch.AppImage"
    local url="${APPIMAGETOOL_URL:-https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-$arch.AppImage}"

    mkdir -p "$tools_dir"
    if [ ! -x "$tool_path" ]; then
        info "Downloading appimagetool for $arch"
        require_cmd curl
        curl -L --fail --show-error --output "$tool_path" "$url"
        chmod +x "$tool_path"
    fi

    printf '%s\n' "$tool_path"
}

build_deb() {
    require_cmd dpkg-deb
    local deb_arch
    deb_arch="$(debian_arch "$target_arch")"
    local deb_release="${rpm_release//_/.}"
    local package_version="${rpm_version}-${deb_release}"
    local deb_root="$work_dir/deb-root"
    local deb_path="$DIST_DIR/linux-codex-app_${package_version}_${deb_arch}.deb"

    rm -rf "$deb_root"
    mkdir -p "$deb_root/DEBIAN"
    rsync -a "$payload_root/" "$deb_root/"

    cat > "$deb_root/DEBIAN/control" <<EOF
Package: linux-codex-app
Version: $package_version
Section: devel
Priority: optional
Architecture: $deb_arch
Maintainer: linux-codex-app maintainers <noreply@example.com>
Depends: bash, nodejs, npm, python3, libgtk-3-0, libnss3, libx11-6, libxcomposite1, libxdamage1, libxrandr2, libxkbcommon0, libatk-bridge2.0-0, libcups2, libpango-1.0-0, libcairo2, libgbm1
Description: OpenAI Codex Desktop converted runtime for Linux
 Unofficial Linux runtime package for Codex Desktop, converted from a pinned
 upstream Codex Desktop build by the linux-codex-app release pipeline.
EOF

    cat > "$deb_root/DEBIAN/postinst" <<'EOF'
#!/usr/bin/env bash
set -e
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database /usr/share/applications >/dev/null 2>&1 || true
fi
EOF
    cat > "$deb_root/DEBIAN/postrm" <<'EOF'
#!/usr/bin/env bash
set -e
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database /usr/share/applications >/dev/null 2>&1 || true
fi
EOF
    chmod 0755 "$deb_root/DEBIAN/postinst" "$deb_root/DEBIAN/postrm"

    info "Building DEB: $deb_path"
    dpkg-deb --build --root-owner-group "$deb_root" "$deb_path"
}

build_tarball() {
    local tar_path="$DIST_DIR/linux-codex-app-${rpm_version}-${rpm_release}.${target_arch}.tar.gz"

    info "Building portable root tarball: $tar_path"
    tar -C "$payload_root" -czf "$tar_path" .
}

build_appimage() {
    local appimagetool
    appimagetool="$(resolve_appimagetool)"
    local app_dir="$work_dir/AppDir"
    local appimage_arch_value
    appimage_arch_value="$(appimage_arch "$target_arch")"
    local appimage_path="$DIST_DIR/linux-codex-app-${rpm_version}-${rpm_release}.${appimage_arch_value}.AppImage"

    rm -rf "$app_dir"
    mkdir -p "$app_dir"
    rsync -a "$payload_root/" "$app_dir/"

    cat > "$app_dir/AppRun" <<EOF
#!/usr/bin/env bash
set -euo pipefail
HERE="\$(dirname "\$(readlink -f "\${0}")")"
export LINUX_CODEX_APP_ROOT="\$HERE/opt/linux-codex-app"
export LINUX_CODEX_APP_CURRENT="\$HERE/opt/linux-codex-app/current"
export LINUX_CODEX_APP_LIBEXEC="\$HERE/usr/libexec/linux-codex-app"
export LINUX_CODEX_APP_SHARE="\$HERE/usr/share/linux-codex-app"
export LINUX_CODEX_APP_PLUGIN_SHARE="\$HERE/usr/share"
export CODEX_CLI_PATH="\${CODEX_CLI_PATH:-\$HERE/opt/linux-codex-app/codex-cli/$cli_version/codex}"
exec "\$HERE/opt/linux-codex-app/current/start.sh" "\$@"
EOF
    chmod 0755 "$app_dir/AppRun"

    cp "$payload_root/usr/share/applications/codex-app.desktop" "$app_dir/codex-app.desktop"
    sed -i \
        -e 's#^Exec=.*#Exec=AppRun %U#' \
        -e 's#^Path=.*#Path=.#' \
        -e 's#^Icon=.*#Icon=codex-app#' \
        "$app_dir/codex-app.desktop"
    cp "$payload_root/opt/linux-codex-app/current/icon.png" "$app_dir/codex-app.png"

    info "Building AppImage: $appimage_path"
    ARCH="$appimage_arch_value" APPIMAGE_EXTRACT_AND_RUN=1 "$appimagetool" "$app_dir" "$appimage_path"
    chmod +x "$appimage_path"
}

build_pacman_pkg() {
    require_cmd zstd
    local pacman_root="$work_dir/pacman-root"
    local package_version="${rpm_version}-${rpm_release}"
    local package_path="$DIST_DIR/linux-codex-app-${package_version}-${target_arch}.pkg.tar.zst"
    local installed_size

    rm -rf "$pacman_root"
    mkdir -p "$pacman_root"
    rsync -a "$payload_root/" "$pacman_root/"
    installed_size="$(du -sb "$pacman_root" | awk '{print $1}')"

    cat > "$pacman_root/.PKGINFO" <<EOF
pkgname = linux-codex-app
pkgbase = linux-codex-app
pkgver = $package_version
pkgdesc = OpenAI Codex Desktop converted runtime for Linux
url = https://github.com/kkkzbh/linux-codex-app
builddate = $(date +%s)
packager = linux-codex-app local release
size = $installed_size
arch = $target_arch
license = custom
depend = bash
depend = nodejs
depend = npm
depend = python
depend = gtk3
depend = nss
depend = libx11
depend = libxcomposite
depend = libxdamage
depend = libxrandr
depend = libxkbcommon
depend = at-spi2-core
depend = cups
depend = pango
depend = cairo
depend = libdrm
EOF

    cat > "$pacman_root/.INSTALL" <<'EOF'
post_install() {
  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database /usr/share/applications >/dev/null 2>&1 || true
  fi
}

post_remove() {
  if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database /usr/share/applications >/dev/null 2>&1 || true
  fi
}
EOF

    info "Building pacman package: $package_path"
    tar \
        --sort=name \
        --owner=0 \
        --group=0 \
        --numeric-owner \
        --zstd \
        -C "$pacman_root" \
        -cf "$package_path" .
}

require_cmd node
require_cmd rsync
require_cmd tar

manifest_id="$(json_field id)"
rpm_version="$(json_field rpmVersion)"
rpm_release="$(json_field rpmRelease)"
target_arch="$(json_field targetArch)"
cli_version="$(json_field codexCli.version)"
work_dir="$BUILD_ROOT/$manifest_id"
payload_root="$work_dir/payload"

"$REPO_ROOT/scripts/build-runtime-rpm.sh" "$MANIFEST_PATH"
[ -d "$payload_root" ] || error "Expected payload root after RPM build: $payload_root"
mkdir -p "$DIST_DIR"

build_deb
build_tarball
build_appimage
build_pacman_pkg
sha256_all_dist_artifacts

info "Package artifacts written to: $DIST_DIR"
