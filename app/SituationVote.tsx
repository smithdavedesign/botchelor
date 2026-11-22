"use client";

import Link from "next/link";
import Avatar from "./Avatar";
import { requestJson } from "./request";
import { useAction } from "./useAction";
import { showCrowd, tallyLine } from "@/lib/crowd-threshold";
import type { SituationBoard } from "@/lib/situations";

/** "in 5h", "in 40m": how long until the vote closes, from the server's clock (the page is dynamic). */
function closesIn(iso: string, now: number): string {
  const mins = Math.max(0, Math.round((Date.parse(iso) - now) / 60_000));
  return mins >= 60 ? `${Math.floor(mins / 60)}h` : `${mins}m`;
}

/**
 * Tonight's situation (lib/situations.ts): two of the house cast, three situations to vote between, and how the last
 * vote went with the room to watch it in. The counts show once you've voted, and only for a crowd or to an insider (the
 * empty-room rule, lib/crowd-threshold.ts: "won with 1 of 1" told a stranger nobody votes). /watch shows it as its own
 * card; on home it is one `part` of the Tonight card (app/TonightVotes.tsx): no card of its own, its question a level down.
 */
export default function SituationVote({ board, now, insider = false, part = false }: { board: SituationBoard; now: number; insider?: boolean; part?: boolean }) {
  const { busy, error, run } = useAction();
  const [a, b] = board.cast;
  const voted = board.my_pick !== null;
  const tally = voted && showCrowd(board.total, { insider });
  const vote = (pick: string) => run(() => requestJson("/api/situation", { pick }));
  const Box = part ? "div" : "section";
  const Head = part ? "h3" : "h2";
  return (
    <Box id="situation" className={part ? "situation tonight-part" : "card situation"} role={part ? "group" : undefined} aria-labelledby="situation-head">
      <div className="situation-head">
        <span className="situation-avatars" aria-hidden="true">
          <Avatar seed={a.id} name={a.name} hue={a.hue} house portraitSrc={a.portrait} size={40} decorative />
          <Avatar seed={b.id} name={b.name} hue={b.hue} house portraitSrc={b.portrait} size={40} decorative />
        </span>
        <div>
          <p className="kicker">{part ? "The situation" : "Tonight's situation · you pick"}</p>
          {/* A day the producer staged a beat (lib/producer.ts): the twists name their own people, so the line says what the vote decides. */}
          <Head id="situation-head">{board.headline ?? `${a.name} × ${b.name}: what happens on their date?`}</Head>
          <p className="muted small">
            Most votes wins; {board.headline ? "it happens" : "they play it"} after the vote closes in {closesIn(board.closes_at, now)}.{" "}
            {voted ? tallyLine(board.total, { insider }) : "Vote to see how it's going."}
          </p>
        </div>
      </div>
      <ul className="situation-choices">
        {board.choices.map((c) => {
          const mine = board.my_pick === c.id;
          const share = board.total ? Math.round((c.votes / board.total) * 100) : 0;
          return (
            <li key={c.id}>
              <button
                type="button"
                className={`situation-choice${mine ? " mine" : ""}`}
                aria-pressed={mine}
                disabled={busy}
                onClick={() => vote(c.id)}
              >
                <span className="situation-title">
                  <span aria-hidden="true">{c.icon}</span> {c.title}
                  {mine && <span className="chip">Your pick</span>}
                </span>
                <span className="situation-premise">{c.premise}</span>
                {tally && (
                  <span className="situation-bar">
                    <span style={{ width: `${share}%` }} aria-hidden="true" />
                    <em>
                      {share}%<span className="sr-only"> of votes</span>
                    </em>
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {error && <p className="error small">{error}</p>}
      {board.last && (
        <p className="situation-last small">
          <span aria-hidden="true">{board.last.icon}</span> Last vote: <strong>{board.last.title}</strong> won
          {showCrowd(board.last.total, { insider }) ? ` with ${board.last.votes} of ${board.last.total}` : ""} for {board.last.cast[0]} × {board.last.cast[1]}
          {board.last.my_pick ? (board.last.won ? " (your pick)" : " (not yours this time)") : ""}.{" "}
          <Link href={board.last.room_path}>Watch how it went →</Link>
        </p>
      )}
    </Box>
  );
}
