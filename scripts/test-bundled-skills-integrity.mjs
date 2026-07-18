#!/usr/bin/env node

import assert from "node:assert/strict";
import {
  chmodSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildBundledSkillsManifest,
  readBundledSkillsManifest,
  verifyBundledSkillsTree,
  writeBundledSkillsManifest,
} from "./bundled-skills-integrity.mjs";

const tempDir = mkdtempSync(path.join(os.tmpdir(), "codex-bundled-skills-test-"));

function writeFixtureFile(rootDir, relativePath, content, mode = 0o644) {
  const filePath = path.join(rootDir, ...relativePath.split("/"));
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
  chmodSync(filePath, mode);
}

function createFixture(rootDir) {
  mkdirSync(rootDir, { recursive: true });
  writeFixtureFile(rootDir, "skills/.curated/hatch-pet/SKILL.md", "# Hatch Pet\n");
  writeFixtureFile(
    rootDir,
    "skills/.curated/hatch-pet/scripts/prepare_pet_run.py",
    "print('prepare')\n",
    0o755,
  );
  writeFixtureFile(
    rootDir,
    "skills/.curated/hatch-pet/scripts/validate_atlas.py",
    "print('validate')\n",
    0o755,
  );
  writeFixtureFile(
    rootDir,
    "skills/.curated/hatch-pet/references/codex-pet-contract.md",
    "# Pet contract\n",
  );
  writeFixtureFile(
    rootDir,
    "skills/.curated/hatch-pet/tests/test_single_final_chroma_pass.py",
    "def test_chroma(): pass\n",
  );
  writeFixtureFile(
    rootDir,
    "skills/.curated/onboard-new-user/SKILL.md",
    "# Onboard\n",
  );
}

function copyFixture(sourceRoot, name) {
  const copyRoot = path.join(tempDir, name);
  cpSync(sourceRoot, copyRoot, {
    recursive: true,
    preserveTimestamps: true,
  });
  return copyRoot;
}

function expectFailure(action, pattern) {
  assert.throws(action, pattern);
}

try {
  const sourceRoot = path.join(tempDir, "source");
  const manifestPath = path.join(tempDir, "manifest.json");
  createFixture(sourceRoot);

  const manifest = buildBundledSkillsManifest(sourceRoot);
  writeBundledSkillsManifest(manifestPath, manifest);
  const persistedManifest = readBundledSkillsManifest(manifestPath);
  verifyBundledSkillsTree(sourceRoot, persistedManifest);

  const completeCopy = copyFixture(sourceRoot, "complete-copy");
  verifyBundledSkillsTree(completeCopy, persistedManifest);

  const missingRoot = path.join(tempDir, "missing-root");
  expectFailure(
    () => verifyBundledSkillsTree(missingRoot, persistedManifest),
    /Bundled skills root not found/,
  );

  const missingFileCopy = copyFixture(sourceRoot, "missing-file-copy");
  rmSync(
    path.join(
      missingFileCopy,
      "skills/.curated/hatch-pet/tests/test_single_final_chroma_pass.py",
    ),
  );
  expectFailure(
    () => verifyBundledSkillsTree(missingFileCopy, persistedManifest),
    /missing manifest entry: skills\/.curated\/hatch-pet\/tests\/test_single_final_chroma_pass\.py/,
  );

  const extraFileCopy = copyFixture(sourceRoot, "extra-file-copy");
  writeFixtureFile(
    extraFileCopy,
    "skills/.curated/hatch-pet/scripts/unexpected.py",
    "print('unexpected')\n",
  );
  expectFailure(
    () => verifyBundledSkillsTree(extraFileCopy, persistedManifest),
    /unexpected entry: skills\/.curated\/hatch-pet\/scripts\/unexpected\.py/,
  );

  const modifiedContentCopy = copyFixture(sourceRoot, "modified-content-copy");
  const validateAtlasPath = path.join(
    modifiedContentCopy,
    "skills/.curated/hatch-pet/scripts/validate_atlas.py",
  );
  const originalContent = readFileSync(validateAtlasPath, "utf8");
  writeFileSync(validateAtlasPath, originalContent.replace("validate", "tampered"));
  expectFailure(
    () => verifyBundledSkillsTree(modifiedContentCopy, persistedManifest),
    /sha256 mismatch for skills\/.curated\/hatch-pet\/scripts\/validate_atlas\.py/,
  );

  const modifiedModeCopy = copyFixture(sourceRoot, "modified-mode-copy");
  chmodSync(
    path.join(modifiedModeCopy, "skills/.curated/hatch-pet/scripts/validate_atlas.py"),
    0o644,
  );
  expectFailure(
    () => verifyBundledSkillsTree(modifiedModeCopy, persistedManifest),
    /mode mismatch for skills\/.curated\/hatch-pet\/scripts\/validate_atlas\.py/,
  );

  const corruptManifestPath = path.join(tempDir, "corrupt-manifest.json");
  writeFileSync(
    corruptManifestPath,
    `${JSON.stringify({ ...manifest, treeSha256: "0".repeat(64) }, null, 2)}\n`,
  );
  expectFailure(
    () => readBundledSkillsManifest(corruptManifestPath),
    /manifest treeSha256 mismatch/,
  );

  const symlinkCopy = copyFixture(sourceRoot, "symlink-copy");
  symlinkSync(
    "SKILL.md",
    path.join(symlinkCopy, "skills/.curated/hatch-pet/SKILL-link.md"),
  );
  expectFailure(
    () => buildBundledSkillsManifest(symlinkCopy),
    /contains a symbolic link/,
  );

  const metadataCopy = copyFixture(sourceRoot, "metadata-copy");
  writeFixtureFile(
    metadataCopy,
    "skills/.curated/hatch-pet/SKILL.md:com.apple.provenance",
    "metadata\n",
  );
  expectFailure(
    () => buildBundledSkillsManifest(metadataCopy),
    /contains macOS metadata/,
  );

  console.error("Bundled skills integrity tests passed");
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
