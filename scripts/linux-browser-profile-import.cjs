const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { DatabaseSync, backup } = require("node:sqlite");
const {
  createOnePasswordBrowserProvider,
} = require("./codex-linux-onepassword-browser-provider.cjs");

const PROFILE_DIRECTORY_PATTERN = /^(?:Default|Profile \d+)$/;
const DEVTOOLS_TIMEOUT_MS = 15_000;
const CHROME_SHUTDOWN_TIMEOUT_MS = 5_000;
const IMPORTED_SESSION_COOKIE_RETENTION_SECONDS = 400 * 24 * 60 * 60;
const COOKIE_DATABASE_PATHS = ["Network/Cookies", "Cookies"];
const PROFILE_METADATA_FILES = ["Preferences", "Secure Preferences"];

function executableOnPath(command) {
  if (command.includes(path.sep)) {
    return fs.existsSync(command) ? command : null;
  }
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
}

function chromeInstallations() {
  const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  const configuredRoot = process.env.CODEX_CHROME_USER_DATA_DIR?.trim();
  const configuredBinary = process.env.CODEX_CHROME_BIN?.trim();
  const definitions = configuredRoot
    ? [{ appName: "Google Chrome", commands: [configuredBinary], rootPath: configuredRoot }]
    : [
        {
          appName: "Google Chrome",
          commands: [configuredBinary, "google-chrome", "google-chrome-stable"],
          rootPath: path.join(configHome, "google-chrome"),
        },
        {
          appName: "Google Chrome Beta",
          commands: [configuredBinary, "google-chrome-beta"],
          rootPath: path.join(configHome, "google-chrome-beta"),
        },
        {
          appName: "Chromium",
          commands: [configuredBinary, "chromium", "chromium-browser"],
          rootPath: path.join(configHome, "chromium"),
        },
      ];

  return definitions
    .map((definition) => ({
      ...definition,
      command: definition.commands.filter(Boolean).map(executableOnPath).find(Boolean) ?? null,
      rootPath: path.resolve(definition.rootPath),
    }))
    .filter(({ command, rootPath }) => command != null && fs.existsSync(rootPath));
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

function profileHasCookies(profilePath) {
  return COOKIE_DATABASE_PATHS.some((relativePath) =>
    fs.existsSync(path.join(profilePath, relativePath)),
  );
}

function listProfilesForInstallation(installation) {
  const localState = readJson(path.join(installation.rootPath, "Local State"));
  const infoCache = localState?.profile?.info_cache ?? {};
  return fs
    .readdirSync(installation.rootPath, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && PROFILE_DIRECTORY_PATTERN.test(entry.name),
    )
    .map((entry) => {
      const profilePath = path.join(installation.rootPath, entry.name);
      const metadata = infoCache[entry.name] ?? {};
      return {
        source: "chrome",
        appName: installation.appName,
        profileName: String(metadata.name || entry.name),
        profileDirectoryName: entry.name,
        profilePath,
        rootPath: installation.rootPath,
        hasCookies: profileHasCookies(profilePath),
        hasPasswords: false,
        ...(metadata.gaia_name ? { gaiaName: String(metadata.gaia_name) } : {}),
        ...(metadata.user_name ? { userName: String(metadata.user_name) } : {}),
      };
    })
    .filter((profile) => profile.hasCookies);
}

function listChromeProfiles() {
  return chromeInstallations().flatMap(listProfilesForInstallation);
}

async function copyIfPresent(source, destination) {
  try {
    await fsPromises.mkdir(path.dirname(destination), { recursive: true });
    await fsPromises.copyFile(source, destination);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function snapshotCookieDatabase(source, destination) {
  if (!fs.existsSync(source)) return false;
  await fsPromises.mkdir(path.dirname(destination), { recursive: true });
  const database = new DatabaseSync(source, { readOnly: true });
  try {
    await backup(database, destination);
  } finally {
    database.close();
  }
  return true;
}

async function stageProfile(profile, temporaryRoot) {
  await copyIfPresent(
    path.join(profile.rootPath, "Local State"),
    path.join(temporaryRoot, "Local State"),
  );
  for (const relativePath of PROFILE_METADATA_FILES) {
    await copyIfPresent(
      path.join(profile.profilePath, relativePath),
      path.join(temporaryRoot, profile.profileDirectoryName, relativePath),
    );
  }
  let snapshotCount = 0;
  for (const relativePath of COOKIE_DATABASE_PATHS) {
    if (
      await snapshotCookieDatabase(
        path.join(profile.profilePath, relativePath),
        path.join(temporaryRoot, profile.profileDirectoryName, relativePath),
      )
    ) {
      snapshotCount += 1;
    }
  }
  if (snapshotCount === 0) {
    throw new Error("Chrome cookie database is no longer available");
  }
}

function waitForChildExit(child) {
  if (child.exitCode != null || child.signalCode != null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    child.once("exit", resolve);
    child.once("error", reject);
  });
}

async function waitForChildExitUntil(child, timeoutMs) {
  if (child.exitCode != null || child.signalCode != null) return true;
  return await new Promise((resolve, reject) => {
    const onExit = () => {
      clearTimeout(timeout);
      child.off("error", onError);
      resolve(true);
    };
    const onError = (error) => {
      clearTimeout(timeout);
      child.off("exit", onExit);
      reject(error);
    };
    const timeout = setTimeout(() => {
      child.off("exit", onExit);
      child.off("error", onError);
      resolve(false);
    }, timeoutMs);
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

async function stopChromeProcess(child) {
  if (child == null || child.exitCode != null || child.signalCode != null) return;
  child.kill("SIGTERM");
  if (await waitForChildExitUntil(child, CHROME_SHUTDOWN_TIMEOUT_MS)) return;
  child.kill("SIGKILL");
  await waitForChildExit(child);
}

async function waitForDevToolsPort(temporaryRoot, child) {
  const activePortPath = path.join(temporaryRoot, "DevToolsActivePort");
  const deadline = Date.now() + DEVTOOLS_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode != null || child.signalCode != null) {
      throw new Error(
        `Chrome exited before its DevTools endpoint was ready (${child.exitCode ?? child.signalCode})`,
      );
    }
    try {
      const [port] = (await fsPromises.readFile(activePortPath, "utf8")).trim().split(/\r?\n/);
      if (/^\d+$/.test(port)) return Number(port);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for Chrome cookie import endpoint");
}

async function cdpCall(webSocketUrl, method) {
  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const requestId = 1;
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`Timed out calling Chrome DevTools method ${method}`));
    }, DEVTOOLS_TIMEOUT_MS);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ id: requestId, method }));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== requestId) return;
      clearTimeout(timeout);
      socket.close();
      if (message.error) {
        reject(new Error(message.error.message || `Chrome DevTools method ${method} failed`));
      } else {
        resolve(message.result ?? {});
      }
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("Chrome DevTools connection failed during cookie import"));
    });
  });
}

