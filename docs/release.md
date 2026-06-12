# Release Checklist

1. Update or add `upstream/codex-app-YYYYMMDD.json`.
2. Confirm the manifest pins DMG size, DMG sha256, source `app.asar` sha256,
   Codex Desktop version/build, Electron version, pinned 7-Zip extractor,
   Codex CLI release, and Linux patch version. The Codex CLI entry must include
   the exact package URL, vendor target, and sha256.
   Keep `rpmVersion` stable unless there is a package-manager compatibility
   reason to change it; publish new upstream refreshes by changing
   `rpmRelease` to a date suffix such as `YYYYMMDD.codex26_608_12217`.
3. Run static checks:

   ```bash
   npm run check
   ```

4. Run the local release on a Fedora 44 x86_64 machine. The local machine is
   the authoritative release environment because it can validate the converted
   desktop runtime and KDE integration directly. The full package build requires
   RPM tooling, `dpkg-deb`, `zstd`, and `appimagetool` or network access to
   download the default appimagetool:

   ```bash
   npm run release:local -- upstream/codex-app-YYYYMMDD.json
   ```

   If `RPM_SIGNING_KEY_ID` names a local GPG secret key, the script signs RPMs
   and publishes signed GitHub Pages DNF repository metadata. Without the local
   signing key, the script uploads GitHub Release assets and skips DNF repo
   metadata publishing.

5. Smoke-test the generated RPMs in a clean Fedora 44 VM or container, DEBs on
   a Debian/Ubuntu-family system, pacman packages on Arch, and AppImage/tar.gz
   launch paths on a clean Linux desktop.
6. The `smoke-packages` GitHub Actions workflow builds inside a Fedora 44
   container and uploads temporary smoke artifacts. It is a validation path,
   not the authoritative release publisher.
7. Local release assets include RPM, DEB, AppImage, tar.gz, pacman
   `pkg.tar.zst`, and `SHA256SUMS`.
8. Publish release notes with:
   - linux-codex-app version and RPM release
   - upstream Codex Desktop version/build
   - Electron version
   - Codex CLI version
   - Linux patch version
   - package formats produced
   - verification summary
   - known limitations and yanked-version notes

Local signing environment:

- `RPM_SIGNING_KEY_ID`: key id, fingerprint, or signing identity passed to GPG.
- `RPM_SIGNING_PASSPHRASE`: optional passphrase used by
  `publish-github-pages-repo.mjs` for `repomd.xml` signing when the local key is
  passphrase-protected. Unprotected local signing keys do not need it.
- `GH_TOKEN`: optional. If unset, `gh` uses the logged-in local account for
  GitHub Release uploads; Pages publishing requires a token because it pushes
  `gh-pages` through HTTPS.
