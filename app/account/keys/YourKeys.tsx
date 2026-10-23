"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { requestJson } from "@/app/request";
import { JOB_INFO, keyMeta, providerLabel, type ConnectionSummary, type PlainError } from "@/lib/connections-shared";
import ProviderMark from "./ProviderMark";

/**
 * Every key a person has stored, one line each (Stripe's keys list): its provider, its last four, when it was checked and
 * last used, and what it's used for. Replace pastes a new one (checked live first); Remove deletes it for good, and every
 * job that used it goes back to no key.
 */
export default function YourKeys({ connections }: { connections: ConnectionSummary[] }) {
  return (
    <section className="card" id="your-keys" aria-labelledby="your-keys-title">
      <h2 id="your-keys-title">Your keys</h2>
      <p className="muted small">Stored encrypted. Only the last four are ever shown again: a key can be replaced or removed, never read back.</p>
      <ul className="connection-keys">
        {connections.map((c) => (
          <KeyRow key={c.provider} c={c} />
        ))}
      </ul>
    </section>
  );
}

function KeyRow({ c }: { c: ConnectionSummary }) {
  const router = useRouter();
  const [replacing, setReplacing] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<PlainError | string | null>(null);
  const label = providerLabel(c.provider);
  const uses = c.jobs.length ? `used for ${c.jobs.map((j) => JOB_INFO[j].title).join(", ")}` : "not used for anything yet";

  async function remove() {
    const back = c.jobs.length ? ` ${c.jobs.map((j) => JOB_INFO[j].title).join(" and ")} go back to no key of yours.` : "";
    if (!confirm(`Remove your ${label} key? It's deleted for good.${back}`)) return;
    setBusy(true);
    const r = await requestJson("/api/me/connections", { provider: c.provider }, "DELETE").catch(() => null);
    setBusy(false);
    if (r?.ok) router.refresh();
    else setError(r?.message ?? "Couldn't reach Botchelor. Try again.");
  }

  async function replace(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await requestJson("/api/me/connections", { provider: c.provider, key }, "PUT").catch(() => null);
    setBusy(false);
    const d = (r?.data ?? {}) as { message?: string; kind?: PlainError["kind"]; fix?: PlainError["fix"] };
    if (!r) return setError("Couldn't reach Botchelor. Try again.");
    if (!r.ok) return setError(d.kind ? { kind: d.kind, message: d.message ?? r.message, fix: d.fix ?? null } : r.message);
    setKey("");
    setReplacing(false);
    router.refresh();
  }

  return (
    <li className="connection-key">
      <ProviderMark provider={c.provider} size={30} />
      <div className="connection-key-body">
        <p>
          <strong>{label}</strong> <span className="connection-key-mask">{keyMeta(c)[0]}</span>
          {c.last_error ? <span className="connection-pill tone-error">Needs attention</span> : null}
        </p>
        <p className="muted small">{[...keyMeta(c).slice(1), uses].join(" · ")}</p>
        {replacing && (
          <form className="connection-replace" onSubmit={replace}>
            <label>
              <span>New {label} key</span>
              <input type="password" autoComplete="off" spellCheck={false} value={key} onChange={(e) => setKey(e.target.value)} minLength={8} maxLength={400} required />
            </label>
            <button type="submit" disabled={busy || !key.trim()}>
              {busy ? "Checking…" : "Check and save"}
            </button>
          </form>
        )}
        {error && (
          <p className="byok-status err" role="status">
            {typeof error === "string" ? error : `${error.message}${error.fix ? ` → ${error.fix.label}` : ""}`}
          </p>
        )}
      </div>
      <div className="connection-key-actions">
        <button type="button" className="secondary" onClick={() => setReplacing((r) => !r)} aria-expanded={replacing}>
          {replacing ? "Cancel" : "Replace"}
        </button>
        <button type="button" className="link-button danger" onClick={remove} disabled={busy}>
          Remove
        </button>
      </div>
    </li>
  );
}
