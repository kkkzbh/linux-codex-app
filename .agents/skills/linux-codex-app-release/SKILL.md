---
name: linux-codex-app-release
description: Use when syncing verified Linux Codex App installer changes from /home/kkkzbh/code/codex-app/codex-desktop-linux-installer into /home/kkkzbh/code/linux-codex-app, updating pinned upstream manifests, building signed RPMs, publishing GitHub Releases, and verifying the GitHub Pages DNF repository.
metadata:
  short-description: Sync codex-app changes and publish linux-codex-app RPM releases
---

# Linux Codex App Release

This skill is for the release handoff from the development workspace
`/home/kkkzbh/code/codex-app/codex-desktop-linux-installer` to the public release
workspace `/home/kkkzbh/code/linux-codex-app`.

## Roles

- `codex-app`: development and upstream-adaptation workspace. Patch anchors, runtime behavior, and plugin behavior can be iterated here against fresh staged installs.
- `linux-codex-app`: public release workspace. It owns pinned upstream manifests, RPM packaging, signing, GitHub Release assets, GitHub Pages DNF metadata, and user-facing installation docs.

Do not let both repositories independently evolve Linux patch logic. Develop and verify first, then sync the verified state into the release repository.

## Non-negotiables

- No runtime self-patching and no compatibility fallback branches for old upstream bundle layouts.
- Release builds must fail fast on pinned DMG, `app.asar`, Electron, or verifier mismatch.
- Do not bypass a changed upstream `Codex.dmg`; update the manifest and patch anchors or publish nothing.
- Users must be able to keep installing already published old RPMs. Do not delete old Release assets or non-yanked repository metadata entries.
- RPM install must not download a DMG, patch the app, or build native modules at install time.

## Workflow

1. Verify the development repo first:

   ```bash
   cd /home/kkkzbh/code/codex-app/codex-desktop-linux-installer
   ./scripts/check-dmg-update.sh
   ./install.sh
   ./scripts/verify-install.sh /absolute/path/to/staged-installs/codex-app-YYYYMMDD-HHMMSS
   ```

   Use a fresh staged install. Do not debug by mutating an active runtime directory.

2. Sync only source assets into the release repo:

   ```bash
   src=/home/kkkzbh/code/codex-app/codex-desktop-linux-installer
   dst=/home/kkkzbh/code/linux-codex-app

   rsync -a --delete "$src/scripts/" "$dst/scripts/"
   rsync -a --delete "$src/plugins/" "$dst/plugins/"
   rsync -a --delete "$src/assets/" "$dst/assets/"
   rsync -a "$src/install.sh" "$dst/install.sh"
   ```

   Preserve release-only files in `linux-codex-app`: `.github/`, `packaging/`,
   `upstream/`, `docs/`, `README.md`, `package.json`, `.agents/`, and
   `packaging/rpm/RPM-GPG-KEY-linux-codex-app`.

3. Update the pinned upstream manifest when upstream changed.

   Add a new `upstream/codex-app-YYYYMMDD.json` with the current DMG URL metadata,
   DMG sha256 and size, source `app.asar` sha256, Codex App version/build,
   Electron version, Codex CLI release/archive/sha256, RPM version/release, target
   arch, and Linux patch version.

   If a release workflow fails with a DMG size/hash mismatch, treat that as the
   expected guardrail. Do not re-run with relaxed checks.

4. Validate the release repo:

   ```bash
   cd /home/kkkzbh/code/linux-codex-app
   npm run check
   git diff --stat
   ```

   For local RPM debugging on Fedora 44 x86_64:

   ```bash
   LINUX_CODEX_APP_REPO_BASEURL='https://kkkzbh.github.io/linux-codex-app/rpm/fedora/$releasever/$basearch' \
   ./scripts/build-runtime-rpm.sh upstream/codex-app-YYYYMMDD.json
   ```

5. Commit and push `linux-codex-app`:

   ```bash
   git status --short
   git add <scoped files>
   git commit -m "<release sync message>"
   git push origin main
   ```

6. Run the release workflow:

   ```bash
   gh workflow run release-rpm.yml \
     --repo kkkzbh/linux-codex-app \
     --ref main \
     -f manifest=upstream/codex-app-YYYYMMDD.json

   gh run watch <run-id> --repo kkkzbh/linux-codex-app --exit-status
   ```

7. Verify the published release and repository:

   ```bash
   gh release view <tag> --repo kkkzbh/linux-codex-app --json tagName,url,assets
   curl -fsSL https://kkkzbh.github.io/linux-codex-app/linux-codex-app.repo
   curl -fsSL https://kkkzbh.github.io/linux-codex-app/rpm/fedora/44/x86_64/repodata/repomd.xml | head
   ```

   Verify `repomd.xml.asc` with the published key, then run a clean Fedora 44
   smoke test:

   ```bash
   podman run --rm --network=host fedora:44 bash -lc '
     set -euo pipefail
     curl -fsSL -o /etc/yum.repos.d/linux-codex-app.repo \
       https://kkkzbh.github.io/linux-codex-app/linux-codex-app.repo
     dnf -y makecache --repo linux-codex-app
     dnf install -y linux-codex-app
     linux-codex-app status
     linux-codex-app verify
   '
   ```

## Failure Handling

- If CI fails before packaging because the DMG hash/size changed, create a new
  manifest and update patch anchors against the new upstream bundle.
- If verifier fails, fix the patch scripts and rerun from a fresh staged build.
- If Pages or Release publication fails, fix the workflow or GitHub configuration
  directly and rerun; do not publish by hand unless the workflow itself is being
  repaired and the repair is committed.
- If a release is security-broken, yank it from stable metadata but keep the
  GitHub Release artifact with a clear note.
