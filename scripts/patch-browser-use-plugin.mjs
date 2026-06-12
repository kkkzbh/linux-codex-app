#!/usr/bin/env node

import { patchBrowserPlugin } from "./linux-browser-runtime/browser-plugin-patches.mjs";

const [browserRoot] = process.argv.slice(2);

if (!browserRoot) {
  console.error("Usage: patch-browser-use-plugin.mjs <browser-plugin-root>");
  process.exit(1);
}

patchBrowserPlugin(browserRoot);
