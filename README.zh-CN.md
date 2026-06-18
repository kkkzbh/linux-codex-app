# linux-codex-app

[English](README.md) | 简体中文

把 Codex App 打包成 Linux 上可直接安装或运行的发行产物。

这个项目会在发布阶段下载固定版本的上游 `Codex.dmg`，校验 hash，转换成 Linux Electron runtime，应用 Linux patch，并把最终 runtime 和固定版本 Codex CLI 一起打包。用户安装或运行发布产物时不需要提供 DMG，也不会在安装阶段 patch、编译或联网下载上游 App。

当前目标平台：

- Fedora 44 KDE x86_64 是 RPM/DNF 仓库的主要验证目标
- Codex App `26.608.12217`
- Electron `42.1.0`
- Codex CLI `0.139.0`

发布产物：

- RPM：Fedora/DNF 仓库和直接安装
- DEB：Debian/Ubuntu 系发行版直接安装
- AppImage：免安装运行
- tar.gz：portable root payload，适合手工安装、检查或二次打包
- pkg.tar.zst：Arch/pacman 直接安装包

## Fedora 44 KDE：DNF 仓库安装

导入 DNF 仓库：

```bash
sudo curl -fsSL -o /etc/yum.repos.d/linux-codex-app.repo \
  https://kkkzbh.github.io/linux-codex-app/linux-codex-app.repo
```

导入仓库后，DNF 会校验 RPM 签名和仓库元数据签名。当前仓库签名 key fingerprint 是：

```text
6096 D6A7 1F4A 86D6 775C  7E2E FB1A DAA3 9B0B FF25
```

安装并启动：

```bash
sudo dnf install linux-codex-app
codex-app
```

检查安装状态：

```bash
linux-codex-app status
linux-codex-app verify
```

以后有新 RPM 发布后，系统更新会通过 DNF 仓库处理：

```bash
sudo dnf upgrade linux-codex-app
```

如果之前导入过旧版仓库 key，遇到签名校验失败时，重新下载 repo 文件即可让 DNF 使用当前 GitHub Pages 上的新公钥。

## 可选插件

Dolphin 文件管理器插件：

```bash
sudo dnf install linux-codex-app-plugin-dolphin
```

Kitty 终端插件：

```bash
sudo dnf install linux-codex-app-plugin-kitty
```

Computer Use KDE 桌面控制插件：

```bash
sudo dnf install linux-codex-app-plugin-computer-use
```

安装插件包后，在 Codex 的 Plugins UI 中添加本地 marketplace：

- Dolphin: `/usr/share/linux-codex-app-plugin-dolphin`
- Kitty: `/usr/share/linux-codex-app-plugin-kitty`
- Computer Use: `/usr/share/linux-codex-app-plugin-computer-use`

Dolphin/Kitty/Computer Use 的窗口访问集成默认不启用。需要时显式开启：

```bash
linux-codex-app enable dolphin-window-access
linux-codex-app enable kitty-window-access
linux-codex-app enable computer-use-access
```

关闭 Dolphin/Kitty 的用户级 wrapper/desktop override：

```bash
linux-codex-app disable dolphin-window-access
linux-codex-app disable kitty-window-access
```

## GitHub Release 直接下载

当前版本：

```bash
VERSION=v0.1.2-20260612.codex26.608.12217
BASE=https://github.com/kkkzbh/linux-codex-app/releases/download/$VERSION
```

下载校验文件：

```bash
curl -LO "$BASE/SHA256SUMS"
```

### Fedora/RPM

如果不想导入 DNF 仓库，也可以直接下载 RPM 后安装：

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

tar.gz 是以 `/` 为根的 portable payload。手工安装时解到目标根目录，或解包检查其中的 `/opt/linux-codex-app`、`/usr/bin/codex-app` 和 desktop metadata。

## 发布

正式发布以 Fedora 44 KDE 本机为主路径：

```bash
npm run release:local
```

这个命令会本机构建 RPM、DEB、AppImage、tar.gz、pacman 包和 `SHA256SUMS`，然后上传到 GitHub Release。GitHub Actions 只保留 Fedora 容器 smoke，用来验证脚本和无签名构建，不作为正式发布源。

## 说明

这是非官方社区项目。仓库中的发布链路按“构建阶段固定上游、安装阶段直接可用”设计。公开发布包含转换后 Codex runtime 的二进制产物前，需要单独确认相关再分发风险。
