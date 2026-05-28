import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  BROWSER_BACKEND_REGISTRY_VERSION,
  BROWSER_BACKEND_TYPES,
  browserBackendRegistryPath,
} from "./constants.mjs";

export function pidIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function normalizeRegistryEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return null;
  }

  const type = entry.type;
  const socketPath = entry.socketPath;
  const pid = Number(entry.pid);
  const createdAtMs = Number(entry.createdAtMs);
  const owner = entry.owner;

  if (!BROWSER_BACKEND_TYPES.has(type)) {
    return null;
  }
  if (typeof socketPath !== "string" || socketPath.length === 0 || !path.isAbsolute(socketPath)) {
    return null;
  }
  if (!Number.isInteger(pid) || pid <= 0) {
    return null;
  }
  if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) {
    return null;
  }
  if (typeof owner !== "string" || owner.length === 0) {
    return null;
  }

  return { type, socketPath, pid, createdAtMs, owner };
}

export function readBrowserBackendRegistry(registryPath = browserBackendRegistryPath()) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(registryPath, "utf8"));
  } catch {
    return { version: BROWSER_BACKEND_REGISTRY_VERSION, backends: [] };
  }

  const backends = Array.isArray(parsed?.backends)
    ? parsed.backends.map(normalizeRegistryEntry).filter(Boolean)
    : [];

  return { version: BROWSER_BACKEND_REGISTRY_VERSION, backends };
}

export function writeBrowserBackendRegistry(registry, registryPath = browserBackendRegistryPath()) {
  mkdirSync(path.dirname(registryPath), { recursive: true, mode: 0o700 });
  writeFileSync(
    registryPath,
    `${JSON.stringify(
      {
        version: BROWSER_BACKEND_REGISTRY_VERSION,
        backends: registry.backends.map(normalizeRegistryEntry).filter(Boolean),
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
}

export function pruneBrowserBackendRegistry(registryPath = browserBackendRegistryPath()) {
  const registry = readBrowserBackendRegistry(registryPath);
  const backends = registry.backends.filter((entry) => pidIsAlive(entry.pid));
  writeBrowserBackendRegistry({ ...registry, backends }, registryPath);
  return { ...registry, backends };
}

export function registerBrowserBackend({ type, socketPath, owner, registryPath = browserBackendRegistryPath() }) {
  const entry = normalizeRegistryEntry({
    type,
    socketPath,
    owner,
    pid: process.pid,
    createdAtMs: Date.now(),
  });

  if (!entry) {
    throw new Error("Invalid browser backend registry entry");
  }

  const registry = pruneBrowserBackendRegistry(registryPath);
  const backends = registry.backends
    .filter((candidate) => candidate.pid !== entry.pid || candidate.socketPath !== entry.socketPath)
    .concat(entry);

  writeBrowserBackendRegistry({ ...registry, backends }, registryPath);

  return () => {
    const current = readBrowserBackendRegistry(registryPath);
    const remaining = current.backends.filter(
      (candidate) => candidate.pid !== entry.pid || candidate.socketPath !== entry.socketPath,
    );

    if (remaining.length === 0) {
      rmSync(registryPath, { force: true });
      return;
    }

    writeBrowserBackendRegistry({ ...current, backends: remaining }, registryPath);
  };
}
