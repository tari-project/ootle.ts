//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

// Unit tests for the SSE chunk parser. `parseSseChunk` is the pure string-shaped
// half of `event-stream.ts` — we test it directly. The async `openEventStream`
// generator's connection-failure path is also covered via a one-shot `fetch`
// mock that returns a non-OK response.

import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_SSE_EVENT_DATA_LENGTH, MAX_SSE_LINE_LENGTH, openEventStream, parseSseChunk } from "./event-stream";

describe("parseSseChunk", () => {
  it("parses a single complete event with `event:` and JSON `data:`", () => {
    const buffer = 'event: TransactionFinalized\ndata: {"transaction_id":"tx_aa"}\n\n';

    const { events, remainder } = parseSseChunk(buffer);

    expect(events).toEqual([
      {
        type: "TransactionFinalized",
        data: { transaction_id: "tx_aa" },
      },
    ]);
    expect(remainder).toBe("");
  });

  it("falls back to a 'message' type when no `event:` line is present", () => {
    const buffer = 'data: {"foo":"bar"}\n\n';

    const { events } = parseSseChunk(buffer);

    expect(events).toEqual([{ type: "message", data: { foo: "bar" } }]);
  });

  it("concatenates multi-line `data:` continuations into a single string before JSON.parse", () => {
    // SSE spec: multiple `data:` lines in one event are joined with newlines.
    // Constructing JSON with an embedded literal newline keeps it valid after the join.
    const buffer = 'event: chunked\ndata: {"a":1,\ndata: "b":"\\n"}\n\n';

    const { events } = parseSseChunk(buffer);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("chunked");
    expect(events[0].data).toEqual({ a: 1, b: "\n" });
  });

  it("returns the raw string as `data` when the payload is not valid JSON", () => {
    const buffer = "event: log\ndata: not json\n\n";

    const { events } = parseSseChunk(buffer);

    expect(events).toEqual([{ type: "log", data: "not json" }]);
  });

  it("skips an event with no `data:` lines", () => {
    const buffer = "event: heartbeat\n\nevent: TransactionFinalized\ndata: {}\n\n";

    const { events } = parseSseChunk(buffer);

    expect(events).toEqual([{ type: "TransactionFinalized", data: {} }]);
  });

  it("carries a partial trailing block forward as the remainder", () => {
    const buffer = 'event: A\ndata: {"a":1}\n\nevent: B\ndata: {"b":';

    const { events, remainder } = parseSseChunk(buffer);

    expect(events).toEqual([{ type: "A", data: { a: 1 } }]);
    expect(remainder).toBe('event: B\ndata: {"b":');
  });

  it("ignores `id:` and `retry:` lines per SSE spec", () => {
    const buffer = 'id: 42\nretry: 1000\nevent: ping\ndata: {"ok":true}\n\n';

    const { events } = parseSseChunk(buffer);

    expect(events).toEqual([{ type: "ping", data: { ok: true } }]);
  });
});

describe("openEventStream connection failure", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits the canonical 'SSE connection failed: HTTP <status>' error via the back-off retry", async () => {
    // The generator catches the failure and logs+sleeps before retrying. Abort the
    // signal during the retry sleep so the loop exits cleanly. Spy on console.warn to
    // confirm the failure message reached the back-off log line.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 503 }) as unknown as Response);

    const controller = new AbortController();
    const iter = openEventStream("http://localhost:18300/events", controller.signal);

    // Kick the generator: the first `.next()` triggers the fetch, the failure path
    // and the warn() before the back-off sleep starts. Abort to release the sleep.
    const nextPromise = iter.next();
    // Let the microtask queue drain so the warn() has fired.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    controller.abort();
    const result = await nextPromise;

    expect(result.done).toBe(true);
    expect(warn).toHaveBeenCalled();
    const calls = warn.mock.calls.flat().map((arg) => String(arg));
    expect(calls.some((arg) => arg.includes("SSE connection failed: HTTP 503"))).toBe(true);
  });
});

