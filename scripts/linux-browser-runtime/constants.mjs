import os from "node:os";
import path from "node:path";
import process from "node:process";

export const BROWSER_BACKEND_TYPES = new Set(["extension", "iab", "cdp"]);
export const BROWSER_BACKEND_REGISTRY_VERSION = 1;
export const BROWSER_DISCOVERY_TIMEOUT_MS = 4_000;
export const BROWSER_FRAME_HEADER_BYTES = 4;
export const CHROME_NATIVE_HOST_REQUEST_TIMEOUT_MS = 12_000;
export const BROWSER_SOCKET_ROOT = "/tmp/codex-browser-use";
export const BROWSER_REGISTRY_ENV = "CODEX_BROWSER_BACKENDS_REGISTRY";

export function browserRuntimeDir(env = process.env) {
  return env.XDG_RUNTIME_DIR && env.XDG_RUNTIME_DIR.length > 0 ? env.XDG_RUNTIME_DIR : os.tmpdir();
}

export function browserBackendRegistryPath(env = process.env) {
  if (env[BROWSER_REGISTRY_ENV] && env[BROWSER_REGISTRY_ENV].trim().length > 0) {
    return env[BROWSER_REGISTRY_ENV];
  }

  const uid = process.getuid?.() ?? "user";
  return path.join(browserRuntimeDir(env), `codex-browser-backends-${uid}.json`);
}
