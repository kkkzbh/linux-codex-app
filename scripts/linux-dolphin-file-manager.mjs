#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DOLPHIN_WRAPPER_MARKER = "Codex Dolphin window access wrapper";

function normalizeInputPath(inputPath, cwd) {
  if (typeof inputPath !== "string" || inputPath.trim().length === 0) {
    throw new Error("Expected a file-system path to open in Dolphin.");
  }

  if (inputPath.startsWith("file://")) {
    return fileURLToPath(inputPath);
  }

  return path.isAbsolute(inputPath) ? inputPath : path.resolve(cwd, inputPath);
}

export function findExistingPath(inputPath) {
  let candidate = inputPath;

  for (;;) {
    if (existsSync(candidate)) {
      return candidate;
    }

    const parent = path.dirname(candidate);
    if (parent === candidate) {
      return null;
    }

    candidate = parent;
  }
}

export function resolveOpenRequest(inputPath, { cwd = process.cwd() } = {}) {
  const normalizedPath = normalizeInputPath(inputPath, cwd);
  const existingPath = findExistingPath(normalizedPath) ?? normalizedPath;
  const stats = existsSync(existingPath) ? statSync(existingPath) : null;
  const args = stats?.isFile() ? ["--select", existingPath] : [existingPath];

  return {
    targetPath: existingPath,
    args,
  };
}

export function buildDolphinArgs(request) {
  return request.args;
}

function getDolphinCommand(env) {
  const configuredCommand = env.CODEX_DOLPHIN_BIN?.trim();
  if (configuredCommand) {
    return configuredCommand;
  }

  const localBinPath = env.XDG_BIN_HOME?.trim();
  if (localBinPath) {
    return getCodexDolphinWrapperCommand(path.join(localBinPath, "dolphin"));
  }

  const home = env.HOME?.trim();
  if (!home) {
    throw new Error("Expected HOME to locate the Codex Dolphin wrapper.");
  }

  return getCodexDolphinWrapperCommand(path.join(home, ".local", "bin", "dolphin"));
}

function getCodexDolphinWrapperCommand(wrapperPath) {
  if (!existsSync(wrapperPath)) {
    throw new Error(`Codex Dolphin wrapper is not installed: ${wrapperPath}`);
  }

  const wrapperSource = readFileSync(wrapperPath, "utf8");
  if (!wrapperSource.includes(DOLPHIN_WRAPPER_MARKER)) {
    throw new Error(`Dolphin wrapper is not owned by Codex: ${wrapperPath}`);
  }

  return wrapperPath;
}

export function openPathWithFileManager(
  inputPath,
  { cwd = process.cwd(), env = process.env, spawnSyncImpl = spawnSync } = {},
) {
  const request = resolveOpenRequest(inputPath, { cwd });
  const command = getDolphinCommand(env);
  const args = buildDolphinArgs(request);
  // Codex file-manager opens must use the Dolphin CLI. Generic file-manager
  // D-Bus calls can reuse an existing window and bypass the user's
  // single-process/multi-window Dolphin setup and the installed dolphin wrapper.
  const result = spawnSyncImpl(command, args, {
    encoding: "utf8",
    env,
    stdio: "pipe",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    const stdout = result.stdout?.trim();
    const detail = stderr || stdout || `exit status ${result.status}`;
    throw new Error(`Dolphin file-manager open failed: ${detail}`);
  }

  return request;
}

function main() {
  const [inputPath, ...rest] = process.argv.slice(2);

  if (!inputPath || rest.length > 0) {
    console.error("Usage: codex-dolphin-file-manager <path>");
    process.exit(2);
  }

  try {
    openPathWithFileManager(inputPath);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
