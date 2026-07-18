#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildDolphinArgs,
  openPathWithFileManager,
  resolveOpenRequest,
} from "./linux-dolphin-file-manager.mjs";

const tempDir = mkdtempSync(path.join(tmpdir(), "codex-dolphin-file-manager-"));

try {
  const folderPath = path.join(tempDir, "folder path");
  const nestedPath = path.join(folderPath, "nested");
  const filePath = path.join(folderPath, "item 'quoted'.txt");
  const homePath = path.join(tempDir, "home");
  const wrapperPath = path.join(homePath, ".local", "bin", "dolphin");
  const xdgBinPath = path.join(tempDir, "xdg-bin");
  const xdgWrapperPath = path.join(xdgBinPath, "dolphin");
  const nonCodexWrapperPath = path.join(tempDir, "non-codex-bin", "dolphin");

  mkdirSync(nestedPath, { recursive: true });
  mkdirSync(path.dirname(wrapperPath), { recursive: true });
  mkdirSync(xdgBinPath, { recursive: true });
  mkdirSync(path.dirname(nonCodexWrapperPath), { recursive: true });
  writeFileSync(filePath, "test\n");
  writeFileSync(wrapperPath, "#!/usr/bin/env bash\n# Codex Dolphin window access wrapper\n");
  writeFileSync(xdgWrapperPath, "#!/usr/bin/env bash\n# Codex Dolphin window access wrapper\n");
  writeFileSync(nonCodexWrapperPath, "#!/usr/bin/env bash\n");

  const folderRequest = resolveOpenRequest(folderPath);
  assert.equal(folderRequest.targetPath, folderPath);
  assert.deepEqual(folderRequest.args, [folderPath]);

  const fileRequest = resolveOpenRequest(filePath);
  assert.equal(fileRequest.targetPath, filePath);
  assert.deepEqual(fileRequest.args, ["--select", filePath]);

  const missingRequest = resolveOpenRequest(path.join(folderPath, "missing", "child.txt"));
  assert.equal(missingRequest.targetPath, folderPath);
  assert.deepEqual(missingRequest.args, [folderPath]);

  assert.deepEqual(buildDolphinArgs(fileRequest), ["--select", filePath]);

  const calls = [];
  const opened = openPathWithFileManager(filePath, {
    env: { ...process.env, CODEX_DOLPHIN_BIN: "dolphin-test" },
    spawnSyncImpl(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0, stdout: "", stderr: "" };
    },
  });

  assert.deepEqual(opened, fileRequest);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "dolphin-test");
  assert.deepEqual(calls[0].args, buildDolphinArgs(fileRequest));
  assert.equal(calls[0].options.encoding, "utf8");
  assert.equal(calls[0].options.env.CODEX_DOLPHIN_BIN, "dolphin-test");

  const wrapperCalls = [];
  const wrapperOpened = openPathWithFileManager(folderPath, {
    env: { HOME: homePath },
    spawnSyncImpl(command, args, options) {
      wrapperCalls.push({ command, args, options });
      return { status: 0, stdout: "", stderr: "" };
    },
  });
  assert.deepEqual(wrapperOpened, folderRequest);
  assert.equal(wrapperCalls.length, 1);
  assert.equal(wrapperCalls[0].command, wrapperPath);
  assert.deepEqual(wrapperCalls[0].args, buildDolphinArgs(folderRequest));

  const xdgWrapperCalls = [];
  openPathWithFileManager(folderPath, {
    env: { HOME: homePath, XDG_BIN_HOME: xdgBinPath },
    spawnSyncImpl(command, args) {
      xdgWrapperCalls.push({ command, args });
      return { status: 0, stdout: "", stderr: "" };
    },
  });
  assert.equal(xdgWrapperCalls.length, 1);
  assert.equal(xdgWrapperCalls[0].command, xdgWrapperPath);

  assert.throws(
    () =>
      openPathWithFileManager(filePath, {
        spawnSyncImpl() {
          return { status: 1, stdout: "", stderr: "dolphin unavailable\n" };
        },
      }),
    /Dolphin file-manager open failed: dolphin unavailable/,
  );

  assert.throws(
    () =>
      openPathWithFileManager(folderPath, {
        env: { HOME: path.join(tempDir, "missing-home") },
        spawnSyncImpl() {
          throw new Error("spawn should not run without a Codex wrapper");
        },
      }),
    /Codex Dolphin wrapper is not installed:/,
  );

  assert.throws(
    () =>
      openPathWithFileManager(folderPath, {
        env: { XDG_BIN_HOME: path.dirname(nonCodexWrapperPath) },
        spawnSyncImpl() {
          throw new Error("spawn should not run without a Codex-owned wrapper");
        },
      }),
    /Dolphin wrapper is not owned by Codex:/,
  );
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

console.error("[INFO] Linux Dolphin file-manager helper tests passed");
