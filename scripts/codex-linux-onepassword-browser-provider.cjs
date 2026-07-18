const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const BINDING_STATE_VERSION = 1;
const BINDING_STATE_FILENAME = "onepassword-browser-bindings.json";
const BUILT_IN_BROWSER_PARTITION = "persist:codex-browser-app";
const BUILT_IN_BROWSER_ROUTE_PARTITION_PREFIX = "persist:codex-browser-app-route:";
const OP_REQUEST_TIMEOUT_MS = 120_000;
const OP_OUTPUT_LIMIT_BYTES = 32 * 1024 * 1024;
const LOGIN_FORM_WAIT_MS = 15_000;

class OnePasswordCliUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "OnePasswordCliUnavailableError";
  }
}

function executableOnPath(command) {
  if (!command) return null;
  if (command.includes(path.sep)) {
    try {
      fs.accessSync(command, fs.constants.X_OK);
      return path.resolve(command);
    } catch {
      return null;
    }
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

function resolveOnePasswordCli() {
  const configured = process.env.CODEX_ONEPASSWORD_CLI?.trim();
  return executableOnPath(configured || "op");
}

async function runOpJson(opPath, args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(opPath, args, {
      env: {
        ...process.env,
        OP_BIOMETRIC_UNLOCK_ENABLED: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const rejectRequest = (message) => finish(() => reject(new Error(message)));
    const rejectUnavailable = (message) =>
      finish(() => reject(new OnePasswordCliUnavailableError(message)));
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      rejectUnavailable("1Password authorization timed out");
    }, OP_REQUEST_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > OP_OUTPUT_LIMIT_BYTES) {
        child.kill("SIGTERM");
        rejectRequest("1Password CLI returned too much data");
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > OP_OUTPUT_LIMIT_BYTES) {
        child.kill("SIGTERM");
        rejectRequest("1Password CLI returned too much diagnostic data");
      }
    });
    child.on("error", () => rejectUnavailable("Could not start the 1Password CLI"));
    child.on("close", (code) => {
      finish(() => {
        if (code !== 0) {
          reject(
            new OnePasswordCliUnavailableError(
              `1Password CLI request failed with exit code ${code}`,
            ),
          );
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(stdout).toString("utf8")));
        } catch {
          reject(new Error("1Password CLI returned invalid JSON"));
        }
      });
    });
  });
}

function profilePathForAccount(accountId) {
  return `onepassword://account/${encodeURIComponent(accountId)}`;
}

