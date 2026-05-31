# linux-codex-app

把 Codex App 打包成 Fedora 44 KDE 上可直接安装的 RPM。

这个项目会在发布阶段下载固定版本的上游 `Codex.dmg`，校验 hash，转换成 Linux Electron runtime，应用 Linux patch，并把最终 runtime 和固定版本 Codex CLI 一起打进 RPM。用户安装 RPM 时不需要提供 DMG，也不会在安装阶段 patch、编译或联网下载上游 App。

当前目标平台：

- Fedora 44 KDE x86_64
- Codex App `26.527.31326`
- Electron `42.1.0`
- Codex CLI `0.135.0`

## Fedora 44 KDE 安装

导入 DNF 仓库：

```bash
sudo curl -fsSL -o /etc/yum.repos.d/linux-codex-app.repo \
  https://kkkzbh.github.io/linux-codex-app/linux-codex-app.repo
```

导入仓库后，DNF 会校验 RPM 签名和仓库元数据签名。

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

## 可选插件

Dolphin 文件管理器插件：

```bash
sudo dnf install linux-codex-app-plugin-dolphin
```

Kitty 终端插件：

```bash
sudo dnf install linux-codex-app-plugin-kitty
```

安装插件包后，在 Codex 的 Plugins UI 中添加本地 marketplace：

- Dolphin: `/usr/share/linux-codex-app-plugin-dolphin`
- Kitty: `/usr/share/linux-codex-app-plugin-kitty`

Dolphin/Kitty 的窗口访问集成默认不启用。需要时显式开启：

```bash
linux-codex-app enable dolphin-window-access
linux-codex-app enable kitty-window-access
```

关闭用户级 wrapper/desktop override：

```bash
linux-codex-app disable dolphin-window-access
linux-codex-app disable kitty-window-access
```

## 直接安装 RPM

如果不想导入仓库，也可以从 GitHub Releases 下载对应版本 RPM 后安装：

```bash
sudo dnf install ./linux-codex-app-0.1.1-1.codex26_527_31326.fc44.x86_64.rpm
```

## 说明

这是非官方社区项目。仓库中的 RPM 发布链路按“构建阶段固定上游、安装阶段直接可用”设计。公开发布包含转换后 Codex runtime 的二进制 RPM 前，需要单独确认相关再分发风险。
