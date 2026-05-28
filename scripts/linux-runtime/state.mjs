import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";

export const LINUX_PATCH_STATE_FILENAME = ".linux-patches-state.json";
export const LINUX_PATCH_VERSION = 73;

export function getAppAsarSignature(filePath) {
  const stats = statSync(filePath);
  return {
    size: stats.size,
    sha256: createHash("sha256").update(readFileSync(filePath)).digest("hex"),
  };
}

export function loadLinuxPatchState(statePath) {
  if (!existsSync(statePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(statePath, "utf8"));
  } catch {
    return null;
  }
}

export function buildLinuxPatchState({ appAsarSignature, features }) {
  return {
    patchVersion: LINUX_PATCH_VERSION,
    appAsar: appAsarSignature,
    features: Object.fromEntries(features.map((feature) => [feature.id, feature.version])),
  };
}

export function writeLinuxPatchState(statePath, { appAsarSignature, features }) {
  writeFileSync(
    statePath,
    JSON.stringify(buildLinuxPatchState({ appAsarSignature, features }), null, 2),
  );
}

export function isLinuxPatchStateCurrent({ state, appAsarSignature, features }) {
  if (!state || state.patchVersion !== LINUX_PATCH_VERSION) {
    return false;
  }

  if (
    state.appAsar?.size !== appAsarSignature.size ||
    state.appAsar?.sha256 !== appAsarSignature.sha256
  ) {
    return false;
  }

  for (const feature of features) {
    if (state.features?.[feature.id] !== feature.version) {
      return false;
    }
  }

  return true;
}
