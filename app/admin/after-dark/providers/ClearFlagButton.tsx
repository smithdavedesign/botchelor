"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";

/** Lets an account a chargeback or refund flagged subscribe again, once an admin has looked (app/api/admin/after-dark/billing). */
export default function ClearFlagButton({ userId }: { userId: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  if (state === "done") return <span className="muted small">Cleared</span>;
  return (
    <>
      <button
        type="button"
        className="secondary small"
        disabled={state === "busy"}
        onClick={async () => {
          setState("busy");
          setError(null);
          const r = await requestJson("/api/admin/after-dark/billing", { user_id: userId }).catch(() => null);
          if (r?.ok) setState("done");
          else {
            setError(r?.message ?? "Network error.");
            setState("idle");
          }
        }}
      >
        Reviewed: allow again
      </button>
      {error && <span className="error small"> {error}</span>}
    </>
  );
}
