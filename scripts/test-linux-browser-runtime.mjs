#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import realProcess from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { encodeFrame, FrameDecoder, parseFrame } from "./linux-browser-runtime/frame.mjs";
import {
  COMMON_BROWSER_CLIENT_PATCHES,
  patchBrowserClient,
} from "./linux-browser-runtime/browser-client-patches.mjs";
import { CHROME_MANIFEST_CHECK_PATCHES } from "./linux-browser-runtime/chrome-plugin-patches.mjs";
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

async function readFrame(stream, decoder, label, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const onData = (chunk) => {
      try {
        const frames = decoder.push(chunk);
        if (frames.length > 0) {
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

function chromeBrowserClientFixtureSource() {
  const frameModuleUrl = pathToFileURL(path.join(runtimeDir, "frame.mjs")).href;

  return `import net from "node:net";
import * as BS from "node:path";
import { readdir as RD } from "node:fs/promises";
import { homedir as HD, platform as OS } from "node:os";
import { encodeFrame, FrameDecoder, parseFrame } from ${JSON.stringify(frameModuleUrl)};

const Zf="/tmp/codex-native-pipes";
const Resolve=BS.resolve,Home=HD,Platform=OS;
var ChromeProfileRoot=Resolve(Home(),Platform()==="win32"?"AppData\\\\Local\\\\Google\\\\Chrome\\\\User Data":"Library/Application Support/Google/Chrome");

function alpha(){let bridge=globalThis.nodeRepl?.nativePipe;return bridge==null||typeof bridge.createConnection!="function"?null:bridge}
class NativePipe{static async create(socketPath){let bridge=alpha();if(!bridge)throw new Error("native pipe bridge missing");return bridge.createConnection(socketPath)}}
function createApi(socket){return{getInfo(){return new Promise((resolve,reject)=>{let decoder=new FrameDecoder(),timer=setTimeout(()=>reject(new Error("getInfo timed out")),10000);socket.on("data",chunk=>{try{for(let frame of decoder.push(chunk)){let message=parseFrame(frame);if(message.id===1){clearTimeout(timer);resolve(message.result)}}}catch(error){clearTimeout(timer);reject(error)}});socket.write(encodeFrame(JSON.stringify({jsonrpc:"2.0",id:1,method:"getInfo"})))})},close(){socket.destroy()}}}
function enrich(info){return Promise.resolve(info)}
function log(){}
function norm(info){return info}
function fmt(error){return error instanceof Error?error.message:String(error)}
async function connectBackend(sock,make){let api=null,phase="pipe-connect";try{let transport=await NativePipe.create(sock);api=make(transport),phase="backend-info-request";let info=await api.getInfo(),full=await enrich(info).catch(err=>(log(err),info));return{browser:{id:crypto.randomUUID().substring(8),api:api,info:norm(full)}}}catch(problem){return await api?.close(),log(problem),{failure:\`\${phase}/\${fmt(problem)}\`}}}
const prefix=Zf,Path=BS,readDir=RD,platform=OS;
var discover=()=>platform()==="win32"?readWin():readLinux(),readLinux=async()=>(await readDir(prefix)).map(entry=>Path.resolve(prefix,entry)),readWin=async()=>{let root="\\\\\\\\.\\\\pipe\\\\";return(await readDir(root)).map(winEntry=>Path.resolve(root,winEntry)).filter(candidate=>candidate.startsWith(prefix))};
function normalize(tabId){return tabId}
function normalizeTimeout(options){return options.timeout_ms}
function isLoad(target){return Boolean(target)}
class PointerDriver{constructor(){this.api={moveMouse:async()=>{}};this.cdp={waitForPageLoadEvent:async()=>{},call:async()=>{}};this.ui={moveMouse:async()=>{}}}async dispatchMouseMove(){}async dispatchMouseUp(){}async move(tab,opts,px,py){let pending=this.api.moveMouse({tabId:tab,...opts.waitForArrival===!1?{waitForArrival:!1}:{},x:px,y:py});if(opts.waitForArrival===!1){pending.catch(()=>{});return}await pending}async clickPoint(t){let n=normalize(t.tabId),o=normalizeTimeout({timeout_ms:t.timeoutMs}),r=t.button??"left",a=t.loadTarget==null||!isLoad(t.loadTarget)?[n]:[t.loadTarget,n],s=Promise.all(a.map(async l=>this.cdp.waitForPageLoadEvent(l,{timeoutMs:o}))),c=s.catch(()=>{});try{await this.dispatchMouseMove(n,t.point,t.modifiers);for(let i=1;i<=t.clickCount;i+=1)await this.dispatchMouseDown({button:r,clickCount:i,modifiers:t.modifiers,point:t.point,tabId:n}),await this.dispatchMouseUp({button:r,clickCount:i,modifiers:t.modifiers,point:t.point,tabId:n})}catch(e){throw await c,e}await s}async dispatchMouseDown(){}}
export async function setupBrowserRuntime({globals=globalThis}={}){let sockets=await discover(),results=[];for(let socketPath of sockets)results.push(await connectBackend(socketPath,createApi));globals.__codexBrowserRuntimeResults=results;return{results}}
export const setupAtlasRuntime=setupBrowserRuntime;
`;
}

function chromeManifestCheckerFixtureSource() {
  return [
    'import os from "node:os";',
    'import path from "node:path";',
    "",
    'const WINDOWS_NATIVE_HOST_REGISTRY_KEY_PREFIX = "Software\\\\Google\\\\Chrome\\\\NativeMessagingHosts";',
    'const expectedHostName = "com.openai.codex";',
    "",
    "function readWindowsRegistryDefaultValue() {",
    "  return null;",
    "}",
    "",
    "function getDefaultWindowsManifestPath() {",
    '  return "C:\\\\Users\\\\codex\\\\manifest.json";',
    "}",
    "",
    "export function findManifest() {",
    CHROME_MANIFEST_CHECK_PATCHES[0].search,
    "}",
    "",
  ].join("\n");
}

function createAndPatchChromeFixture(tempDir) {
  const chromeRoot = path.join(tempDir, "chrome");
  const scriptsDir = path.join(chromeRoot, "scripts");
  mkdirSync(scriptsDir, { recursive: true });
  writeFileSync(path.join(scriptsDir, "browser-client.mjs"), chromeBrowserClientFixtureSource());
  writeFileSync(path.join(scriptsDir, "check-native-host-manifest.js"), chromeManifestCheckerFixtureSource());

  const clientPath = path.join(chromeRoot, "scripts", "browser-client.mjs");
  if (readFileSync(clientPath, "utf8").includes("CODEX_BROWSER_BACKENDS_REGISTRY")) {
    return chromeRoot;
  }

  patchBrowserClient(clientPath, { includeChromePatches: true });
  return chromeRoot;
}

function testBrowserClientPatchLocatorsPreserveRenamedMinifiedSymbols() {
  const syntheticSource = [
    'function alpha(){let bridge=globalThis.nodeRepl?.nativePipe;return bridge==null||typeof bridge.createConnection!="function"?null:bridge}',
    'async function connectBackend(sock,make){let api=null,phase="pipe-connect";try{let transport=await NativePipe.create(sock);api=make(transport),phase="backend-info-request";let info=await api.getInfo(),full=await enrich(info).catch(err=>(log(err),info));return{browser:{id:crypto.randomUUID().substring(8),api:api,info:norm(full)}}}catch(problem){return await api?.close(),log(problem),{failure:`${phase}/${fmt(problem)}`}}}',
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

function testChromeManifestPatchLocator() {
  const patched = patchSource(
    chromeManifestCheckerFixtureSource(),
    CHROME_MANIFEST_CHECK_PATCHES,
    "synthetic Chrome native host manifest checker",
  );

  assert.equal(patched.includes('process.platform === "linux"'), true);
  assert.equal(patched.includes('"NativeMessagingHosts"'), true);
  assert.equal(patched.includes("macOS, Windows, and Linux"), true);
}

async function testPatchedBrowserClientStaticMarkers() {
  const tempDir = makeTempDir("codex-browser-client-static-");
  try {
    const chromeRoot = createAndPatchChromeFixture(tempDir);
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

async function testPatchedBrowserClientRegistryDiscovery() {
  const originalExit = process.exit;
  const tempDir = makeTempDir("codex-browser-client-runtime-");
  const chromeRoot = createAndPatchChromeFixture(tempDir);
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
testChromeManifestPatchLocator();
await testPatchedBrowserClientStaticMarkers();
await testPatchedBrowserClientRegistryDiscovery();

console.error("[INFO] Linux browser runtime tests passed");
realProcess.exit(0);
