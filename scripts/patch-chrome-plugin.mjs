#!/usr/bin/env node

import path from "node:path";
import { patchBrowserClient } from "./linux-browser-runtime/browser-client-patches.mjs";
import { patchChromeManifestChecker } from "./linux-browser-runtime/chrome-plugin-patches.mjs";

function usage() {
  return "Usage: patch-chrome-plugin.mjs <chrome-plugin-root>";
}

const [chromeRoot] = process.argv.slice(2);

if (!chromeRoot) {
  console.error(usage());
  process.exit(1);
}

patchBrowserClient(path.join(chromeRoot, "scripts", "browser-client.mjs"), {
  includeChromePatches: true,
});
patchChromeManifestChecker(path.join(chromeRoot, "scripts", "check-native-host-manifest.js"));
