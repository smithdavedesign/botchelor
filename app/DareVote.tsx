"use client";

import Link from "next/link";
import Avatar from "./Avatar";
import { requestJson } from "./request";
import { useAction } from "./useAction";
import { useT } from "./I18nProvider";
import { fillNodes } from "./fillNodes";
import type { T } from "@/lib/i18n/translate";
import VoteCast from "@/app/motion/VoteCast";
import { showCrowd, tallyLine } from "@/lib/crowd-threshold";
import type { DareBoard } from "@/lib/dares";
import { dareSubject, type DareVerdict } from "@/lib/dare-words";
import { POINTS_PER_DARE } from "@/lib/rules";

/**
 * Tonight's dare (lib/dares.ts): the ballot's second lane. Viewers back one of three producer dares; the winner is
 * slipped to one side of tomorrow's house date, and the other side never knows. The counts show once you've voted.
 * /watch shows it as its own card; on home it is one `part` of the Tonight card (app/TonightVotes.tsx).
 */
/** The dare's outcome lines by the dared one's pronouns (lib/dare-words.ts dareSubject), whole sentences so each language words them its own way. */
function dareLines(t: T, pronouns: string | null | undefined) {
  const who = dareSubject(pronouns);
  const verdict: Record<DareVerdict, string> =
    who === "He"
      ? { went_through: t("He went through with it."), sort_of: t("He sort of did it. Half credit, generously."), chickened_out: t("He chickened out.") }
      : who === "She"
        ? { went_through: t("She went through with it."), sort_of: t("She sort of did it. Half credit, generously."), chickened_out: t("She chickened out.") }
        : { went_through: t("They went through with it."), sort_of: t("They sort of did it. Half credit, generously."), chickened_out: t("They chickened out.") };
  const ask = who === "He" ? t("Did he go through with it? You decide.") : who === "She" ? t("Did she go through with it? You decide.") : t("Did they go through with it? You decide.");
  const watch = who === "He" ? t("Watch whether he goes through with it") : who === "She" ? t("Watch whether she goes through with it") : t("Watch whether they go through with it");
  return { verdict, ask, watch };
}

export default function DareVote({ board, insider = false, part = false }: { board: DareBoard; insider?: boolean; part?: boolean }) {
  const t = useT();
  const { busy, error, run } = useAction();
  const voted = board.my_pick !== null;
  const tally = voted && showCrowd(board.total, { insider });
  const vote = (pick: string) => run(() => requestJson("/api/dare", { pick }));
  const Box = part ? "div" : "section";
  const Head = part ? "h3" : "h2";
  return (
    <Box id="dare" className={part ? "situation dare tonight-part" : "card situation dare"} role={part ? "group" : undefined} aria-labelledby="dare-head">
      <div className="situation-head">
        <span className="situation-avatars" aria-hidden="true">
          <Avatar seed={board.target.id} name={board.target.name} hue={board.target.hue} house portraitSrc={board.target.portrait} size={40} decorative />
        </span>
        <div>
          <p className="kicker">{part ? t("The dare") : t("Tonight's dare · you pick")}</p>
          <Head id="dare-head">{t("Dare {name} to…", { name: board.target.name })}</Head>
          <p className="muted small">
            {t("The producers slip the winning dare to {name} — their date won't know.", { name: board.target.name })}{" "}
            {voted ? tallyLine(board.total, { insider }, t) : t("Vote to see how it's going.")}{" "}
            {t("If your dare wins, you score when it airs: +{full} if they go through with it, +{half} if they sort of do.", { full: POINTS_PER_DARE.went_through, half: POINTS_PER_DARE.sort_of })}
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
                data-track="dare-vote"
              >
                <span className="situation-title">
                  <span aria-hidden="true">😈</span> {c.text}
                  {mine && <span className="chip">{t("Your dare")}</span>}
                </span>
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
      <VoteCast pick={board.my_pick} label={t("Your dare is in")} />
      {error && <p className="error small">{error}</p>}
      {board.last && (
        <p className="situation-last small">
          {/* The dare as it was slipped to them, in quotes, as the episode's reveal shows it: in its own words it says
              "you", which after "dared Sable to" read as the viewer (the 2026-11-22 audit). */}
          <span aria-hidden="true">😈</span>{" "}
          {fillNodes(t("Last dare, for {name}: {dare}"), { name: <strong>{board.last.name}</strong>, dare: <em>{`“${board.last.text}”`}</em> })}
          {board.last.my_pick ? (board.last.won ? ` ${t("(your dare)")}` : ` ${t("(not yours this time)")}`) : ""}{" "}
          {board.last.aired ? (
            <>
              {board.last.verdict ? dareLines(t, board.last.pronouns).verdict[board.last.verdict] : dareLines(t, board.last.pronouns).ask}
              {board.last.won && board.last.verdict && POINTS_PER_DARE[board.last.verdict] > 0 ? ` ${t("Your vote: +{n} points.", { n: POINTS_PER_DARE[board.last.verdict] })}` : ""}{" "}
              {board.last.episode_path && <Link href={board.last.episode_path}>{t("See the date")} →</Link>}
            </>
          ) : (
            board.last.episode_path && (
              <Link href={board.last.episode_path}>{dareLines(t, board.last.pronouns).watch} →</Link>
            )
          )}
        </p>
      )}
    </Box>
  );
}

