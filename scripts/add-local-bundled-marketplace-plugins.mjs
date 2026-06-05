#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";

function usage() {
  return "Usage: add-local-bundled-marketplace-plugins.mjs <marketplace> <plugin-name>[=<plugin-dir>]...";
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

const pluginSpecs = pluginNames.map((spec) => {
  const separator = spec.indexOf("=");
  const name = separator === -1 ? spec : spec.slice(0, separator);
  const directory = separator === -1 ? spec : spec.slice(separator + 1);
  if (!name || !directory) {
    throw new Error(`Invalid plugin spec: ${spec}`);
  }
  return { name, directory };
});

const existingNames = new Set(marketplace.plugins.map((plugin) => plugin?.name));
const duplicateNames = pluginSpecs.map((plugin) => plugin.name).filter((name) => existingNames.has(name));
if (duplicateNames.length > 0) {
  throw new Error(`Marketplace already contains local plugin entries: ${duplicateNames.join(", ")}`);
}

const localPlugins = pluginSpecs.map(({ name, directory }) => ({
  name,
  source: {
    source: "local",
    path: `./plugins/${directory}`,
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
