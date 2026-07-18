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

function findThemeDirs(themeName) {
  const dirs = [];

  for (const root of [
    process.env.HOME ? path.join(process.env.HOME, ".local", "share", "icons") : null,
    "/usr/local/share/icons",
    "/usr/share/icons",
  ].filter(Boolean)) {
    const candidate = path.join(root, themeName);

    if (existsSync(candidate)) {
      dirs.push(candidate);
    }
  }

  return dirs;
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
    "scalable/apps",
    "64x64/apps",
    "48x48/apps",
    "32x32/apps",
    "24x24/apps",
    "22x22/apps",
    "16x16/apps",
    "symbolic/apps",
    "mimes/scalable",
    "mimes/64",
    "mimes/48",
    "mimes/32",
    "mimes/24",
    "mimes/22",
    "mimes/16",
    "mimes/symbolic",
    "scalable/mimes",
    "64x64/mimes",
    "48x48/mimes",
    "32x32/mimes",
    "24x24/mimes",
    "22x22/mimes",
    "16x16/mimes",
    "symbolic/mimes",
    "mimetypes/scalable",
    "mimetypes/64",
    "mimetypes/48",
    "mimetypes/32",
    "mimetypes/24",
    "mimetypes/22",
    "mimetypes/16",
    "mimetypes/symbolic",
    "scalable/mimetypes",
    "64x64/mimetypes",
    "48x48/mimetypes",
    "32x32/mimetypes",
    "24x24/mimetypes",
    "22x22/mimetypes",
    "16x16/mimetypes",
    "symbolic/mimetypes",
    "places/scalable",
    "places/64",
    "places/48",
    "places/32",
    "places/24",
    "places/22",
    "places/16",
    "places/symbolic",
    "scalable/places",
    "64x64/places",
    "48x48/places",
    "32x32/places",
    "24x24/places",
    "22x22/places",
    "16x16/places",
    "symbolic/places",
  ];

  for (const iconName of iconNames) {
    for (const subdir of candidateSubdirs) {
      // Open-target icons are consumed by Electron native menus; keep this
      // resolver on raster PNG assets because nativeImage drops SVG data URLs.
      for (const extension of [".png"]) {
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

    const themeDirs = findThemeDirs(variant);

    if (themeDirs.length === 0) {
      continue;
    }

    for (const themeDir of themeDirs) {
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
  }

  return null;
}

function findPixmapIcon(iconNames) {
  for (const root of [
    process.env.HOME ? path.join(process.env.HOME, ".local", "share", "pixmaps") : null,
    "/usr/local/share/pixmaps",
    "/usr/share/pixmaps",
  ].filter(Boolean)) {
    for (const iconName of iconNames) {
      const candidate = path.join(root, `${iconName}.png`);

      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function findCommandAdjacentPng(commandPath) {
  if (!commandPath || !path.isAbsolute(commandPath)) {
    return null;
  }

  const commandIcon = path.join(path.dirname(commandPath), `${path.basename(commandPath)}.png`);
  return existsSync(commandIcon) ? commandIcon : null;
}

function encodeIconAsDataUrl(iconPath) {
  if (!iconPath || !existsSync(iconPath)) {
    return null;
  }

  const extension = path.extname(iconPath).toLowerCase();
  if (extension !== ".png") {
    return null;
  }

  return `data:image/png;base64,${readFileSync(iconPath).toString("base64")}`;
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
        displayName: readIniSectionValue(filePath, "Desktop Entry", "Name") ?? "",
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

function getLinuxDesktopEntryById(desktopId) {
  const normalizedDesktopId = desktopId.trim().toLowerCase();
  return getLinuxDesktopEntries().find((entry) => entry.fileName === normalizedDesktopId) ?? null;
}

function resolveDesktopIcon(iconValue, extraFallbackIconNames = [], commandPath = null) {
  const commandAdjacentIcon = findCommandAdjacentPng(commandPath);

  if (iconValue && path.isAbsolute(iconValue)) {
    return encodeIconAsDataUrl(iconValue) ?? encodeIconAsDataUrl(commandAdjacentIcon);
  }

  const iconNames = [iconValue, ...extraFallbackIconNames].filter(Boolean);
  const themeName = getKdeIconThemeName();
  const resolvedIcon =
    (themeName ? resolveThemeIcon(themeName, iconNames) : null) ??
    resolveThemeIcon("hicolor", iconNames) ??
    resolveThemeIcon("breeze", iconNames) ??
    resolveThemeIcon("breeze-dark", iconNames) ??
    findPixmapIcon(iconNames) ??
    commandAdjacentIcon;

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
        displayName: entry.displayName,
        iconDataUrl: resolveDesktopIcon(entry.iconValue, iconNames, execCommand),
      };
    }
  }

  return {
    command: bestMatch?.command ?? null,
    iconDataUrl: bestMatch?.iconDataUrl ?? null,
    label: bestMatch?.displayName ?? null,
  };
}

function getMimeAppsListPaths() {
  const homeDir = process.env.HOME;
  const configHome = process.env.XDG_CONFIG_HOME ?? (homeDir ? path.join(homeDir, ".config") : null);
  const configDirs = (process.env.XDG_CONFIG_DIRS ?? "/etc/xdg").split(":").filter(Boolean);
  const dataHome = process.env.XDG_DATA_HOME ?? (homeDir ? path.join(homeDir, ".local", "share") : null);
  const dataDirs = (process.env.XDG_DATA_DIRS ?? "/usr/local/share:/usr/share").split(":").filter(Boolean);

  return [
    configHome ? path.join(configHome, "mimeapps.list") : null,
    ...configDirs.map((dir) => path.join(dir, "mimeapps.list")),
    dataHome ? path.join(dataHome, "applications", "mimeapps.list") : null,
    ...dataDirs.map((dir) => path.join(dir, "applications", "mimeapps.list")),
  ].filter(Boolean);
}

function getDefaultDesktopIdForMimeType(mimeType) {
  for (const mimeAppsListPath of getMimeAppsListPaths()) {
    const value = readIniSectionValue(mimeAppsListPath, "Default Applications", mimeType);

    if (!value) {
      continue;
    }

    const desktopId = value
      .split(";")
      .map((entry) => entry.trim())
      .find(Boolean);

    if (desktopId) {
      return desktopId;
    }
  }

  return null;
}

const DEFAULT_APP_EXTENSION_MIME_TYPES = {
  c: ["text/x-csrc", "text/plain"],
  cc: ["text/x-c++src", "text/plain"],
  cpp: ["text/x-c++src", "text/plain"],
  csv: ["text/csv"],
  doc: ["application/msword", "application/wps-office.doc"],
  docm: ["application/vnd.ms-word.document.macroEnabled.12"],
  docx: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/wps-office.docx",
  ],
  dot: ["application/msword-template", "application/wps-office.dot"],
  dotm: ["application/vnd.ms-word.template.macroEnabled.12"],
  dotx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.template"],
  h: ["text/x-chdr", "text/plain"],
  hpp: ["text/x-c++hdr", "text/plain"],
  html: ["text/html"],
  jpeg: ["image/jpeg"],
  jpg: ["image/jpeg"],
  js: ["application/javascript", "text/javascript", "text/plain"],
  json: ["application/json", "text/plain"],
  md: ["text/markdown", "text/x-markdown", "text/plain"],
  odp: ["application/vnd.oasis.opendocument.presentation"],
  ods: ["application/vnd.oasis.opendocument.spreadsheet"],
  odt: ["application/vnd.oasis.opendocument.text"],
  pdf: ["application/pdf"],
  png: ["image/png"],
  pot: ["application/vnd.ms-powerpoint", "application/wps-office.pot"],
  potm: ["application/vnd.ms-powerpoint.template.macroEnabled.12"],
  potx: ["application/vnd.openxmlformats-officedocument.presentationml.template"],
  pps: ["application/vnd.ms-powerpoint"],
  ppsm: ["application/vnd.ms-powerpoint.slideshow.macroEnabled.12"],
  ppsx: ["application/vnd.openxmlformats-officedocument.presentationml.slideshow"],
  ppt: ["application/vnd.ms-powerpoint", "application/wps-office.ppt"],
  pptm: ["application/vnd.ms-powerpoint.presentation.macroEnabled.12"],
  pptx: [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/wps-office.pptx",
  ],
  py: ["text/x-python", "text/plain"],
  rtf: ["application/rtf", "text/rtf"],
  svg: ["image/svg+xml"],
  ts: ["video/mp2t", "text/plain"],
  txt: ["text/plain"],
  wps: ["application/wps-office.wps"],
  wpt: ["application/wps-office.wpt"],
  xls: ["application/vnd.ms-excel", "application/wps-office.xls"],
  xlsb: ["application/vnd.ms-excel.sheet.binary.macroEnabled.12"],
  xlsm: ["application/vnd.ms-excel.sheet.macroEnabled.12"],
  xlsx: [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/wps-office.xlsx",
  ],
  xlt: ["application/vnd.ms-excel", "application/wps-office.xlt"],
  xltm: ["application/vnd.ms-excel.template.macroEnabled.12"],
  xltx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.template"],
  yaml: ["application/x-yaml", "text/yaml", "text/plain"],
  yml: ["application/x-yaml", "text/yaml", "text/plain"],
};

function getLinuxDefaultAppIconByExtension() {
  const iconByExtension = {};

  for (const [extension, mimeTypes] of Object.entries(DEFAULT_APP_EXTENSION_MIME_TYPES)) {
    for (const mimeType of mimeTypes) {
      const desktopId = getDefaultDesktopIdForMimeType(mimeType);

      if (!desktopId) {
        continue;
      }

      const entry = getLinuxDesktopEntryById(desktopId);
      const iconDataUrl = entry
        ? resolveDesktopIcon(entry.iconValue, [], parseDesktopExecCommand(entry.execValue))
        : null;

      if (iconDataUrl) {
        iconByExtension[extension] = iconDataUrl;
        break;
      }
    }
  }

  return iconByExtension;
}

function commandInHomeLocalBin(commandName) {
  const homeDir = process.env.HOME;

  if (!homeDir) {
    return null;
  }

  const commandPath = path.join(homeDir, ".local", "bin", commandName);
  return existsSync(commandPath) ? commandPath : null;
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

function getWpsAsset() {
  const writer = getLinuxDesktopAppInfo({
    fileNameHints: ["wps-office-wps"],
    nameHints: ["wps writer", "wps"],
    startupWmClasses: ["wps"],
    execNames: ["wps"],
    iconNames: ["wps-office2023-wpsmain", "wps-office-wps", "wps"],
  });
  const spreadsheet = getLinuxDesktopAppInfo({
    fileNameHints: ["wps-office-et"],
    nameHints: ["wps spreadsheets", "wps"],
    startupWmClasses: ["et"],
    execNames: ["et"],
    iconNames: ["wps-office2023-etmain", "wps-office-et", "et"],
  });
  const presentation = getLinuxDesktopAppInfo({
    fileNameHints: ["wps-office-wpp"],
    nameHints: ["wps presentation", "wps"],
    startupWmClasses: ["wpp"],
    execNames: ["wpp"],
    iconNames: ["wps-office2023-wppmain", "wps-office-wpp", "wpp"],
  });
  const pdf = getLinuxDesktopAppInfo({
    fileNameHints: ["wps-office-pdf"],
    nameHints: ["wps pdf"],
    startupWmClasses: ["wpspdf"],
    execNames: ["wpspdf"],
    iconNames: ["wps-office2023-pdfmain", "wps-office-pdf", "wpspdf"],
  });
  const suiteIcon =
    resolveDesktopIcon("wps-office2023-kprometheus", [
      "wps-office-kingsoft",
      "wps-office2023-wpsmain",
      "wps-office-wps",
      "wps",
    ]) ??
    writer.iconDataUrl ??
    spreadsheet.iconDataUrl ??
    presentation.iconDataUrl ??
    pdf.iconDataUrl;

  return {
    iconDataUrl: suiteIcon,
    commands: {
      word: writer.command,
      spreadsheet: spreadsheet.command,
      presentation: presentation.command,
      pdf: pdf.command,
    },
  };
}

function getOfficeRemoteAppAsset() {
  const info = getLinuxDesktopAppInfo({
    fileNameHints: ["office-remoteapp-bridge"],
    nameHints: ["office remoteapp"],
    startupWmClasses: ["office-remoteapp-bridge"],
    execNames: ["office-remoteapp-bridge"],
    iconNames: ["office-remoteapp-suite", "office-remoteapp-word", "x-office-document"],
  });

  return {
    command: commandInHomeLocalBin("office-remoteapp-bridge"),
    iconDataUrl:
      resolveDesktopIcon("office-remoteapp-suite", [
        "office-remoteapp-word",
        "x-office-document",
      ]) ?? info.iconDataUrl,
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

function emptyLinuxOpenTargetAssets() {
  return {
    ...emptyLinuxVisibleTargetAssets(),
    defaultAppIconByExtension: {},
    gwenview: { command: null, iconDataUrl: null },
    typora: { command: null, iconDataUrl: null },
    wps: {
      iconDataUrl: null,
      commands: { word: null, spreadsheet: null, presentation: null, pdf: null },
    },
    officeRemoteApp: { command: null, iconDataUrl: null },
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

let openTargetAssetsCache = null;

export function getLinuxOpenTargetAssets() {
  if (openTargetAssetsCache) {
    return openTargetAssetsCache;
  }

  if (process.env.CODEX_LINUX_DESKTOP_ASSETS === "0") {
    openTargetAssetsCache = emptyLinuxOpenTargetAssets();
    return openTargetAssetsCache;
  }

  openTargetAssetsCache = {
    ...getLinuxVisibleTargetAssets(),
    defaultAppIconByExtension: getLinuxDefaultAppIconByExtension(),
    gwenview: getLinuxDesktopAppInfo({
      fileNameHints: ["org.kde.gwenview", "gwenview"],
      nameHints: ["gwenview"],
      startupWmClasses: ["gwenview"],
      execNames: ["gwenview"],
      iconNames: ["org.kde.gwenview", "gwenview"],
    }),
    typora: getLinuxDesktopAppInfo({
      fileNameHints: ["typora"],
      nameHints: ["typora"],
      startupWmClasses: ["typora"],
      execNames: ["typora", "typora-x11-fcitx"],
      iconNames: ["typora"],
    }),
    wps: getWpsAsset(),
    officeRemoteApp: getOfficeRemoteAppAsset(),
  };

  return openTargetAssetsCache;
}
