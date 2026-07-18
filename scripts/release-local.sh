#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
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

GIT_BIN="${GIT_BIN:-/usr/bin/git}"
if [ ! -x "$GIT_BIN" ]; then
    GIT_BIN="$(command -v git || true)"
fi
[ -x "$GIT_BIN" ] || error "Missing required command: git"

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

repo_slug() {
    "$GIT_BIN" -C "$REPO_ROOT" remote get-url origin | sed -E \
        -e 's#^git@github.com:##' \
        -e 's#^https://github.com/##' \
        -e 's#\.git$##'
}

release_tag() {
    local rpm_version="$1"
    local rpm_release="$2"
    printf 'v%s-%s\n' "$rpm_version" "$(printf '%s' "$rpm_release" | sed -E 's/^1\.codex/codex/' | tr '_' '.')"
}

sign_rpms_if_possible() {
    if [ -z "${RPM_SIGNING_KEY_ID:-}" ]; then
        warn "RPM_SIGNING_KEY_ID is not set; leaving RPMs unsigned and skipping Pages DNF repository publish"
        return 1
    fi

    if ! gpg --list-secret-keys "$RPM_SIGNING_KEY_ID" >/dev/null 2>&1; then
        warn "No local GPG secret key for RPM_SIGNING_KEY_ID=$RPM_SIGNING_KEY_ID; leaving RPMs unsigned and skipping Pages DNF repository publish"
        return 1
    fi

    require_cmd rpmsign
    require_cmd rpmkeys
    info "Signing RPMs with key: $RPM_SIGNING_KEY_ID"
    rpmsign --key-id "$RPM_SIGNING_KEY_ID" --addsign "$DIST_DIR"/*.rpm \
        || error "Failed to sign RPM artifacts"

    local public_key_file="$REPO_ROOT/.build/RPM-GPG-KEY-linux-codex-app"
    mkdir -p "$REPO_ROOT/.build"
    gpg --armor --export "$RPM_SIGNING_KEY_ID" > "$public_key_file" \
        || error "Failed to export RPM signing public key"
    cp "$public_key_file" "$REPO_ROOT/packaging/rpm/RPM-GPG-KEY-linux-codex-app" \
        || error "Failed to stage RPM signing public key"

    local rpmdb
    rpmdb="$(mktemp -d "${TMPDIR:-/tmp}/linux-codex-app-rpmdb.XXXXXX")"
    rpmkeys --dbpath "$rpmdb" --import "$public_key_file" \
        || error "Failed to initialize the isolated RPM keyring"
    LC_ALL=C rpmkeys --checksig --dbpath "$rpmdb" "$DIST_DIR"/*.rpm \
        | tee "$REPO_ROOT/.build/rpm-signature-checks.txt" \
        || error "RPM signature verification command failed"
    while IFS= read -r line; do
        case "$line" in
            *": digests signatures OK") ;;
            *) error "RPM signature check failed: $line" ;;
        esac
    done < "$REPO_ROOT/.build/rpm-signature-checks.txt"
    rm -rf "$rpmdb"

    (
        cd "$DIST_DIR"
        find . -maxdepth 1 -type f \
            \( -name '*.rpm' -o -name '*.deb' -o -name '*.AppImage' -o -name '*.tar.gz' -o -name '*.pkg.tar.zst' \) \
            -printf '%f\n' | sort | xargs -r sha256sum > SHA256SUMS
    )
    return 0
}

publish_release_assets() {
    local repository="$1"
    local tag="$2"
    local title="$3"
    local notes_file="$4"

    require_cmd gh
    if gh release view "$tag" --repo "$repository" >/dev/null 2>&1; then
        gh release edit "$tag" --repo "$repository" --title "$title" --notes-file "$notes_file"
    else
        gh release create "$tag" --repo "$repository" --title "$title" --notes-file "$notes_file"
    fi

    shopt -s nullglob
    local artifacts=(
        "$DIST_DIR"/*.rpm
        "$DIST_DIR"/*.deb
        "$DIST_DIR"/*.AppImage
        "$DIST_DIR"/*.tar.gz
        "$DIST_DIR"/*.pkg.tar.zst
        "$DIST_DIR"/SHA256SUMS
    )
    shopt -u nullglob

    [ "${#artifacts[@]}" -gt 0 ] || error "No release artifacts found in $DIST_DIR"

    local artifact attempt
    for artifact in "${artifacts[@]}"; do
        for attempt in 1 2 3; do
            info "Uploading release asset ($(basename "$artifact"), attempt $attempt/3)"
            if gh release upload "$tag" --repo "$repository" "$artifact" --clobber; then
                break
            fi

            if [ "$attempt" -eq 3 ]; then
                error "Failed to upload release asset after retries: $artifact"
            fi
            sleep $((attempt * 5))
        done
    done
}

publish_pages_repo() {
    local repository="$1"
    local tag="$2"
    local pages_base_url="$3"
    local fedora_release="$4"
    local target_arch="$5"

    require_cmd createrepo_c
    require_cmd gh
    local public_key_file="$REPO_ROOT/.build/RPM-GPG-KEY-linux-codex-app"
    [ -f "$public_key_file" ] || error "Missing exported RPM public key: $public_key_file"

    local token="${GH_TOKEN:-}"
    if [ -z "$token" ]; then
        token="$(gh auth token)"
    fi
    [ -n "$token" ] || error "GH_TOKEN is required for Pages publish and gh auth token returned empty output"

    local repo_url="https://x-access-token:${token}@github.com/${repository}.git"
    local pages_dir="$REPO_ROOT/.build/pages"

    rm -rf "$pages_dir"
    if "$GIT_BIN" ls-remote --exit-code --heads "$repo_url" gh-pages >/dev/null 2>&1; then
        "$GIT_BIN" clone \
            --depth 1 \
            --filter=blob:none \
            --no-checkout \
            --single-branch \
            --branch gh-pages \
            "$repo_url" \
            "$pages_dir"
        "$GIT_BIN" -C "$pages_dir" sparse-checkout init --no-cone
        "$GIT_BIN" -C "$pages_dir" sparse-checkout set \
            "/.nojekyll" \
            "/RPM-GPG-KEY-linux-codex-app" \
            "/index.html" \
            "/linux-codex-app.repo" \
            "/rpm/fedora/$fedora_release/$target_arch/packages.json" \
            "/rpm/fedora/$fedora_release/$target_arch/repodata/*"
        "$GIT_BIN" -C "$pages_dir" checkout gh-pages
    else
        mkdir "$pages_dir"
        "$GIT_BIN" -C "$pages_dir" init -b gh-pages
        "$GIT_BIN" -C "$pages_dir" remote add origin "$repo_url"
    fi

    node "$REPO_ROOT/scripts/publish-github-pages-repo.mjs" \
        --rpm-dir "$DIST_DIR" \
        --pages-dir "$pages_dir" \
        --release-tag "$tag" \
        --repository "$repository" \
        --pages-base-url "$pages_base_url" \
        --fedora-release "$fedora_release" \
        --public-key-file "$public_key_file" \
        --gpg-key-id "$RPM_SIGNING_KEY_ID" \
        --arch "$target_arch"

    "$GIT_BIN" -C "$pages_dir" config user.name "linux-codex-app local release"
    "$GIT_BIN" -C "$pages_dir" config user.email "linux-codex-app@users.noreply.github.com"
    "$GIT_BIN" -C "$pages_dir" add .
    if "$GIT_BIN" -C "$pages_dir" diff --cached --quiet; then
        info "No DNF repository metadata changes"
    else
        "$GIT_BIN" -C "$pages_dir" commit -m "Publish RPM repository for $tag"
        "$GIT_BIN" -C "$pages_dir" push origin gh-pages
    fi
}

require_cmd node

if [ -z "${RPM_SIGNING_KEY_ID:-}" ] && command -v gpg >/dev/null 2>&1; then
    discovered_key="$(
        gpg --list-secret-keys --with-colons "linux-codex-app RPM signing key" 2>/dev/null \
            | awk -F: '$1 == "fpr" { print $10; exit }'
    )"
    if [ -n "$discovered_key" ]; then
        export RPM_SIGNING_KEY_ID="$discovered_key"
        info "Using discovered linux-codex-app RPM signing key: $RPM_SIGNING_KEY_ID"
    fi
fi

repository="${LINUX_CODEX_APP_GITHUB_REPOSITORY:-$(repo_slug)}"
repo_name="${repository#*/}"
pages_base_url="${LINUX_CODEX_APP_PAGES_BASE_URL:-https://${repository%%/*}.github.io/$repo_name}"
fedora_release="${LINUX_CODEX_APP_FEDORA_RELEASE:-44}"