describe("openEventStream streaming", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A `Response` whose body streams the given chunks, then closes. */
  function sseResponse(chunks: string[]): Response {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }

  it("yields each parsed event from the response body in order", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseResponse(['event: transaction\ndata: {"id":"tx_1"}\n\n', 'event: transaction\ndata: {"id":"tx_2"}\n\n']),
    );

    const controller = new AbortController();
    const seen: unknown[] = [];
    for await (const event of openEventStream("http://localhost:18300/events", controller.signal)) {
      seen.push(event);
      if (seen.length === 2) {
        controller.abort();
        break;
      }
    }

    expect(seen).toEqual([
      { type: "transaction", data: { id: "tx_1" } },
      { type: "transaction", data: { id: "tx_2" } },
    ]);
  });

  it("reassembles an event split across two network chunks", async () => {
    // The read loop must carry the partial block forward in `buffer` — a naive
    // per-chunk parse would drop this event entirely.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseResponse(['event: transaction\ndata: {"id":', '"tx_split"}\n\n']),
    );

    const controller = new AbortController();
    const seen: unknown[] = [];
    for await (const event of openEventStream("http://localhost:18300/events", controller.signal)) {
      seen.push(event);
      controller.abort();
      break;
    }

    expect(seen).toEqual([{ type: "transaction", data: { id: "tx_split" } }]);
  });

  it("sends the SSE Accept header on the request", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(sseResponse(['event: ping\ndata: {"ok":true}\n\n']));

    const controller = new AbortController();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for await (const _event of openEventStream("http://localhost:18300/events", controller.signal)) {
      controller.abort();
      break;
    }

    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Accept).toBe("text/event-stream");
  });

  it("stops without yielding when the signal is already aborted", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const controller = new AbortController();
    controller.abort();

    const seen: unknown[] = [];
    for await (const event of openEventStream("http://localhost:18300/events", controller.signal)) {
      seen.push(event);
    }

    expect(seen).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("openEventStream parsing and bounds", () => {
  const URL = "http://localhost:18300/events";

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A `Response` whose body streams the given chunks, then closes. */
  function sseResponse(chunks: string[]): Response {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });
    return new Response(body, { status: 200 });
  }

  /** Collects every event from a single connection that streams `chunks`, plus any back-off warnings. */
  async function collectOnce(chunks: string[]): Promise<{ events: unknown[]; warnings: string[] }> {
    const controller = new AbortController();
    const warnings: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      warnings.push(args.map(String).join(" "));
      // Release the back-off sleep, which registers its abort listener right after this call
      queueMicrotask(() => controller.abort());
    });
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(sseResponse(chunks))
      .mockImplementation(async () => {
        // The first body closed cleanly and the loop reconnected: stop here
        controller.abort();
        throw new DOMException("aborted", "AbortError");
      });

    const events: unknown[] = [];
    for await (const event of openEventStream(URL, controller.signal)) {
      events.push(event);
    }
    return { events, warnings };
  }

  it("yields every event when many arrive in one chunk", async () => {
    const chunk = Array.from({ length: 100 }, (_, i) => `event: e\ndata: {"i":${i}}\n\n`).join("");
    const { events } = await collectOnce([chunk]);
    expect(events).toHaveLength(100);
    expect(events[99]).toEqual({ type: "e", data: { i: 99 } });
  });

  it("reassembles a line split over many chunks", async () => {
    const line = 'data: {"id":"tx_many_chunks"}';
    const chunks = ["event: transaction\n", ...line.split(""), "\n\n"];
    const { events } = await collectOnce(chunks);
    expect(events).toEqual([{ type: "transaction", data: { id: "tx_many_chunks" } }]);
  });

  it("treats a \\r\\n split across chunks as one terminator", async () => {
    // Counted as two terminators, the "\n" would end the event before its data line and drop its type.
    const { events } = await collectOnce(["event: split\r", '\ndata: {"ok":true}\r\n\r\n']);
    expect(events).toEqual([{ type: "split", data: { ok: true } }]);
  });

  it("accepts bare \\r line terminators", async () => {
    const { events } = await collectOnce(['event: cr\rdata: {"ok":true}\r\r']);
    expect(events).toEqual([{ type: "cr", data: { ok: true } }]);
  });

  it("dispatches a line exactly at the length limit", async () => {
    const value = "x".repeat(MAX_SSE_LINE_LENGTH - "data: ".length);
    const { events, warnings } = await collectOnce([`data: ${value}\n\n`]);
    expect(warnings).toEqual([]);
    expect(events).toEqual([{ type: "message", data: value }]);
  });

  it("fails the stream and stops reading on an unterminated line past the limit", async () => {
    // An endless `data:` line with no terminator: unbounded buffering would never return.
    const controller = new AbortController();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {
      queueMicrotask(() => controller.abort());
    });
    const encoder = new TextEncoder();
    const piece = encoder.encode("x".repeat(64 * 1024));
    let chunksSent = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(encoder.encode("data: "));
      },
      pull(c) {
        chunksSent++;
        c.enqueue(piece);
      },
      cancel() {
        cancelled = true;
      },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body, { status: 200 }));

    const events: unknown[] = [];
    for await (const event of openEventStream(URL, controller.signal)) {
      events.push(event);
    }

    expect(events).toEqual([]);
    expect(cancelled).toBe(true);
    expect(chunksSent * 64 * 1024).toBeLessThan(MAX_SSE_LINE_LENGTH + 4 * 64 * 1024);
    const calls = warn.mock.calls.flat().map(String);
    expect(calls.some((arg) => arg.includes("SSE line exceeds the maximum length"))).toBe(true);
  });

  it("treats a \\r\\n split across chunks with an empty intermediate chunk as one terminator", async () => {
    const { events } = await collectOnce(["event: split\r", "", '\ndata: {"ok":true}\r\n\r\n']);
    expect(events).toEqual([{ type: "split", data: { ok: true } }]);
  });

  it("strips only a single leading space from `data:` lines per SSE spec", async () => {
    const { events } = await collectOnce(["event: raw\ndata:   indented\n\n"]);
    expect(events).toEqual([{ type: "raw", data: "  indented" }]);
  });

  it("fails the stream when one event's data lines exceed the limit", async () => {
    const line = `data: ${"y".repeat(64 * 1024)}\n`;
    const lines = Math.ceil(MAX_SSE_EVENT_DATA_LENGTH / (64 * 1024)) + 1;
    const { events, warnings } = await collectOnce([line.repeat(lines), "\n"]);
    expect(events).toEqual([]);
    expect(warnings.some((w) => w.includes("SSE event data exceeds the maximum length"))).toBe(true);
  });
});
