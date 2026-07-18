#!/usr/bin/env node

import { existsSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createLinuxPatchContext } from "./linux-runtime/bundle-context.mjs";
import { linuxPatchFeatures, verifyLinuxPatchSource } from "./linux-runtime/features/index.mjs";
import {
  LINUX_PATCH_STATE_FILENAME,
  getAppAsarSignature,
  isLinuxPatchStateCurrent,
  loadLinuxPatchState,
  writeLinuxPatchState,
} from "./linux-runtime/state.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const installDir = path.resolve(process.argv[2] ?? path.join(scriptDir, ".."));
const resourcesDir = path.join(installDir, "resources");
const appAsarPath = path.join(resourcesDir, "app.asar");
const statePath = path.join(resourcesDir, LINUX_PATCH_STATE_FILENAME);

function runOrThrow(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.status === 0) {
    return;
  }

  throw new Error(
    [
      `Command failed: ${command} ${args.join(" ")}`,
      result.stdout?.trim(),
      result.stderr?.trim(),
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

function main() {
  if (!existsSync(appAsarPath)) {
    throw new Error(`app.asar not found: ${appAsarPath}`);
  }

  const appAsarSignature = getAppAsarSignature(appAsarPath);
  const state = loadLinuxPatchState(statePath);

  if (isLinuxPatchStateCurrent({ state, appAsarSignature, features: linuxPatchFeatures })) {
    return;
  }

  const workDir = mkdtempSync(path.join(resourcesDir, ".codex-linux-patch-state-"));
  const extractDir = path.join(workDir, "app");

  try {
    runOrThrow("npx", ["--yes", "asar", "extract", appAsarPath, extractDir], resourcesDir);
    const context = createLinuxPatchContext(extractDir);
    verifyLinuxPatchSource(context.readBundleSources(), context);
    writeLinuxPatchState(statePath, { appAsarSignature, features: linuxPatchFeatures });
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

main();
