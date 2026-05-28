# Repository Retention

The RPM repository must retain old installable versions.

Rules:

- Do not delete historical RPM files from the package bucket or GitHub Pages
  repository path.
- Regenerate repository metadata with all non-yanked RPMs present.
- Keep GitHub Release assets for every version, even if the version is later
  yanked from the stable repo metadata.
- A normal upstream Codex Desktop update is not a reason to remove the previous
  RPM. The previous RPM contains its converted runtime and must keep installing.
- Yank only for severe safety or data-loss issues. Document yanked versions in
  release notes and remove them from stable repo metadata, but leave the release
  artifact available for audit.

Expected behavior:

- `dnf install linux-codex-app` installs the newest non-yanked package present in
  current repo metadata.
- `dnf install linux-codex-app-<version>` works for old non-yanked versions that
  remain in metadata.
- Direct installation of a downloaded old RPM works offline because the RPM
  contains the converted runtime and packaged Codex CLI.
