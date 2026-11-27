"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { requestJson } from "../../request";
import {
  entryLine,
  GOAL_MAX,
  GOALS_ACTIVE,
  GROWTH_TRAITS,
  LIFE_PERIOD_MAX,
  LIFE_VALUE_MAX,
  type FieldProposal,
  type LifeDay,
  type LifeEntry,
  type LifeFieldDef,
  type LifeGoal,
  type TraitShift,
} from "@/lib/life-record-shared";

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
  goals,
  days,
  shifts,
}: {
  characterId: string;
  name: string;
  owner: boolean;
  entries: LifeEntry[];
  fields: LifeFieldDef[];
  asks: FieldProposal[];
  goals: LifeGoal[];
  days: LifeDay[];
  /** Owner only: how it has been changing, newest first. */
  shifts: TraitShift[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [field, setField] = useState(fields[0]?.key ?? "jobs");
  const [value, setValue] = useState("");
  const [period, setPeriod] = useState("");
  const [hidden, setHidden] = useState(false);
  const def = fields.find((f) => f.key === field);
  const [goal, setGoalText] = useState("");

  async function post(body: Record<string, unknown>, fail: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    const r = await requestJson(`/api/characters/${characterId}/life`, body).catch(() => ({ ok: false, message: "Network error. Try again." }));
    setBusy(false);
    if (r.ok) router.refresh();
    else setError(r.message ?? fail);
    return r.ok;
  }
  const active = goals.filter((g) => g.status === "active");
  const reached = goals.filter((g) => g.status === "done");
  const traitWord = (s: TraitShift) => {
    const t = GROWTH_TRAITS.find((x) => x.id === s.trait);
    return t ? (s.delta > 0 ? t.up : t.down).replace(/yourself/, "themselves") : s.trait;
  };

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
      {(active.length > 0 || reached.length > 0 || owner) && (
        <div>
          <strong>Working towards</strong>
          {active.length === 0 && <p className="muted small">{owner ? `Nothing yet. ${name} may come up with something, or give them a goal.` : "Nothing right now."}</p>}
          <ul className="list">
            {active.map((g) => (
              <li key={g.id}>
                {g.text} <span className="muted small">({g.progress}%{g.source === "character" ? `, ${name}'s own idea` : ""})</span>
                {owner && (
                  <>
                    {" "}
                    <button type="button" className="link-button" disabled={busy} onClick={() => void post({ action: "goal_status", goal_id: g.id, status: "done" }, "Couldn't change that.")}>
                      Done
                    </button>{" "}
                    <button type="button" className="link-button" disabled={busy} onClick={() => void post({ action: "goal_status", goal_id: g.id, status: "dropped" }, "Couldn't change that.")}>
                      Drop
                    </button>
                  </>
                )}
              </li>
            ))}
            {reached.slice(0, 3).map((g) => (
              <li key={g.id} className="muted">
                ✓ {g.text}
              </li>
            ))}
          </ul>
          {owner && active.length < GOALS_ACTIVE && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void post({ action: "add_goal", text: goal }, "Couldn't add that goal.").then((ok) => ok && setGoalText(""));
              }}
            >
              <input value={goal} onChange={(e) => setGoalText(e.target.value)} maxLength={GOAL_MAX} placeholder="Get back into painting" aria-label="A new goal" />{" "}
              <button type="submit" className="button" disabled={busy || goal.trim().length < 4}>
                Add goal
              </button>
            </form>
          )}
        </div>
      )}
      {days.length > 0 && (
        <div>
          <strong>A day in {name}&apos;s life</strong>
          {days.map((d) => (
            <blockquote key={d.day} className="small">
              {d.text}
            </blockquote>
          ))}
        </div>
      )}
      {owner && shifts.length > 0 && (
        <details>
          <summary>🔒 How {name} has been changing (only you see this)</summary>
          <p className="muted small">Small, slow changes from what {name} has lived. They shape how {name} talks, never how a date ends. Undo any you don&apos;t want.</p>
          <ul className="list">
            {shifts.slice(0, 12).map((s) => (
              <li key={s.id} className={s.vetoed ? "muted" : undefined}>
                {s.vetoed ? <s>A little {traitWord(s)}</s> : <>A little {traitWord(s)}</>} <span className="muted small">— {s.reason}</span>{" "}
                <button type="button" className="link-button" disabled={busy} onClick={() => void post({ action: "veto_shift", shift_id: s.id, undo: s.vetoed }, "Couldn't change that.")}>
                  {s.vetoed ? "Keep it after all" : "Undo"}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
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
