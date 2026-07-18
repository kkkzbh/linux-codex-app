#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BUNDLED_SKILLS_MANIFEST_FILENAME = ".linux-bundled-skills-manifest.json";
export const BUNDLED_SKILLS_MANIFEST_VERSION = 1;

const REQUIRED_BUNDLED_SKILL_FILES = [
  "skills/.curated/hatch-pet/SKILL.md",
  "skills/.curated/hatch-pet/scripts/prepare_pet_run.py",
  "skills/.curated/hatch-pet/scripts/validate_atlas.py",
  "skills/.curated/hatch-pet/references/codex-pet-contract.md",
  "skills/.curated/onboard-new-user/SKILL.md",
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function comparePaths(left, right) {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function formatMode(stats) {
  return (stats.mode & 0o7777).toString(8).padStart(4, "0");
}

function requireSkillsRoot(rootDir) {
  if (!existsSync(rootDir)) {
    throw new Error(`Bundled skills root not found: ${rootDir}`);
  }

  const stats = lstatSync(rootDir);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`Bundled skills root must be a real directory: ${rootDir}`);
  }
}

function scanBundledSkillsTree(rootDir) {
  requireSkillsRoot(rootDir);

  const entries = [];
  const visit = (absolutePath, relativePath) => {
    const stats = lstatSync(absolutePath);
    const name = path.basename(absolutePath);

    if (name.includes(":com.apple.")) {
      throw new Error(`Bundled skills tree contains macOS metadata: ${absolutePath}`);
    }
    if (stats.isSymbolicLink()) {
      throw new Error(`Bundled skills tree contains a symbolic link: ${absolutePath}`);
    }

    if (stats.isDirectory()) {
      entries.push({
        path: relativePath,
        type: "directory",
        mode: formatMode(stats),
      });
      const children = readdirSync(absolutePath).sort(comparePaths);
      for (const child of children) {
        visit(
          path.join(absolutePath, child),
          relativePath === "." ? child : path.posix.join(relativePath, child),
        );
      }
      return;
    }

    if (stats.isFile()) {
      const content = readFileSync(absolutePath);
      entries.push({
        path: relativePath,
        type: "file",
        mode: formatMode(stats),
        size: content.length,
        sha256: sha256(content),
      });
      return;
    }

    throw new Error(`Bundled skills tree contains an unsupported filesystem entry: ${absolutePath}`);
  };

  visit(rootDir, ".");
  entries.sort((left, right) => comparePaths(left.path, right.path));
  return entries;
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("Bundled skills manifest must be a JSON object");
  }
  if (manifest.manifestVersion !== BUNDLED_SKILLS_MANIFEST_VERSION) {
    throw new Error(
      `Bundled skills manifest version must be ${BUNDLED_SKILLS_MANIFEST_VERSION}`,
    );
  }
  if (!Array.isArray(manifest.entries) || manifest.entries.length === 0) {
    throw new Error("Bundled skills manifest entries must be a non-empty array");
  }

  let previousPath = null;
  for (const entry of manifest.entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Bundled skills manifest contains an invalid entry");
    }
    if (typeof entry.path !== "string" || entry.path.length === 0) {
      throw new Error("Bundled skills manifest entry path must be a non-empty string");
    }
    if (
      entry.path !== "." &&
      (path.posix.isAbsolute(entry.path) ||
        path.posix.normalize(entry.path) !== entry.path ||
        entry.path === ".." ||
        entry.path.startsWith("../"))
    ) {
      throw new Error(`Bundled skills manifest contains an unsafe path: ${entry.path}`);
    }
    if (previousPath !== null && comparePaths(previousPath, entry.path) >= 0) {
      throw new Error(`Bundled skills manifest entries are not strictly sorted: ${entry.path}`);
    }
    previousPath = entry.path;

    if (!/^[0-7]{4}$/.test(entry.mode)) {
      throw new Error(`Bundled skills manifest contains an invalid mode for ${entry.path}`);
    }
    if (entry.type === "directory") {
      if (entry.size !== undefined || entry.sha256 !== undefined) {
        throw new Error(`Bundled skills directory entry contains file metadata: ${entry.path}`);
      }
      continue;
    }
    if (entry.type !== "file") {
      throw new Error(`Bundled skills manifest contains an invalid type for ${entry.path}`);
    }
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
      throw new Error(`Bundled skills manifest contains an invalid size for ${entry.path}`);
    }
    if (typeof entry.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
      throw new Error(`Bundled skills manifest contains an invalid sha256 for ${entry.path}`);
    }
  }

  if (manifest.entries[0].path !== "." || manifest.entries[0].type !== "directory") {
    throw new Error("Bundled skills manifest must begin with the root directory entry");
  }

  const expectedTreeSha256 = sha256(JSON.stringify(manifest.entries));
  if (manifest.treeSha256 !== expectedTreeSha256) {
    throw new Error(
      `Bundled skills manifest treeSha256 mismatch: expected ${expectedTreeSha256}, got ${manifest.treeSha256 ?? "<missing>"}`,
    );
  }
}

