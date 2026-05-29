//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import { useState } from "react";
import { truncate } from "../lib/format";
import { CheckIcon } from "./CheckIcon";
import { CopyIcon } from "./CopyIcon";

export interface FieldProps {
  label: string;
  value: string;
  mono?: boolean;
}

export function Field({ label, value, mono = false }: FieldProps) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Some browsers block clipboard in insecure contexts; swallow silently.
    }
  };
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="field-value-row">
        <span className={mono ? "mono value" : "value"} title={value}>
          {truncate(value, 14, 10)}
        </span>
        <button className="btn-copy" onClick={() => void copy()} title="Copy to clipboard" aria-label="Copy">
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
      </div>
    </div>
  );
}
