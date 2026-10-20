"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";

/** The confirm button on /link/[code]: links the agent to the signed-in account, then opens the Account's agents. */
export function LinkConfirm({ code }: { code: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await requestJson("/api/link", { code });
          if (r.ok) {
            window.location.assign("/account#agents");
            return;
          }
          setError(r.message);
          setBusy(false);
        }}
      >
        {busy ? "Linking…" : "Link it to my account"}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
