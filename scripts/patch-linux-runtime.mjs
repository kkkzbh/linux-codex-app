#!/usr/bin/env node

import { createLinuxPatchContext } from "./linux-runtime/bundle-context.mjs";
import {
  linuxPatchFeatures,
  synchronizeSharedBundleSources,
  verifyLinuxPatchSource,
} from "./linux-runtime/features/index.mjs";
import {
  formatLinuxPatchProbeReport,
  probeLinuxRuntimePatches,
} from "./linux-runtime/patch-preflight.mjs";

const extractedAppDir = process.argv[2];

if (!extractedAppDir) {
  throw new Error("Usage: patch-linux-runtime.mjs <app-extracted-dir>");
}

const patchSet = process.env.CODEX_LINUX_RUNTIME_PATCH_SET?.trim() || "all";
const selectedFeatures = selectPatchFeatures(patchSet);

function selectPatchFeatures(requestedPatchSet) {
  switch (requestedPatchSet) {
    case "all":
      return linuxPatchFeatures;
    case "none":
      return [];
    case "native-titlebar":
      return linuxPatchFeatures.filter((feature) => feature.id === "native-titlebar");
    default:
      throw new Error(
        `Unsupported CODEX_LINUX_RUNTIME_PATCH_SET=${requestedPatchSet}. Expected all, none, or native-titlebar.`,
      );
  }
}

if (selectedFeatures.length === 0) {
  process.stderr.write("[INFO] Skipping Linux runtime patches because CODEX_LINUX_RUNTIME_PATCH_SET=none\n");
  process.exit(0);
}

const context = createLinuxPatchContext(extractedAppDir);
let bundleSources = context.readBundleSources();

try {
  for (const feature of selectedFeatures) {
    const previousSources = bundleSources;
    bundleSources = synchronizeSharedBundleSources(
      previousSources,
      feature.apply(previousSources, context),
      context,
    );
  }
} catch (error) {
  const report = probeLinuxRuntimePatches(context.readBundleSources(), context);
  console.error(formatLinuxPatchProbeReport(report));
  throw error;
}

if (patchSet === "all") {
  verifyLinuxPatchSource(bundleSources, context);
} else {
  for (const feature of selectedFeatures) {
    feature.verify(bundleSources, context);
  }
}
context.writeBundleSources(bundleSources);
context.verifyBundleSyntax();
