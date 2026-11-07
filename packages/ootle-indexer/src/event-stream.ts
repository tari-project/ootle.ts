//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import { IndexerClientError } from "@tari-project/ootle";

/**
 * A parsed SSE event from the indexer.
 * The `type` field comes from the `event:` line; `data` is the parsed JSON payload.
 */
export interface IndexerSseEvent {
  type: string;
  data: unknown;
}

/**
 * Longest SSE line accepted, in UTF-16 code units, excluding its terminator.
 * Indexer events are a few KiB of JSON, so this bounds the read buffer.
 */
export const MAX_SSE_LINE_LENGTH = 1024 * 1024;

/** Most `data` accepted for one event, in UTF-16 code units, across all of its `data:` lines. */
export const MAX_SSE_EVENT_DATA_LENGTH = 1024 * 1024;

/**
 * Parses a partial SSE buffer into discrete events, returning any unparsed
 * remainder that should be carried forward to the next chunk.
 *
 * @deprecated Carrying the remainder forward and re-parsing it on every chunk
 *   is unbounded in memory and quadratic in CPU. {@link openEventStream} uses an
 *   incremental, size-bounded parser instead.
 */
export function parseSseChunk(buffer: string): { events: IndexerSseEvent[]; remainder: string } {
  const events: IndexerSseEvent[] = [];

  // SSE events are separated by double newlines (\n\n or \r\n\r\n).
  const blocks = buffer.split(/\n\n|\r\n\r\n/);

  // The last element is an incomplete block — carry it forward.
  const remainder = blocks.pop() ?? "";

  for (const block of blocks) {
    if (!block.trim()) continue;

    let type = "message";
    const dataLines: string[] = [];

    for (const line of block.split(/\n|\r\n/)) {
      if (line.startsWith("event:")) {
        type = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trim());
      }
      // ignore id: and retry: fields
    }

    if (dataLines.length === 0) continue;

    const rawData = dataLines.join("\n");
    let data: unknown = rawData;
    try {
      data = JSON.parse(rawData);
    } catch {
      // leave as raw string if not valid JSON
    }

    events.push({ type, data });
  }

  return { events, remainder };
}

/**
 * Incremental SSE parser. Each pushed chunk is scanned for line terminators
 * once, and the unterminated tail is held as pieces until its terminator
 * arrives. Throws once a line or one event's data exceeds its bound.
 */
class SseParser {
  // Splits on \r\n, \r, or \n per the SSE spec
  private readonly lineEnding = /\r\n|\r|\n/g;
  // Pieces of the current line received so far, held apart so that each chunk is searched only once
  private pending: string[] = [];
  private pendingLength = 0;
  // The last chunk ended in "\r", so a "\n" opening the next chunk completes that terminator
  private afterCr = false;

  private type = "message";
  private dataLines: string[] = [];
  private dataLength = 0;

  constructor(private readonly url: string) {}

