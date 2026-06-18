# linux-codex-app

English | [简体中文](README.zh-CN.md)

Package Codex App into Linux release artifacts that can be installed or run directly.

During release, this project downloads a fixed upstream `Codex.dmg`, verifies its hash, converts it to a Linux Electron runtime, applies Linux patches, and packages the final runtime together with a fixed Codex CLI version. Users do not need to provide the DMG, patch, compile, or download the upstream app during installation or runtime startup.

Current targets:

- Fedora 44 KDE x86_64 is the primary validated target for RPM/DNF repository installation
- Codex App `26.608.12217`
- Electron `42.1.0`
- Codex CLI `0.139.0`

Release artifacts:

- RPM: Fedora/DNF repository and direct install
- DEB: direct install on Debian/Ubuntu-family distributions
- AppImage: run without installation
- tar.gz: portable root payload for manual install, inspection, or repackaging
- pkg.tar.zst: direct Arch/pacman package

## Fedora 44 KDE: Install From DNF Repository

Import the DNF repository:

```bash
sudo curl -fsSL -o /etc/yum.repos.d/linux-codex-app.repo \
  https://kkkzbh.github.io/linux-codex-app/linux-codex-app.repo
```

After importing the repository, DNF verifies the RPM signature and repository metadata signature. The current repository signing key fingerprint is:

```text
6096 D6A7 1F4A 86D6 775C  7E2E FB1A DAA3 9B0B FF25
```

Install and start:

```bash
sudo dnf install linux-codex-app
codex-app
```

Check installation state:

```bash
linux-codex-app status
linux-codex-app verify
```

After new RPM releases, system updates are handled through the DNF repository:

```bash
sudo dnf upgrade linux-codex-app
```

If an older repository key was imported before and signature verification fails, download the repo file again so DNF uses the current public key from GitHub Pages.

## Optional Plugins

Dolphin file manager plugin:

```bash
sudo dnf install linux-codex-app-plugin-dolphin
```

Kitty terminal plugin:

```bash
sudo dnf install linux-codex-app-plugin-kitty
```

Computer Use KDE desktop-control plugin:

```bash
sudo dnf install linux-codex-app-plugin-computer-use
```

After installing plugin packages, add the local marketplace in Codex Plugins UI:

- Dolphin: `/usr/share/linux-codex-app-plugin-dolphin`
- Kitty: `/usr/share/linux-codex-app-plugin-kitty`
- Computer Use: `/usr/share/linux-codex-app-plugin-computer-use`

Dolphin/Kitty/Computer Use window-access integration is disabled by default. Enable it explicitly when needed:

```bash
linux-codex-app enable dolphin-window-access
linux-codex-app enable kitty-window-access
linux-codex-app enable computer-use-access
```

Disable Dolphin/Kitty user-level wrapper/desktop overrides:

```bash
linux-codex-app disable dolphin-window-access
linux-codex-app disable kitty-window-access
```

## Download From GitHub Release

Current version:

```bash
VERSION=v0.1.2-20260612.codex26.608.12217
BASE=https://github.com/kkkzbh/linux-codex-app/releases/download/$VERSION
```

Download checksum file:

```bash
curl -LO "$BASE/SHA256SUMS"
```

### Fedora/RPM

If you do not want to import the DNF repository, download and install the RPM directly:

```bash
curl -LO "$BASE/linux-codex-app-0.1.2-20260612.codex26_608_12217.fc44.x86_64.rpm"
sha256sum -c SHA256SUMS --ignore-missing
sudo dnf install ./linux-codex-app-0.1.2-20260612.codex26_608_12217.fc44.x86_64.rpm
codex-app
```

### Debian/Ubuntu DEB

```bash
curl -LO "$BASE/linux-codex-app_0.1.2-20260612.codex26.608.12217_amd64.deb"
sha256sum -c SHA256SUMS --ignore-missing
sudo apt install ./linux-codex-app_0.1.2-20260612.codex26.608.12217_amd64.deb
codex-app
```

### Arch/pacman

```bash
curl -LO "$BASE/linux-codex-app-0.1.2-20260612.codex26_608_12217-x86_64.pkg.tar.zst"
sha256sum -c SHA256SUMS --ignore-missing
sudo pacman -U ./linux-codex-app-0.1.2-20260612.codex26_608_12217-x86_64.pkg.tar.zst
codex-app
```

### AppImage

```bash
curl -LO "$BASE/linux-codex-app-0.1.2-20260612.codex26_608_12217.x86_64.AppImage"
sha256sum -c SHA256SUMS --ignore-missing
chmod +x ./linux-codex-app-0.1.2-20260612.codex26_608_12217.x86_64.AppImage
./linux-codex-app-0.1.2-20260612.codex26_608_12217.x86_64.AppImage
```

### Portable tar.gz

```bash
curl -LO "$BASE/linux-codex-app-0.1.2-20260612.codex26_608_12217.x86_64.tar.gz"
sha256sum -c SHA256SUMS --ignore-missing
tar -tzf linux-codex-app-0.1.2-20260612.codex26_608_12217.x86_64.tar.gz | head
```

The tar.gz is a portable payload rooted at `/`. For manual installation, extract it to the target root, or inspect `/opt/linux-codex-app`, `/usr/bin/codex-app`, and desktop metadata after unpacking.

## Release

Official releases use a Fedora 44 KDE local machine as the main path:

```bash
npm run release:local
```

This command builds RPM, DEB, AppImage, tar.gz, pacman package, and `SHA256SUMS` locally, then uploads them to GitHub Release. GitHub Actions only keeps Fedora container smoke checks to validate scripts and unsigned builds; it is not the official release source.

## Notes

This is an unofficial community project. The release pipeline is designed around "fixed upstream at build time, directly usable at install time." Before publishing artifacts containing the converted Codex runtime binary, confirm the relevant redistribution risks separately.
