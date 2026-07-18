#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const stageScript = path.join(scriptDir, "stage-bundled-plugins.mjs");

function writePlugin(sourceRoot, name, options = {}) {
  const root = path.join(sourceRoot, "plugins", name);
  mkdirSync(path.join(root, ".codex-plugin"), { recursive: true });
  const manifest = { name, version: options.version ?? "1.0.0" };
  if (options.command) manifest.mcpServers = "./.mcp.json";
  writeFileSync(path.join(root, ".codex-plugin", "plugin.json"), JSON.stringify(manifest));
  if (options.command) {
    writeFileSync(
      path.join(root, ".mcp.json"),
      JSON.stringify({ mcpServers: { test: { command: options.command, args: [] } } }),
    );
  }
  writeFileSync(path.join(root, "payload.txt"), name);
}

function writeMarketplace(sourceRoot, names) {
  const marketplacePath = path.join(sourceRoot, ".agents", "plugins", "marketplace.json");
  mkdirSync(path.dirname(marketplacePath), { recursive: true });
  writeFileSync(
    marketplacePath,
    JSON.stringify({
      name: "openai-bundled",
      plugins: names.map((name) => ({
        name,
        source: { source: "local", path: `./plugins/${name}` },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      })),
    }),
  );
}

function writeBlacklist(filePath, entries) {
  writeFileSync(filePath, JSON.stringify({ version: 1, plugins: entries }));
}

function runStage(sourceRoot, destRoot, blacklistPath) {
  return spawnSync(process.execPath, [stageScript, sourceRoot, destRoot, blacklistPath], {
    encoding: "utf8",
  });
}

function makeFixture() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "codex-bundled-plugins-"));
  const sourceRoot = path.join(tempDir, "source");
  const destRoot = path.join(tempDir, "dest");
  const blacklistPath = path.join(tempDir, "blacklist.json");
  const names = ["browser", "visualize", "computer-use", "record-and-replay", "new-plugin"];
  for (const name of names) {
    const macOnly = name === "computer-use" || name === "record-and-replay";
    writePlugin(sourceRoot, name, {
      command: macOnly
        ? "./Codex Computer Use.app/Contents/SharedSupport/Client.app/Contents/MacOS/Client"
        : undefined,
    });
  }
  writeMarketplace(sourceRoot, names);
  writeBlacklist(blacklistPath, [
    { name: "computer-use", reason: "macOS-only MCP executable" },
    { name: "record-and-replay", reason: "macOS-only recording service" },
  ]);
  return { tempDir, sourceRoot, destRoot, blacklistPath };
}

function testStagesEveryPluginExceptBlacklist() {
  const fixture = makeFixture();
  try {
    const result = runStage(fixture.sourceRoot, fixture.destRoot, fixture.blacklistPath);
    assert.equal(result.status, 0, result.stderr);
    const marketplace = JSON.parse(
      readFileSync(path.join(fixture.destRoot, ".agents", "plugins", "marketplace.json"), "utf8"),
    );
    assert.deepEqual(marketplace.plugins.map((plugin) => plugin.name), ["browser", "visualize", "new-plugin"]);
    assert.equal(existsSync(path.join(fixture.destRoot, "plugins", "new-plugin", "payload.txt")), true);
    assert.equal(existsSync(path.join(fixture.destRoot, "plugins", "computer-use")), false);

    const audit = JSON.parse(
      readFileSync(path.join(fixture.destRoot, ".linux-bundled-plugin-audit.json"), "utf8"),
    );
    assert.equal(audit.manifestVersion, 1);
    assert.deepEqual(
      audit.plugins.map(({ name, state }) => [name, state]),
      [
        ["browser", "included"],
        ["visualize", "included"],
        ["computer-use", "blacklisted"],
        ["record-and-replay", "blacklisted"],
        ["new-plugin", "included"],
      ],
    );
    assert.match(result.stdout, /Included upstream bundled plugins: browser, visualize, new-plugin/);
  } finally {
    rmSync(fixture.tempDir, { recursive: true, force: true });
  }
}

function testRejectsUnreviewedMacOnlyPlugin() {
  const fixture = makeFixture();
  try {
    writeBlacklist(fixture.blacklistPath, [
      { name: "computer-use", reason: "macOS-only MCP executable" },
    ]);
    const result = runStage(fixture.sourceRoot, fixture.destRoot, fixture.blacklistPath);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /record-and-replay invokes a macOS-only executable/);
  } finally {
    rmSync(fixture.tempDir, { recursive: true, force: true });
  }
}

function testRejectsStaleBlacklistEntry() {
  const fixture = makeFixture();
  try {
    writeBlacklist(fixture.blacklistPath, [
      { name: "computer-use", reason: "macOS-only MCP executable" },
      { name: "record-and-replay", reason: "macOS-only recording service" },
      { name: "removed-plugin", reason: "stale" },
    ]);
    const result = runStage(fixture.sourceRoot, fixture.destRoot, fixture.blacklistPath);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /entries absent from this DMG: removed-plugin/);
  } finally {
    rmSync(fixture.tempDir, { recursive: true, force: true });
  }
}

function testRejectsMissingPluginPayload() {
  const fixture = makeFixture();
  try {
    rmSync(path.join(fixture.sourceRoot, "plugins", "new-plugin"), { recursive: true, force: true });
    const result = runStage(fixture.sourceRoot, fixture.destRoot, fixture.blacklistPath);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /new-plugin is missing its source directory or manifest/);
  } finally {
    rmSync(fixture.tempDir, { recursive: true, force: true });
  }
}

testStagesEveryPluginExceptBlacklist();
testRejectsUnreviewedMacOnlyPlugin();
testRejectsStaleBlacklistEntry();
testRejectsMissingPluginPayload();
console.log("Bundled plugin staging tests passed");
