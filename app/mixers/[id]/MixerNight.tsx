"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import ChatThread from "@/app/ChatThread";
import CharacterName from "@/app/CharacterName";
import type { MixerTable } from "@/lib/mixer-night";

/** A line's beat while the night plays, and the bell's longer pause between rounds. */
const LINE_MS = 2200;
const BELL_MS = 3000;

type Step = { kind: "bell"; round: number } | { kind: "line"; table: number; line: number } | { kind: "table"; table: number };

const NOTE: Record<Exclude<MixerTable["state"], "ready">, string> = {
  airs_soon: "Airs soon: its lines show once it airs.",
  generating: "Being written now.",
  private: "This table's date is private.",
  hidden: "This table's date is hidden while reports are reviewed.",
  failed: "This meeting fell through, so it never happened.",
};

/**
 * The mixer night, played (lib/mixer-night.ts): every table in the order the bell called them, round by round, with a
 * "Round N of M" strip and the bell between rounds. Opens as the readable record of the whole night; ▶ plays it line by
 * line from the first round (each table's lines, with the room's beats around it), and ⏭ shows it all again.
 */
export default function MixerNight({ tables, rounds, closing }: { tables: MixerTable[]; rounds: number; closing: string | null }) {
  const steps = useMemo(() => {
    const out: Step[] = [];
    let round = -1;
    tables.forEach((t, k) => {
      if (t.round !== round) {
        round = t.round;
        out.push({ kind: "bell", round });
      }
      if (t.turns.length) t.turns.forEach((_, line) => out.push({ kind: "line", table: k, line }));
      else out.push({ kind: "table", table: k });
    });
    return out;
  }, [tables]);
  // null: the record (everything shown). A number: playing, with steps[0..pos) shown.
  const [pos, setPos] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const refs = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    if (pos === null || paused || pos >= steps.length) return;
    const next = steps[pos];
    // The first step comes quickly (pressing play starts the night); a bell holds a beat longer than a line.
    const delay = pos === 0 ? 600 : next.kind === "bell" ? BELL_MS : LINE_MS;
    const id = setTimeout(() => setPos((p) => (p === null ? p : p + 1)), delay);
    return () => clearTimeout(id);
  }, [pos, paused, steps]);

  // Follow the table being played.
  const current = pos === null ? null : steps[Math.max(0, Math.min(pos, steps.length) - 1)];
  const currentTable = current && current.kind !== "bell" ? current.table : null;
  useEffect(() => {
    if (currentTable === null) return;
    refs.current[currentTable]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [currentTable]);

  const shownLines = (k: number): number => {
    if (pos === null) return tables[k].turns.length;
    let n = 0;
    for (let s = 0; s < Math.min(pos, steps.length); s++) {
      const st = steps[s];
      if (st.kind === "line" && st.table === k) n = st.line + 1;
    }
    return n;
  };
  const reached = (k: number): boolean => pos === null || steps.slice(0, pos).some((s) => s.kind !== "bell" && s.table === k);
  const bellRung = (round: number): boolean => pos === null || steps.slice(0, pos).some((s) => s.kind === "bell" && s.round === round);
  const playingRound = pos === null ? null : [...steps.slice(0, Math.max(1, pos))].reverse().find((s): s is Extract<Step, { kind: "bell" }> => s.kind === "bell")?.round ?? 0;
  const done = pos !== null && pos >= steps.length;

  return (
    <div className="mixer-night">
      <div className="mixer-strip" role="group" aria-label="The night's rounds">
        <span className="mixer-strip-rounds">
          {Array.from({ length: rounds }, (_, r) => (
            <a key={r} href={`#round-${r + 1}`} className={`mixer-strip-round${playingRound === r ? " on" : ""}`} aria-current={playingRound === r ? "step" : undefined}>
              Round {r + 1} of {rounds}
            </a>
          ))}
        </span>
        <span className="mixer-strip-tools">
          {pos === null || done ? (
            <button type="button" className="primary small" onClick={() => { setPaused(false); setPos(0); }} disabled={!steps.length}>
              {done ? "↻ Again" : "▶ Play the night"}
            </button>
          ) : (
            <>
              <button type="button" className="secondary small" onClick={() => setPaused((p) => !p)} aria-label={paused ? "Play" : "Pause"}>
                {paused ? "▶" : "⏸"}
              </button>
              <button type="button" className="button-ghost small" onClick={() => setPos(null)} aria-label="Show the whole night">
                ⏭
              </button>
            </>
          )}
        </span>
      </div>

      {tables.map((t, k) => {
        const firstOfRound = k === 0 || tables[k - 1].round !== t.round;
        const n = shownLines(k);
        return (
          <div key={t.index}>
            {firstOfRound && bellRung(t.round) && (
              <p className="mixer-bell" id={`round-${t.round + 1}`} role="note">
                🔔 <strong>Round {t.round + 1} of {rounds}</strong>
                {t.round > 0 ? " — the bell rings, and everyone moves on." : " — the bell rings, and the first pairs sit down."}
              </p>
            )}
            {reached(k) && (
              <section className="card mixer-table" ref={(el) => { refs.current[k] = el; }} aria-label={`${t.characters[0].name} and ${t.characters[1].name}`}>
                <header className="mixer-table-head">
                  <strong>
                    <CharacterName character={t.characters[0]} /> <span className="vs">×</span> <CharacterName character={t.characters[1]} />
                  </strong>
                  {t.episode_id && t.state !== "private" && (
                    <Link className="small" href={`/episodes/${t.episode_id}`}>
                      {t.state === "airs_soon" ? "Call the ending" : "Its own episode"}
                    </Link>
                  )}
                </header>
                {t.state === "ready" && t.turns.length ? (
                  <ChatThread
                    characters={t.characters}
                    turns={t.turns.slice(0, n)}
                    dividers={t.beats.filter((b) => b.at <= n && b.at < t.turns.length).map((b) => ({ at: b.at, text: b.text, icon: "👀" }))}
                    feedback={t.episode_id ? { kind: "episode", refId: t.episode_id } : null}
                  />
                ) : (
                  <p className="muted small">{t.state === "ready" ? "Its lines didn't come out; they're written in later." : NOTE[t.state]}</p>
                )}
                {t.ending_label && n >= t.turns.length && <p className="mixer-table-ending small">{t.ending_label}</p>}
              </section>
            )}
          </div>
        );
      })}

      {(pos === null || done) && (
        <section className="mixer-closing" aria-label="Closing time">
          <p>
            🌙 {closing ?? "Who leaves with whom shows here once every table has aired (it would give the endings away)."}
          </p>
        </section>
      )}
    </div>
  );
}
