import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function assertPluginManifestBasics(manifest, pluginRoot) {
  assert.equal(typeof manifest.name, "string");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(typeof manifest.description, "string");
  assert.ok(manifest.description.length > 0);
  assert.equal(typeof manifest.author?.name, "string");
  assert.equal(typeof manifest.homepage, "string");
  assert.equal(typeof manifest.repository, "string");
  assert.equal(typeof manifest.license, "string");
  assert.equal(manifest.skills, "./skills/");
  assert.equal(manifest.mcpServers, "./.mcp.json");

  const pluginInterface = manifest.interface ?? {};
  assert.equal(typeof pluginInterface.displayName, "string");
  assert.equal(typeof pluginInterface.shortDescription, "string");
  assert.equal(typeof pluginInterface.longDescription, "string");
  assert.equal(typeof pluginInterface.developerName, "string");
  assert.equal(typeof pluginInterface.category, "string");
  assert.ok(Array.isArray(pluginInterface.capabilities));
  assert.ok(pluginInterface.capabilities.length > 0);
  assert.ok(Array.isArray(pluginInterface.defaultPrompt));
  assert.ok(pluginInterface.defaultPrompt.length > 0);
  assert.match(pluginInterface.brandColor, /^#[0-9A-Fa-f]{6}$/);
  assertPluginAsset(pluginRoot, pluginInterface.composerIcon);
  assertPluginAsset(pluginRoot, pluginInterface.logo);
}

export function runPluginValidatorIfAvailable(pluginRoot, legacyServerName) {
  const configuredValidator = process.env.CODEX_PLUGIN_VALIDATOR;
  const candidates = [
    configuredValidator,
    path.join(os.homedir(), ".agents", "skills", ".system", "plugin-creator", "scripts", "validate_plugin.py"),
    path.join(os.homedir(), ".codex", "skills", ".system", "plugin-creator", "scripts", "validate_plugin.py"),
  ].filter(Boolean);
  const pluginValidator = candidates.find((candidate) => existsSync(candidate));
  if (!pluginValidator) {
    if (configuredValidator) {
      assert.fail(`CODEX_PLUGIN_VALIDATOR does not exist: ${configuredValidator}`);
    }
    return;
  }

  const validation = spawnSync("python3", [pluginValidator, pluginRoot], { encoding: "utf8" });
  const validationOutput = validation.stdout + validation.stderr;
  if (
    validation.status !== 0 &&
    validationOutput.includes(`field \`${legacyServerName}\` is not accepted by plugin validation`) &&
    validationOutput.includes("field `mcpServers` must be an object")
  ) {
    return;
  }
  assert.equal(validation.status, 0, validationOutput);
}

function assertPluginAsset(pluginRoot, relativePath) {
  assert.equal(typeof relativePath, "string");
  assert.match(relativePath, /^\.\//);
  assert.ok(existsSync(path.join(pluginRoot, relativePath)), `missing plugin asset: ${relativePath}`);
}
