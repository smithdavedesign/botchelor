"use client";

import Link from "next/link";
import Avatar from "@/app/Avatar";
import { requestJson } from "@/app/request";
import { useAction } from "@/app/useAction";
import { countdown } from "@/lib/countdown";
import type { CeremonyBoard, SuitorState } from "@/lib/ceremony";

const STATE_WORD: Record<SuitorState, string> = { in: "still in", out: "went home", final_rose: "the final rose", runner_up: "runner-up" };

/** "Sunday, 8 pm UTC": the fixed time the ceremony is held, the same for everyone (a countdown sits beside it). */
const utcTime = (iso: string): string => {
  const d = new Date(iso);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  return `Sunday, ${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"} UTC`;
};

/**
 * The Botchelor (lib/ceremony.ts): the lead, the suitors with their roses or how they left, the audience's vote on who
 * goes home while it's open (counts once you've voted, like the situation vote), the countdown to Sunday's ceremony, and
 * the last ceremony in the show's words, and the walk-ons (open casting, lib/casting.ts). Only on a season running the
 * format; a classic season never renders it.
 */
export default function BotchelorCard({ board, now }: { board: CeremonyBoard; now: number }) {
  const { busy, error, run } = useAction();
  const vote = (pick: string) => run(() => requestJson("/api/ceremony", { pick }));
  const voted = board.vote?.my_pick != null;
  const inPlay = board.suitors.filter((s) => s.state === "in").length;
  return (
    <section id="rose-ceremony" className="card botchelor-card" aria-labelledby="botchelor-head" data-track-area="rose-ceremony">
      <p className="kicker">This season · one lead, your characters as the suitors</p>
      <h2 id="botchelor-head">🌹 {board.title}</h2>
      <div className="botchelor-house">
        <Link href={`/characters/${board.lead.id}`} className="botchelor-lead">
          <Avatar seed={board.lead.id} name={board.lead.name} hue={board.lead.hue} house={board.lead.house} portraitSrc={board.lead.portrait} size={56} />
          <span>
            <strong>{board.lead.name}</strong>
            <span className="muted small"> · the lead</span>
          </span>
        </Link>
        <ul className="botchelor-suitors" aria-label="The suitors">
          {board.suitors.map((s) => (
            <li key={s.id} className={`botchelor-suitor is-${s.state}`}>
              <Link href={`/characters/${s.id}`}>
                <Avatar seed={s.id} name={s.name} hue={s.hue} house={s.house} portraitSrc={s.portrait} size={40} />
                <span className="botchelor-suitor-name">{s.name}</span>
                <span className="muted small">
                  {s.state === "in" ? "🌹 " : s.state === "final_rose" ? "🌹 " : "🥀 "}
                  {STATE_WORD[s.state]}
                  {s.state === "out" && s.week ? ` · week ${s.week}` : ""}
                </span>
              </Link>
            </li>
          ))}
          {board.suitors.length === 0 && <li className="muted small">No suitors yet: the cast is picked when the season starts.</li>}
        </ul>
      </div>
      {board.vote ? (
        <>
          <p className="muted small">
            <strong>Who goes home?</strong> Your vote sends one suitor home on {utcTime(board.vote.closes_at)}; {board.lead.name}&apos;s own dates send
            another. {voted ? `${board.vote.total} ${board.vote.total === 1 ? "vote" : "votes"} so far.` : "Vote to see how it's going."}
          </p>
          <p className="botchelor-ballot">
            {board.vote.choices.map((c) => (
              <span key={c.id}>
                <button type="button" className={board.vote?.my_pick === c.id ? "primary small" : "button-ghost small"} disabled={busy} data-track="ceremony-vote" onClick={() => vote(c.id)}>
                  {c.name}
                  {voted ? ` · ${c.votes}` : ""}
                </button>{" "}
              </span>
            ))}
          </p>
        </>
      ) : board.next ? (
        <p className="muted small">
          {board.next.finale
            ? `The final rose ${countdown(board.next.runs_at, now)}: ${board.lead.name} picks between the last ${inPlay === 1 ? "one" : inPlay}, by how the season's dates went.`
            : inPlay <= 2
              ? `Two remain. The final rose comes on the season's last Sunday.`
              : `The next rose ceremony ${countdown(board.next.runs_at, now)} (${utcTime(board.next.runs_at)}). The vote opens on Thursday; ${board.lead.name}'s dates decide the other rose.`}
        </p>
      ) : null}
      {board.last && (
        <div className="botchelor-last">
          <p className="small">
            <strong>{board.last.finale ? "The finale" : `Week ${board.last.week}'s ceremony`}</strong>
            {board.last.total > 0 ? <span className="muted"> · {board.last.total} {board.last.total === 1 ? "vote" : "votes"}</span> : null}
          </p>
          {board.last.lines.map((line, i) => (
            <p key={i} className="small botchelor-line">
              {line}
            </p>
          ))}
        </div>
      )}
      {/* Open casting (lib/casting.ts): anyone's new character walks on for a first date with the lead; the count shows
          under the empty-room rule (decided on the server), and the finale names the people's rose. */}
      {board.walk_ons && (board.walk_ons.line || board.walk_ons.peoples_rose) && (
        <p className="muted small" data-walk-ons>
          {board.walk_ons.line && (
            <>
              <strong>Walk-ons this week.</strong> {board.walk_ons.line}{" "}
              <Link href="/create" data-track="walk-on-create">
                Send yours in →
              </Link>{" "}
            </>
          )}
          {board.walk_ons.peoples_rose && (
            <>
              <strong>The people&apos;s rose:</strong> <Link href={`/characters/${board.walk_ons.peoples_rose.id}`}>{board.walk_ons.peoples_rose.name}</Link>, the walk-on with the
              most roses ({board.walk_ons.peoples_rose.roses}).
            </>
          )}
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
