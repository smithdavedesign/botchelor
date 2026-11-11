"use client";

import Link from "next/link";
import Avatar from "./Avatar";
import Reveal from "./Reveal";
import { requestJson } from "./request";
import { useAction } from "./useAction";
import { countdown } from "@/lib/countdown";
import type { RevealBoard, RevealResult } from "@/lib/weekly-reveal";
import Icon from "@/app/Icon";

/** "Sunday, 7 pm UTC": a fixed time in words, the same for everyone (a countdown sits beside it). */
const utcTime = (iso: string): string => {
  const d = new Date(iso);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const day = d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  return `${day}, ${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"} UTC`;
};

/** The result line: whose secret came out, by how many votes (or that the producers picked), and their date. */
export function RevealResultLine({ last }: { last: RevealResult }) {
  return (
    <p className="situation-last small weekly-reveal-result">
      <Icon name="unlock" /> <strong>{last.name}&apos;s secret is out:</strong> “{last.secret}”{" "}
      <span className="muted">
        {last.producers_pick ? "Nobody voted, so the producers picked." : `${last.votes} of ${last.total} ${last.total === 1 ? "vote" : "votes"}.`}
      </span>{" "}
      {last.room_path ? (
        <Link href={last.room_path} data-track="reveal-room">
          {last.partner ? `${last.partner} has heard it: watch their date →` : "Watch their date →"}
        </Link>
      ) : (
        <Link href={`/characters/${last.character_id}#secrets`}>See their secrets →</Link>
      )}
    </p>
  );
}

/**
 * Sunday's reveal (lib/weekly-reveal.ts): one vote a week, in a 24-hour window, on whose secret comes out; at the close
 * the secret airs, and the winner goes on a live date with the cast member they've dated most, who has heard it. The
 * counts show once you've voted. /watch shows the card; home's tonight band links to it while the vote is open.
 */
export default function WeeklyReveal({ board, now }: { board: RevealBoard; now: number }) {
  const { busy, error, run } = useAction();
  const voted = board.my_pick !== null;
  const vote = (pick: string) => run(() => requestJson("/api/weekly-reveal", { pick }));
  // The countdown that matters now: to the close, to the result, or to the next vote.
  const when =
    board.state === "open"
      ? `Closes ${countdown(board.closes_at, now)}`
      : board.state === "closed"
        ? `The vote is in: the secret comes out ${countdown(board.airs_at, now)}`
        : board.state === "soon"
          ? `The vote opens ${countdown(board.opens_at, now)}`
          : null;
  return (
    <section id="sunday-reveal" className="card situation weekly-reveal" aria-labelledby="sunday-reveal-head" data-track-area="sunday-reveal">
      <div className="situation-head">
        <div>
          <p className="kicker">Every Sunday · the audience decides</p>
          <h2 id="sunday-reveal-head">
            <Icon name="unlock" /> Sunday&apos;s reveal{board.state === "open" ? ": whose secret comes out?" : ""}
          </h2>
          {when && <p className="chip weekly-reveal-when">{when}</p>}
          {board.state === "open" ? (
            <p className="muted small">
              Most votes wins. At {utcTime(board.airs_at)} their next secret comes out, and they go on a date with the cast member
              they&apos;ve dated most, who has heard it. Watch it live: the characters still decide how it ends.{" "}
              {voted ? `${board.total} ${board.total === 1 ? "vote" : "votes"} so far.` : "Vote to see how it's going."}
            </p>
          ) : board.state === "soon" ? (
            <p className="muted small">
              Once a week the audience votes one cast member&apos;s secret out. The vote runs for 24 hours from {utcTime(board.opens_at)}, and the
              secret airs at {utcTime(board.airs_at)}.
            </p>
          ) : null}
        </div>
      </div>
      {board.choices.length > 0 && (
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
                  disabled={busy || board.state !== "open"}
                  onClick={() => vote(c.id)}
                  data-track="reveal-vote"
                >
                  <span className="situation-title">
                    <Avatar seed={c.id} name={c.name} hue={c.hue} house portraitSrc={c.portrait} size={32} decorative /> {c.name}
                    {mine && <span className="chip">Your pick</span>}
                  </span>
                  <span className="situation-premise">
                    {c.out} of {c.total} secrets out
                  </span>
                  {voted && (
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
      )}
      {error && <p className="error small">{error}</p>}
      {/* The envelope (app/Reveal.tsx): sealed while the vote is in and the secret is minutes away; opened, with the
          unseal once per week per browser, as soon as it's out. While a new vote is open the last result is a line. */}
      {board.state === "closed" && (
        <Reveal
          id={`${board.week_id}-sealed`}
          sealed
          kicker="This week's envelope"
          sealedTitle={`Sealed until ${utcTime(board.airs_at)}`}
          sealedNote={voted ? "Your vote's in. The envelope opens for everyone at once." : "The vote is in. The envelope opens for everyone at once."}
        />
      )}
      {board.last && board.state !== "closed" && board.state !== "open" && (
        <Reveal
          id={board.last.week_id}
          kicker="This week's envelope"
          who={<Avatar seed={board.last.character_id} name={board.last.name} hue={null} house size={56} decorative />}
          line={`${board.last.name.split(" ")[0]}'s secret is out`}
          detail={`“${board.last.secret}”`}
        >
          <RevealResultLine last={board.last} />
        </Reveal>
      )}
      {board.last && board.state === "open" && <RevealResultLine last={board.last} />}
    </section>
  );
}
