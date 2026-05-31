import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

function readIniSectionValue(filePath, sectionName, keyName) {
  if (!existsSync(filePath)) {
    return null;
  }

  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  let inSection = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inSection = trimmed === `[${sectionName}]`;
      continue;
    }

    if (!inSection || trimmed.startsWith("#") || trimmed.startsWith(";")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    if (trimmed.slice(0, separatorIndex).trim() !== keyName) {
      continue;
    }

    const value = trimmed.slice(separatorIndex + 1).trim();
    return value.length > 0 ? value : null;
  }

  return null;
}

function getKdeIconThemeName() {
  const homeDir = process.env.HOME;

  if (!homeDir) {
    return null;
  }

  for (const candidate of [
    path.join(homeDir, ".config", "kdeglobals"),
    path.join(homeDir, ".config", "kdedefaults", "kdeglobals"),
  ]) {
    const theme = readIniSectionValue(candidate, "Icons", "Theme");

    if (theme) {
      return theme;
    }
  }

  return null;
}

function findThemeDir(themeName) {
  for (const root of [
    process.env.HOME ? path.join(process.env.HOME, ".local", "share", "icons") : null,
    "/usr/local/share/icons",
    "/usr/share/icons",
  ].filter(Boolean)) {
    const candidate = path.join(root, themeName);

    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function getThemeNameVariants(themeName) {
  return [
    ...new Set([
      themeName,
      themeName.replace(/-(light|dark)$/i, ""),
      themeName.replace(/([._-])(light|dark)$/i, ""),
    ]),
  ]
    .map((value) => value.trim())
    .filter(Boolean);
}

function getThemeInherits(themeDir) {
  const inherits = readIniSectionValue(path.join(themeDir, "index.theme"), "Icon Theme", "Inherits");

  return inherits
    ? inherits
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
}

function findIconInThemeDir(themeDir, iconNames) {
  const candidateSubdirs = [
    "apps/scalable",
    "apps/64",
    "apps/48",
    "apps/32",
    "apps/24",
    "apps/22",
    "apps/16",
    "apps/symbolic",
    "places/scalable",
    "places/64",
    "places/48",
    "places/32",
    "places/24",
    "places/22",
    "places/16",
    "places/symbolic",
  ];

  for (const iconName of iconNames) {
    for (const subdir of candidateSubdirs) {
      for (const extension of [".svg", ".png", ".svgz", ".xpm"]) {
        const candidate = path.join(themeDir, subdir, `${iconName}${extension}`);

        if (existsSync(candidate)) {
          return candidate;
        }
      }
    }
  }

  return null;
}

function resolveThemeIcon(themeName, iconNames, visitedThemes = new Set()) {
  for (const variant of getThemeNameVariants(themeName)) {
    if (visitedThemes.has(variant)) {
      continue;
    }

    visitedThemes.add(variant);

    const themeDir = findThemeDir(variant);

    if (!themeDir) {
      continue;
    }

    const directIcon = findIconInThemeDir(themeDir, iconNames);

    if (directIcon) {
      return directIcon;
    }

    for (const inheritedTheme of getThemeInherits(themeDir)) {
      const inheritedIcon = resolveThemeIcon(inheritedTheme, iconNames, visitedThemes);

      if (inheritedIcon) {
        return inheritedIcon;
      }
    }
  }

  return null;
}

function encodeIconAsDataUrl(iconPath) {
  if (!iconPath || !existsSync(iconPath)) {
    return null;
  }

  const extension = path.extname(iconPath).toLowerCase();
  const mimeType =
    extension === ".png"
      ? "image/png"
      : extension === ".svg" || extension === ".svgz"
        ? "image/svg+xml"
        : extension === ".xpm"
          ? "image/x-xpixmap"
          : "application/octet-stream";

  return `data:${mimeType};base64,${readFileSync(iconPath).toString("base64")}`;
}

function parseDesktopExecCommand(execValue) {
  if (!execValue) {
    return null;
  }

  const trimmed = execValue.trim();

  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.startsWith('"')) {
    const closingQuoteIndex = trimmed.indexOf('"', 1);

    if (closingQuoteIndex > 1) {
      return trimmed.slice(1, closingQuoteIndex);
    }
  }

  const [command] = trimmed.split(/\s+/, 1);
  return command || null;
}

function getLinuxDesktopEntryDirs() {
  return [
    process.env.HOME ? path.join(process.env.HOME, ".local", "share", "applications") : null,
    "/usr/local/share/applications",
    "/usr/share/applications",
  ].filter(Boolean);
}

let linuxDesktopEntriesCache = null;

function getLinuxDesktopEntries() {
  if (linuxDesktopEntriesCache) {
    return linuxDesktopEntriesCache;
  }

  const entries = [];

  for (const dir of getLinuxDesktopEntryDirs()) {
    if (!existsSync(dir)) {
      continue;
    }

    let fileNames;

    try {
      fileNames = readdirSync(dir);
    } catch {
      continue;
    }

    for (const fileName of fileNames) {
      if (!fileName.endsWith(".desktop")) {
        continue;
      }

      const filePath = path.join(dir, fileName);
      const execValue = readIniSectionValue(filePath, "Desktop Entry", "Exec");

      if (!execValue) {
        continue;
      }

      entries.push({
        fileName: fileName.toLowerCase(),
        name: readIniSectionValue(filePath, "Desktop Entry", "Name")?.toLowerCase() ?? "",
        execValue,
        iconValue: readIniSectionValue(filePath, "Desktop Entry", "Icon"),
        startupWmClass:
          readIniSectionValue(filePath, "Desktop Entry", "StartupWMClass")?.toLowerCase() ?? "",
      });
    }
  }

  linuxDesktopEntriesCache = entries;
  return entries;
}

function resolveDesktopIcon(iconValue, extraFallbackIconNames = []) {
  if (!iconValue) {
    return null;
  }

  if (path.isAbsolute(iconValue)) {
    return encodeIconAsDataUrl(iconValue);
  }

  const iconNames = [iconValue, ...extraFallbackIconNames];
  const themeName = getKdeIconThemeName();
  const resolvedIcon =
    (themeName ? resolveThemeIcon(themeName, iconNames) : null) ??
    resolveThemeIcon("hicolor", iconNames) ??
    resolveThemeIcon("breeze", iconNames) ??
    resolveThemeIcon("breeze-dark", iconNames);

  return resolvedIcon ? encodeIconAsDataUrl(resolvedIcon) : null;
}

function getLinuxDesktopAppInfo({
  fileNameHints,
  nameHints,
  startupWmClasses,
  execNames,
  iconNames = [],
}) {
  let bestMatch = null;

  for (const entry of getLinuxDesktopEntries()) {
    const execCommand = parseDesktopExecCommand(entry.execValue);
    const execBaseName = execCommand ? path.basename(execCommand).toLowerCase() : "";
    let score = 0;

    if (startupWmClasses.some((value) => value === entry.startupWmClass)) {
      score += 100;
    }

    if (fileNameHints.some((value) => entry.fileName.includes(value))) {
      score += 40;
    }

    if (nameHints.some((value) => entry.name.includes(value))) {
      score += 20;
    }

    if (execNames.some((value) => execBaseName === value)) {
      score += 10;
    }

    if (score === 0) {
      continue;
    }

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = {
        score,
        command: execCommand,
        iconDataUrl: resolveDesktopIcon(entry.iconValue, iconNames),
      };
    }
  }

  return {
    command: bestMatch?.command ?? null,
    iconDataUrl: bestMatch?.iconDataUrl ?? null,
  };
}

