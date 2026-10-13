"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ApiResult } from "./request";

/**
 * Runs an API call, then refreshes the server-rendered page, or shows the error. An action may also
 * return an error message (string) from an earlier step, or null for "nothing to report".
 */
export function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(action: () => Promise<ApiResult | string | null>) {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      const failure = typeof result === "string" ? result : result && !result.ok ? result.message : null;
      if (failure) setError(failure);
      else router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}
