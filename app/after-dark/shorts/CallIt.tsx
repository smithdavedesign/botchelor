"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { requestJson } from "@/app/request";
import type { Call, FirstMove, Outcome, Picks, YesNo } from "@/lib/adult/predictions";
import styles from "./shorts.module.css";

/** How far it goes, as a call reads it (lib/adult/stages.ts, in order). */
export const FURTHEST_LABELS = ["Just talking", "First touches", "A kiss", "Undressing", "All the way"] as const;
/** What each right call is worth (lib/adult/predictions.ts CALL_POINTS; kept here for the client). */
const WORTH = { first_move: 5, furthest: 10, their_place: 5, second_night: 5 } as const;

type Names = { a: string; b: string };
const firstMoveLabel = (m: FirstMove, n: Names) => (m === "a" ? n.a : m === "b" ? n.b : "Neither: they only talk");
const placeLabel = (v: YesNo) => (v === "yes" ? "Yes, one of their places" : "No, somewhere else");
const nightLabel = (v: YesNo) => (v === "yes" ? "Yes, another night" : "No, just this one");

/**
 * Call it (lib/adult/predictions.ts): before pressing play, how their night goes. Free points on After Dark's own board;
 * the call can change until play starts, and locks then.
 */
export function CallIt({ id, names, initial, onCall }: { id: string; names: Names; initial: Call | null; onCall?: (c: Call) => void }) {
  const [picks, setPicks] = useState<Partial<Picks>>(initial?.picks ?? { second_night: null });
  const [saved, setSaved] = useState<Call | null>(initial);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const ready = picks.first_move !== undefined && picks.furthest !== undefined && picks.their_place !== undefined;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return setNote({ text: "Call the first three first: the second night is the bonus.", error: true });
    setBusy(true);
    const res = await requestJson(`/api/admin/after-dark/shorts/${encodeURIComponent(id)}/call`, { ...picks, second_night: picks.second_night ?? null }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setNote({ text: res?.message ?? "That didn't go through. Try again.", error: true });
    const call = res.data.call as Call;
    setSaved(call);
    onCall?.(call);
    setNote({ text: "Your call is in. You can change it until you press play; then it locks." });
  }

  const radio = <K extends keyof Picks>(key: K, value: Picks[K], label: string) => (
    <label key={String(value)} className={picks[key] === value ? styles.chosen : undefined}>
      <input type="radio" name={`call-${key}`} checked={picks[key] === value} onChange={() => setPicks((p) => ({ ...p, [key]: value }))} disabled={busy} /> {label}
    </label>
  );
  return (
    <section className={`card ${styles.call}`} aria-label="Call it">
      <h2>📣 Call it</h2>
      <p className="muted small">Before you press play: how does their night go? Free points on After Dark&apos;s own board. Your call locks the moment it plays.</p>
      <form onSubmit={submit} className={styles.callForm}>
        <fieldset>
          <legend>Who makes the first move? · {WORTH.first_move} points</legend>
          <div className={styles.choices}>{(["a", "b", "neither"] as const).map((m) => radio("first_move", m, firstMoveLabel(m, names)))}</div>
        </fieldset>
        <fieldset>
          <legend>How far does it go? · {WORTH.furthest} points</legend>
          <div className={styles.choices}>{FURTHEST_LABELS.map((l, i) => radio("furthest", i, l))}</div>
        </fieldset>
        <fieldset>
          <legend>Do they end up at one of their places? · {WORTH.their_place} points</legend>
          <div className={styles.choices}>{(["yes", "no"] as const).map((v) => radio("their_place", v, placeLabel(v)))}</div>
        </fieldset>
        <fieldset>
          <legend>
            Bonus: a second night? · {WORTH.second_night} points <span className="muted">(optional)</span>
          </legend>
          <div className={styles.choices}>
            {(["yes", "no"] as const).map((v) => radio("second_night", v, nightLabel(v)))}
            {radio("second_night", null, "Skip it")}
          </div>
        </fieldset>
        <p className={styles.row}>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Saving…" : saved ? "Change my call" : "Lock in my call"}
          </button>
        </p>
      </form>
      {note && (
        <p className={note.error ? "error" : "notice"} role="status">
          {note.text}
        </p>
      )}
    </section>
  );
}

/** After play: the call against what the night shows, and the points; or just what happened, for someone who didn't call. */
export function Reveal({ names, call, outcome, boardLabel, owner = false }: { names: Names; call: Call | null; outcome: Outcome; boardLabel?: string | null; owner?: boolean }) {
  const settled = call?.settled ?? null;
  const rows: { part: string; mine: string | null; happened: string; points: number | null }[] = [
    { part: "The first move", mine: call ? firstMoveLabel(call.picks.first_move, names) : null, happened: firstMoveLabel(outcome.first_move, names), points: settled?.points.first_move ?? null },
    { part: "How far it went", mine: call ? FURTHEST_LABELS[call.picks.furthest] : null, happened: FURTHEST_LABELS[outcome.furthest] ?? "", points: settled?.points.furthest ?? null },
    {
      part: "One of their places",
      mine: call ? placeLabel(call.picks.their_place) : null,
      happened: outcome.their_place === "yes" ? `Yes${outcome.ended ? `: ${outcome.ended}` : ""}` : `No${outcome.ended ? `: ${outcome.ended}` : ""}`,
      points: settled?.points.their_place ?? null,
    },
    {
      part: "A second night (bonus)",
      mine: call ? (call.picks.second_night ? nightLabel(call.picks.second_night) : "Skipped") : null,
      happened: nightLabel(outcome.second_night),
      points: settled ? settled.points.second_night : null,
    },
  ];
  return (
    <section className={`card ${styles.call}`} aria-label="How it went">
      <h2>{settled ? `📣 You called it: ${settled.points.total} point${settled.points.total === 1 ? "" : "s"}` : owner ? "📣 What viewers' calls settle against" : "📣 What happened"}</h2>
      <ul className={styles.revealList}>
        {rows.map((r) => (
          <li key={r.part}>
            <p className={styles.revealHead}>
              <strong>{r.part}</strong>
              {settled && <span className={r.points ? styles.hit : "muted"}>{r.points ? `+${r.points}` : "0"}</span>}
            </p>
            <p className="small">
              {call && (
                <>
                  Your call: {r.mine} ·{" "}
                </>
              )}
              The night: {r.happened}
            </p>
          </li>
        ))}
      </ul>
      {settled ? (
        <p className="muted small">
          Free points on <Link href="/after-dark/shorts#board">After Dark&apos;s board{boardLabel ? ` for ${boardLabel}` : ""}</Link>: nothing buys them and they buy nothing.
        </p>
      ) : (
        !owner && <p className="muted small">You didn&apos;t call this one. Call the next Short before you press play.</p>
      )}
    </section>
  );
}
