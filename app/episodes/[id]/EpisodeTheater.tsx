"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Icon from "@/app/Icon";
import { useOverlay } from "@/app/useOverlay";
import { flush, queueEvent } from "@/app/engagement";
import Scene from "@/app/Scene";
import ChatThread from "@/app/ChatThread";
import { delayBefore, useReplay } from "@/app/useReplay";
import { DATE_ACTS } from "@/lib/rules";
import type { Turn } from "@/lib/conversation";
import type { CharacterRef } from "@/lib/game";
import { placeAt, type PlaceId } from "@/lib/venues";
import CharacterName from "@/app/CharacterName";
import { dateWatchedLive, msSinceDateStarted, theaterLeftProps } from "@/lib/engagement-keys";
import ShareEnding from "./ShareEnding";
import VerdictCard from "./VerdictCard";
import { latestFace } from "@/lib/show-shots-shared";
import type { ColdOpen } from "@/lib/cold-open";
import ColdOpenCard, { cutButtonLabel, type CutLink } from "./ColdOpenCard";
import CutPlayer, { type CutPlace } from "./CutPlayer";

/** What the verdict card needs beyond the theater's own props (app/episodes/[id]/page.tsx hands it over for a creator). */
export type TheaterVerdict = {
  /** Which of the two is the creator's own (the one that texts): 0 or 1. */
  mine: 0 | 1;
  /** Its reflection on the date, when one was produced. */
  reflection: string | null;
  pushKey: string | null;
  /**
   * The After Dark bridge's link for this viewer (lib/adult/bridge-viewer.ts), or null. On a finished date the page
   * sends it only when the date ended in a second date; the live stage checks the ending itself (GeneratingPoller.tsx).
   */
  afterDark?: { href: string } | null;
};

type Props = {
  /** For the 👍/👎 on each line (lib/line-feedback.ts): line i is transcript[i], and playback shows them from the top. */
  episodeId: string;
  characters: [CharacterRef, CharacterRef];
  venue: PlaceId | null;
  transcript: Turn[];
  endingLabel: string;
  /** Open straight into the playback (`?play=1`: the creator arriving from sending the date, or a "watch it" link). */
  autoOpen?: boolean;
  /** The creator's own date, just filmed (`?play=1` from sending it): the chip says so, and the funnel counts it apart. */
  justFilmed?: boolean;
  /** Lines the creator already watched live while it was filmed (`?from=`): playback carries on from there. */
  startAt?: number;
  /** The roleplay the two played (lib/date-roleplays.ts): a chip in the header, so the lines read as their roles'. */
  roleplay?: { icon: string; title: string } | null;
  /** With `justFilmed`: the verdict card in place of the bare ending (VerdictCard.tsx). */
  verdict?: TheaterVerdict | null;
  /**
   * The cold open (lib/cold-open.ts): shown before the first line to anyone starting the date from the top, never to the
   * creator who just filmed it nor to someone picking up where they watched live. Null: none (COLD_OPEN=0, or nothing to say).
   */
  coldOpen?: ColdOpen | null;
  /** The date's short version (lib/home-clip.ts episodeCut), or null: a button beside "Watch in theater" and on the card. */
  cut?: CutLink | null;
  /** The date's report card (lib/report-card.ts), once it has aired for everyone: a link on the end screen. */
  reportCard?: string | null;
};

function lastOf(turns: Turn[], side: "a" | "b"): string | null {
  for (let i = turns.length - 1; i >= 0; i--) if (turns[i].side === side) return turns[i].dialogue;
  return null;
}

/**
 * M13 — the episode's cinematic replay. The same immersive scene as the live theater (characters in the
 * venue, persistent bubbles, the conversation as a messaging thread beside it), played back line by line,
 * paced like it aired. The readable thread stays on the page as the record; this is the experience on top.
 */
export default function EpisodeTheater(props: Props) {
  const [open, setOpen] = useState(props.autoOpen ?? false);
  const [cutFrom, setCutFrom] = useState<CutPlace | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  if (!open) {
    return (
      <>
        <button type="button" className="primary" onClick={() => setOpen(true)}>
          <Icon name="clapper" /> Watch in theater
        </button>
        {props.cut && (
          // The quick way in (2026-11-19): the same date as the show's short, with its voices.
          <button type="button" className="secondary" onClick={() => setCutFrom("hero")} data-track="episode-cut">
            {cutButtonLabel(props.cut.seconds)}
          </button>
        )}
        {props.cut && cutFrom && <CutPlayer cut={props.cut} title={cutTitle(props.characters)} place={cutFrom} onClose={() => setCutFrom(null)} />}
      </>
    );
  }
  return (
    <Playback
      {...props}
      onExit={() => {
        setOpen(false);
        // Leaving drops ?play=1, so a reload shows the episode rather than starting over.
        if (props.autoOpen) router.replace(pathname, { scroll: false });
      }}
    />
  );
}

