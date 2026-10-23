"use client";

import { useEffect, useState } from "react";

type Counts = { v2: number; legacy: number };
type Status = { secret: "on" | "off" | "too_short"; writes: "v2" | "legacy" | null; people: Counts; house: Counts };

const SECRET: Record<Status["secret"], string> = {
  on: "KEY_ENCRYPTION_SECRET is set: new keys are sealed with it (v2).",
  off: "KEY_ENCRYPTION_SECRET isn't set: keys are sealed from SESSION_SECRET (legacy), so rotating SESSION_SECRET would make them unreadable.",
  too_short: "KEY_ENCRYPTION_SECRET is set but shorter than 32 characters, so it isn't used: keys are still sealed from SESSION_SECRET.",
};

/**
 * Stored keys (lib/key-store-admin.ts): how every person's key and every house key is sealed, and a button that seals
 * the legacy ones under KEY_ENCRYPTION_SECRET now. When legacy is 0, SESSION_SECRET can be rotated without losing a key.
 * Counts only. Reuses the admin password saved in this browser, like the other panels.
 */
export default function KeysPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const headers = () => {
    let key = "";
    try {
      key = localStorage.getItem("bz_frontier") ?? "";
    } catch {
      /* private mode: an admin account still works */
    }
    return key ? { "x-frontier-key": key } : ({} as Record<string, string>);
  };

  useEffect(() => {
    fetch("/api/admin/keys", { headers: headers() })
      .then(async (res) => {
        const body = await res.json();
        if (res.ok) setStatus(body as Status);
        else setNote(body.message ?? "Not authorized.");
      })
      .catch(() => setNote("Network error."));
  }, []);

  async function reseal() {
    setBusy(true);
    setNote(null);
    const res = await fetch("/api/admin/keys", { method: "POST", headers: headers() }).catch(() => null);
    setBusy(false);
    const body = res ? await res.json().catch(() => ({})) : {};
    if (res?.ok) {
      setStatus(body.status as Status);
      const m = body.moved as { people: number; house: number; unreadable: number };
      setNote(`Sealed again: ${m.people} of people's, ${m.house} of the house's.${m.unreadable ? ` ${m.unreadable} couldn't be opened and stay as they are.` : ""}`);
    } else setNote(body.message ?? "Couldn't reseal.");
  }

  const legacy = status ? status.people.legacy + status.house.legacy : 0;
  return (
    <section className="card">
      <h2>Stored keys</h2>
      {status ? (
        <>
          <p className="muted">{SECRET[status.secret]}</p>
          <ul className="list">
            <li>
              People&apos;s keys: {status.people.v2} v2, {status.people.legacy} legacy
            </li>
            <li>
              The house&apos;s keys (After Dark): {status.house.v2} v2, {status.house.legacy} legacy
            </li>
          </ul>
          {status.secret === "on" && legacy > 0 && (
            <button type="button" className="secondary" onClick={reseal} disabled={busy}>
              {busy ? "Sealing…" : `Seal the ${legacy} legacy key${legacy === 1 ? "" : "s"} again now`}
            </button>
          )}
          {status.secret === "on" && legacy === 0 && <p className="muted small">Nothing is sealed from SESSION_SECRET: it can be rotated without losing a key.</p>}
        </>
      ) : null}
      {note && <p className="muted small">{note}</p>}
    </section>
  );
}
