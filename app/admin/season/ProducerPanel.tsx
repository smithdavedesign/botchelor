"use client";

import { useEffect, useState } from "react";

type BeatView = {
  day: string;
  status: string;
  kind: string;
  tension: string | null;
  who: { id: string; name: string }[];
  why: string | null;
  logline: string | null;
  logline_by: string | null;
  previously: string | null;
  tonight: string | null;
  twists: { id: string; title: string; premise: string }[];
  wants: { name: string; want: string }[];
  evidence: string[];
  came: string;
};
type PlanView = { day: string; slot: string; a: string; b: string; written: boolean; model: string | null; ms: number | null; cost_usd: number | null; used: boolean; fit: boolean | null };
type View = {
  on: boolean;
  next_day: string;
  next_skipped: boolean;
  beats: BeatView[];
  switches: { producer: boolean; date_plan_at_night: boolean; night_plans: boolean };
  plans: PlanView[];
};

const KIND: Record<string, string> = { surface_claim: "a claim that should surface", same_room: "two people who should be put in a room", rival_date: "a rival who should get the date" };

/** One night's plan, in words: whether one was written, and whether the date it was for used it. */
function planLine(p: PlanView): string {
  const wrote = p.written ? `written${p.ms !== null ? ` in ${(p.ms / 1000).toFixed(1)}s` : ""}${p.cost_usd !== null ? `, $${p.cost_usd.toFixed(4)}` : ""}` : "none passed";
  const used = p.used ? (p.fit ? "used by the date" : "the date turned out differently, so it played from the rules plan") : "not used yet";
  return `${p.day} · ${p.slot} · ${p.a} × ${p.b}: ${wrote}, ${used}`;
}

/**
 * The producer's last week (lib/producer.ts): what it staged each day and why, the evidence behind it, what came of it,
 * and the plans it wrote at night (lib/night-plans.ts). It never needs a person; this is so the owner can see why it
 * chose what it chose, and skip tomorrow's beat. Admin account or password.
 */
export default function ProducerPanel() {
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const headers = (): Record<string, string> => {
    try {
      const key = localStorage.getItem("bz_frontier");
      return key ? { "x-frontier-key": key } : {};
    } catch {
      return {};
    }
  };

  async function call(body?: Record<string, unknown>) {
    setError(null);
    const res = await fetch("/api/admin/producer", body ? { method: "POST", headers: { "content-type": "application/json", ...headers() }, body: JSON.stringify(body) } : { headers: headers() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data.message ?? "Not authorized.");
    setView(data as View);
  }

  useEffect(() => {
    call().catch(() => setError("Network error."));
  }, []);

  async function act(action: "skip" | "unskip") {
    setBusy(true);
    await call({ action }).catch(() => setError("Network error."));
    setBusy(false);
  }

  // Not authorized, or still loading: the season panel above already says so.
  if (!view) return null;
  return (
    <section className="card" id="producer">
      <h2>The producer</h2>
      <p className="muted small">
        Once a night (23:20 UTC) it reads the story state and picks tomorrow&apos;s beat: who should end up in a room, which claim should surface. It sets
        situations and never an outcome. {view.switches.producer ? "On." : "Off (PRODUCER=0)."}{" "}
        {view.switches.date_plan_at_night ? "No date waits on the director before its first line" : "Dates still ask the director first (DATE_PLAN_AT_NIGHT=0)"}
        {view.switches.night_plans ? "; tomorrow's house date gets its plan written at night." : "; no plans are written at night (PRODUCER_PLANS=1 turns that on)."}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p>
        {view.next_skipped ? (
          <>
            Tomorrow&apos;s beat ({view.next_day}) is skipped.{" "}
            <button type="button" className="button-ghost small" disabled={busy} onClick={() => act("unskip")}>
              Undo
            </button>
          </>
        ) : (
          <button type="button" className="button-ghost small" disabled={busy} onClick={() => act("skip")}>
            Skip tomorrow&apos;s beat ({view.next_day})
          </button>
        )}
      </p>
      {view.beats.length === 0 && <p className="muted">No beats yet. The first one is picked on the next hourly pass.</p>}
      <ul>
        {view.beats.map((b) => (
          <li key={b.day}>
            <p>
              <strong>{b.day}</strong> <span className="badge">{b.status}</span>{" "}
              {b.tension ? (
                <>
                  {b.who.map((w) => w.name).join(", ")}: {KIND[b.kind] ?? b.kind}
                </>
              ) : (
                <span className="muted">no beat{b.why ? ` (${b.why.replace(/_/g, " ")})` : ""}</span>
              )}
            </p>
            {b.logline && (
              <p>
                “{b.logline}” <span className="muted small">({b.logline_by})</span>
              </p>
            )}
            {b.previously && (
              <p className="small">
                {b.previously} {b.tonight}
              </p>
            )}
            {b.tension && (
              <details className="ux-fold">
                <summary>Why, the evidence, and what came of it</summary>
                {b.why && <p className="small">{b.why}</p>}
                {b.evidence.length > 0 && (
                  <ul className="small">
                    {b.evidence.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                )}
                {b.wants.length > 0 && <p className="small">Wants set: {b.wants.map((w) => `${w.name}: “${w.want}”`).join(" · ")}</p>}
                {b.twists.length > 0 && <p className="small">The vote&apos;s twists: {b.twists.map((t) => t.title).join(" · ")}</p>}
                <p className="small">
                  <strong>What came of it:</strong> {b.came}
                </p>
              </details>
            )}
          </li>
        ))}
      </ul>
      {view.plans.length > 0 && (
        <details className="ux-fold">
          <summary>Plans written at night ({view.plans.length})</summary>
          <ul className="small">
            {view.plans.map((p) => (
              <li key={`${p.day}-${p.slot}`}>{planLine(p)}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
