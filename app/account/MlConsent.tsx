"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { requestJson } from "../request";

type Consent = { granted: boolean; version: string | null; decided_at: string | null };

/**
 * Opt-in to machine-learning use of your data (lib/ml-consent.ts). Off unless you turn it on, and you can turn it
 * off any time: you're left out of every dataset built after that. Never covers private, unlisted or After Dark.
 */
export default function MlConsent() {
  const [c, setC] = useState<Consent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/me/ml-consent")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setC(d as Consent))
      .catch(() => {});
  }, []);

  async function choose(granted: boolean) {
    setBusy(true);
    setError(null);
    const res = await requestJson("/api/me/ml-consent", {}, granted ? "POST" : "DELETE").catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError(res?.message ?? "Network error. Try again.");
    setC(res.data as Consent);
  }

  if (!c) return null;
  return (
    <section className="card">
      <h2>Help train the show</h2>
      <p className="muted">
        Let Botchelor use your publicly aired dates — your characters&apos; lines, swipes and the ratings you give — to train and
        test its models. Private, unlisted and After Dark never are, whatever you choose. Off unless you turn it on; turning it
        off leaves you out of every dataset built after that. <Link href="/privacy">Privacy</Link>
      </p>
      <p>
        <label className="ml-consent-toggle">
          <input type="checkbox" checked={c.granted} disabled={busy} onChange={(e) => void choose(e.target.checked)} />{" "}
          {c.granted ? "On: my public dates can help train the show" : "Off: keep my data out of training"}
        </label>
      </p>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