  push(text: string): IndexerSseEvent[] {
    const events: IndexerSseEvent[] = [];

    if (text.length === 0) {
      return events;
    }

    if (this.afterCr) {
      if (text.startsWith("\n")) {
        text = text.slice(1);
      }
      this.afterCr = false;
      if (text.length === 0) {
        return events;
      }
    }

    let lineStart = 0;
    this.lineEnding.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = this.lineEnding.exec(text)) !== null) {
      const pieceLen = match.index - lineStart;
      if (this.pendingLength + pieceLen > MAX_SSE_LINE_LENGTH) {
        throw new IndexerClientError(`SSE line exceeds the maximum length of ${MAX_SSE_LINE_LENGTH}`, {
          url: this.url,
        });
      }
      this.pending.push(text.slice(lineStart, match.index));
      const line = this.pending.join("");
      this.pending = [];
      this.pendingLength = 0;
      lineStart = this.lineEnding.lastIndex;
      this.afterCr = match[0] === "\r" && lineStart === text.length;

      const event = this.processLine(line);
      if (event) events.push(event);
    }

    if (lineStart < text.length) {
      this.pending.push(text.slice(lineStart));
      this.pendingLength += text.length - lineStart;
      if (this.pendingLength > MAX_SSE_LINE_LENGTH) {
        throw new IndexerClientError(`SSE line exceeds the maximum length of ${MAX_SSE_LINE_LENGTH}`, {
          url: this.url,
        });
      }
    }

    return events;
  }

  private processLine(line: string): IndexerSseEvent | undefined {
    if (line.length > MAX_SSE_LINE_LENGTH) {
      throw new IndexerClientError(`SSE line exceeds the maximum length of ${MAX_SSE_LINE_LENGTH}`, { url: this.url });
    }

    // Empty line = end of event
    if (line === "") return this.dispatch();

    if (line.startsWith("event:")) {
      const value = line.slice(6);
      this.type = value.startsWith(" ") ? value.slice(1) : value;
    } else if (line.startsWith("data:")) {
      const rawValue = line.slice(5);
      const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
      // Each line after the first adds a "\n" separator
      this.dataLength += value.length + (this.dataLines.length > 0 ? 1 : 0);
      if (this.dataLength > MAX_SSE_EVENT_DATA_LENGTH) {
        throw new IndexerClientError(`SSE event data exceeds the maximum length of ${MAX_SSE_EVENT_DATA_LENGTH}`, {
          url: this.url,
        });
      }
      this.dataLines.push(value);
    } else if (line === "data") {
      this.dataLength += this.dataLines.length > 0 ? 1 : 0;
      if (this.dataLength > MAX_SSE_EVENT_DATA_LENGTH) {
        throw new IndexerClientError(`SSE event data exceeds the maximum length of ${MAX_SSE_EVENT_DATA_LENGTH}`, {
          url: this.url,
        });
      }
      this.dataLines.push("");
    } else if (line === "event") {
      this.type = "message";
    }
    // ignore id:, retry: and comment lines
    return undefined;
  }

  private dispatch(): IndexerSseEvent | undefined {
    const { type, dataLines } = this;
    this.type = "message";
    this.dataLines = [];
    this.dataLength = 0;

    if (dataLines.length === 0) return undefined;

    const rawData = dataLines.join("\n");
    let data: unknown = rawData;
    try {
      data = JSON.parse(rawData);
    } catch {
      // leave as raw string if not valid JSON
    }
    return { type, data };
  }
}

/**
 * Opens a persistent SSE connection to `url` using `fetch` and yields
 * parsed events as an async generator.
 *
 * Works in browsers (Fetch + ReadableStream) and Node.js ≥ 18.
 * Automatically reconnects after errors with a 5 s back-off. A line longer than
 * {@link MAX_SSE_LINE_LENGTH} or an event with more than
 * {@link MAX_SSE_EVENT_DATA_LENGTH} of data is treated as a stream error.
 * Stops when `signal` is aborted.
 *
 * Mirrors the `EventStream` / `into_stream()` pattern from the Rust ootle-rs crate.
 *
 * @throws {IndexerClientError} (caught + logged by the retry loop) if the SSE
 *   endpoint returns a non-success status.
 */
export async function* openEventStream(url: string, signal: AbortSignal): AsyncGenerator<IndexerSseEvent> {
  const RETRY_DELAY_MS = 5_000;

  while (!signal.aborted) {
    const controller = new AbortController();

    // Abort the inner fetch when the outer signal fires.
    const onAbort = () => controller.abort();
    signal.addEventListener("abort", onAbort, { once: true });

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "text/event-stream", "Cache-Control": "no-cache" },
      });

      if (!response.ok || !response.body) {
        const status = Number.isFinite(response.status) ? response.status : undefined;
        throw new IndexerClientError(`SSE connection failed: HTTP ${response.status}`, { status, url });
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parser = new SseParser(url);

      try {
        while (!signal.aborted) {
          const { done, value } = await reader.read();
          if (done) {
            for (const event of parser.push(decoder.decode())) {
              yield event;
            }
            break;
          }

          for (const event of parser.push(decoder.decode(value, { stream: true }))) {
            yield event;
          }
        }
      } finally {
        // Closes the connection, including after a parse error
        reader.cancel().catch(() => {});
      }
    } catch (err) {
      if (signal.aborted) return;
      if ((err as { name?: string }).name === "AbortError") return;
      // Log and retry after back-off.
      console.warn("[ootle-indexer] SSE stream error, retrying in 5 s:", (err as Error).message);
      await new Promise<void>((resolve) => {
        const onSleepAbort = () => {
          clearTimeout(t);
          resolve();
        };
        const t = setTimeout(() => {
          signal.removeEventListener("abort", onSleepAbort);
          resolve();
        }, RETRY_DELAY_MS);
        signal.addEventListener("abort", onSleepAbort, { once: true });
      });
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }
}
