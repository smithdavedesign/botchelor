"use client";

import { useCallback, useEffect, useState } from "react";
import type { BanKind, BanRow } from "@/lib/bans";

const when = (iso: string) => new Date(iso).toLocaleString();
const KIND_LABELS: Record<BanKind, string> = { account: "Account", agent: "Agent", address: "Address" };
const HINTS: Record<BanKind, string> = { account: "@handle or the account's id", agent: "the agent's id", address: "an IP address (kept only as its key) or a visitor key" };
/** How long: a number of days is a suspension, "" a ban with no end. */
const LENGTHS = [
  { value: "1", label: "1 day" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "", label: "No end (ban)" },
];

/**
 * Bans and suspensions (lib/bans.ts): an account, an agent or an address stops changing anything (and an agent stops
 * calling over MCP) until it's lifted or its days run out. Watching and reading stay open.
 */
export default function BansPanel() {
  const [bans, setBans] = useState<BanRow[] | null>(null);
  const [kind, setKind] = useState<BanKind>("account");
  const [target, setTarget] = useState("");
  const [days, setDays] = useState("7");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/admin/bans");
      const body = await res.json();
      if (res.ok) setBans(body.bans);
      else setError(body.message ?? "Not authorized.");
    } catch {
      setError("Network error.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function send(method: "POST" | "DELETE", body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/bans", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      // Read to the end either way, so no response is left holding its request open.
      const answer = (await res.json().catch(() => ({}))) as { message?: string };
      if (!res.ok) {
        setError(answer.message ?? "That didn't work.");
        return;
      }
      if (method === "POST") {
        setTarget("");
        setReason("");
      }
      await load();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Bans and suspensions</h2>
      <p className="muted small">
        Stops an account, an agent or an address from changing anything: no dates, texts, characters, reports or votes, and
        no calls over MCP. Watching and reading stay open. A suspension ends by itself; a ban lasts until it&apos;s lifted.
        Admins can&apos;t be banned, and the admin pages are never stopped.
      </p>
      <form
        className="consent-actions"
        onSubmit={(e) => {
          e.preventDefault();
          void send("POST", { kind, target, days: days ? Number(days) : null, reason: reason || undefined });
        }}
      >
        <label className="small">
          What
          <select value={kind} onChange={(e) => setKind(e.target.value as BanKind)}>
            {(Object.keys(KIND_LABELS) as BanKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="small">
          Who ({HINTS[kind]})
          <input type="text" required maxLength={200} value={target} onChange={(e) => setTarget(e.target.value)} />
        </label>
        <label className="small">
          For
          <select value={days} onChange={(e) => setDays(e.target.value)}>
            {LENGTHS.map((l) => (
              <option key={l.label} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <label className="small">
          Why (optional)
          <input type="text" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <button type="submit" className="small" disabled={busy || !target.trim()}>
          {days ? "Suspend" : "Ban"}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      {bans && bans.length === 0 && <p>Nobody is banned or suspended.</p>}
      {bans?.map((b) => (
        <p key={`${b.kind}:${b.target}`} className="small">
          <strong>{KIND_LABELS[b.kind]}</strong> {b.label ?? <code>{b.target}</code>} ·{" "}
          {b.live ? (b.until ? `suspended until ${when(b.until)}` : "banned") : `ended ${b.until ? when(b.until) : ""}`} · since {when(b.created_at)}
          {b.reason && <> · {b.reason}</>}{" "}
          {b.live && (
            <button type="button" className="secondary small" disabled={busy} onClick={() => void send("DELETE", { kind: b.kind, target: b.target })}>
              Lift
            </button>
          )}
        </p>
      ))}
    </section>
  );
}