export function verifyBundledSkillsContract(rootDir) {
  requireSkillsRoot(rootDir);
  for (const relativePath of REQUIRED_BUNDLED_SKILL_FILES) {
    const filePath = path.join(rootDir, ...relativePath.split("/"));
    if (!existsSync(filePath) || !lstatSync(filePath).isFile()) {
      throw new Error(`Required bundled skill file not found: ${filePath}`);
    }
  }
}

export function buildBundledSkillsManifest(rootDir) {
  verifyBundledSkillsContract(rootDir);
  const entries = scanBundledSkillsTree(rootDir);
  return {
    manifestVersion: BUNDLED_SKILLS_MANIFEST_VERSION,
    treeSha256: sha256(JSON.stringify(entries)),
    entries,
  };
}

export function writeBundledSkillsManifest(manifestPath, manifest) {
  validateManifest(manifest);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

export function readBundledSkillsManifest(manifestPath) {
  if (!existsSync(manifestPath)) {
    throw new Error(`Bundled skills manifest not found: ${manifestPath}`);
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`Bundled skills manifest is not valid JSON: ${manifestPath}`, {
      cause: error,
    });
  }
  validateManifest(manifest);
  return manifest;
}

export function verifyBundledSkillsTree(rootDir, manifest) {
  validateManifest(manifest);
  verifyBundledSkillsContract(rootDir);
  const actualEntries = scanBundledSkillsTree(rootDir);
  const expectedByPath = new Map(manifest.entries.map((entry) => [entry.path, entry]));
  const actualByPath = new Map(actualEntries.map((entry) => [entry.path, entry]));

  for (const expected of manifest.entries) {
    const actual = actualByPath.get(expected.path);
    if (!actual) {
      throw new Error(`Bundled skills tree is missing manifest entry: ${expected.path}`);
    }
    for (const field of ["type", "mode", "size", "sha256"]) {
      if (actual[field] !== expected[field]) {
        throw new Error(
          `Bundled skills ${field} mismatch for ${expected.path}: expected ${expected[field]}, got ${actual[field]}`,
        );
      }
    }
  }

  for (const actual of actualEntries) {
    if (!expectedByPath.has(actual.path)) {
      throw new Error(`Bundled skills tree contains an unexpected entry: ${actual.path}`);
    }
  }

  const actualTreeSha256 = sha256(JSON.stringify(actualEntries));
  if (actualTreeSha256 !== manifest.treeSha256) {
    throw new Error(
      `Bundled skills treeSha256 mismatch: expected ${manifest.treeSha256}, got ${actualTreeSha256}`,
    );
  }
}

function usage() {
  return `Usage:
  bundled-skills-integrity.mjs snapshot <skills-root> <manifest-path>
  bundled-skills-integrity.mjs verify <skills-root> <manifest-path>`;
}

function main() {
  const [command, rootDirArg, manifestPathArg] = process.argv.slice(2);
  if (!command || !rootDirArg || !manifestPathArg || process.argv.length !== 5) {
    throw new Error(usage());
  }

  const rootDir = path.resolve(rootDirArg);
  const manifestPath = path.resolve(manifestPathArg);
  if (command === "snapshot") {
    const manifest = buildBundledSkillsManifest(rootDir);
    writeBundledSkillsManifest(manifestPath, manifest);
    return;
  }
  if (command === "verify") {
    verifyBundledSkillsTree(rootDir, readBundledSkillsManifest(manifestPath));
    return;
  }

  throw new Error(usage());
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`[ERROR] ${error.message}`);
    process.exit(1);
  }
}
