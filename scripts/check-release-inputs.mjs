#!/usr/bin/env node

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const upstreamDir = path.join(repoRoot, "upstream");

function fail(message) {
  throw new Error(message);
}

function requireString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`Expected non-empty string: ${name}`);
  }
}

function requireSha256(value, name) {
  requireString(value, name);
  if (!/^[0-9a-f]{64}$/i.test(value)) {
    fail(`Expected sha256 hex for ${name}: ${value}`);
  }
}

function requirePositiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    fail(`Expected positive integer: ${name}`);
  }
}

function validateManifest(manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

  if (manifest.schema !== 1) {
    fail(`Unsupported manifest schema in ${manifestPath}: ${manifest.schema}`);
  }

  for (const key of ["id", "appVersion", "appBuildNumber", "rpmVersion", "rpmRelease", "targetArch"]) {
    requireString(manifest[key], `${manifestPath}:${key}`);
  }

  if (!["x86_64", "aarch64"].includes(manifest.targetArch)) {
    fail(`Unsupported targetArch in ${manifestPath}: ${manifest.targetArch}`);
  }

  requireString(manifest.dmg?.url, `${manifestPath}:dmg.url`);
  requirePositiveInteger(manifest.dmg?.size, `${manifestPath}:dmg.size`);
  requireString(manifest.dmg?.etag, `${manifestPath}:dmg.etag`);
  requireString(manifest.dmg?.lastModified, `${manifestPath}:dmg.lastModified`);
  requireSha256(manifest.dmg?.sha256, `${manifestPath}:dmg.sha256`);
  requireSha256(manifest.dmg?.appAsarSha256, `${manifestPath}:dmg.appAsarSha256`);
  requireString(manifest.electron?.version, `${manifestPath}:electron.version`);
  requireString(manifest.buildTools?.sevenZip?.version, `${manifestPath}:buildTools.sevenZip.version`);
  requireString(manifest.buildTools?.sevenZip?.url, `${manifestPath}:buildTools.sevenZip.url`);
  requireSha256(manifest.buildTools?.sevenZip?.sha256, `${manifestPath}:buildTools.sevenZip.sha256`);
  requireString(manifest.codexCli?.release, `${manifestPath}:codexCli.release`);
  requireString(manifest.codexCli?.version, `${manifestPath}:codexCli.version`);
  requireString(manifest.codexCli?.vendorTarget, `${manifestPath}:codexCli.vendorTarget`);
  requireString(manifest.codexCli?.archiveUrl, `${manifestPath}:codexCli.archiveUrl`);
  requireSha256(manifest.codexCli?.sha256, `${manifestPath}:codexCli.sha256`);
  requirePositiveInteger(manifest.linuxPatchVersion, `${manifestPath}:linuxPatchVersion`);
}

function requireExecutable(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  const mode = statSync(absolutePath).mode;
  if ((mode & 0o111) === 0) {
    fail(`Expected executable file: ${relativePath}`);
  }
}

const manifests = readdirSync(upstreamDir)
  .filter((name) => name.endsWith(".json"))
  .map((name) => path.join(upstreamDir, name));

if (manifests.length === 0) {
  fail("Expected at least one upstream manifest under upstream/");
}

for (const manifestPath of manifests) {
  validateManifest(manifestPath);
}

for (const script of [
  "install.sh",
  "scripts/build-runtime-rpm.sh",
  "scripts/linux-codex-app",
  "scripts/verify-install.sh",
]) {
  requireExecutable(script);
}

const repoPublicKey = readFileSync(path.join(repoRoot, "packaging/rpm/RPM-GPG-KEY-linux-codex-app"), "utf8").trim();
if (!repoPublicKey.startsWith("-----BEGIN PGP PUBLIC KEY BLOCK-----") || !repoPublicKey.endsWith("-----END PGP PUBLIC KEY BLOCK-----")) {
  fail("Expected armored RPM public key at packaging/rpm/RPM-GPG-KEY-linux-codex-app");
}

console.log(`release-inputs: ok (${manifests.length} manifest${manifests.length === 1 ? "" : "s"})`);
