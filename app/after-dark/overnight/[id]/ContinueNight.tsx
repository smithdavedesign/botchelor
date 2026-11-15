"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { requestJson } from "@/app/request";

/** The one button on the overnight page: starts the pair's night (lib/adult/overnight.ts startOvernightNight) and opens it. */
export default function ContinueNight({ episodeId, label }: { episodeId: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function start() {
    setBusy(true);
    setError(null);
    const res = await requestJson("/api/admin/after-dark/overnight", { episode_id: episodeId }).catch(() => null);
    if (res?.ok && typeof res.data.path === "string") return router.push(res.data.path);
    setBusy(false);
    setError(res ? "That night can't be started right now." : "Network error. Try again.");
  }
  return (
    <>
      <p>
        <button type="button" className="primary" onClick={() => void start()} disabled={busy}>
          {busy ? "Starting…" : label}
        </button>
      </p>
      {error && (
        <p className="error" role="status">
          {error}
        </p>
      )}
    </>
  );
}
