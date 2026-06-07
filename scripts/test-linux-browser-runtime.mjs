#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import realProcess from "node:process";
import { fileURLToPath } from "node:url";
import { encodeFrame, FrameDecoder, parseFrame } from "./linux-browser-runtime/frame.mjs";
import { COMMON_BROWSER_CLIENT_PATCHES } from "./linux-browser-runtime/browser-client-patches.mjs";
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

  addVersionedCacheCandidates(candidates, path.join(codexHome, "plugins", "cache", "openai-bundled", "chrome"));

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
    await new Promise((resolve) => child.once("exit", resolve));
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
    await new Promise((resolve) => child.once("exit", resolve));
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
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function copyAndPatchChromeFixture(tempDir) {
  const chromeRoot = path.join(tempDir, "chrome");
  const result = spawnSync(process.execPath, [
    "-e",
    `
      const fs = require("node:fs");
      fs.cpSync(${JSON.stringify(chromeFixtureRoot)}, ${JSON.stringify(chromeRoot)}, { recursive: true });
    `,
  ]);
  if (result.status !== 0) {
    throw new Error("Failed to copy Chrome plugin fixture");
  }

  const clientPath = path.join(chromeRoot, "scripts", "browser-client.mjs");
  const runningCheckPath = path.join(chromeRoot, "scripts", "chrome-is-running.js");
  const manifestCheckPath = path.join(chromeRoot, "scripts", "check-native-host-manifest.js");
  const skillPath = path.join(chromeRoot, "skills", "control-chrome", "SKILL.md");
  if (
    readFileSync(clientPath, "utf8").includes("CODEX_BROWSER_BACKENDS_REGISTRY") &&
    readFileSync(runningCheckPath, "utf8").includes("isLinuxExtensionCapableChromeCommand") &&
    readFileSync(manifestCheckPath, "utf8").includes('process.platform === "linux"') &&
    readFileSync(skillPath, "utf8").includes("Visible Tool Surface")
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

function testBrowserClientPatchLocatorsPreserveRenamedMinifiedSymbols() {
  const syntheticSource = [
    'function alpha(){let bridge=globalThis.nodeRepl?.nativePipe;return bridge==null||typeof bridge.createConnection!="function"?null:bridge}',
    'async function connectBackend(sock,make){let api=null,phase="pipe-connect";try{let transport=await NativePipe.create(sock);api=make(transport),phase="backend-info-request";let info=await api.getInfo(),full=await enrich(info).catch(err=>(log(err),info));return{browser:{id:crypto.randomUUID().substring(8),api:api,info:norm(await augment(full))}}}catch(problem){return await api?.close(),log(problem),{failure:`${phase}/${fmt(problem)}`}}}',
    'var discover=()=>platform()==="win32"?readWin():readLinux(),readLinux=async()=>(await readdir(prefix)).map(entry=>Path.resolve(prefix,entry)),readWin=async()=>{let root="\\\\.\\pipe\\";return(await readdir(root)).map(winEntry=>Path.resolve(root,winEntry)).filter(candidate=>candidate.startsWith(prefix))};',
    'let pending=this.api.moveMouse({tabId:tab,...opts.waitForArrival===!1?{waitForArrival:!1}:{},x:px,y:py});if(opts.waitForArrival===!1){pending.catch(()=>{});return}await pending',
    'async clickPoint(event){let tab=normalize(event.tabId),timeout=normalizeTimeout({timeout_ms:event.timeoutMs}),button=event.button??"left",targets=event.loadTarget==null||!isLoad(event.loadTarget)?[tab]:[event.loadTarget,tab],wait=Promise.all(targets.map(async target=>this.cdp.waitForPageLoadEvent(target,{timeoutMs:timeout}))),ignored=wait.catch(()=>{});try{await this.dispatchMouseMove(tab,event.point,event.modifiers);for(let idx=1;idx<=event.clickCount;idx+=1)await this.dispatchMouseDown({button:button,clickCount:idx,modifiers:event.modifiers,point:event.point,tabId:tab}),await this.dispatchMouseUp({button:button,clickCount:idx,modifiers:event.modifiers,point:event.point,tabId:tab})}catch(err){throw await ignored,err}await wait}async dispatchMouseDown(',
  ].join(";");

  const patched = patchSource(syntheticSource, COMMON_BROWSER_CLIENT_PATCHES, "synthetic browser-client");
  for (const marker of [
    "globalThis.__codexNativePipe",
    "browser backend info request timed out",
    "CODEX_BROWSER_BACKENDS_REGISTRY",
    "waitForArrival:!1",
    "this.ui.moveMouse",
  ]) {
    assert.equal(patched.includes(marker), true, `patched source should include ${marker}`);
  }

  for (const patch of COMMON_BROWSER_CLIENT_PATCHES) {
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
    assert.equal(clientSource.includes('type:"mouseMoved",x:t.point.x,y:t.point.y,button:"none"'), true);
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

async function testPatchedChromeSkillMakesNodeReplToolSurfaceExplicit() {
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
    globalThis.nodeRepl = {
      env: { BROWSER_USE_DISABLE_AMBIENT_NETWORK: "1" },
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
    assert.ok(Date.now() - startedAt < 6_000, "hung backend should not block discovery indefinitely");
    assert.equal(extensionBackend.getInfoCalls(), 1);
    assert.equal(globalThis.__codexBrowserBackendRegistryByPath.get(extensionSocket).type, "extension");
  } finally {
    process.exit = originalExit;
    delete process.env.CODEX_BROWSER_BACKENDS_REGISTRY;
    delete globalThis.__codexNativePipe;
    delete globalThis.nodeRepl;
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
testBrowserClientPatchLocatorsPreserveRenamedMinifiedSymbols();
await testPatchedBrowserClientStaticMarkers();
await testPatchedChromeRunningCheckerIgnoresExtensionlessLinuxChrome();
await testPatchedChromeSkillMakesNodeReplToolSurfaceExplicit();
await testPatchedBrowserClientRegistryDiscovery();

console.error("[INFO] Linux browser runtime tests passed");
realProcess.exit(0);
