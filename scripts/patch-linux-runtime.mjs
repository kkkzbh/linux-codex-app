#!/usr/bin/env node

import { createLinuxPatchContext } from "./linux-runtime/bundle-context.mjs";
import { linuxPatchFeatures, verifyLinuxPatchSource } from "./linux-runtime/features/index.mjs";
import {
  formatLinuxPatchProbeReport,
  probeLinuxRuntimePatches,
} from "./linux-runtime/patch-preflight.mjs";

const extractedAppDir = process.argv[2];

if (!extractedAppDir) {
  throw new Error("Usage: patch-linux-runtime.mjs <app-extracted-dir>");
}

const context = createLinuxPatchContext(extractedAppDir);
let bundleSources = context.readBundleSources();

try {
  for (const feature of linuxPatchFeatures) {
    bundleSources = feature.apply(bundleSources, context);
  }
} catch (error) {
  const report = probeLinuxRuntimePatches(context.readBundleSources(), context);
  console.error(formatLinuxPatchProbeReport(report));
  throw error;
}

verifyLinuxPatchSource(bundleSources, context);
context.writeBundleSources(bundleSources);
context.verifyBundleSyntax();
