#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

export const BUNDLED_PLUGIN_AUDIT_FILENAME = ".linux-bundled-plugin-audit.json";

function usage() {
  return "Usage: stage-bundled-plugins.mjs <source-root> <dest-root> <blacklist-json>";
}

function fail(message) {
  throw new Error(message);
}

function readJson(filePath, description) {
  let source;
  try {
    source = readFileSync(filePath, "utf8");
  } catch (error) {
    fail(`Could not read ${description}: ${filePath}: ${error.message}`);
  }

  try {
    return { source, value: JSON.parse(source) };
  } catch (error) {
    fail(`Could not parse ${description}: ${filePath}: ${error.message}`);
  }
}

function requireObject(value, description) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    fail(`Expected ${description} to be an object`);
  }
  return value;
}

function requireNonEmptyString(value, description) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`Expected ${description} to be a non-empty string`);
  }
  return value.trim();
}

function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

function collectCommands(value, commands = []) {
  if (Array.isArray(value)) {
    for (const entry of value) collectCommands(entry, commands);
    return commands;
  }
  if (value == null || typeof value !== "object") return commands;

  for (const [key, entry] of Object.entries(value)) {
    if (key === "command" && typeof entry === "string") commands.push(entry);
    collectCommands(entry, commands);
  }
  return commands;
}

