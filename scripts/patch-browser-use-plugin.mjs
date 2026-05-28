#!/usr/bin/env node

import { patchBrowserClient } from "./linux-browser-runtime/browser-client-patches.mjs";

const [browserClientPath] = process.argv.slice(2);

if (!browserClientPath) {
  console.error("Usage: patch-browser-use-plugin.mjs <browser-client.mjs>");
  process.exit(1);
}

patchBrowserClient(browserClientPath);
