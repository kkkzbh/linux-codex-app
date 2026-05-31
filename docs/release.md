# Release Checklist

1. Update or add `upstream/codex-app-YYYYMMDD.json`.
2. Confirm the manifest pins DMG size, DMG sha256, source `app.asar` sha256,
   Codex Desktop version/build, Electron version, pinned 7-Zip extractor,
   Codex CLI release, and Linux patch version. The Codex CLI entry must include
   the exact package URL, vendor target, and sha256.
3. Run static checks:

   ```bash
   npm run check
   ```

4. Build RPMs locally on a Fedora 44 x86_64 machine when debugging the release
   pipeline:

   ```bash
   LINUX_CODEX_APP_REPO_BASEURL='https://kkkzbh.github.io/linux-codex-app/rpm/fedora/$releasever/$basearch' \
   ./scripts/build-runtime-rpm.sh upstream/codex-app-YYYYMMDD.json
   ```

5. Smoke-test the generated RPMs in a clean Fedora 44 VM or container. A
   physical Fedora 44 build host is valid; the GitHub Actions workflow uses a
   Fedora 44 container only to pin the CI build and smoke environment.
6. Run the `release-rpm` GitHub Actions workflow. It builds inside Fedora 44,
   signs RPMs, verifies signatures, uploads RPMs and `SHA256SUMS` to a GitHub
   Release, regenerates signed GitHub Pages DNF repo metadata, and keeps
   existing non-yanked packages in metadata.
7. Publish release notes with:
   - linux-codex-app version and RPM release
   - upstream Codex Desktop version/build
   - Electron version
   - Codex CLI version
   - Linux patch version
   - verification summary
   - known limitations and yanked-version notes

Required GitHub Actions secrets:

- `RPM_SIGNING_KEY`: ASCII-armored private signing key or signing subkey.
- `RPM_SIGNING_KEY_ID`: key id, fingerprint, or signing identity passed to GPG.
- `RPM_SIGNING_PASSPHRASE`: passphrase used for RPM and `repomd.xml` signing.