function pluginSignals(pluginRoot, manifest) {
  const macAppBundles = readdirSync(pluginRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"))
    .map((entry) => entry.name)
    .sort();
  const macOnlyCommands = [];
  const mcpManifest = manifest.mcpServers;

  if (typeof mcpManifest === "string") {
    const mcpPath = path.resolve(pluginRoot, mcpManifest);
    if (!mcpPath.startsWith(`${pluginRoot}${path.sep}`) || !existsSync(mcpPath)) {
      fail(`Plugin MCP manifest is missing or escapes its root: ${mcpManifest}`);
    }
    const { value } = readJson(mcpPath, "plugin MCP manifest");
    for (const command of collectCommands(value)) {
      if (
        /\.app[\\/]Contents[\\/](?:SharedSupport[\\/].*?[\\/])?[^\\/]+\.app[\\/]Contents[\\/]MacOS[\\/]/i.test(
          command,
        ) ||
        /\.app[\\/]Contents[\\/]MacOS[\\/]/i.test(command) ||
        /^\/Applications\//.test(command) ||
        /(^|[\\/])osascript$/i.test(command)
      ) {
        macOnlyCommands.push(command);
      }
    }
  }

  return { macAppBundles, macOnlyCommands: [...new Set(macOnlyCommands)].sort() };
}

function readBlacklist(blacklistPath) {
  const { source, value } = readJson(blacklistPath, "bundled plugin blacklist");
  requireObject(value, "bundled plugin blacklist");
  if (value.version !== 1) fail(`Unsupported bundled plugin blacklist version: ${value.version}`);
  if (!Array.isArray(value.plugins)) fail("Expected bundled plugin blacklist plugins to be an array");

  const entries = new Map();
  for (const rawEntry of value.plugins) {
    const entry = requireObject(rawEntry, "bundled plugin blacklist entry");
    const name = requireNonEmptyString(entry.name, "bundled plugin blacklist name");
    const reason = requireNonEmptyString(entry.reason, `blacklist reason for ${name}`);
    if (entries.has(name)) fail(`Duplicate bundled plugin blacklist entry: ${name}`);
    entries.set(name, { name, reason });
  }
  return { entries, sha256: sha256(source) };
}

function stageBundledPlugins(sourceRoot, destRoot, blacklistPath) {
  if (existsSync(destRoot)) fail(`Bundled plugin destination already exists: ${destRoot}`);
  const sourceMarketplacePath = path.join(sourceRoot, ".agents", "plugins", "marketplace.json");
  const destMarketplacePath = path.join(destRoot, ".agents", "plugins", "marketplace.json");
  const auditPath = path.join(destRoot, BUNDLED_PLUGIN_AUDIT_FILENAME);
  const { source: marketplaceSource, value: marketplace } = readJson(
    sourceMarketplacePath,
    "bundled plugin marketplace",
  );
  requireObject(marketplace, "bundled plugin marketplace");
  if (!Array.isArray(marketplace.plugins)) fail("Expected bundled plugin marketplace plugins to be an array");

  const blacklist = readBlacklist(blacklistPath);
  const seenNames = new Set();
  const selectedEntries = [];
  const selectedPlugins = [];
  const auditPlugins = [];

  for (const rawPlugin of marketplace.plugins) {
    const plugin = requireObject(rawPlugin, "bundled marketplace plugin");
    const name = requireNonEmptyString(plugin.name, "bundled marketplace plugin name");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) fail(`Invalid bundled plugin name: ${name}`);
    if (seenNames.has(name)) fail(`Duplicate bundled marketplace plugin: ${name}`);
    seenNames.add(name);

    const expectedSourcePath = `./plugins/${name}`;
    if (plugin.source?.source !== "local" || plugin.source?.path !== expectedSourcePath) {
      fail(`Bundled plugin ${name} must use local source path ${expectedSourcePath}`);
    }

    const sourcePluginRoot = path.join(sourceRoot, "plugins", name);
    const pluginManifestPath = path.join(sourcePluginRoot, ".codex-plugin", "plugin.json");
    if (!existsSync(sourcePluginRoot) || !existsSync(pluginManifestPath)) {
      fail(`Bundled plugin ${name} is missing its source directory or manifest: ${sourcePluginRoot}`);
    }
    const { value: manifest } = readJson(pluginManifestPath, `plugin manifest for ${name}`);
    requireObject(manifest, `plugin manifest for ${name}`);
    if (manifest.name !== name) fail(`Bundled plugin manifest name mismatch: ${name} != ${manifest.name}`);
    const version = requireNonEmptyString(manifest.version, `plugin version for ${name}`);
    const signals = pluginSignals(sourcePluginRoot, manifest);
    const excluded = blacklist.entries.get(name);

    if (!excluded && signals.macOnlyCommands.length > 0) {
      fail(
        `Bundled plugin ${name} invokes a macOS-only executable: ${signals.macOnlyCommands.join(", ")}. ` +
          "Audit its Linux runtime path before adding a documented blacklist entry.",
      );
    }

    auditPlugins.push({
      name,
      version,
      state: excluded ? "blacklisted" : "included",
      reason: excluded?.reason ?? null,
      signals,
    });
    if (excluded) continue;

    selectedEntries.push(plugin);
    selectedPlugins.push({ name, sourcePluginRoot });
  }

  const staleBlacklist = [...blacklist.entries.keys()].filter((name) => !seenNames.has(name));
  if (staleBlacklist.length > 0) {
    fail(`Bundled plugin blacklist contains entries absent from this DMG: ${staleBlacklist.join(", ")}`);
  }
  if (selectedEntries.length === 0) fail("Bundled plugin policy selected no plugins");

  for (const { name, sourcePluginRoot } of selectedPlugins) {
    const destPluginRoot = path.join(destRoot, "plugins", name);
    cpSync(sourcePluginRoot, destPluginRoot, {
      recursive: true,
      errorOnExist: true,
      force: false,
      verbatimSymlinks: true,
    });
  }

  mkdirSync(path.dirname(destMarketplacePath), { recursive: true });
  writeFileSync(
    destMarketplacePath,
    `${JSON.stringify({ ...marketplace, plugins: selectedEntries }, null, 2)}\n`,
  );
  writeFileSync(
    auditPath,
    `${JSON.stringify(
      {
        manifestVersion: 1,
        sourceMarketplaceSha256: sha256(marketplaceSource),
        blacklistSha256: blacklist.sha256,
        plugins: auditPlugins,
      },
      null,
      2,
    )}\n`,
  );

  const included = auditPlugins.filter((plugin) => plugin.state === "included").map((plugin) => plugin.name);
  const excluded = auditPlugins.filter((plugin) => plugin.state === "blacklisted");
  process.stdout.write(`Included upstream bundled plugins: ${included.join(", ")}\n`);
  process.stdout.write(
    `Blacklisted upstream bundled plugins: ${excluded.map((plugin) => `${plugin.name} (${plugin.reason})`).join(", ")}\n`,
  );
}

const [sourceRoot, destRoot, blacklistPath, ...extra] = process.argv.slice(2);
if (!sourceRoot || !destRoot || !blacklistPath || extra.length > 0) {
  console.error(usage());
  process.exit(1);
}

stageBundledPlugins(path.resolve(sourceRoot), path.resolve(destRoot), path.resolve(blacklistPath));
