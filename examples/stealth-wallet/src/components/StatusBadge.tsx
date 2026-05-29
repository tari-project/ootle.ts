//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

export interface StatusBadgeProps {
  color: "success" | "muted";
  label: string;
}

export function StatusBadge({ color, label }: StatusBadgeProps) {
  return (
    <div className={`status-badge ${color}`}>
      <span className="dot" />
      {label}
    </div>
  );
}