function normalizeOrigin(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function itemOrigins(item) {
  const origins = new Set();
  for (const entry of Array.isArray(item?.urls) ? item.urls : []) {
    const href = typeof entry === "string" ? entry : entry?.href;
    if (typeof href !== "string") continue;
    const origin = normalizeOrigin(href);
    if (origin) origins.add(origin);
  }
  return [...origins].sort();
}

function emptyBindingState() {
  return { version: BINDING_STATE_VERSION, accounts: {} };
}

function validateBindingState(value) {
  if (
    value == null ||
    value.version !== BINDING_STATE_VERSION ||
    value.accounts == null ||
    typeof value.accounts !== "object" ||
    Array.isArray(value.accounts)
  ) {
    throw new Error("Invalid 1Password browser binding state");
  }
  for (const [accountId, account] of Object.entries(value.accounts)) {
    if (!accountId || account == null || !Array.isArray(account.items)) {
      throw new Error("Invalid 1Password browser account binding state");
    }
    for (const item of account.items) {
      if (
        item == null ||
        typeof item.itemId !== "string" ||
        !item.itemId ||
        typeof item.vaultId !== "string" ||
        !item.vaultId ||
        typeof item.favorite !== "boolean" ||
        !Array.isArray(item.origins) ||
        item.origins.some((origin) => normalizeOrigin(origin) !== origin)
      ) {
        throw new Error("Invalid 1Password browser item binding state");
      }
    }
  }
  return value;
}

function readBindingState(bindingStatePath) {
  try {
    return validateBindingState(JSON.parse(fs.readFileSync(bindingStatePath, "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return emptyBindingState();
    throw error;
  }
}

function writeBindingState(bindingStatePath, state) {
  validateBindingState(state);
  const directory = path.dirname(bindingStatePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = `${bindingStatePath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporaryPath, bindingStatePath);
    fs.chmodSync(bindingStatePath, 0o600);
  } finally {
    try {
      fs.rmSync(temporaryPath, { force: true });
    } catch {}
  }
}

function isBuiltInBrowserContents(contents) {
  const partition = contents?.session?.getPartition?.();
  return (
    partition === BUILT_IN_BROWSER_PARTITION ||
    partition?.startsWith(BUILT_IN_BROWSER_ROUTE_PARTITION_PREFIX) === true
  );
}

const WAIT_FOR_LOGIN_FORM_SCRIPT = `
(function codexOnePasswordWaitForLoginForm() {
  const isVisible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
  };
  const hasLoginForm = () => {
    const passwords = [...document.querySelectorAll('input[type="password"]')].filter((input) =>
      !input.disabled &&
      !input.readOnly &&
      input.autocomplete !== "new-password" &&
      input.value.length === 0 &&
      isVisible(input)
    );
    return passwords.length === 1;
  };
  if (hasLoginForm()) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timeout);
      resolve(value);
    };
    const observer = new MutationObserver(() => {
      if (hasLoginForm()) finish(true);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    const timeout = setTimeout(() => finish(false), ${LOGIN_FORM_WAIT_MS});
  });
})()
`;

function fillLoginFormScript(credential) {
  return `
(function codexOnePasswordFillLoginForm(credential) {
  const isVisible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
  };
  const passwords = [...document.querySelectorAll('input[type="password"]')].filter((input) =>
    !input.disabled &&
    !input.readOnly &&
    input.autocomplete !== "new-password" &&
    input.value.length === 0 &&
    isVisible(input)
  );
  if (passwords.length !== 1) return { filledPassword: false, filledUsername: false };
  const passwordInput = passwords[0];
  const scope = passwordInput.form || document;
  const usernameInputs = [...scope.querySelectorAll('input:not([type]), input[type="text"], input[type="email"], input[type="tel"]')]
    .filter((input) => !input.disabled && !input.readOnly && input.value.length === 0 && isVisible(input))
    .map((input) => {
      const identity = [input.autocomplete, input.name, input.id, input.type].join(" ").toLowerCase();
      const precedesPassword = Boolean(input.compareDocumentPosition(passwordInput) & Node.DOCUMENT_POSITION_FOLLOWING);
      let score = precedesPassword ? 2 : 0;
      if (/username|email/.test(input.autocomplete)) score += 8;
      if (/user|login|email|account/.test(identity)) score += 4;
      if (input.type === "email") score += 2;
      return { input, score };
    })
    .sort((left, right) => right.score - left.score);
  const setValue = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  let filledUsername = false;
  if (credential.username && usernameInputs.length > 0) {
    setValue(usernameInputs[0].input, credential.username);
    filledUsername = true;
  }
  setValue(passwordInput, credential.password);
  return { filledPassword: true, filledUsername };
})(${JSON.stringify(credential)})
`;
}

class OnePasswordBrowserProvider {
  constructor({ electron, opPath, bindingStatePath, autoStart = true }) {
    if (!electron?.app || !electron?.webContents) {
      throw new Error("Electron app and webContents APIs are required for 1Password browser support");
    }
    this.electron = electron;
    this.opPath = opPath === undefined ? resolveOnePasswordCli() : opPath;
    this.bindingStatePath =
      bindingStatePath ?? path.join(electron.app.getPath("userData"), BINDING_STATE_FILENAME);
    this.bindingState = readBindingState(this.bindingStatePath);
    this.credentialPromises = new Map();
    this.attachedContents = new WeakSet();
    this.started = false;
    this.onWebContentsCreated = (_event, contents) => this.attach(contents);
    this.onBeforeQuit = () => this.credentialPromises.clear();
    if (autoStart) this.start();
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.electron.app.on("web-contents-created", this.onWebContentsCreated);
    this.electron.app.on("before-quit", this.onBeforeQuit);
    for (const contents of this.electron.webContents.getAllWebContents()) this.attach(contents);
  }

  dispose() {
    if (!this.started) return;
    this.started = false;
    this.electron.app.removeListener("web-contents-created", this.onWebContentsCreated);
    this.electron.app.removeListener("before-quit", this.onBeforeQuit);
    this.credentialPromises.clear();
  }

  async listAccounts() {
    if (!this.opPath) return [];
    const accounts = await runOpJson(this.opPath, ["account", "list", "--format", "json"]);
    if (!Array.isArray(accounts)) throw new Error("1Password CLI returned invalid account data");
    return accounts.filter(
      (account) => typeof account?.account_uuid === "string" && account.account_uuid.length > 0,
    );
  }

  async listProfiles() {
    let accounts;
    try {
      accounts = await this.listAccounts();
    } catch (error) {
      if (error instanceof OnePasswordCliUnavailableError) return [];
      throw error;
    }
    return accounts.map((account) => {
      const accountId = account.account_uuid;
      const email = typeof account.email === "string" ? account.email : "";
      const signInAddress = typeof account.url === "string" ? account.url : "";
      return {
        source: "onepassword",
        appName: "1Password",
        profileName: email || signInAddress || accountId,
        profileDirectoryName: accountId,
        profilePath: profilePathForAccount(accountId),
        rootPath: this.opPath,
        hasCookies: false,
        hasPasswords: true,
        ...(email ? { userName: email } : {}),
      };
    });
  }

  async importProfile(profilePath) {
    if (!this.opPath) throw new Error("Install and configure the 1Password CLI first");
    const profiles = await this.listProfiles();
    const profile = profiles.find((candidate) => candidate.profilePath === profilePath);
    if (!profile) throw new Error("1Password account is no longer available");
    const accountId = profile.profileDirectoryName;
    const items = await runOpJson(this.opPath, [
      "item",
      "list",
      "--categories",
      "Login",
      "--format",
      "json",
      "--account",
      accountId,
    ]);
    const favoriteItems = await runOpJson(this.opPath, [
      "item",
      "list",
      "--categories",
      "Login",
      "--favorite",
      "--format",
      "json",
      "--account",
      accountId,
    ]);
    if (!Array.isArray(items) || !Array.isArray(favoriteItems)) {
      throw new Error("1Password CLI returned invalid Login item data");
    }
    const favoriteIds = new Set(
      favoriteItems.map((item) => item?.id).filter((itemId) => typeof itemId === "string"),
    );
    const bindings = [];
    let skippedInvalid = 0;
    for (const item of items) {
      const itemId = item?.id;
      const vaultId = item?.vault?.id;
      const origins = itemOrigins(item);
      if (
        typeof itemId !== "string" ||
        !itemId ||
        typeof vaultId !== "string" ||
        !vaultId ||
        origins.length === 0
      ) {
        skippedInvalid += 1;
        continue;
      }
      bindings.push({
        itemId,
        vaultId,
        favorite: favoriteIds.has(itemId),
        origins,
      });
    }
    this.bindingState = {
      version: BINDING_STATE_VERSION,
      accounts: {
        ...this.bindingState.accounts,
        [accountId]: { items: bindings },
      },
    };
    writeBindingState(this.bindingStatePath, this.bindingState);
    this.credentialPromises.clear();
    return {
      status: "success",
      discovered: items.length,
      canonicalized: bindings.length,
      imported: bindings.length,
      skippedInvalid,
      failed: 0,
    };
  }

  bindingForOrigin(origin) {
    const matches = [];
    const seen = new Set();
    for (const [accountId, account] of Object.entries(this.bindingState.accounts)) {
      for (const item of account.items) {
        if (!item.origins.includes(origin)) continue;
        const key = `${accountId}:${item.vaultId}:${item.itemId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        matches.push({ accountId, ...item });
      }
    }
    if (matches.length === 1) return matches[0];
    const favorites = matches.filter((item) => item.favorite);
    return favorites.length === 1 ? favorites[0] : null;
  }

  async credentialForBinding(binding) {
    const key = `${binding.accountId}:${binding.vaultId}:${binding.itemId}`;
    let promise = this.credentialPromises.get(key);
    if (promise) return await promise;
    promise = this.readCredential(binding).catch((error) => {
      this.credentialPromises.delete(key);
      throw error;
    });
    this.credentialPromises.set(key, promise);
    return await promise;
  }

  async readCredential(binding) {
    if (!this.opPath) throw new Error("1Password CLI is unavailable");
    const item = await runOpJson(this.opPath, [
      "item",
      "get",
      binding.itemId,
      "--vault",
      binding.vaultId,
      "--format",
      "json",
      "--account",
      binding.accountId,
    ]);
    const fields = Array.isArray(item?.fields) ? item.fields : [];
    const password = fields.find((field) => field?.purpose === "PASSWORD")?.value;
    const username = fields.find((field) => field?.purpose === "USERNAME")?.value;
    if (typeof password !== "string" || password.length === 0) {
      throw new Error("The selected 1Password Login item has no password field");
    }
    return {
      username: typeof username === "string" ? username : "",
      password,
    };
  }

  attach(contents) {
    if (!isBuiltInBrowserContents(contents) || this.attachedContents.has(contents)) return;
    this.attachedContents.add(contents);
    const autofill = () => {
      this.autofill(contents).catch((error) => {
        console.error(`[1Password browser] ${error.message}`);
      });
    };
    contents.on("dom-ready", autofill);
    contents.on("did-navigate-in-page", autofill);
    if (!contents.isLoadingMainFrame?.()) queueMicrotask(autofill);
  }

  async autofill(contents) {
    if (contents.isDestroyed?.()) return false;
    const origin = normalizeOrigin(contents.getURL());
    if (!origin) return false;
    const binding = this.bindingForOrigin(origin);
    if (!binding) return false;
    const hasLoginForm = await contents.executeJavaScript(WAIT_FOR_LOGIN_FORM_SCRIPT, false);
    if (!hasLoginForm || contents.isDestroyed?.()) return false;
    if (normalizeOrigin(contents.getURL()) !== origin) return false;
    const credential = await this.credentialForBinding(binding);
    if (normalizeOrigin(contents.getURL()) !== origin) return false;
    const result = await contents.executeJavaScript(fillLoginFormScript(credential), false);
    return result?.filledPassword === true;
  }
}

function createOnePasswordBrowserProvider(options) {
  return new OnePasswordBrowserProvider(options);
}

module.exports = {
  BINDING_STATE_FILENAME,
  OnePasswordBrowserProvider,
  createOnePasswordBrowserProvider,
  itemOrigins,
  normalizeOrigin,
  profilePathForAccount,
};