/** The short version's sheet title: "Ada × Bo, the short version". */
function cutTitle([a, b]: [CharacterRef, CharacterRef]): string {
  return `${a.name} × ${b.name}, the short version`;
}

/** How long the whole date plays in the theater from its first line, by the replay's own pacing. */
function playMsOf(transcript: Turn[]): number {
  let ms = 0;
  for (let i = 0; i < transcript.length; i++) ms += delayBefore(transcript, i);
  return ms;
}

function Playback({ episodeId, characters, venue, transcript, endingLabel, justFilmed, startAt, roleplay, verdict, autoOpen, coldOpen, cut, reportCard, onExit }: Props & { onExit: () => void }) {
  // The cold open comes first for anyone starting from the top (never the creator just filmed, nor picking up live).
  const intro = Boolean(coldOpen) && !justFilmed && !(startAt && startAt > 0);
  const [card, setCard] = useState<"first" | "again" | null>(intro ? "first" : null);
  const [cutOpen, setCutOpen] = useState(false);
  // The date waits behind the card: it starts when they press Start.
  const replay = useReplay(transcript, !intro, { startAt });
  // Playing when "Who's who" paused it, so going back carries on; paused, it stays paused.
  const resume = useRef(true);
  const shownCard = useRef(false);
  useEffect(() => {
    if (!intro || shownCard.current) return;
    shownCard.current = true;
    queueEvent("cold_open", { lines: transcript.length, cut: Boolean(cut), again: false });
  }, [intro, transcript.length, cut]);
  const closeCard = () => setCard(null);
  const startFromCard = () => {
    const again = card === "again";
    setCard(null);
    if (!again || resume.current) replay.play();
  };
  const reopenCard = () => {
    resume.current = replay.playing && !replay.done;
    replay.pause();
    setCard("again");
  };
  // Where a viewer gave up (lib/engagement-keys.ts theaterLeftProps): once per opening, by Exit or the tab going away,
  // and never once the ending played. The ref reads the line on screen at that moment, not at the last render's closure.
  const openedAt = useRef(Date.now());
  const left = useRef(false);
  const at = useRef({ line: 0, done: false });
  at.current = { line: replay.shown.length, done: replay.done };
  const leave = (via: "exit" | "hidden") => {
    if (left.current || at.current.done) return;
    left.current = true;
    queueEvent("theater_left", theaterLeftProps({ line: at.current.line, of: transcript.length, openedAt: openedAt.current, now: Date.now(), via, auto: Boolean(autoOpen), intro }));
    if (via === "hidden") flush();
  };
  const leaveRef = useRef(leave);
  leaveRef.current = leave;
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") leaveRef.current("hidden");
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);
  const [convo, setConvo] = useState(true);
  // The aha moment (2026-11-07 product review, item 5): the replay reached the ending. Once per mount, never on exit.
  // Honest about how (the 2026-11-14 core plan): whether they skipped to it, and for the creator's own just-filmed date how
  // long since they sent it (lib/engagement-keys.ts; null when the stamp isn't in this tab).
  const watched = useRef(false);
  const skipped = useRef(false);
  useEffect(() => {
    if (!replay.done || watched.current) return;
    watched.current = true;
    // The filming stage already counted this ending in this tab (its early verdict card, GeneratingPoller.tsx): once.
    if (justFilmed && dateWatchedLive(episodeId)) return;
    queueEvent("date_watched", {
      via: "theater",
      just_filmed: Boolean(justFilmed),
      skipped: skipped.current,
      ms_since_start: justFilmed ? msSinceDateStarted() : null,
      // Whether this opening began with the cold open (lib/cold-open.ts), to compare endings watched with and without it.
      intro,
    });
  }, [replay.done, justFilmed, episodeId, intro]);
  const skip = () => {
    skipped.current = true;
    closeCard();
    replay.skip();
  };
  // Full screen over the page: the page behind is inert and still, and Escape closes "Who's who", else leaves the theater
  // (app/useOverlay.ts; 2026-11-20 mobile audit).
  const stage = useRef<HTMLDivElement>(null);
  useOverlay(true, {
    root: stage,
    outside: false,
    onClose: () => {
      if (card) return startFromCard();
      leave("exit");
      onExit();
    },
  });
  const shown = replay.shown;
  const [a, b] = characters;
  const actLabel = shown.length ? DATE_ACTS[shown[shown.length - 1].act] ?? null : null;

  return (
    <div className="theater theater-clean theater-replay" ref={stage}>
      <div className={`theater-stage${convo ? " with-convo" : ""}`}>
        <div className="theater-scene-area">
          <Scene
            characters={characters}
            venue={placeAt(shown, venue)}
            lineA={lastOf(shown, "a")}
            lineB={lastOf(shown, "b")}
            moodA={latestFace(characters[0].shots, shown, "a")}
            moodB={latestFace(characters[1].shots, shown, "b")}
            actLabel={actLabel}
            placeholder="The date begins…"
          />
        </div>
        <div className="theater-convo">
          <ChatThread characters={characters} turns={shown} typing={replay.typing} tone="dark" follow empty="The conversation appears here, line by line." feedback={{ kind: "episode", refId: episodeId }} />
        </div>

        {card && coldOpen && (
          <ColdOpenCard
            coldOpen={coldOpen}
            characters={characters}
            lines={transcript.length}
            playMs={playMsOf(transcript)}
            cut={cut ?? null}
            again={card === "again"}
            onStart={startFromCard}
            onCut={() => setCutOpen(true)}
          />
        )}
        {cut && cutOpen && <CutPlayer cut={cut} title={cutTitle(characters)} place="cold_open" onClose={() => setCutOpen(false)} />}

        {/* The title bar: Exit at the top left as the way back, then who's on (mobile audit A3: the transport moved to the
            foot, in thumb reach and labelled). */}
        <header className="theater-hud">
          <button
            type="button"
            className="secondary small theater-exit"
            onClick={() => {
              leave("exit");
              onExit();
            }}
          >
            <span aria-hidden="true">←</span> Exit
          </button>
          <div className="theater-id">
            <strong>
              <CharacterName character={a} /> <span className="vs">×</span> <CharacterName character={b} />
            </strong>
            {justFilmed && <span className="chip">Just filmed</span>}
            {roleplay && (
              <span className="chip" title="A roleplay both sides agreed to: the lines are their roles'">
                {roleplay.icon} {roleplay.title}
              </span>
            )}
          </div>
        </header>

        {!card &&
          replay.done &&
          (justFilmed && verdict ? (
            // The creator's own date, just filmed: the ending with a next step (their character texts them).
            <VerdictCard
              episodeId={episodeId}
              endingLabel={endingLabel}
              you={characters[verdict.mine]}
              partner={characters[verdict.mine === 0 ? 1 : 0]}
              preview={verdict.reflection}
              pushKey={verdict.pushKey}
              onRestart={replay.restart}
              afterDark={verdict.afterDark ?? null}
              reportCard={reportCard ?? null}
            />
          ) : (
            <div className="theater-verdict">
              <p className="ending">{endingLabel}</p>
              <p className="muted">
                That&apos;s how it ended.{" "}
                <button type="button" className="linklike" onClick={replay.restart}>
                  Watch again
                </button>
              </p>
              {/* The share where the feeling is (2026-11-11 growth plan): spoiler-free, like every viewer's share. */}
              <ShareEnding episodeId={episodeId} names={[a.name, b.name]} kind="viewer" />
              {reportCard && (
                <p className="theater-report">
                  <Link className="button-ghost" href={reportCard} data-track="report-card-open">
                    📝 See its report card
                  </Link>
                </p>
              )}
            </div>
          ))}
      </div>
      {/* Play, Replay, Skip and Who's who at the foot, labelled: a phone's thumb reaches them there (mobile audit A3). */}
      <nav className="theater-transport" aria-label="Playback">
        {coldOpen && (
          <button
            type="button"
            className={`theater-icon theater-transport-button${card ? " on" : ""}`}
            onClick={card ? startFromCard : reopenCard}
            aria-pressed={Boolean(card)}
            aria-label="Who's who"
            title="Who's who"
            data-track="theater-whos-who"
          >
            <span aria-hidden="true">👥</span>
            <span className="theater-transport-word" aria-hidden="true">
              Who&apos;s who
            </span>
          </button>
        )}
        <button
          type="button"
          className="theater-icon theater-transport-button"
          onClick={() => {
            closeCard();
            replay.restart();
          }}
          aria-label="Replay"
          title="Replay from the start"
        >
          <span aria-hidden="true">↻</span>
          <span className="theater-transport-word" aria-hidden="true">
            Replay
          </span>
        </button>
        <button
          type="button"
          className="theater-icon theater-transport-button theater-transport-main"
          onClick={() => {
            closeCard();
            replay.toggle();
          }}
          aria-label={replay.playing ? "Pause" : "Play"}
          title={replay.playing ? "Pause" : "Play"}
        >
          <span aria-hidden="true">{replay.playing ? "⏸" : "▶"}</span>
          <span className="theater-transport-word" aria-hidden="true">
            {replay.playing ? "Pause" : "Play"}
          </span>
        </button>
        <button type="button" className="theater-icon theater-transport-button" onClick={skip} aria-label="Skip to the end" title="Skip to the end">
          <span aria-hidden="true">⏭</span>
          <span className="theater-transport-word" aria-hidden="true">
            Skip
          </span>
        </button>
        <button
          type="button"
          className={`theater-icon theater-icon-wide${convo ? " on" : ""}`}
          onClick={() => setConvo((v) => !v)}
          aria-pressed={convo}
          aria-label="The conversation"
          title="The conversation"
        >
          📜
        </button>
      </nav>
    </div>
  );
}
