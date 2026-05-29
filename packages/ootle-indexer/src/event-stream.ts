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
 * Parses a partial SSE buffer into discrete events, returning any unparsed
 * remainder that should be carried forward to the next chunk.
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
 * Opens a persistent SSE connection to `url` using `fetch` and yields
 * parsed events as an async generator.
 *
 * Works in browsers (Fetch + ReadableStream) and Node.js ≥ 18.
 * Automatically reconnects after errors with a 5 s back-off.
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
      let buffer = "";

      try {
        while (!signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const { events, remainder } = parseSseChunk(buffer);
          buffer = remainder;

          for (const event of events) {
            yield event;
          }
        }
      } finally {
        reader.cancel();
      }
    } catch (err) {
      if (signal.aborted) return;
      if ((err as { name?: string }).name === "AbortError") return;
      // Log and retry after back-off.
      console.warn("[ootle-indexer] SSE stream error, retrying in 5 s:", (err as Error).message);
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, RETRY_DELAY_MS);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(t);
            resolve();
          },
          { once: true },
        );
      });
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }
}
