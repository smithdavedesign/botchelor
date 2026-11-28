"use client";

import Link from "next/link";
import Avatar from "./Avatar";
import { requestJson } from "./request";
import { useAction } from "./useAction";
import { useT } from "./I18nProvider";
import { fillNodes } from "./fillNodes";
import VoteCast from "@/app/motion/VoteCast";
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
  const t = useT();
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
          <p className="kicker">{part ? t("The situation") : t("Tonight's situation · you pick")}</p>
          {/* A day the producer staged a beat (lib/producer.ts): the twists name their own people, so the line says what the vote decides. */}
          <Head id="situation-head">{board.headline ?? t("{a} × {b}: what happens on their date?", { a: a.name, b: b.name })}</Head>
          <p className="muted small">
            {board.headline
              ? t("Most votes wins; it happens after the vote closes in {time}.", { time: closesIn(board.closes_at, now) })
              : t("Most votes wins; they play it after the vote closes in {time}.", { time: closesIn(board.closes_at, now) })}{" "}
            {voted ? tallyLine(board.total, { insider }, t) : t("Vote to see how it's going.")}
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
                  {mine && <span className="chip">{t("Your pick")}</span>}
                </span>
                <span className="situation-premise">{c.premise}</span>
                {tally && (
                  <span className="situation-bar">
                    <span style={{ width: `${share}%` }} aria-hidden="true" />
                    <em>
                      {share}%<span className="sr-only"> {t("of votes")}</span>
                    </em>
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <VoteCast pick={board.my_pick} />
      {error && <p className="error small">{error}</p>}
      {board.last && (
        <p className="situation-last small">
          <span aria-hidden="true">{board.last.icon}</span>{" "}
          {fillNodes(
            showCrowd(board.last.total, { insider })
              ? t("Last vote: {title} won with {votes} of {total} for {pair}", { votes: board.last.votes, total: board.last.total, pair: `${board.last.cast[0]} × ${board.last.cast[1]}` })
              : t("Last vote: {title} won for {pair}", { pair: `${board.last.cast[0]} × ${board.last.cast[1]}` }),
            { title: <strong>{board.last.title}</strong> },
          )}
          {board.last.my_pick ? (board.last.won ? ` ${t("(your pick)")}` : ` ${t("(not yours this time)")}`) : ""}.{" "}
          <Link href={board.last.room_path}>{t("Watch how it went")} →</Link>
        </p>
      )}
    </Box>
  );
}