rpm_version="$(json_field rpmVersion)"
rpm_release="$(json_field rpmRelease)"
app_version="$(json_field appVersion)"
target_arch="$(json_field targetArch)"
tag="$(release_tag "$rpm_version" "$rpm_release")"
title="linux-codex-app $rpm_version ($app_version)"
notes_file="$REPO_ROOT/.build/release-notes-$tag.md"

if [ -z "${LINUX_CODEX_APP_DIST_DIR:-}" ]; then
    DIST_DIR="$REPO_ROOT/dist/$tag"
    export LINUX_CODEX_APP_DIST_DIR="$DIST_DIR"
fi

export LINUX_CODEX_APP_REPO_BASEURL="${LINUX_CODEX_APP_REPO_BASEURL:-$pages_base_url/rpm/fedora/\$releasever/\$basearch}"
export LINUX_CODEX_APP_REPO_ENABLED="${LINUX_CODEX_APP_REPO_ENABLED:-1}"

info "Building local release packages for $tag"
"$REPO_ROOT/scripts/build-runtime-packages.sh" "$MANIFEST_PATH"

signed=0
if sign_rpms_if_possible; then
    signed=1
fi

cat > "$notes_file" <<EOF
Local Fedora $fedora_release x86_64 package release from pinned upstream manifest \`$(basename "$MANIFEST_PATH")\`.

Assets include RPM, DEB, AppImage, portable tar.gz, pacman pkg.tar.zst, and SHA256SUMS.
EOF

if [ "$signed" -eq 1 ]; then
    cat >> "$notes_file" <<EOF

RPM packages and repository metadata are signed by the linux-codex-app RPM signing key.

\`\`\`bash
sudo curl -fsSL -o /etc/yum.repos.d/linux-codex-app.repo \\
  $pages_base_url/linux-codex-app.repo
sudo dnf install linux-codex-app
\`\`\`
EOF
else
    cat >> "$notes_file" <<'EOF'

RPMs in this release were built locally without an available signing private key, so DNF repository metadata was not published.
EOF
fi

publish_release_assets "$repository" "$tag" "$title" "$notes_file"

if [ "$signed" -eq 1 ]; then
    publish_pages_repo "$repository" "$tag" "$pages_base_url" "$fedora_release" "$target_arch"
else
    warn "Skipped Pages DNF repository publish because RPM signing was unavailable"
fi

info "Local release complete: $tag"
