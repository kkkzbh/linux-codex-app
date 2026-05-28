#!/usr/bin/env node

import { createLinuxPatchContext } from "./linux-runtime/bundle-context.mjs";
import {
  formatLinuxPatchProbeReport,
  probeLinuxRuntimePatches,
} from "./linux-runtime/patch-preflight.mjs";

const args = process.argv.slice(2);
const json = args.includes("--json");
const extractedAppDir = args.find((arg) => arg !== "--json");

if (!extractedAppDir) {
  throw new Error("Usage: probe-linux-patches.mjs [--json] <app-extracted-dir>");
}

const context = createLinuxPatchContext(extractedAppDir);
const report = probeLinuxRuntimePatches(context.readBundleSources(), context);

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(formatLinuxPatchProbeReport(report));
}

process.exit(report.ok ? 0 : 1);
