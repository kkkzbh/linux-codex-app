#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";

function usage() {
  return "Usage: add-local-bundled-marketplace-plugins.mjs <marketplace> <plugin-name>...";
}

const [marketplacePath, ...pluginNames] = process.argv.slice(2);

if (!marketplacePath || pluginNames.length === 0) {
  console.error(usage());
  process.exit(1);
}

const marketplace = JSON.parse(readFileSync(marketplacePath, "utf8"));
if (!Array.isArray(marketplace.plugins)) {
  throw new Error(`Expected marketplace plugins array in: ${marketplacePath}`);
}

const existingNames = new Set(marketplace.plugins.map((plugin) => plugin?.name));
const duplicateNames = pluginNames.filter((name) => existingNames.has(name));
if (duplicateNames.length > 0) {
  throw new Error(`Marketplace already contains local plugin entries: ${duplicateNames.join(", ")}`);
}

const localPlugins = pluginNames.map((name) => ({
  name,
  source: {
    source: "local",
    path: `./plugins/${name}`,
  },
  policy: {
    installation: "AVAILABLE",
    authentication: "ON_INSTALL",
  },
  category: "Productivity",
}));

writeFileSync(
  marketplacePath,
  JSON.stringify({ ...marketplace, plugins: [...marketplace.plugins, ...localPlugins] }, null, 2) + "\n",
);
