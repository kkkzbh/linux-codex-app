#!/usr/bin/env node

import {
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createLinuxPatchContext } from "./linux-runtime/bundle-context.mjs";
import { linuxPatchFeatures, verifyLinuxPatchSource } from "./linux-runtime/features/index.mjs";
import {
  LINUX_PATCH_STATE_FILENAME,
  getAppAsarSignature,
  isLinuxPatchStateCurrent,
  loadLinuxPatchState,
  writeLinuxPatchState,
} from "./linux-runtime/state.mjs";

const __filename = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(__filename);
const installDir = path.resolve(process.argv[2] ?? path.join(scriptDir, ".."));
const resourcesDir = path.join(installDir, "resources");
const appAsarPath = path.join(resourcesDir, "app.asar");
const appAsarUnpackedPath = path.join(resourcesDir, "app.asar.unpacked");
const statePath = path.join(resourcesDir, LINUX_PATCH_STATE_FILENAME);
const patchScriptPath = path.join(scriptDir, "patch-linux-runtime.mjs");

function runOrThrow(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.status !== 0) {
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
}

function writeState() {
  writeLinuxPatchState(statePath, {
    appAsarSignature: getAppAsarSignature(appAsarPath),
    features: linuxPatchFeatures,
  });
}

function replaceAppAsar(tempAppAsarPath) {
  const backupPath = path.join(
    resourcesDir,
    `app.asar.bak-auto-${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}`,
  );

  copyFileSync(appAsarPath, backupPath);
  copyFileSync(tempAppAsarPath, appAsarPath);
  rmSync(tempAppAsarPath, { force: true });
}

function replaceAppAsarUnpacked(tempAppAsarUnpackedPath) {
  if (!existsSync(tempAppAsarUnpackedPath)) {
    return;
  }

  rmSync(appAsarUnpackedPath, { recursive: true, force: true });
  cpSync(tempAppAsarUnpackedPath, appAsarUnpackedPath, { recursive: true });
  rmSync(tempAppAsarUnpackedPath, { recursive: true, force: true });
}

function main() {
  if (!existsSync(appAsarPath)) {
    throw new Error(`app.asar not found: ${appAsarPath}`);
  }

  const currentSignature = getAppAsarSignature(appAsarPath);
  const state = loadLinuxPatchState(statePath);

  if (isLinuxPatchStateCurrent({ state, appAsarSignature: currentSignature, features: linuxPatchFeatures })) {
    return;
  }

  const workDir = mkdtempSync(path.join(os.tmpdir(), "codex-linux-patch-"));
  const extractDir = path.join(workDir, "app-extracted");
  const packedAsarPath = path.join(workDir, "app.asar");
  const packedAsarUnpackedPath = path.join(workDir, "app.asar.unpacked");

  try {
    mkdirSync(extractDir, { recursive: true });
    runOrThrow("npx", ["--yes", "asar", "extract", appAsarPath, extractDir], installDir);

    const context = createLinuxPatchContext(extractDir);
    const extractedSources = context.readBundleSources();

    try {
      verifyLinuxPatchSource(extractedSources, context);
      writeState();
      return;
    } catch {
      // The extracted bundle is not fully patched for the current upstream layout.
    }

    runOrThrow("node", [patchScriptPath, extractDir], installDir);

    verifyLinuxPatchSource(context.readBundleSources(), context);

    runOrThrow(
      "npx",
      ["--yes", "asar", "pack", extractDir, packedAsarPath, "--unpack", "{*.node,*.so,*.dylib}"],
      workDir,
    );

    replaceAppAsar(packedAsarPath);
    replaceAppAsarUnpacked(packedAsarUnpackedPath);
    writeState();
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

main();
