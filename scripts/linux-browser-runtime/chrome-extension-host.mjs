#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, rmSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { BROWSER_SOCKET_ROOT, CHROME_NATIVE_HOST_REQUEST_TIMEOUT_MS } from "./constants.mjs";
import { encodeFrame, FrameDecoder, parseFrame } from "./frame.mjs";
import { pruneBrowserBackendRegistry, registerBrowserBackend } from "./registry.mjs";

const socketPath = path.join(BROWSER_SOCKET_ROOT, `${process.pid}-${randomUUID()}.sock`);
const clients = new Set();
const pendingByHostId = new Map();
let nextHostRequestId = 1;
let unregisterBackend = null;

function requestIdKey(id) {
  return typeof id === "string" || typeof id === "number" ? String(id) : null;
}

function rewriteRequestForChrome(client, message, frame) {
  const key = message && Object.hasOwn(message, "id") ? requestIdKey(message.id) : null;

  if (key == null) {
    return frame;
  }

  const hostId = `${process.pid}:${nextHostRequestId++}`;
  const timeout = setTimeout(() => {
    const pending = pendingByHostId.get(hostId);
    if (!pending) {
      return;
    }

    pendingByHostId.delete(hostId);
    writeToClient(
      pending.client,
      Buffer.from(
        JSON.stringify({
          jsonrpc: "2.0",
          id: pending.originalId,
          error: {
            code: -32000,
            message: `Chrome native host request timed out: ${pending.method ?? "unknown"}`,
          },
        }),
        "utf8",
      ),
      () => cleanupAndExit(1),
    );
  }, CHROME_NATIVE_HOST_REQUEST_TIMEOUT_MS);
  timeout.unref?.();
  pendingByHostId.set(hostId, {
    client,
    method: typeof message?.method === "string" ? message.method : null,
    originalId: message.id,
    timeout,
  });

  return Buffer.from(JSON.stringify({ ...message, id: hostId }), "utf8");
}

function rewriteResponseForClient(pending, message, frame) {
  if (!message || !Object.hasOwn(message, "id")) {
    return frame;
  }

  return Buffer.from(JSON.stringify({ ...message, id: pending.originalId }), "utf8");
}

function writeToChrome(frame) {
  process.stdout.write(encodeFrame(frame));
}

function writeToClient(client, frame, callback = undefined) {
  if (!client.destroyed) {
    client.write(encodeFrame(frame), callback);
    return;
  }

  callback?.();
}

function routeChromeFrame(frame) {
  const message = parseFrame(frame);
  const key = message && Object.hasOwn(message, "id") ? requestIdKey(message.id) : null;
  const pending = key == null ? null : pendingByHostId.get(key);

  if (key != null && message?.method === "ping") {
    writeToChrome(
      Buffer.from(
        JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: "pong",
        }),
        "utf8",
      ),
    );
    return;
  }

  if (pending) {
    pendingByHostId.delete(key);
    clearTimeout(pending.timeout);
    writeToClient(pending.client, rewriteResponseForClient(pending, message, frame));
    return;
  }

  if (key != null && key.startsWith(`${process.pid}:`)) {
    return;
  }

  for (const candidate of clients) {
    writeToClient(candidate, frame);
  }
}

function routeClientFrame(client, frame) {
  const message = parseFrame(frame);

  writeToChrome(rewriteRequestForChrome(client, message, frame));
}

function deleteSocket() {
  rmSync(socketPath, { force: true });
}

function cleanupAndExit(code = 0) {
  unregisterBackend?.();
  server.close(() => {});
  for (const client of clients) {
    client.destroy();
  }
  deleteSocket();
  process.exit(code);
}

mkdirSync(BROWSER_SOCKET_ROOT, { recursive: true, mode: 0o700 });
chmodSync(BROWSER_SOCKET_ROOT, 0o700);
pruneBrowserBackendRegistry();
deleteSocket();

const server = net.createServer((client) => {
  const decoder = new FrameDecoder();
  clients.add(client);

  client.on("data", (chunk) => {
    try {
      for (const frame of decoder.push(chunk)) {
        routeClientFrame(client, frame);
      }
    } catch (error) {
      client.destroy(error);
    }
  });

  client.on("close", () => {
    clients.delete(client);
    for (const [id, pending] of pendingByHostId.entries()) {
      if (pending.client === client) {
        pendingByHostId.delete(id);
        clearTimeout(pending.timeout);
      }
    }
  });
});

server.listen(socketPath, () => {
  unregisterBackend = registerBrowserBackend({
    type: "extension",
    socketPath,
    owner: "chrome-native-host",
  });
});

const chromeDecoder = new FrameDecoder();
process.stdin.on("data", (chunk) => {
  try {
    for (const frame of chromeDecoder.push(chunk)) {
      routeChromeFrame(frame);
    }
  } catch {
    cleanupAndExit(1);
  }
});

process.stdin.on("end", () => cleanupAndExit(0));
process.stdin.resume();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => cleanupAndExit(0));
}

process.on("exit", () => {
  unregisterBackend?.();
  deleteSocket();
});
