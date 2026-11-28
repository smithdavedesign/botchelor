"use client";

import Link from "next/link";
import Avatar from "@/app/Avatar";
import { requestJson } from "@/app/request";
import { useAction } from "@/app/useAction";
import { countdown } from "@/lib/countdown";
import { showCrowd, tallyLine } from "@/lib/crowd-threshold";
import type { CeremonyBoard, SuitorState } from "@/lib/ceremony";
import type { NextPremiere } from "@/lib/premiere-clock";
import { showSetBackground } from "@/lib/show-sets";
import Icon from "@/app/Icon";
import VoteCast from "@/app/motion/VoteCast";
import CeremonyReveal from "./CeremonyReveal";

const STATE_WORD: Record<SuitorState, string> = { in: "still in", out: "went home", final_rose: "the final rose", runner_up: "runner-up" };

/** "Sunday, 11:20 pm UTC": the fixed time the ceremony is held, the same for everyone (a countdown sits beside it). */
const utcTime = (iso: string): string => {
  const d = new Date(iso);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  return `Sunday, ${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"} UTC`;
};

/** "today" or "on Thursday": the day a challenge's prize date is on (UTC, like the show's days). */
const dayWord = (day: string, now: number): string =>
  day === new Date(now).toISOString().slice(0, 10) ? "today" : `on ${new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })}`;

/**
 * The Botchelor (lib/ceremony.ts): the lead, the suitors with their roses or how they left, the audience's vote on who
 * goes home while it's open (counts once you've voted, like the situation vote), the countdown to Sunday's ceremony, and
 * the last ceremony in the show's words, and the walk-ons (open casting, lib/casting.ts). Only on a season running the
 * format; a classic season never renders it. The Sunday premiere (lib/sunday-premiere.ts), the lead's last-chance date
 * live in one room before the roses, is one line under the ceremony's.
 */
