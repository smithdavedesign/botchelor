"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Avatar from "@/app/Avatar";
import { requestJson } from "@/app/request";
import { countdown } from "@/lib/countdown";
import { showCrowd } from "@/lib/crowd-threshold";
import type { FantasyBoard } from "@/lib/fantasy";

/**
 * The fantasy league (lib/fantasy.ts): draft three suitors before the first rose ceremony's vote opens, then watch the
 * points come in every Sunday. Loaded for this viewer from /api/fantasy (the season page itself is the same for everyone).
 */
export default function FantasyLeague() {
  const [board, setBoard] = useState<FantasyBoard | null | undefined>(undefined);
  const [picks, setPicks] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const load = async () => {
    const res = await fetch("/api/fantasy").catch(() => null);
    const data = res?.ok ? ((await res.json()) as FantasyBoard) : null;
    setBoard(data);
    if (data?.mine) setPicks(data.mine.picks);
  };
  useEffect(() => {
    void load();
  }, []);
  if (!board) return null;
  const want = Math.min(3, board.suitors.filter((s) => !s.out).length);
  const toggle = (id: string) => setPicks((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < want ? [...p, id] : p));
  const save = async () => {
    setBusy(true);
    setError(null);
    const r = await requestJson("/api/fantasy", { picks }).catch(() => null);
    setBusy(false);
    if (!r?.ok) setError(r?.message ?? "Network error. Try again.");
    else await load();
  };
  const crowd = showCrowd(board.players);
  return (
    <section id="fantasy" className="card fantasy-league" aria-labelledby="fantasy-head" data-track-area="fantasy">
      <p className="kicker">Fantasy league</p>
      <h2 id="fantasy-head">{board.open ? "Draft three suitors" : "Your three"}</h2>
      <p className="muted small">
        {board.points.rose} point for every rose they keep, {board.points.final_two} for the final two, {board.points.final_rose} for the final rose.{" "}
        {board.open ? `The draft closes ${countdown(board.locks_at, now)}, when the first ceremony's vote opens.` : "The draft is closed."}
        {crowd ? ` ${board.players} playing.` : ""}
      </p>
      {board.mine && (
        <p className="small" data-fantasy-score>
          <strong>
            {board.mine.points} {board.mine.points === 1 ? "point" : "points"}
          </strong>
          {crowd ? ` · #${board.mine.rank} of ${board.players}` : ""}
        </p>
      )}
      <ul className="casting-slots season-live-faces fantasy-suitors">
        {board.suitors.map((s) => {
          const mine = picks.includes(s.id);
          return (
            <li key={s.id} className={`casting-slot is-taken${mine ? " is-picked" : ""}${s.out ? " is-out" : ""}`}>
              <Avatar seed={s.id} name={s.name} hue={s.hue} house={s.house} portraitSrc={s.portrait} size={48} decorative />
              <span className="casting-slot-text">
                <Link href={`/characters/${s.id}`}>
                  <strong>{s.name}</strong>
                </Link>
                <span className="muted small">
                  {s.points} {s.points === 1 ? "point" : "points"}
                  {crowd && s.drafted ? ` · in ${s.drafted} ${s.drafted === 1 ? "draft" : "drafts"}` : ""}
                </span>
                {board.open && !s.out && (
                  <button type="button" className={mine ? "primary small" : "button-ghost small"} aria-pressed={mine} onClick={() => toggle(s.id)} data-track="fantasy-pick">
                    {mine ? "Drafted" : "Draft"}
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {board.open && (
        <p className="cta-row">
          <button type="button" className="primary" disabled={busy || picks.length !== want} onClick={save} data-track="fantasy-save">
            {board.mine ? "Change my draft" : `Lock in my ${want}`}
          </button>
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