async function readCookiesThroughChrome(profile, installation) {
  const temporaryRoot = await fsPromises.mkdtemp(
    path.join(os.tmpdir(), "codex-chrome-profile-import-"),
  );
  let child = null;
  try {
    await stageProfile(profile, temporaryRoot);
    child = spawn(
      installation.command,
      [
        "--headless=new",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-default-apps",
        "--disable-extensions",
        "--no-first-run",
        "--no-default-browser-check",
        `--user-data-dir=${temporaryRoot}`,
        `--profile-directory=${profile.profileDirectoryName}`,
        "--remote-debugging-port=0",
        "about:blank",
      ],
      { stdio: "ignore" },
    );
    const port = await waitForDevToolsPort(temporaryRoot, child);
    const response = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (!response.ok) throw new Error(`Chrome DevTools discovery failed (${response.status})`);
    const { webSocketDebuggerUrl } = await response.json();
    if (typeof webSocketDebuggerUrl !== "string") {
      throw new Error("Chrome DevTools discovery did not return a WebSocket endpoint");
    }
    const result = await cdpCall(webSocketDebuggerUrl, "Storage.getCookies");
    return Array.isArray(result.cookies) ? result.cookies : [];
  } finally {
    await stopChromeProcess(child);
    await fsPromises.rm(temporaryRoot, { force: true, recursive: true });
  }
}

function normalizedAllowlist(values) {
  if (values == null) return null;
  return values.map((value) => value.trim().toLowerCase().replace(/^\./, ""));
}