function getDolphinAsset() {
  const info = getLinuxDesktopAppInfo({
    fileNameHints: ["org.kde.dolphin", "dolphin"],
    nameHints: ["dolphin"],
    startupWmClasses: ["dolphin"],
    execNames: ["dolphin"],
    iconNames: ["org.kde.dolphin", "dolphin", "system-file-manager"],
  });

  if (info.iconDataUrl) {
    return info;
  }

  return {
    ...info,
    iconDataUrl:
      resolveDesktopIcon("org.kde.dolphin", ["dolphin", "system-file-manager"]) ??
      resolveDesktopIcon("dolphin", ["org.kde.dolphin", "system-file-manager"]) ??
      resolveDesktopIcon("system-file-manager", ["org.kde.dolphin", "dolphin"]),
  };
}

let visibleTargetAssetsCache = null;

function emptyLinuxVisibleTargetAssets() {
  return {
    dolphin: { command: null, iconDataUrl: null },
    vscode: { command: null, iconDataUrl: null },
    pycharm: { command: null, iconDataUrl: null },
    webstorm: { command: null, iconDataUrl: null },
    clion: { command: null, iconDataUrl: null },
  };
}

export function getLinuxVisibleTargetAssets() {
  if (visibleTargetAssetsCache) {
    return visibleTargetAssetsCache;
  }

  if (process.env.CODEX_LINUX_DESKTOP_ASSETS === "0") {
    visibleTargetAssetsCache = emptyLinuxVisibleTargetAssets();
    return visibleTargetAssetsCache;
  }

  visibleTargetAssetsCache = {
    dolphin: getDolphinAsset(),
    vscode: getLinuxDesktopAppInfo({
      fileNameHints: ["visual-studio-code", "code.desktop", "vscode", "codium"],
      nameHints: ["visual studio code", "vs code", "vscodium"],
      startupWmClasses: ["code", "code - oss", "vscode", "codium"],
      execNames: ["code", "code-insiders", "codium"],
      iconNames: ["visual-studio-code", "code", "vscode", "codium"],
    }),
    pycharm: getLinuxDesktopAppInfo({
      fileNameHints: ["jetbrains-pycharm"],
      nameHints: ["pycharm"],
      startupWmClasses: ["jetbrains-pycharm"],
      execNames: ["pycharm"],
      iconNames: ["pycharm", "jetbrains-pycharm"],
    }),
    webstorm: getLinuxDesktopAppInfo({
      fileNameHints: ["jetbrains-webstorm"],
      nameHints: ["webstorm"],
      startupWmClasses: ["jetbrains-webstorm"],
      execNames: ["webstorm"],
      iconNames: ["webstorm", "jetbrains-webstorm"],
    }),
    clion: getLinuxDesktopAppInfo({
      fileNameHints: ["jetbrains-clion"],
      nameHints: ["clion"],
      startupWmClasses: ["jetbrains-clion"],
      execNames: ["clion"],
      iconNames: ["clion", "jetbrains-clion"],
    }),
  };

  return visibleTargetAssetsCache;
}