export default function BotchelorCard({
  board,
  now,
  premiere = null,
  insider = false,
}: {
  board: CeremonyBoard;
  now: number;
  premiere?: NextPremiere | null;
  insider?: boolean;
}) {
  const { busy, error, run } = useAction();
  const vote = (pick: string) => run(() => requestJson("/api/ceremony", { pick }));
  const voted = board.vote?.my_pick != null;
  const tally = voted && showCrowd(board.vote?.total ?? 0, { insider });
  const inPlay = board.suitors.filter((s) => s.state === "in").length;
  return (
    <section id="rose-ceremony" className="card botchelor-card" aria-labelledby="botchelor-head" data-track-area="rose-ceremony">
      <p className="kicker">This season · one lead, your characters as the suitors</p>
      <h2 id="botchelor-head"><Icon name="rose" /> {board.title}</h2>
      {/* "Previously on" (lib/season-story.ts): the night opens on what already aired, like a TV episode. */}
      {board.previously && board.previously.length > 0 && (
        <div className="previously-on" data-previously>
          <p className="kicker">Previously on {board.title}</p>
          {board.previously.map((l, i) => (
            <p key={i} className="small">
              {l}
            </p>
          ))}
        </div>
      )}
      {/* The lead and the suitors on the show's stage, and the last verdict under the rose (lib/show-sets.ts). */}
      <div className="botchelor-house on-set" style={{ backgroundImage: showSetBackground("stage", 0.35) }}>
        <Link href={`/characters/${board.lead.id}`} className="botchelor-lead">
          {/* The lead holding out a rose, once their show kit has it (lib/show-shots.ts); their face until then. */}
          {board.lead.rose ? (
            // eslint-disable-next-line @next/next/no-img-element -- a PG shot from its own route, already small
            <img className="botchelor-lead-rose" src={board.lead.rose} alt="" width={72} height={90} />
          ) : (
            <Avatar seed={board.lead.id} name={board.lead.name} hue={board.lead.hue} house={board.lead.house} portraitSrc={board.lead.portrait} size={56} />
          )}
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
                  {s.state === "out" ? "🥀 " : <><Icon name="rose" className="suitor-rose" />{" "}</>}
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
            another. {voted ? tallyLine(board.vote.total, { insider }) : "Vote to see how it's going."}
          </p>
          <p className="botchelor-ballot">
            {board.vote.choices.map((c) => (
              <span key={c.id}>
                <button type="button" className={board.vote?.my_pick === c.id ? "primary small" : "button-ghost small"} disabled={busy} data-track="ceremony-vote" onClick={() => vote(c.id)}>
                  {c.name}
                  {tally ? ` · ${c.votes}` : ""}
                </button>{" "}
              </span>
            ))}
          </p>
          <VoteCast pick={board.vote.my_pick} />
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
      {/* The bombshell (lib/bombshell.ts): mid-season the audience votes one audition into the house. */}
      {board.bombshell?.state === "open" && (
        <div className="bombshell-vote" data-bombshell="open">
          {/* The news band: a red "Breaking" plate and the auditions' names running past, as a channel breaks a story. */}
          <div className="breaking-band" aria-hidden="true">
            <span className="breaking-plate">
              <span className="breaking-dot" />
              Breaking
            </span>
            <span className="breaking-ticker">
              <span className="breaking-run">
                {[0, 1].map((k) => (
                  <span key={k}>
                    {(board.bombshell?.choices ?? []).map((c) => (
                      <span key={c.id}>A bombshell is coming · Will it be {c.name}? · </span>
                    ))}
                  </span>
                ))}
              </span>
            </span>
          </div>
          <p className="small">
            <strong>The bombshell.</strong> One of these auditions walks into the house {countdown(board.bombshell.closes_at, now)}, and is safe at their first
            ceremony. Who should it be? {board.bombshell.my_pick ? tallyLine(board.bombshell.total, { insider }) : ""}
          </p>
          <p className="botchelor-ballot">
            {board.bombshell.choices.map((c) => (
              <span key={c.id}>
                <button
                  type="button"
                  className={board.bombshell?.my_pick === c.id ? "primary small" : "button-ghost small"}
                  disabled={busy}
                  data-track="bombshell-vote"
                  onClick={() => run(() => requestJson("/api/bombshell", { pick: c.id }))}
                >
                  {c.name}
                  {board.bombshell?.my_pick && showCrowd(board.bombshell.total, { insider }) ? ` · ${c.votes}` : ""}
                </button>{" "}
              </span>
            ))}
          </p>
          <VoteCast pick={board.bombshell.my_pick} />
        </div>
      )}
      {board.bombshell?.state === "joined" && board.bombshell.joined && (
        <p className="small" data-bombshell="joined">
          <span aria-hidden="true">💣</span> <strong>The bombshell:</strong> <Link href={`/characters/${board.bombshell.joined.id}`}>{board.bombshell.joined.name}</Link> walked into the
          house mid-season.
        </p>
      )}
      {premiere?.kind === "weekly" && premiere.lead.id === board.lead.id && (
        <p className="muted small" data-premiere={premiere.state}>
          <span aria-hidden="true">📺</span> <strong>{premiere.finale ? "The finale's premiere" : "Sunday's premiere"}</strong>
          {premiere.state === "live" ? " is on now" : `, ${premiere.time_words}, ${countdown(premiere.at, now)}`}: {board.lead.name}&apos;s{" "}
          {premiere.finale ? "last date before the final rose" : "last-chance date"}
          {premiere.suitor ? (
            <>
              {" "}
              with <Link href={`/characters/${premiere.suitor.id}`}>{premiere.suitor.name}</Link>
            </>
          ) : (
            ", with the suitor in most danger"
          )}
          , live in one room for everyone{premiere.roses_at ? `, then ${premiere.finale ? "the final rose" : "the roses"}` : ""}.{" "}
          {premiere.room_path ? (
            <Link href={premiere.room_path} data-track="premiere-room">
              {premiere.state === "live" ? "Watch it live →" : "Its room →"}
            </Link>
          ) : (
            "Its room opens on Watch about 40 minutes before."
          )}
        </p>
      )}
      {board.last && (
        <div className="botchelor-last on-set" style={{ backgroundImage: showSetBackground("elimination", 0.45) }}>
          <p className="small">
            <strong>{board.last.finale ? "The finale" : `Week ${board.last.week}'s ceremony`}</strong>
            {showCrowd(board.last.total, { insider }) ? <span className="muted"> · {board.last.total} {board.last.total === 1 ? "vote" : "votes"}</span> : null}
          </p>
          {/* The roses one at a time, the last rose between two faces, then the limo (lib/ceremony-night.ts). */}
          <CeremonyReveal last={board.last} staged={board.staged} />
        </div>
      )}
      {/* The week's house challenge (lib/house-conflict.ts): its winner takes the lead's next date in the rotation,
          trading days with whoever's turn it was. Decided by the show's rules, never by a vote. */}
      {board.challenge && (
        <p className="small botchelor-line" data-challenge>
          <span aria-hidden="true">🏆</span> <Link href={`/characters/${board.challenge.winner.id}`}>{board.challenge.winner.name}</Link> won{" "}
          {board.challenge.title ? board.challenge.title.replace(/^The /, "the ") : "the house challenge"}: {board.lead.name}&apos;s next date,{" "}
          {dayWord(board.challenge.day, now)}, is theirs.{" "}
          {board.challenge.scene_path && (
            <Link href={board.challenge.scene_path} data-track="house-scene" data-track-where="botchelor-card">
              See how →
            </Link>
          )}
        </p>
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
      <p className="muted small">
        <Link href={`${board.season_path}#tea`} data-track="botchelor-tea">
          The tea →
        </Link>{" "}
        ·{" "}
        <Link href={`${board.season_path}#fantasy`} data-track="botchelor-fantasy">
          Fantasy league →
        </Link>
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