function cookieAllowed(cookie, allowlist) {
  if (allowlist == null) return true;
  const domain = String(cookie.domain || "").toLowerCase().replace(/^\./, "");
  return allowlist.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`));
}

function electronSameSite(value) {
  switch (value) {
    case "Strict":
      return "strict";
    case "Lax":
      return "lax";
    case "None":
      return "no_restriction";
    default:
      return "unspecified";
  }
}

function cookieDetails(cookie, nowSeconds = Date.now() / 1000) {
  const domain = String(cookie.domain || "");
  const host = domain.replace(/^\./, "");
  const name = String(cookie.name ?? "");
  if (!host || !name) return null;
  const cookiePath = String(cookie.path || "/");
  const details = {
    url: `${cookie.secure ? "https" : "http"}://${host}${cookiePath}`,
    name,
    value: String(cookie.value ?? ""),
    path: cookiePath,
    secure: cookie.secure === true,
    httpOnly: cookie.httpOnly === true,
    sameSite: electronSameSite(cookie.sameSite),
  };
  if (domain.startsWith(".")) details.domain = domain;
  details.expirationDate =
    Number(cookie.expires) > 0
      ? Number(cookie.expires)
      : Math.floor(nowSeconds) + IMPORTED_SESSION_COOKIE_RETENTION_SECONDS;
  return details;
}

async function writeCookies(electron, targetPartition, cookies, allowlist) {
  const targetCookies = electron.session.fromPartition(targetPartition).cookies;
  let imported = 0;
  let skippedInvalid = 0;
  let failed = 0;
  for (const cookie of cookies) {
    if (!cookieAllowed(cookie, allowlist)) continue;
    const details = cookieDetails(cookie);
    if (details == null) {
      skippedInvalid += 1;
      continue;
    }
    try {
      await targetCookies.set(details);
      imported += 1;
    } catch {
      failed += 1;
    }
  }
  return {
    status: failed > 0 ? (imported > 0 ? "partial-success" : "failed_to_copy") : "success",
    discovered: cookies.length,
    canonicalized: cookies.length - skippedInvalid,
    imported,
    skippedInvalid,
    failed,
  };
}

let sharedOnePasswordProvider = null;

function onePasswordProviderForElectron(electron) {
  if (sharedOnePasswordProvider == null) {
    sharedOnePasswordProvider = createOnePasswordBrowserProvider({ electron });
  }
  return sharedOnePasswordProvider;
}

function createLinuxBrowserProfileImporter({ electron, onePasswordProvider }) {
  if (!electron?.session) throw new Error("Electron session API is required for browser profile import");
  const onePassword = onePasswordProvider ?? onePasswordProviderForElectron(electron);
  return {
    async listImportableProfiles() {
      return [...listChromeProfiles(), ...(await onePassword.listProfiles())];
    },
    async importProfile(request) {
      if (request.source === "onepassword") {
        if (!request.importPasswords) throw new Error("Select passwords to import");
        return {
          source: "onepassword",
          profilePath: request.profilePath,
          passwords: await onePassword.importProfile(request.profilePath),
        };
      }
      if (request.source !== "chrome") throw new Error("Unsupported Linux browser import source");
      if (request.importPasswords) throw new Error("Linux browser import supports cookies only");
      if (!request.importCookies) throw new Error("Select cookies to import");
      const profiles = listChromeProfiles();
      const profile = profiles.find(
        (candidate) => path.resolve(candidate.profilePath) === path.resolve(request.profilePath),
      );
      if (!profile) throw new Error("Browser profile is no longer importable");
      const installation = chromeInstallations().find(
        (candidate) => candidate.rootPath === profile.rootPath,
      );
      if (!installation) throw new Error("Chrome executable is unavailable for the selected profile");
      const cookies = await readCookiesThroughChrome(profile, installation);
      return {
        source: "chrome",
        profilePath: profile.profilePath,
        cookies: await writeCookies(
          electron,
          request.targetPartition,
          cookies,
          normalizedAllowlist(request.cookieDomainAllowlist),
        ),
      };
    },
  };
}

module.exports = {
  cookieDetails,
  createLinuxBrowserProfileImporter,
  IMPORTED_SESSION_COOKIE_RETENTION_SECONDS,
  listChromeProfiles,
  snapshotCookieDatabase,
  stageProfile,
  stopChromeProcess,
};
