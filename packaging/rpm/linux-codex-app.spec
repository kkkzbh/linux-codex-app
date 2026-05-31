%global app_version %{?linux_codex_app_version}%{!?linux_codex_app_version:0.1.0}
%global app_release %{?linux_codex_app_release}%{!?linux_codex_app_release:1}
%global manifest_id %{?linux_codex_app_manifest_id}%{!?linux_codex_app_manifest_id:unknown}
%global debug_package %{nil}
%global __os_install_post %{nil}
%global __requires_exclude_from ^/opt/linux-codex-app/.*$
%global __provides_exclude_from ^/opt/linux-codex-app/.*$

Name:           linux-codex-app
Version:        %{app_version}
Release:        %{app_release}%{?dist}
Summary:        OpenAI Codex Desktop converted runtime for Linux
License:        MIT
URL:            https://github.com/kkkzbh/linux-codex-app
Source0:        linux-codex-app-%{version}-payload.tar.gz

Requires:       bash
Requires:       at-spi2-atk
Requires:       at-spi2-core
Requires:       alsa-lib
Requires:       cairo
Requires:       cups-libs
Requires:       dbus-libs
Requires:       desktop-file-utils
Requires:       expat
Requires:       glib2
Requires:       gtk3
Requires:       libX11
Requires:       libXcomposite
Requires:       libXdamage
Requires:       libXext
Requires:       libXfixes
Requires:       libXrandr
Requires:       libxcb
Requires:       libxkbcommon
Requires:       mesa-libgbm
Requires:       nodejs
Requires:       nspr
Requires:       nss
Requires:       npm
Requires:       pango
Requires:       systemd-libs

%description
Unofficial Linux runtime package for Codex Desktop. The RPM contains a runtime
converted from a pinned upstream Codex Desktop build by the linux-codex-app
release pipeline.

%package plugin-dolphin
Summary:        Optional KDE Dolphin plugin assets for linux-codex-app
Requires:       %{name}%{?_isa} = %{version}-%{release}
Requires:       nodejs
Requires:       python3

%description plugin-dolphin
Optional Dolphin plugin assets and helper scripts for linux-codex-app.
Window-access integration is opt-in through linux-codex-app enable.

%package plugin-kitty
Summary:        Optional kitty terminal plugin assets for linux-codex-app
Requires:       %{name}%{?_isa} = %{version}-%{release}
Requires:       nodejs

%description plugin-kitty
Optional kitty terminal plugin assets and helper scripts for linux-codex-app.
Window-access integration is opt-in through linux-codex-app enable.

%package repo
Summary:        DNF repository file for linux-codex-app
Requires:       dnf

%description repo
Optional DNF repository configuration for linux-codex-app. The repository
metadata retains historical RPM versions unless a release is explicitly yanked.

%prep
%setup -q -c -T
tar -xzf %{SOURCE0}

%build

%install
mkdir -p %{buildroot}
cp -a . %{buildroot}/

%post
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database /usr/share/applications >/dev/null 2>&1
fi

%postun
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database /usr/share/applications >/dev/null 2>&1
fi

%files
/opt/linux-codex-app
/usr/bin/codex-app
/usr/bin/linux-codex-app
/usr/libexec/linux-codex-app
/usr/share/applications/codex-app.desktop
%dir /usr/share/linux-codex-app
/usr/share/linux-codex-app/upstream.json
%dir /usr/share/linux-codex-app/plugins
%exclude /usr/share/linux-codex-app/plugins/dolphin
%exclude /usr/share/linux-codex-app/plugins/kitty
%exclude /etc/yum.repos.d/linux-codex-app.repo

%files plugin-dolphin
/usr/share/linux-codex-app/plugins/dolphin
/usr/share/linux-codex-app-plugin-dolphin

%files plugin-kitty
/usr/share/linux-codex-app/plugins/kitty
/usr/share/linux-codex-app-plugin-kitty

%files repo
%config(noreplace) /etc/yum.repos.d/linux-codex-app.repo
/etc/pki/rpm-gpg/RPM-GPG-KEY-linux-codex-app

%changelog
* Thu May 28 2026 linux-codex-app maintainers <noreply@example.com> - %{app_version}-%{app_release}
- Build from pinned upstream manifest %{manifest_id}.
