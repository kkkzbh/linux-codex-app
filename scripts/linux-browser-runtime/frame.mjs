import { Buffer } from "node:buffer";
import { BROWSER_FRAME_HEADER_BYTES } from "./constants.mjs";

export class FrameDecoder {
  chunks = [];
  byteLength = 0;
  chunkStart = 0;

  push(chunk) {
    this.append(chunk);
    const frames = [];

    for (;;) {
      if (this.byteLength < BROWSER_FRAME_HEADER_BYTES) {
        break;
      }

      const payloadLength = this.peekBytes(BROWSER_FRAME_HEADER_BYTES).readUInt32LE(0);
      const frameLength = BROWSER_FRAME_HEADER_BYTES + payloadLength;

      if (this.byteLength < frameLength) {
        break;
      }

      frames.push(this.consumeBytes(frameLength).subarray(BROWSER_FRAME_HEADER_BYTES));
    }

    return frames;
  }

  append(chunk) {
    if (chunk.byteLength === 0) {
      return;
    }

    const buffer = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    this.chunks.push(buffer);
    this.byteLength += buffer.byteLength;
  }

  peekBytes(byteCount) {
    const first = this.chunks[this.chunkStart];
    if (first && first.byteLength >= byteCount) {
      return first.subarray(0, byteCount);
    }

    const buffer = Buffer.allocUnsafe(byteCount);
    let offset = 0;

    for (let index = this.chunkStart; index < this.chunks.length; index += 1) {
      const chunk = this.chunks[index];
      if (!chunk) {
        throw new Error("frame decoder underflow");
      }

      offset += chunk.copy(buffer, offset, 0, byteCount - offset);
      if (offset === byteCount) {
        break;
      }
    }

    return buffer;
  }

  consumeBytes(byteCount) {
    const first = this.chunks[this.chunkStart];
    if (first && first.byteLength >= byteCount) {
      const bytes = first.subarray(0, byteCount);

      if (first.byteLength === byteCount) {
        this.discardFirstChunk();
      } else {
        this.chunks[this.chunkStart] = first.subarray(byteCount);
      }

      this.byteLength -= byteCount;
      return bytes;
    }

    const buffer = Buffer.allocUnsafe(byteCount);
    let offset = 0;

    while (offset < byteCount) {
      const chunk = this.chunks[this.chunkStart];
      if (!chunk) {
        throw new Error("frame decoder underflow");
      }

      const copied = chunk.copy(buffer, offset, 0, byteCount - offset);
      offset += copied;
      this.byteLength -= copied;

      if (copied === chunk.byteLength) {
        this.discardFirstChunk();
      } else {
        this.chunks[this.chunkStart] = chunk.subarray(copied);
      }
    }

    return buffer;
  }

  discardFirstChunk() {
    this.chunkStart += 1;

    if (this.chunkStart === this.chunks.length) {
      this.chunks.length = 0;
      this.chunkStart = 0;
      return;
    }

    if (this.chunkStart > 1024 && this.chunkStart * 2 > this.chunks.length) {
      this.chunks.splice(0, this.chunkStart);
      this.chunkStart = 0;
    }
  }
}

export function encodeFrame(payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), "utf8");
  const frame = Buffer.allocUnsafe(BROWSER_FRAME_HEADER_BYTES + body.byteLength);
  frame.writeUInt32LE(body.byteLength, 0);
  body.copy(frame, BROWSER_FRAME_HEADER_BYTES);
  return frame;
}

export function parseFrame(frame) {
  try {
    return JSON.parse(frame.toString("utf8"));
  } catch {
    return null;
  }
}
