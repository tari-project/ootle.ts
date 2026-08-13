//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

/**
 * Live component-event monitoring via SSE.
 *
 * Subscribes to the indexer's `/events` SSE stream, filters events to those
 * touching a component substate id (`OOTLE_COMPONENT_ADDRESS`), and prints
 * each event as it arrives. The indexer's `openEventStream` already
 * reconnects with a 5 s back-off on stream errors.
 *
 * Long-running by default (runs until SIGINT). Set `OOTLE_WATCH_LIMIT=<n>` to
 * exit cleanly after `n` events. Filtering is **client-side** by
 * `OOTLE_COMPONENT_ADDRESS` (and optional `OOTLE_EVENT_TOPIC`).
 */

import { openEventStream } from "@tari-project/ootle-indexer";
import type { IndexerSseEvent } from "@tari-project/ootle-indexer";
import { NETWORK, indexerUrl, runScript } from "./_common/index.js";

function parseLimit(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`OOTLE_WATCH_LIMIT must be a positive integer (got '${raw}')`);
  }
  return n;
}

function matchesFilters(event: IndexerSseEvent, wantComponent: string | null, wantTopic: string | null): boolean {
  // When the indexer emits component-scoped events (e.g. `ComponentEvent`), the
  // component address appears in the payload and the string-contains check below
  // filters to just those events. On LocalNet the indexer only emits
  // `TransactionFinalized` events whose payload contains no component address, so
  // when `wantComponent` is null (no OOTLE_COMPONENT_ADDRESS set) every event
  // passes this filter and the stream acts as an unfiltered view.
  const serialised = JSON.stringify(event.data);
  if (wantComponent && !serialised.includes(wantComponent)) return false;
  if (wantTopic && !serialised.includes(wantTopic)) return false;
  return true;
}

function extractFields(payload: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ["id", "transaction_id", "topic", "substate_id"]) {
    const v = payload[key];
    if (typeof v === "string" || typeof v === "number") out[key] = String(v);
  }
  return out;
}

function printEvent(event: IndexerSseEvent): void {
  const payload = event.data;
  const summary = payload && typeof payload === "object" ? extractFields(payload as Record<string, unknown>) : {};
  const parts = [`type=${event.type}`];
  for (const [k, v] of Object.entries(summary)) {
    parts.push(`${k}=${v}`);
  }
  console.log(`[event] ${parts.join(" ")}`);
  console.log(`        payload=${JSON.stringify(payload)}`);
}

await runScript(async () => {
  const component = process.env.OOTLE_COMPONENT_ADDRESS ?? null;
  if (component !== null && !component.startsWith("component_")) {
    throw new Error(`OOTLE_COMPONENT_ADDRESS must start with 'component_' (got '${component}')`);
  }

  const topic = process.env.OOTLE_EVENT_TOPIC || null;
  const limit = parseLimit(process.env.OOTLE_WATCH_LIMIT);

  const url = indexerUrl();
  console.log(`Network: ${NETWORK}, indexer: ${url}`);
  const filterDesc = component ? `component ${component}` : "all components";
  console.log(`Watching ${filterDesc}${topic ? ` (topic=${topic})` : ""}${limit !== null ? ` (limit=${limit})` : ""}`);

  const controller = new AbortController();
  // SIGINT (Ctrl-C) closes the stream cleanly so the process exits 0.
  process.on("SIGINT", () => {
    console.log("\nReceived SIGINT, closing event stream.");
    controller.abort();
  });

  let count = 0;
  for await (const event of openEventStream(`${url.replace(/\/$/, "")}/events`, controller.signal)) {
    if (!matchesFilters(event, component, topic)) continue;
    printEvent(event);
    count += 1;
    if (limit !== null && count >= limit) {
      console.log(`\nReached limit of ${limit} event(s); exiting.`);
      controller.abort();
      break;
    }
  }

  return {};
});
