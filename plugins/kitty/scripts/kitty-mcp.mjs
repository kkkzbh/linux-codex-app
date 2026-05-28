#!/usr/bin/env node

import { createKittyController } from "./kitty-lib.mjs";

const serverInfo = {
  name: "kitty",
  version: "0.1.0",
};

const controller = createKittyController();
let outputMode = "line";

function send(message) {
  const payload = JSON.stringify(message);
  if (outputMode === "headers") {
    process.stdout.write(`Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`);
    return;
  }
  process.stdout.write(`${payload}\n`);
}

function sendResult(id, result) {
  if (id == null) {
    return;
  }
  send({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message) {
  if (id == null) {
    return;
  }
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

function toolResult(payload) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function toolError(error) {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: error instanceof Error ? error.message : String(error),
      },
    ],
  };
}

async function handleRequest(message) {
  switch (message.method) {
    case "initialize":
      sendResult(message.id, {
        protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo,
        instructions:
          "Use Kitty tools for Linux terminal work that should be visible and controllable in managed kitty windows. Prefer kitty_run plus kitty_read for commands; use kitty_send only for explicit interactive input.",
      });
      return;
    case "ping":
      sendResult(message.id, {});
      return;
    case "tools/list":
      sendResult(message.id, { tools: controller.tools });
      return;
    case "tools/call": {
      const toolName = message.params?.name;
      const args = message.params?.arguments ?? {};
      try {
        const result = await controller.callTool(toolName, args);
        sendResult(message.id, toolResult(result));
      } catch (error) {
        sendResult(message.id, toolError(error));
      }
      return;
    }
    default:
      sendError(message.id, -32601, `Method not found: ${message.method}`);
  }
}

function handleMessage(message) {
  if (message == null || typeof message !== "object") {
    return;
  }
  if (message.id == null && typeof message.method === "string") {
    return;
  }
  handleRequest(message).catch((error) => {
    sendError(message.id, -32603, error instanceof Error ? error.message : String(error));
  });
}

let inputBuffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  inputBuffer = Buffer.concat([inputBuffer, Buffer.from(chunk)]);
  drainInput();
});

function drainInput() {
  for (;;) {
    if (inputBuffer.length === 0) {
      return;
    }

    if (looksLikeHeaderFrame(inputBuffer)) {
      const parsed = readHeaderFrame(inputBuffer);
      if (parsed == null) {
        return;
      }
      outputMode = "headers";
      inputBuffer = inputBuffer.subarray(parsed.consumed);
      handleMessage(parsed.message);
      continue;
    }

    const newlineIndex = inputBuffer.indexOf(0x0a);
    if (newlineIndex < 0) {
      return;
    }
    outputMode = "line";
    const rawLine = inputBuffer.subarray(0, newlineIndex).toString("utf8").replace(/\r$/, "");
    inputBuffer = inputBuffer.subarray(newlineIndex + 1);
    if (rawLine.trim() === "") {
      continue;
    }
    handleMessage(JSON.parse(rawLine));
  }
}

function looksLikeHeaderFrame(buffer) {
  const preview = buffer.subarray(0, Math.min(buffer.length, 32)).toString("ascii").toLowerCase();
  return preview.startsWith("content-length:");
}

function readHeaderFrame(buffer) {
  const separator = findHeaderSeparator(buffer);
  if (separator == null) {
    return null;
  }

  const headerText = buffer.subarray(0, separator.headerEnd).toString("ascii");
  const lengthMatch = headerText.match(/^content-length:\s*(\d+)\s*$/im);
  if (lengthMatch == null) {
    throw new Error("Missing Content-Length header");
  }

  const contentLength = Number.parseInt(lengthMatch[1], 10);
  const messageStart = separator.bodyStart;
  const messageEnd = messageStart + contentLength;
  if (buffer.length < messageEnd) {
    return null;
  }

  const payload = buffer.subarray(messageStart, messageEnd).toString("utf8");
  return {
    consumed: messageEnd,
    message: JSON.parse(payload),
  };
}

function findHeaderSeparator(buffer) {
  const crlf = buffer.indexOf("\r\n\r\n");
  if (crlf >= 0) {
    return { headerEnd: crlf, bodyStart: crlf + 4 };
  }
  const lf = buffer.indexOf("\n\n");
  if (lf >= 0) {
    return { headerEnd: lf, bodyStart: lf + 2 };
  }
  return null;
}

process.stdin.resume();
