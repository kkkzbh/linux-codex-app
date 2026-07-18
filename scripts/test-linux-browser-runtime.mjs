#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import realProcess from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { encodeFrame, FrameDecoder, parseFrame } from "./linux-browser-runtime/frame.mjs";
import {
  BROWSER_ONLY_BROWSER_CLIENT_PATCHES,
  CHROME_ONLY_BROWSER_CLIENT_PATCHES,
  COMMON_BROWSER_CLIENT_PATCHES,
} from "./linux-browser-runtime/browser-client-patches.mjs";
import {
  BROWSER_SKILL_GUIDANCE_PATCHES,
  patchBrowserManifest,
} from "./linux-browser-runtime/browser-plugin-patches.mjs";
import {
  readBrowserBackendRegistry,
  registerBrowserBackend,
  writeBrowserBackendRegistry,
  pruneBrowserBackendRegistry,
} from "./linux-browser-runtime/registry.mjs";
import { patchSource } from "./linux-browser-runtime/patch-utils.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const installerRoot = path.dirname(scriptDir);
const runtimeDir = path.join(scriptDir, "linux-browser-runtime");
const chromeFixtureRoot = resolveChromeFixtureRoot();
const browserFixtureRoot = resolveBrowserFixtureRoot();
const minifiedIdentifier = String.raw`[$A-Z_a-z][$\w]*`;
const currentDirectClickMouseMoveRegex = new RegExp(
  String.raw`async clickPoint\((?<event>${minifiedIdentifier})\)\{[\s\S]*?await this\.ui\.moveMouse\([^)]*\),await this\.dispatchCdpMouseMove\(\{modifiers:\k<event>\.modifiers,point:${minifiedIdentifier},target:${minifiedIdentifier}\}\);[\s\S]*?async dispatchCdpMouseMove\((?<moveEvent>${minifiedIdentifier})\)\{await this\.cdp\.callTarget\(\k<moveEvent>\.target,"Input\.dispatchMouseEvent",\{type:"mouseMoved",x:\k<moveEvent>\.point\.x,y:\k<moveEvent>\.point\.y,button:"none"`,
);
const currentFileChooserTimeoutMaxRegex = new RegExp(
  String.raw`"playwright_wait_for_file_chooser",async\((?<payload>${minifiedIdentifier}),(?<context>${minifiedIdentifier})\)=>\{let (?<tabId>${minifiedIdentifier})=${minifiedIdentifier}\(\k<payload>\.tab_id\),${minifiedIdentifier}=${minifiedIdentifier}\(\{\.\.\.\k<payload>,max:12e4/\* codexFileChooserTimeoutMax \*/\}\);await \k<context>\.cdp\.call\(\k<tabId>,"Page\.enable"\)`,
);

function resolveChromeFixtureRoot() {
  const candidates = chromeFixtureCandidates();
  const searched = [];

  for (const candidate of candidates) {
    searched.push(candidate);
    if (existsSync(path.join(candidate, "scripts", "browser-client.mjs"))) {
      return candidate;
    }
  }

  throw new Error(
    [
      "Could not find a Chrome plugin fixture containing scripts/browser-client.mjs.",
      "Set CODEX_CHROME_PLUGIN_FIXTURE_ROOT to an extracted or staged chrome plugin root.",
      "Searched:",
      ...searched.map((candidate) => `- ${candidate}`),
    ].join("\n"),
  );
}

function chromeFixtureCandidates() {
  const repoRoot = path.dirname(installerRoot);
  const codexHome = process.env.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex");
  const candidates = [];

  addCandidate(candidates, process.env.CODEX_CHROME_PLUGIN_FIXTURE_ROOT);
  addVersionedCacheCandidates(candidates, path.join(codexHome, "plugins", "cache", "openai-bundled", "chrome"));

  for (const stagedDir of sortedChildDirs(path.join(repoRoot, "staged-installs"))) {
    addCandidate(
      candidates,
      path.join(stagedDir, "resources", "plugins", "openai-bundled", "plugins", "chrome"),
    );
  }

  addCandidate(
    candidates,
    path.join(installerRoot, "codex-app", "resources", "plugins", "openai-bundled", "plugins", "chrome"),
  );

  for (const probeDir of sortedChildDirs(installerRoot).filter((dir) =>
    /^\.((plugin|update)-probe)-/.test(path.basename(dir)),
  )) {
    addCandidate(
      candidates,
      path.join(
        probeDir,
        "dmg-extract",
        "Codex Installer",
        "Codex.app",
        "Contents",
        "Resources",
        "plugins",
        "openai-bundled",
        "plugins",
        "chrome",
      ),
    );
  }

  addCandidate(
    candidates,
    path.join(
      os.homedir(),
      ".local",
      "share",
      "codex-app",
      "current",
      "resources",
      "plugins",
      "openai-bundled",
      "plugins",
      "chrome",
    ),
  );

  return uniquePaths(candidates);
}

function resolveBrowserFixtureRoot() {
  const candidates = browserFixtureCandidates();
  const searched = [];

  for (const candidate of candidates) {
    searched.push(candidate);
    if (existsSync(path.join(candidate, "scripts", "browser-client.mjs"))) {
      return candidate;
    }
  }

  throw new Error(
    [
      "Could not find a Browser plugin fixture containing scripts/browser-client.mjs.",
      "Set CODEX_BROWSER_PLUGIN_FIXTURE_ROOT to an extracted or staged browser plugin root.",
      "Searched:",
      ...searched.map((candidate) => `- ${candidate}`),
    ].join("\n"),
  );
}

function browserFixtureCandidates() {
  const repoRoot = path.dirname(installerRoot);
  const codexHome = process.env.CODEX_HOME?.trim() || path.join(os.homedir(), ".codex");
  const candidates = [];

  addCandidate(candidates, process.env.CODEX_BROWSER_PLUGIN_FIXTURE_ROOT);
  addVersionedCacheCandidates(candidates, path.join(codexHome, "plugins", "cache", "openai-bundled", "browser"));

  for (const stagedDir of sortedChildDirs(path.join(repoRoot, "staged-installs"))) {
    addCandidate(
      candidates,
      path.join(stagedDir, "resources", "plugins", "openai-bundled", "plugins", "browser"),
    );
  }

  addCandidate(
    candidates,
    path.join(installerRoot, "codex-app", "resources", "plugins", "openai-bundled", "plugins", "browser"),
  );

  for (const probeDir of sortedChildDirs(installerRoot).filter((dir) =>
    /^\.((plugin|update)-probe)-/.test(path.basename(dir)),
  )) {
    addCandidate(
      candidates,
      path.join(
        probeDir,
        "dmg-extract",
        "Codex Installer",
        "Codex.app",
        "Contents",
        "Resources",
        "plugins",
        "openai-bundled",
        "plugins",
        "browser",
      ),
    );
  }

  addCandidate(
    candidates,
    path.join(
      os.homedir(),
      ".local",
      "share",
      "codex-app",
      "current",
      "resources",
      "plugins",
      "openai-bundled",
      "plugins",
      "browser",
    ),
  );

  return uniquePaths(candidates);
}

