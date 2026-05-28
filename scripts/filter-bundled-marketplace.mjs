#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function usage() {
  return "Usage: filter-bundled-marketplace.mjs <source-marketplace> <dest-marketplace> <plugin-name>...";
}

const [sourcePath, destPath, ...enabledPluginNames] = process.argv.slice(2);

if (!sourcePath || !destPath || enabledPluginNames.length === 0) {
  console.error(usage());
  process.exit(1);
}

const enabled = new Set(enabledPluginNames);
const marketplace = JSON.parse(readFileSync(sourcePath, "utf8"));

if (!Array.isArray(marketplace.plugins)) {
  throw new Error(`Expected marketplace plugins array in: ${sourcePath}`);
}

const plugins = marketplace.plugins.filter((plugin) => enabled.has(plugin?.name));
const missing = enabledPluginNames.filter((name) => !plugins.some((plugin) => plugin.name === name));

if (missing.length > 0) {
  throw new Error(`Upstream marketplace is missing plugin entries: ${missing.join(", ")}`);
}

mkdirSync(path.dirname(destPath), { recursive: true });
writeFileSync(destPath, JSON.stringify({ ...marketplace, plugins }, null, 2) + "\n");
