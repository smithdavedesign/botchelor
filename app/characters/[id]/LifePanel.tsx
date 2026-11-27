"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { requestJson } from "../../request";
import { entryLine, LIFE_PERIOD_MAX, LIFE_VALUE_MAX, type FieldProposal, type LifeEntry, type LifeFieldDef } from "@/lib/life-record-shared";

/**
 * A character's life so far (lib/life-record.ts): jobs, places, family and the rest, grouped by field. Everyone sees the
 * public entries; its owner also sees private ones (marked), adds and removes entries, and sees the new fields its agent
 * asked for and what the show decided.
 */
export default function LifePanel({
  characterId,
  name,
  owner,
  entries,
  fields,
  asks,
}: {
  characterId: string;
  name: string;
  owner: boolean;
  entries: LifeEntry[];
  fields: LifeFieldDef[];
  asks: FieldProposal[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState(fields[0]?.key ?? "jobs");
  const [value, setValue] = useState("");
  const [period, setPeriod] = useState("");
  const [hidden, setHidden] = useState(false);
  const def = fields.find((f) => f.key === field);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await requestJson(`/api/characters/${characterId}/life`, { field, value, period: def?.dated ? period : undefined, private: hidden }).catch(() => ({ ok: false, message: "Network error. Try again." }));
    setBusy(false);
    if (r.ok) {
      setValue("");
      setPeriod("");
      router.refresh();
    } else setError(r.message ?? "Couldn't add that.");
  }

  async function remove(entry: string) {
    setBusy(true);
    setError(null);
    const r = await requestJson(`/api/characters/${characterId}/life?entry=${encodeURIComponent(entry)}`, {}, "DELETE").catch(() => ({ ok: false, message: "Network error. Try again." }));
    setBusy(false);
    if (r.ok) router.refresh();
    else setError(r.message ?? "Couldn't remove that.");
  }

  const groups = fields.map((f) => ({ f, items: entries.filter((e) => e.field === f.key) })).filter((g) => g.items.length);

  return (
    <section className="card character-life" aria-label="Life so far">
      <h2>{name}&apos;s life so far</h2>
      {groups.length === 0 && <p className="muted">{owner ? "Nothing yet. What has their life held apart from dating?" : "Nothing here yet."}</p>}
      {groups.map(({ f, items }) => (
        <div key={f.key}>
          <strong>{f.label}</strong>
          <ul className="list">
            {items.map((e) => (
              <li key={e.id}>
                {entryLine(e)}
                {owner && e.visibility === "self" && <span className="muted small"> 🔒 only {name} and you</span>}
                {owner && (
                  <>
                    {" "}
                    <button type="button" className="link-button" disabled={busy} aria-label={`Remove ${e.value}`} onClick={() => void remove(e.id)}>
                      Remove
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {owner && (
        <form onSubmit={(e) => void add(e)} className="life-add">
          <label>
            Field{" "}
            <select value={field} onChange={(e) => setField(e.target.value)}>
              {fields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>{" "}
          <label>
            What{" "}
            {def?.options?.length ? (
              <select value={value} onChange={(e) => setValue(e.target.value)} required>
                <option value="">Choose…</option>
                {def.options.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            ) : (
              <input value={value} onChange={(e) => setValue(e.target.value)} maxLength={LIFE_VALUE_MAX} required placeholder="Night-shift baker at a canal café" />
            )}
          </label>{" "}
          {def?.dated && (
            <label>
              When <input value={period} onChange={(e) => setPeriod(e.target.value)} maxLength={LIFE_PERIOD_MAX} placeholder="2016–2019" />
            </label>
          )}{" "}
          <label>
            <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} /> Only {name} and you
          </label>{" "}
          <button type="submit" className="button" disabled={busy || value.trim().length < 2}>
            {busy ? "Adding…" : "Add"}
          </button>
          <p className="muted small">
            {name} draws on this on dates, in texts and when you chat. Keep it PG and fictional: no real people. It never changes how a date ends.
          </p>
        </form>
      )}
      {owner && asks.length > 0 && (
        <details>
          <summary>New fields {name}&apos;s agent asked for ({asks.length})</summary>
          <ul className="list">
            {asks.map((a) => (
              <li key={a.id}>
                <strong>{a.label}</strong>: {a.status}
                {a.verdict ? ` — ${a.verdict}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