function addVersionedCacheCandidates(candidates, cacheRoot) {
  addCandidate(candidates, cacheRoot);
  for (const candidate of sortedChildDirs(cacheRoot)) {
    addCandidate(candidates, candidate);
  }
}

function addCandidate(candidates, candidate) {
  if (typeof candidate !== "string" || candidate.trim().length === 0) {
    return;
  }

  candidates.push(path.resolve(candidate));
}

function sortedChildDirs(parentDir) {
  if (!existsSync(parentDir)) {
    return [];
  }

  return readdirSync(parentDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => path.join(parentDir, entry.name))
    .sort((left, right) => comparePathFreshness(right, left));
}

function comparePathFreshness(left, right) {
  try {
    return statSync(left).mtimeMs - statSync(right).mtimeMs || left.localeCompare(right);
  } catch {
    return left.localeCompare(right);
  }
}

function uniquePaths(paths) {
  return [...new Set(paths)];
}

function makeTempDir(prefix) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForChildExit(child, timeoutMs = 5_000) {
  if (child.exitCode != null || child.signalCode != null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for child process to exit")), timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

function frameMessage(message) {
  return encodeFrame(JSON.stringify(message));
}

async function waitFor(condition, label, timeoutMs = 5_000) {
  const startedAt = Date.now();
  for (;;) {
    const value = await condition();
    if (value) {
      return value;
    }
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ${label}`);
    }
    await sleep(25);
  }
}

const decodedFrameQueues = new WeakMap();

async function readFrame(stream, decoder, label, timeoutMs = 5_000) {
  const queued = decodedFrameQueues.get(decoder);
  if (queued?.length > 0) {
    return parseFrame(queued.shift());
  }

  return new Promise((resolve, reject) => {
    const onData = (chunk) => {
      try {
        const frames = decoder.push(chunk);
        if (frames.length > 0) {
          decodedFrameQueues.set(decoder, frames.slice(1));
          cleanup();
          resolve(parseFrame(frames[0]));
        }
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${label}`));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      stream.off("data", onData);
    };
    stream.on("data", onData);
  });
}

async function startFakeBackend(socketPath, { type = "extension", hang = false } = {}) {
  let getInfoCalls = 0;
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    const decoder = new FrameDecoder();
    socket.on("close", () => sockets.delete(socket));
    socket.on("data", (chunk) => {
      for (const frame of decoder.push(chunk)) {
        const message = parseFrame(frame);
        if (hang || !message?.id) {
          continue;
        }
        getInfoCalls += 1;
        socket.write(
          frameMessage({
            jsonrpc: "2.0",
            id: message.id,
            result: {
              name: `Fake ${type}`,
              type,
              capabilities: { browser: [], tab: [] },
              metadata: {},
            },
          }),
        );
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });

  return {
    server,
    getInfoCalls: () => getInfoCalls,
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) {
          socket.destroy();
        }
        server.close(resolve);
      }),
  };
}

async function testFrameCodec() {
  const decoder = new FrameDecoder();
  const first = frameMessage({ id: 1, method: "a" });
  const second = frameMessage({ id: 2, method: "b" });
  const frames = decoder.push(Buffer.concat([first.subarray(0, 3), first.subarray(3), second]));

  assert.deepEqual(frames.map((frame) => parseFrame(frame).id), [1, 2]);
}

