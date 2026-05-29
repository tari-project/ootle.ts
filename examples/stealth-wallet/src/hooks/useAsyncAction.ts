//   Copyright 2024 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import { useCallback, useState } from "react";

export interface AsyncAction<TArgs extends unknown[], TResult> {
  loading: boolean;
  error: string | null;
  result: TResult | null;
  run: (...args: TArgs) => Promise<void>;
  reset: () => void;
}

// The caller is expected to `useCallback`-wrap `fn` so its identity is stable —
// otherwise `run` is recreated each render.
export function useAsyncAction<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  fallback: string,
): AsyncAction<TArgs, TResult> {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TResult | null>(null);

  const run = useCallback(
    async (...args: TArgs) => {
      setLoading(true);
      setError(null);
      setResult(null);
      try {
        setResult(await fn(...args));
      } catch (err) {
        setError(err instanceof Error ? err.message : fallback);
      } finally {
        setLoading(false);
      }
    },
    [fn, fallback],
  );

  const reset = useCallback(() => {
    setLoading(false);
    setError(null);
    setResult(null);
  }, []);

  return { loading, error, result, run, reset };
}
