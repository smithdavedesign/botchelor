"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";

/**
 * "Verify your age" (app/api/after-dark/verify, lib/adult/age-check.ts): starts a Didit check and goes to Didit's page.
 * Shown only where a pass opens more of After Dark, while the check is on.
 */
export default function VerifyAge({ failed, opens }: { failed?: boolean; opens: "all" | "media" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const { ok, data, message } = await requestJson("/api/after-dark/verify");
      if (ok && typeof data.url === "string") {
        window.location.assign(data.url);
        return;
      }
      setError(message);
    } catch {
      setError("Network error. Try again.");
    }
    setBusy(false);
  }

  if (opens === "media") {
    return (
      <p className="muted small ad-text-only" data-verify-age>
        {failed ? "Your last age check didn't pass. " : ""}A quick age check (a selfie, run by Didit) opens pictures, video and voice here.{" "}
        <button type="button" className="link-button" onClick={start} disabled={busy}>
          {busy ? "Opening…" : "Verify your age"}
        </button>
        {error && <span className="error"> {error}</span>}
      </p>
    );
  }

  return (
    <section className="card" data-verify-age>
      <p>
        {failed ? "Your last age check didn't pass. You can try again. " : ""}
        A quick age check opens After Dark here: a selfie that
        estimates your age (an ID only if it&apos;s too close to call), run by Didit. We keep only whether you passed, for a year, never the
        picture or the ID.
      </p>
      <button type="button" onClick={start} disabled={busy}>
        {busy ? "Opening…" : "Verify your age"}
      </button>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