async function testRegistryRegisterAndPrune() {
  const tempDir = makeTempDir("codex-browser-registry-test-");
  const registryPath = path.join(tempDir, "registry.json");

  try {
    const unregister = registerBrowserBackend({
      type: "extension",
      socketPath: path.join(tempDir, "extension.sock"),
      owner: "test-extension",
      registryPath,
    });
    assert.equal(readBrowserBackendRegistry(registryPath).backends.length, 1);

    writeBrowserBackendRegistry(
      {
        version: 1,
        backends: [
          ...readBrowserBackendRegistry(registryPath).backends,
          {
            type: "iab",
            socketPath: path.join(tempDir, "stale.sock"),
            pid: 999999999,
            createdAtMs: Date.now(),
            owner: "stale-test",
          },
        ],
      },
      registryPath,
    );

    const pruned = pruneBrowserBackendRegistry(registryPath);
    assert.equal(pruned.backends.length, 1);
    assert.equal(pruned.backends[0].type, "extension");

    unregister();
    assert.equal(existsSync(registryPath), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testNativeHostRegistryAndRequestIds() {
  const tempDir = makeTempDir("codex-browser-host-test-");
  const registryPath = path.join(tempDir, "registry.json");
  const hostPath = path.join(runtimeDir, "chrome-extension-host.mjs");
  const child = spawn(process.execPath, [hostPath], {
    env: { ...process.env, CODEX_BROWSER_BACKENDS_REGISTRY: registryPath },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const chromeStdoutDecoder = new FrameDecoder();

  try {
    const entry = await waitFor(() => {
      const registry = readBrowserBackendRegistry(registryPath);
      return registry.backends.find((backend) => backend.type === "extension");
    }, "Chrome native host registry entry");

    assert.equal(entry.owner, "chrome-native-host");
    assert.equal(entry.pid, child.pid);

    const clientA = net.createConnection(entry.socketPath);
    const clientB = net.createConnection(entry.socketPath);
    const decoderA = new FrameDecoder();
    const decoderB = new FrameDecoder();
    await Promise.all([
      new Promise((resolve) => clientA.once("connect", resolve)),
      new Promise((resolve) => clientB.once("connect", resolve)),
    ]);

    clientA.write(frameMessage({ jsonrpc: "2.0", id: 7, method: "test.a" }));
    clientB.write(frameMessage({ jsonrpc: "2.0", id: 7, method: "test.b" }));

    const forwardedA = await readFrame(child.stdout, chromeStdoutDecoder, "first forwarded Chrome request");
    const forwardedB = await readFrame(child.stdout, chromeStdoutDecoder, "second forwarded Chrome request");

    assert.notEqual(forwardedA.id, forwardedB.id);
    assert.match(String(forwardedA.id), new RegExp(`^${child.pid}:`));
    assert.match(String(forwardedB.id), new RegExp(`^${child.pid}:`));

    child.stdin.write(frameMessage({ jsonrpc: "2.0", id: forwardedB.id, result: { client: "b" } }));
    child.stdin.write(frameMessage({ jsonrpc: "2.0", id: forwardedA.id, result: { client: "a" } }));

    const responseB = await readFrame(clientB, decoderB, "client B response");
    const responseA = await readFrame(clientA, decoderA, "client A response");
    assert.deepEqual(responseA, { jsonrpc: "2.0", id: 7, result: { client: "a" } });
    assert.deepEqual(responseB, { jsonrpc: "2.0", id: 7, result: { client: "b" } });

    clientA.destroy();
    clientB.destroy();
  } finally {
    child.kill("SIGTERM");
    await waitForChildExit(child);
    await sleep(50);
    assert.equal(readBrowserBackendRegistry(registryPath).backends.length, 0);
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testNativeHostHandlesChromePing() {
  const tempDir = makeTempDir("codex-browser-host-ping-test-");
  const registryPath = path.join(tempDir, "registry.json");
  const hostPath = path.join(runtimeDir, "chrome-extension-host.mjs");
  const child = spawn(process.execPath, [hostPath], {
    env: { ...process.env, CODEX_BROWSER_BACKENDS_REGISTRY: registryPath },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const chromeStdoutDecoder = new FrameDecoder();

  try {
    await waitFor(() => readBrowserBackendRegistry(registryPath).backends.find((backend) => backend.type === "extension"), "Chrome native host ping registry entry");
    child.stdin.write(frameMessage({ jsonrpc: "2.0", id: 21, method: "ping" }));
    const response = await readFrame(child.stdout, chromeStdoutDecoder, "native host ping response");
    assert.deepEqual(response, { jsonrpc: "2.0", id: 21, result: "pong" });
  } finally {
    child.kill("SIGTERM");
    await waitForChildExit(child);
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testNativeHostTimesOutMissingChromeResponse() {
  const tempDir = makeTempDir("codex-browser-host-timeout-test-");
  const registryPath = path.join(tempDir, "registry.json");
  const hostPath = path.join(runtimeDir, "chrome-extension-host.mjs");
  const child = spawn(process.execPath, [hostPath], {
    env: { ...process.env, CODEX_BROWSER_BACKENDS_REGISTRY: registryPath },
    stdio: ["pipe", "pipe", "pipe"],
  });

  try {
    const entry = await waitFor(() => {
      const registry = readBrowserBackendRegistry(registryPath);
      return registry.backends.find((backend) => backend.type === "extension");
    }, "Chrome native host timeout registry entry");

    const client = net.createConnection(entry.socketPath);
    const decoder = new FrameDecoder();
    await new Promise((resolve) => client.once("connect", resolve));
    client.write(frameMessage({ jsonrpc: "2.0", id: 11, method: "slow.test" }));
    const response = await readFrame(client, decoder, "native host timeout response", 15_000);
    assert.equal(response.id, 11);
    assert.match(response.error?.message, /Chrome native host request timed out: slow\.test/);
    client.destroy();
    const exit = await waitForChildExit(child);
    assert.equal(exit.code, 1);
    await waitFor(() => readBrowserBackendRegistry(registryPath).backends.length === 0, "Chrome native host timeout registry cleanup");
  } finally {
    child.kill("SIGTERM");
    await waitForChildExit(child);
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function copyAndPatchChromeFixture(tempDir) {
  const chromeRoot = path.join(tempDir, "chrome");
  copyFixtureTree(chromeFixtureRoot, chromeRoot);

  const clientPath = path.join(chromeRoot, "scripts", "browser-client.mjs");
  const runningCheckPath = path.join(chromeRoot, "scripts", "chrome-is-running.js");
  const manifestCheckPath = path.join(chromeRoot, "scripts", "check-native-host-manifest.js");
  const installManifestPath = path.join(chromeRoot, "scripts", "installManifest.mjs");
  const skillPath = path.join(chromeRoot, "skills", "control-chrome", "SKILL.md");
  const fileUploadsDocPath = path.join(chromeRoot, "docs", "file-uploads.md");
  const uploadTroubleshootingDocPath = path.join(chromeRoot, "docs", "chrome-file-upload-troubleshooting.md");
  normalizeChromeInstallManifestFixture(installManifestPath);
  if (
    readFileSync(clientPath, "utf8").includes("CODEX_BROWSER_BACKENDS_REGISTRY") &&
    readFileSync(clientPath, "utf8").includes("browserAutomation") &&
    readFileSync(clientPath, "utf8").includes("codexLinuxChromeBackendAllowlist") &&
    readFileSync(clientPath, "utf8").includes("codexFileChooserTimeoutMax") &&
    !/globalThis\.nodeRepl|[$A-Z_a-z][$\w]*\.nodeRepl|outside node repl|privilegedNodeRepl/.test(
      readFileSync(clientPath, "utf8"),
    ) &&
    /[$A-Z_a-z][$\w]*\(\)==="linux"\?"\.config\/google-chrome"/.test(readFileSync(clientPath, "utf8")) &&
    readFileSync(runningCheckPath, "utf8").includes("isLinuxExtensionCapableChromeCommand") &&
    readFileSync(manifestCheckPath, "utf8").includes('process.platform === "linux"') &&
    readFileSync(manifestCheckPath, "utf8").includes("getExpectedLinuxHostConfig(manifest") &&
    readFileSync(installManifestPath, "utf8").includes("browserAutomationPath") &&
    readFileSync(installManifestPath, "utf8").includes("t.appServerRuntimePaths") &&
    readFileSync(installManifestPath, "utf8").includes("Missing staged Chrome extension host") &&
    readFileSync(skillPath, "utf8").includes("Visible Tool Surface") &&
    !/node_repl|Node REPL|mcp__node_repl|nodeRepl|REPL/.test(readFileSync(skillPath, "utf8")) &&
    readFileSync(fileUploadsDocPath, "utf8").includes("Chrome file chooser waits honor `timeoutMs`") &&
    readFileSync(uploadTroubleshootingDocPath, "utf8").includes("Use this only after a chooser opened")
  ) {
    return chromeRoot;
  }

  const patchResult = spawnSync(process.execPath, [path.join(scriptDir, "patch-chrome-plugin.mjs"), chromeRoot], {
    encoding: "utf8",
    stdio: "pipe",
  });
  if (patchResult.status !== 0) {
    throw new Error([patchResult.stdout, patchResult.stderr].filter(Boolean).join("\n"));
  }

  return chromeRoot;
}

function normalizeChromeInstallManifestFixture(installManifestPath) {
  let source = readFileSync(installManifestPath, "utf8");
  if (
    source.includes("nodeReplPath") ||
    source.includes("Missing staged Chrome extension host") ||
    !source.includes("browserAutomationPath") ||
    !source.includes("t.appServerRuntimePaths")
  ) {
    return;
  }

  source = source.replaceAll("browserAutomationPath", "nodeReplPath");
  source = source.replace(
    `var N=(t,e)=>{if(process.platform==="linux"){let o=e?.nodeReplPath;if(typeof o!=="string"||!o.trim())throw new Error("Missing staged nodeReplPath for Linux Chrome native host install");let n=P.resolve(P.dirname(o),"plugins","openai-bundled","plugins","chrome"),r=l(n);if(!A(r))throw new Error(\`Missing staged Chrome extension host at \${r}\`);return n}let i=P.resolve(t).split(P.sep),a=i.lastIndexOf("cache");return a<1||i[a-1]!=="plugins"||i.length<=a+3?t:P.resolve(t,"..","latest")};`,
    `var N=t=>{let e=P.resolve(t).split(P.sep),o=e.lastIndexOf("cache");return o<1||e[o-1]!=="plugins"||e.length<=o+3?t:P.resolve(t,"..","latest")};`,
  );
  source = source.replace(
    `var Pt=async t=>{let e=N(D.resolve(import.meta.dirname,".."),t.appServerRuntimePaths);`,
    `var Pt=async t=>{let e=N(D.resolve(import.meta.dirname,".."));`,
  );
  writeFileSync(installManifestPath, source);
}

function writeFakeChromeExtensionHost(chromeRoot) {
  const hostDir = path.join(chromeRoot, "extension-host", "linux", process.arch);
  mkdirSync(hostDir, { recursive: true });
  const hostPath = path.join(hostDir, "extension-host");
  writeFileSync(hostPath, "#!/bin/sh\nexit 0\n");
  chmodSync(hostPath, 0o755);
  return hostPath;
}

function copyAndPatchBrowserFixture(tempDir) {
  const browserRoot = path.join(tempDir, "browser");
  copyFixtureTree(browserFixtureRoot, browserRoot);

  const patchResult = spawnSync(process.execPath, [path.join(scriptDir, "patch-browser-use-plugin.mjs"), browserRoot], {
    encoding: "utf8",
    stdio: "pipe",
  });
  if (patchResult.status !== 0) {
    throw new Error([patchResult.stdout, patchResult.stderr].filter(Boolean).join("\n"));
  }

  return browserRoot;
}

function copyFixtureTree(sourceRoot, destinationRoot) {
  const resolvedSourceRoot = realpathSync(sourceRoot);
  assert.equal(statSync(resolvedSourceRoot).isDirectory(), true, `fixture source must be a directory: ${sourceRoot}`);
  cpSync(resolvedSourceRoot, destinationRoot, {
    recursive: true,
    dereference: true,
    errorOnExist: true,
    force: false,
  });
  assert.equal(lstatSync(destinationRoot).isSymbolicLink(), false, `fixture copy must own its root: ${destinationRoot}`);
  assert.notEqual(realpathSync(destinationRoot), resolvedSourceRoot, `fixture copy escaped to its source: ${sourceRoot}`);
  return destinationRoot;
}

function testFixtureCopiesOwnRootSymlinkTargets() {
  const tempDir = makeTempDir("codex-browser-fixture-copy-");
  try {
    const sourceRoot = path.join(tempDir, "source");
    const sourceLink = path.join(tempDir, "source-link");
    const destinationRoot = path.join(tempDir, "destination");
    const markerPath = "fixture-marker.txt";
    mkdirSync(sourceRoot);
    writeFileSync(path.join(sourceRoot, markerPath), "source\n");
    symlinkSync(sourceRoot, sourceLink, "dir");

    copyFixtureTree(sourceLink, destinationRoot);
    writeFileSync(path.join(destinationRoot, markerPath), "destination\n");

    assert.equal(lstatSync(destinationRoot).isSymbolicLink(), false);
    assert.equal(readFileSync(path.join(sourceRoot, markerPath), "utf8"), "source\n");
    assert.equal(readFileSync(path.join(destinationRoot, markerPath), "utf8"), "destination\n");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function testBrowserClientPatchLocatorsPreserveRenamedMinifiedSymbols() {
  const syntheticSource = [
    'function alpha(){let bridge=globalThis.nodeRepl?.nativePipe;return bridge==null||typeof bridge.createConnection!="function"?null:bridge}',
    'function beta(e){let mode=globalThis.nodeRepl?.env.MODE;return e.nodeRepl?.setResponseMeta({mode}),mode}',
    'function gamma({internalBuild:e=!1,privilegedNodeRepl:t=readGlobal()}={}){if(t==null)return fail("Browser security unavailable outside node repl");return t}',
    'async function connectBackend(sock,make){let api=null,phase="pipe-connect";try{let transport=await NativePipe.create(sock);api=make(transport),phase="backend-info-request";let info=await withTimeout(api.getInfo()),full=await enrich(info).catch(err=>(log(err),info));return{browser:{id:crypto.randomUUID().substring(8),api:api,info:await augment(full),pipe:sock}}}catch(problem){return await api?.close(),log(problem),{failure:`${phase}/${fmt(problem)}`}}}',
    'var discover=()=>platform()==="win32"?readWin():readLinux(),readLinux=async()=>(await readdir(prefix)).map(entry=>Path.resolve(prefix,entry)),readWin=async()=>{let root="\\\\.\\pipe\\";return(await readdir(root)).map(winEntry=>Path.resolve(root,winEntry)).filter(candidate=>candidate.startsWith(prefix))};',
    'let pending=this.api.moveMouse({tabId:tab,...opts.waitForArrival===!1?{waitForArrival:!1}:{},x:px,y:py});if(opts.waitForArrival===!1){pending.catch(()=>{});return}await pending',
    'async clickPoint(event){let tab=normalize(event.tabId),timeout=normalizeTimeout({timeout_ms:event.timeoutMs}),button=event.button??"left",targets=event.loadTarget==null||!isLoad(event.loadTarget)?[tab]:[event.loadTarget,tab],wait=Promise.all(targets.map(async target=>this.cdp.waitForPageLoadEvent(target,{timeoutMs:timeout}))),ignored=wait.catch(()=>{});try{await this.dispatchMouseMove(tab,event.point,event.modifiers);for(let idx=1;idx<=event.clickCount;idx+=1)await this.dispatchMouseDown({button:button,clickCount:idx,modifiers:event.modifiers,point:event.point,tabId:tab}),await this.dispatchMouseUp({button:button,clickCount:idx,modifiers:event.modifiers,point:event.point,tabId:tab})}catch(err){throw await ignored,err}await wait}async dispatchMouseDown(',
    'var profileRoot=resolve(homeDir(),platform()==="win32"?"AppData\\\\Local\\\\Google\\\\Chrome\\\\User Data":"Library/Application Support/Google/Chrome");',
    'var waitFileChooser=command("playwright_wait_for_file_chooser",async(payload,context)=>{let tab=normalizeTab(payload.tab_id),timeout=normalizeTimeout(payload);await context.cdp.call(tab,"Page.enable"),await context.cdp.call(tab,"Page.setInterceptFileChooserDialog",{enabled:!0});try{let event=await context.cdp.waitForEvent(tab,predicate,{timeoutMs:timeout,timeoutMessage:`Timed out after ${timeout}ms waiting for file chooser.`}),id=crypto.randomUUID(),chooser=extract(tab,event);return context.cdp.fileChoosersById.set(id,chooser),{file_chooser_id:id,is_multiple:chooser.isMultiple}}finally{await context.cdp.call(tab,"Page.setInterceptFileChooserDialog",{enabled:!1}).catch(()=>{})}});',
    'var allowed=new Set(["about:blank"]);function isAllowed(url){if(allowed.has(url))return!0;let parsed;try{parsed=new URL(url)}catch{return!1}return parsed.protocol==="http:"||parsed.protocol==="https:"}',
  ].join(";");

  const browserPatches = [...COMMON_BROWSER_CLIENT_PATCHES, ...BROWSER_ONLY_BROWSER_CLIENT_PATCHES];
  const patched = patchSource(syntheticSource, browserPatches, "synthetic browser-client");
  for (const marker of [
    "globalThis.__codexNativePipe",
    "globalThis.browserAutomation",
    "privilegedBrowserAutomation",
    "outside browser automation",
    "browser backend info request timed out",
    "CODEX_BROWSER_BACKENDS_REGISTRY",
    "waitForArrival:!1",
    '==="linux"?".config/google-chrome"',
    'protocol==="file:"',
    "codexFileChooserTimeoutMax",
  ]) {
    assert.equal(patched.includes(marker), true, `patched source should include ${marker}`);
  }

  for (const patch of browserPatches) {
    assert.equal(typeof patch.locatorStrategy, "string", `${patch.label} should declare a locator strategy`);
    assert.equal(typeof patch.risk, "string", `${patch.label} should declare a drift risk`);
  }

  const policySyntheticSource =
    'var allowed=new Set(["about:blank"]);function isAllowed(url){if(allowed.has(url))return!0;let parsed;try{parsed=new URL(url)}catch{return!1}return parsed.protocol==="http:"||parsed.protocol==="https:"}';
  const policyPatched = patchSource(
    policySyntheticSource,
    BROWSER_ONLY_BROWSER_CLIENT_PATCHES,
    "synthetic Browser file URL policy",
  );
  const policyProbe = new Function(
    "URL",
    `${policyPatched}; return {
      aboutBlank: isAllowed("about:blank"),
      http: isAllowed("http://127.0.0.1:3000/"),
      file: isAllowed("file:///tmp/codex-preview.html"),
      data: isAllowed("data:text/html,blocked"),
    };`,
  );
  assert.deepEqual(policyProbe(URL), {
    aboutBlank: true,
    http: true,
    file: true,
    data: false,
  });

  const chromeSyntheticSource =
    'function available(){let value=readEnv(KEY);return value==null?null:split(value).filter(isKnown)}';
  const chromePatched = patchSource(
    chromeSyntheticSource,
    CHROME_ONLY_BROWSER_CLIENT_PATCHES,
    "synthetic chrome browser-client",
  );
  assert.equal(chromePatched.includes("codexLinuxChromeBackendAllowlist"), true);
  assert.equal(chromePatched.includes('includes("chrome")'), true);
  for (const patch of CHROME_ONLY_BROWSER_CLIENT_PATCHES) {
    assert.equal(typeof patch.locatorStrategy, "string", `${patch.label} should declare a locator strategy`);
    assert.equal(typeof patch.risk, "string", `${patch.label} should declare a drift risk`);
  }
}

async function testPatchedBrowserClientStaticMarkers() {
  const tempDir = makeTempDir("codex-browser-client-static-");
  try {
    const chromeRoot = copyAndPatchChromeFixture(tempDir);
    const clientSource = readFileSync(path.join(chromeRoot, "scripts", "browser-client.mjs"), "utf8");
    assert.equal(clientSource.includes("OS(Zf)"), false);
    assert.equal(clientSource.includes("map(e=>BS.resolve(Zf,e))"), false);
    assert.equal(clientSource.includes("CODEX_BROWSER_BACKENDS_REGISTRY"), true);
    assert.equal(clientSource.includes("Linux browser backend registry unavailable"), true);
    assert.equal(clientSource.includes('/proc/${l.ppid}/environ'), true);
    assert.equal(clientSource.includes("browser backend registry type mismatch"), true);
    assert.equal(clientSource.includes("browser backend info request timed out"), true);
    assert.equal(clientSource.includes("codexLinuxChromeBackendAllowlist"), true);
    assert.equal(clientSource.includes("browserAutomation"), true);
    assert.equal(/globalThis\.nodeRepl|[$A-Z_a-z][$\w]*\.nodeRepl/.test(clientSource), false);
    assert.equal(clientSource.includes("NodeRepl"), false);
    assert.equal(clientSource.includes("outside node repl"), false);
    assert.match(clientSource, /[$A-Z_a-z][$\w]*\(\)==="linux"\?"\.config\/google-chrome"/);
    assert.match(clientSource, currentDirectClickMouseMoveRegex);
    assert.match(clientSource, currentFileChooserTimeoutMaxRegex);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testPatchedInAppBrowserClientAllowsFileUrls() {
  const tempDir = makeTempDir("codex-iab-browser-client-static-");
  try {
    const browserRoot = copyAndPatchBrowserFixture(tempDir);
    const clientSource = readFileSync(path.join(browserRoot, "scripts", "browser-client.mjs"), "utf8");
    assert.equal(clientSource.includes('protocol==="file:"'), true);
    assert.equal(clientSource.includes("cannot visit the requested page because its URL is blocked by the"), true);
    assert.equal(clientSource.includes("URL policy"), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testPatchedChromeRunningCheckerIgnoresExtensionlessLinuxChrome() {
  const tempDir = makeTempDir("codex-chrome-running-");
  try {
    const chromeRoot = copyAndPatchChromeFixture(tempDir);
    const scriptPath = path.join(chromeRoot, "scripts", "chrome-is-running.js");
    const scriptSource = readFileSync(scriptPath, "utf8");
    assert.equal(scriptSource.includes("isLinuxExtensionCapableChromeCommand"), true);
    assert.equal(scriptSource.includes('"-ww"'), true);

    const binDir = path.join(tempDir, "bin");
    const psPath = path.join(binDir, "ps");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(
      psPath,
      `#!/usr/bin/env bash
cat <<'EOF'
  4901 /opt/google/chrome/chrome --headless=new --disable-extensions --user-data-dir=/tmp/puppeteer_dev_chrome_profile-Cv6IpR about:blank
  5100 /opt/google/chrome/chrome --type=zygote --user-data-dir=/tmp/puppeteer_dev_chrome_profile-Cv6IpR
EOF
`,
    );
    chmodSync(psPath, 0o755);

    const extensionless = spawnSync(process.execPath, [scriptPath, "--json"], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
      stdio: "pipe",
    });
    assert.equal(extensionless.status, 0, extensionless.stderr);
    assert.equal(JSON.parse(extensionless.stdout).running, false);

    writeFileSync(
      psPath,
      `#!/usr/bin/env bash
cat <<'EOF'
  6001 /opt/google/chrome/chrome --profile-directory=Profile 5
  6010 /opt/google/chrome/chrome --type=renderer --profile-directory=Profile 5
EOF
`,
    );

    const normal = spawnSync(process.execPath, [scriptPath, "--json"], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
      stdio: "pipe",
    });
    assert.equal(normal.status, 0, normal.stderr);
    const normalResult = JSON.parse(normal.stdout);
    assert.equal(normalResult.running, true);
    assert.deepEqual(
      normalResult.processes.map((chromeProcess) => chromeProcess.pid),
      [6001],
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testPatchedChromeInstallManifestUsesStagedPluginRoot() {
  const tempDir = makeTempDir("codex-chrome-install-manifest-");
  try {
    const cacheChromeRoot = copyAndPatchChromeFixture(tempDir);
    writeFakeChromeExtensionHost(cacheChromeRoot);
    const resourcesDir = path.join(tempDir, "staged", "resources");
    const stagedChromeRoot = path.join(resourcesDir, "plugins", "openai-bundled", "plugins", "chrome");
    copyFixtureTree(cacheChromeRoot, stagedChromeRoot);

    for (const helper of ["codex", "node", "browser_automation"]) {
      const helperPath = path.join(resourcesDir, helper);
      writeFileSync(helperPath, "#!/bin/sh\nexit 0\n");
      chmodSync(helperPath, 0o755);
    }

    const homeDir = path.join(tempDir, "home");
    mkdirSync(homeDir, { recursive: true });
    const installScript = path.join(cacheChromeRoot, "scripts", "installManifest.mjs");
    const installResult = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
          const { install } = await import(${JSON.stringify(pathToFileURL(installScript).href)});
          await install({
            appServerRuntimePaths: {
              codexCliPath: ${JSON.stringify(path.join(resourcesDir, "codex"))},
              nodePath: ${JSON.stringify(path.join(resourcesDir, "node"))},
              browserAutomationPath: ${JSON.stringify(path.join(resourcesDir, "browser_automation"))},
            },
          });
        `,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, HOME: homeDir },
        stdio: "pipe",
      },
    );
    assert.equal(installResult.status, 0, installResult.stderr);

    const manifestPath = path.join(homeDir, ".config", "google-chrome", "NativeMessagingHosts", "com.openai.codexextension.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const expectedHostPath = path.join(stagedChromeRoot, "extension-host", "linux", process.arch, "extension-host");
    assert.equal(manifest.path, expectedHostPath);

    const configPath = path.join(path.dirname(expectedHostPath), "extension-host-config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    assert.equal(config.browserClientPath, path.join(stagedChromeRoot, "scripts", "browser-client.mjs"));
    assert.equal(config.codexCliPath, path.join(resourcesDir, "codex"));
    assert.equal(config.nodePath, path.join(resourcesDir, "node"));
    assert.equal(config.browserAutomationPath, path.join(resourcesDir, "browser_automation"));

    const checkerPath = path.join(stagedChromeRoot, "scripts", "check-native-host-manifest.js");
    const validCheck = spawnSync(process.execPath, [checkerPath, "--json"], {
      encoding: "utf8",
      env: { ...process.env, HOME: homeDir },
      stdio: "pipe",
    });
    assert.equal(validCheck.status, 0, validCheck.stderr);
    assert.equal(JSON.parse(validCheck.stdout).correct, true);

    const cacheRootCheck = spawnSync(
      process.execPath,
      [path.join(cacheChromeRoot, "scripts", "check-native-host-manifest.js"), "--json"],
      {
        encoding: "utf8",
        env: { ...process.env, HOME: homeDir },
        stdio: "pipe",
      },
    );
    assert.equal(cacheRootCheck.status, 0, cacheRootCheck.stderr);
    assert.equal(JSON.parse(cacheRootCheck.stdout).correct, true);

    const cacheHostPath = path.join(cacheChromeRoot, "extension-host", "linux", process.arch, "extension-host");
    writeFileSync(
      manifestPath,
      `${JSON.stringify(
        {
          ...manifest,
          path: cacheHostPath,
        },
        null,
        2,
      )}\n`,
    );
    const cacheConfigPath = path.join(path.dirname(cacheHostPath), "extension-host-config.json");
    writeFileSync(
      cacheConfigPath,
      `${JSON.stringify(
        {
          browserClientPath: path.join(cacheChromeRoot, "scripts", "browser-client.mjs"),
          codexCliPath: path.join(tempDir, "old", "codex"),
          nodePath: path.join(tempDir, "old", "node"),
          browserAutomationPath: path.join(tempDir, "old", "browser_automation"),
        },
        null,
        2,
      )}\n`,
    );

    const staleCheck = spawnSync(process.execPath, [checkerPath, "--json"], {
      encoding: "utf8",
      env: { ...process.env, HOME: homeDir },
      stdio: "pipe",
    });
    assert.equal(staleCheck.status, 1, staleCheck.stderr);
    const staleResult = JSON.parse(staleCheck.stdout);
    assert.equal(staleResult.correct, false);
    assert.equal(staleResult.hostPathMatchesExpected, false);
    assert.equal(staleResult.hostConfigMatchesExpected, false);
    assert.match(staleResult.problem, /staged Chrome extension host/);
    assert.match(staleResult.problem, /staged runtime paths/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testPatchedChromeInstallManifestFailsWithoutStagedPluginRoot() {
  const tempDir = makeTempDir("codex-chrome-install-manifest-missing-");
  try {
    const cacheChromeRoot = copyAndPatchChromeFixture(tempDir);
    const resourcesDir = path.join(tempDir, "staged", "resources");
    mkdirSync(resourcesDir, { recursive: true });
    for (const helper of ["codex", "node", "browser_automation"]) {
      const helperPath = path.join(resourcesDir, helper);
      writeFileSync(helperPath, "#!/bin/sh\nexit 0\n");
      chmodSync(helperPath, 0o755);
    }

    const homeDir = path.join(tempDir, "home");
    mkdirSync(homeDir, { recursive: true });
    const installScript = path.join(cacheChromeRoot, "scripts", "installManifest.mjs");
    const installResult = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
          const { install } = await import(${JSON.stringify(pathToFileURL(installScript).href)});
          await install({
            appServerRuntimePaths: {
              codexCliPath: ${JSON.stringify(path.join(resourcesDir, "codex"))},
              nodePath: ${JSON.stringify(path.join(resourcesDir, "node"))},
              browserAutomationPath: ${JSON.stringify(path.join(resourcesDir, "browser_automation"))},
            },
          });
        `,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, HOME: homeDir },
        stdio: "pipe",
      },
    );
    assert.notEqual(installResult.status, 0);
    assert.match(installResult.stderr, /Missing staged Chrome extension host/);
    assert.equal(
      existsSync(path.join(homeDir, ".config", "google-chrome", "NativeMessagingHosts", "com.openai.codexextension.json")),
      false,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function testPatchedChromeInstallManifestPatchLocators() {
  const chromeRoot = copyAndPatchChromeFixture(makeTempDir("codex-chrome-install-locator-"));
  try {
    const installSource = readFileSync(path.join(chromeRoot, "scripts", "installManifest.mjs"), "utf8");
    const manifestCheckSource = readFileSync(path.join(chromeRoot, "scripts", "check-native-host-manifest.js"), "utf8");
    assert.equal(installSource.includes("t.appServerRuntimePaths"), true);
    assert.equal(installSource.includes("Missing staged Chrome extension host"), true);
    assert.equal(manifestCheckSource.includes("getExpectedLinuxHostConfig(manifest"), true);
    assert.equal(manifestCheckSource.includes("hostConfigMatchesExpected"), true);
  } finally {
    rmSync(path.dirname(chromeRoot), { recursive: true, force: true });
  }
}

function testPatchedChromePluginPatcherIsIdempotent() {
  const chromeRoot = copyAndPatchChromeFixture(makeTempDir("codex-chrome-patch-idempotent-"));
  try {
    const patchResult = spawnSync(process.execPath, [path.join(scriptDir, "patch-chrome-plugin.mjs"), chromeRoot], {
      encoding: "utf8",
      stdio: "pipe",
    });
    assert.equal(patchResult.status, 0, [patchResult.stdout, patchResult.stderr].filter(Boolean).join("\n"));
  } finally {
    rmSync(path.dirname(chromeRoot), { recursive: true, force: true });
  }
}

async function testPatchedChromeSkillUsesBrowserAutomationToolSurface() {
  const tempDir = makeTempDir("codex-chrome-skill-guidance-");
  try {
    const chromeRoot = copyAndPatchChromeFixture(tempDir);
    const skillSource = readFileSync(path.join(chromeRoot, "skills", "control-chrome", "SKILL.md"), "utf8");
    assert.equal(skillSource.includes("## Visible Tool Surface"), true);
    assert.equal(skillSource.includes("Do not conclude that Chrome DOM/DevTools automation is unavailable"), true);
    assert.equal(skillSource.includes("Computer Use tools is not evidence"), true);
    assert.equal(skillSource.includes("browser.tabs.new()"), true);
    assert.equal(skillSource.includes("not `browser.tabs.create()`"), true);
    assert.equal(skillSource.includes("tab.playwright.locator"), true);
    assert.equal(skillSource.includes("not `tab.locator(...)`"), true);
    assert.equal(skillSource.includes("browser_automation"), true);
    assert.equal(skillSource.includes("mcp__browser_automation__js"), true);
    assert.equal(skillSource.includes("browserAutomation.write"), true);
    assert.equal(/node_repl|Node REPL|mcp__node_repl|nodeRepl|REPL/.test(skillSource), false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function testPatchedChromeFileUploadDocsDistinguishChooserTimeout() {
  const tempDir = makeTempDir("codex-chrome-upload-docs-");
  try {
    const chromeRoot = copyAndPatchChromeFixture(tempDir);
    const fileUploadsDoc = readFileSync(path.join(chromeRoot, "docs", "file-uploads.md"), "utf8");
    const troubleshootingDoc = readFileSync(
      path.join(chromeRoot, "docs", "chrome-file-upload-troubleshooting.md"),
      "utf8",
    );

    assert.equal(fileUploadsDoc.includes("Chrome file chooser waits honor `timeoutMs`"), true);
    assert.equal(fileUploadsDoc.includes("input.value"), true);
    assert.equal(fileUploadsDoc.includes("Do not treat unreadable or empty `input.files`"), true);
    assert.equal(
      fileUploadsDoc.includes("Do not tell the user to enable Chrome file URL access for that timeout alone"),
      true,
    );
    assert.equal(fileUploadsDoc.includes("chooser.setFiles(...)` fails with a Chrome permission"), true);
    assert.equal(
      troubleshootingDoc.includes("If file upload fails while setting files through a file chooser"),
      false,
    );
    assert.equal(troubleshootingDoc.includes("Use this only after a chooser opened"), true);
    assert.equal(troubleshootingDoc.includes("Allow access to file URLs"), true);
    assert.equal(
      troubleshootingDoc.includes('Do not use this permission prompt for `waitForEvent("filechooser")` timeouts'),
      true,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function testPatchedBrowserSkillUsesBrowserAutomationToolSurface() {
  const syntheticSource = [
    "Never mention `Node REPL`, `node_repl`, `REPL`, JavaScript sessions, or module exports unless a user is asking for that exact information.",
    "Run browser setup code through the Node REPL `js` tool.",
    "The callable tool id typically appears as `mcp__node_repl__js`.",
    "Run this once per fresh `node_repl` session.",
    "nodeRepl.emitImage({ type: `image` });",
    "In `node_repl` you can use Node filesystem libraries when needed.",
  ].join("\n");

  const patched = patchSource(syntheticSource, BROWSER_SKILL_GUIDANCE_PATCHES, "synthetic browser skill");
  assert.equal(patched.includes("browser_automation"), true);
  assert.equal(patched.includes("mcp__browser_automation__js"), true);
  assert.equal(patched.includes("browserAutomation.emitImage"), true);
  assert.equal(/node_repl|Node REPL|mcp__node_repl|nodeRepl|REPL/.test(patched), false);
}

function testPatchedBrowserManifestUsesBrowserAutomationKeyword() {
  const tempDir = makeTempDir("codex-browser-manifest-");
  try {
    const manifestPath = path.join(tempDir, "plugin.json");
    writeFileSync(
      manifestPath,
      `${JSON.stringify({ name: "browser", keywords: ["browser", "node-repl"] }, null, 2)}\n`,
    );
    patchBrowserManifest(manifestPath);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    assert.equal(manifest.keywords.includes("node-repl"), false);
    assert.equal(manifest.keywords.includes("browser-automation"), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function testPatchedBrowserClientRegistryDiscovery() {
  const originalExit = process.exit;
  const tempDir = makeTempDir("codex-browser-client-runtime-");
  const chromeRoot = copyAndPatchChromeFixture(tempDir);
  const registryPath = path.join(tempDir, "registry.json");
  const extensionSocket = path.join(tempDir, "extension.sock");
  const hangSocket = path.join(tempDir, "iab.sock");
  const extensionBackend = await startFakeBackend(extensionSocket, { type: "extension" });
  const hangBackend = await startFakeBackend(hangSocket, { type: "iab", hang: true });

  try {
    writeFileSync(
      registryPath,
      `${JSON.stringify({
        version: 1,
        backends: [
          {
            type: "iab",
            socketPath: hangSocket,
            pid: process.pid,
            createdAtMs: Date.now(),
            owner: "hang-test",
          },
          {
            type: "extension",
            socketPath: extensionSocket,
            pid: process.pid,
            createdAtMs: Date.now(),
            owner: "extension-test",
          },
        ],
      })}\n`,
    );

    process.env.CODEX_BROWSER_BACKENDS_REGISTRY = registryPath;
    globalThis.__codexNativePipe = { createConnection: (socketPath) => net.createConnection(socketPath) };
    globalThis.browserAutomation = {
      env: {
        BROWSER_USE_AVAILABLE_BACKENDS: "iab",
        BROWSER_USE_DISABLE_AMBIENT_NETWORK: "1",
      },
      requestMeta: {
        "x-codex-turn-metadata": { session_id: "linux-browser-runtime-test", turn_id: "turn" },
      },
      setResponseMeta: () => {},
    };

    const startedAt = Date.now();
    const clientUrl = `file://${path.join(chromeRoot, "scripts", "browser-client.mjs")}?${Date.now()}`;
    const clientModule = await import(clientUrl);
    const setupRuntime = clientModule.setupBrowserRuntime ?? clientModule.setupAtlasRuntime;
    assert.equal(typeof setupRuntime, "function", "patched browser client should export a runtime setup function");
    await setupRuntime({ globals: globalThis });
    const discoveredBrowsers = await globalThis.agent.browsers.list();
    assert.equal(
      discoveredBrowsers.some((browser) => browser.type === "extension"),
      true,
      "Chrome client should keep extension backend even when shared MCP env is iab-only",
    );
    assert.ok(Date.now() - startedAt < 6_000, "hung backend should not block discovery indefinitely");
    assert.equal(extensionBackend.getInfoCalls(), 1);
    assert.equal(globalThis.__codexBrowserBackendRegistryByPath.get(extensionSocket).type, "extension");
  } finally {
    process.exit = originalExit;
    delete process.env.CODEX_BROWSER_BACKENDS_REGISTRY;
    delete globalThis.__codexNativePipe;
    delete globalThis.browserAutomation;
    await extensionBackend.close();
    await hangBackend.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

await testFrameCodec();
await testRegistryRegisterAndPrune();
await testNativeHostRegistryAndRequestIds();
await testNativeHostHandlesChromePing();
await testNativeHostTimesOutMissingChromeResponse();
testFixtureCopiesOwnRootSymlinkTargets();
testBrowserClientPatchLocatorsPreserveRenamedMinifiedSymbols();
await testPatchedBrowserClientStaticMarkers();
await testPatchedInAppBrowserClientAllowsFileUrls();
await testPatchedChromeRunningCheckerIgnoresExtensionlessLinuxChrome();
await testPatchedChromeInstallManifestUsesStagedPluginRoot();
await testPatchedChromeInstallManifestFailsWithoutStagedPluginRoot();
testPatchedChromeInstallManifestPatchLocators();
testPatchedChromePluginPatcherIsIdempotent();
await testPatchedChromeSkillUsesBrowserAutomationToolSurface();
testPatchedChromeFileUploadDocsDistinguishChooserTimeout();
testPatchedBrowserSkillUsesBrowserAutomationToolSurface();
testPatchedBrowserManifestUsesBrowserAutomationKeyword();
await testPatchedBrowserClientRegistryDiscovery();

console.error("[INFO] Linux browser runtime tests passed");
realProcess.exit(0);
