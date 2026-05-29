//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

export function truncate(str: string, head = 10, tail = 8): string {
  if (str.length <= head + tail + 3) return str;
  return `${str.slice(0, head)}…${str.slice(-tail)}`;
}

export function formatTari(uTari: bigint): string {
  const sign = uTari < 0n ? "-" : "";
  const abs = uTari < 0n ? -uTari : uTari;
  const whole = abs / 1_000_000n;
  const frac = abs % 1_000_000n;
  return `${sign}${whole}.${frac.toString().padStart(6, "0")} TARI`;
}
