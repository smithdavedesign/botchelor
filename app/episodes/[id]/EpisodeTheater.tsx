"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Icon from "@/app/Icon";
import { useOverlay } from "@/app/useOverlay";
import { flush, queueEvent } from "@/app/engagement";
import Scene from "@/app/Scene";
import ChatThread from "@/app/ChatThread";
import { delayBefore, readingMs, useReplay } from "@/app/useReplay";
import SoundToggle from "@/app/motion/SoundToggle";
import { SOUND_EVENT, soundOn } from "@/app/motion/cues";
import { bedFor, startBed } from "@/app/motion/beds";
import { DATE_ACTS } from "@/lib/rules";
import type { Turn } from "@/lib/conversation";
import type { CharacterRef } from "@/lib/game";
import type { ShareNextCard } from "@/lib/share-next";
import { placeAt, type PlaceId } from "@/lib/venues";
import CharacterName from "@/app/CharacterName";
import { dateWatchedLive, msSinceDateStarted, theaterLeftProps } from "@/lib/engagement-keys";
import ShareEnding from "./ShareEnding";
import ShareNext from "./ShareNext";
import VerdictCard from "./VerdictCard";
import { latestFace } from "@/lib/show-shots-shared";
import { bigLine, chemistryOf, leaverOf, speakerOf } from "@/lib/theater-beats";
import type { Ending } from "@/lib/rules";
import Crowd from "./Crowd";
import { characterPortrait } from "@/lib/portraits";
import { showSetPath } from "@/lib/show-sets";
import type { ColdOpen } from "@/lib/cold-open";
import ColdOpenCard, { cutButtonLabel, type CutLink } from "./ColdOpenCard";
import CutPlayer, { type CutPlace } from "./CutPlayer";
import TheaterUpNext, { type TheaterNext } from "./TheaterUpNext";

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
  /** What to watch next (the page's "Up next", lib/up-next.ts): offered on a viewer's end screen, or null. */
  upNext?: TheaterNext | null;
  /** The owner's "who should go next?" card (lib/share-next.ts), once it aired publicly: in place of the viewer's share. */
  shareNext?: ShareNextCard | null;
  /** How it ended, so the stage acts it out after the last line (petals, a wave, a walk-off). */
  ending?: Ending | null;
  /**
   * Confessional cutaways (2026-11-28): the lines the viewer may already read on the page (the confessionals or the
   * diary cam), cut to between acts in the booth's frame, a's after the first act and b's after the second.
   */
  cutaways?: { character_id: string; line: string }[];
  /** Each one's name-card line on their entrance (what they want from it), in the order they sit. */
  cards?: [string | null, string | null] | null;
  /** The date is public and has aired: 📸 shares a line as a moment card (app/api/og/moment). */
  moments?: boolean;
};

/** How long a confessional cutaway holds between acts, and the entrance before the first line. */
const CUTAWAY_MS = 5200;
const ENTRANCE_MS = 2600;
/** The ending acts out for this long before the end card comes up (only when it played through, not skipped to). */
const CURTAIN_MS = 2800;
const CROWD_KEY = "bz-crowd";

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

function Playback({
  episodeId,
  characters,
  venue,
  transcript,
  endingLabel,
  justFilmed,
  startAt,
  roleplay,
  verdict,
  autoOpen,
  coldOpen,
  cut,
  reportCard,
  upNext,
  shareNext,
  ending = null,
  cutaways = [],
  cards = null,
  moments = false,
  onExit,
}: Props & { onExit: () => void }) {
  // The cold open comes first for anyone starting from the top (never the creator just filmed, nor picking up live).
  const intro = Boolean(coldOpen) && !justFilmed && !(startAt && startAt > 0);
  const [card, setCard] = useState<"first" | "again" | null>(intro ? "first" : null);
  const [cutOpen, setCutOpen] = useState(false);
  // The entrance and the confessional cutaways hold the next line while they play (useReplay's hold).
  const [entering, setEntering] = useState(false);
  const [cutaway, setCutaway] = useState<{ character_id: string; line: string } | null>(null);
  // The date waits behind the card: it starts when they press Start.
  const replay = useReplay(transcript, !intro, { startAt, hold: entering || cutaway !== null });
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
  // The entrance: before the first line they walk in from their sides with their name cards, and the date waits for it.
  // From the top again (Replay), they walk in again and the cutaways play again.
  const entered = useRef(false);
  const cutAt = useRef(new Set<number>());
  const count = replay.shown.length;
  useEffect(() => {
    if (count > 0) entered.current = true;
    else {
      cutAt.current.clear();
      entered.current = false;
    }
  }, [count]);
  useEffect(() => {
    if (count > 0 || !replay.playing || card || entered.current) return;
    entered.current = true;
    setEntering(true);
    const t = window.setTimeout(() => setEntering(false), ENTRANCE_MS);
    return () => {
      window.clearTimeout(t);
      setEntering(false);
    };
  }, [count, replay.playing, card]);
  // A confessional cutaway at the end of each act: once its last line has been read, cut to the booth, then back.
  useEffect(() => {
    if (!replay.playing || card || count === 0 || count >= transcript.length) return;
    const last = transcript[count - 1];
    const next = transcript[count];
    if (!(next.act > last.act)) return;
    const slot = last.act;
    const take = cutaways.find((c) => c.character_id === characters[slot === 0 ? 0 : 1]?.id && c.line.trim());
    if (!take || cutAt.current.has(slot)) return;
    const t = window.setTimeout(() => {
      cutAt.current.add(slot);
      setCutaway(take);
      // Just before the replay would move on (it waits the same reading time), so the cut lands first.
    }, Math.max(1200, readingMs(last) - 300));
    return () => window.clearTimeout(t);
  }, [count, replay.playing, card, transcript, cutaways, characters]);
  useEffect(() => {
    if (!cutaway) return;
    const t = window.setTimeout(() => setCutaway(null), CUTAWAY_MS);
    return () => window.clearTimeout(t);
  }, [cutaway]);
  // The ending acts out before the end card: a few seconds of it when it played through, none when they skipped to it.
  const [curtain, setCurtain] = useState(false);
  useEffect(() => {
    if (!replay.done) {
      setCurtain(false);
      return;
    }
    if (skipped.current) {
      setCurtain(true);
      return;
    }
    const t = window.setTimeout(() => setCurtain(true), ending ? CURTAIN_MS : 0);
    return () => window.clearTimeout(t);
  }, [replay.done, ending]);
  // The crowd (🍿): on unless this browser turned it off.
  const [crowdOn, setCrowdOn] = useState(true);
  useEffect(() => {
    try {
      setCrowdOn(window.localStorage.getItem(CROWD_KEY) !== "off");
    } catch {
      /* on */
    }
  }, []);
  const toggleCrowd = () =>
    setCrowdOn((v) => {
      try {
        if (v) window.localStorage.setItem(CROWD_KEY, "off");
        else window.localStorage.removeItem(CROWD_KEY);
      } catch {
        /* this visit only */
      }
      return !v;
    });
  // The room's sound bed (app/motion/beds.ts) while sound is on, by the place they're at now.
  const place = placeAt(replay.shown, venue);
  const [sound, setSoundState] = useState(false);
  useEffect(() => {
    setSoundState(soundOn());
    const sync = () => setSoundState(soundOn());
    window.addEventListener(SOUND_EVENT, sync);
    return () => window.removeEventListener(SOUND_EVENT, sync);
  }, []);
  const bed = bedFor(place);
  useEffect(() => {
    if (!sound) return;
    return startBed(bed);
  }, [sound, bed]);

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
            staged={{
              speaking: speakerOf(shown),
              act: shown.length ? shown[shown.length - 1].act : 0,
              push: bigLine(shown),
              ...chemistryOf(shown),
              cards: entering ? (cards ?? [null, null]) : null,
              ending: replay.done && !replay.playing && shown.length > 0 ? ending : null,
              leaver: leaverOf(shown),
            }}
          />
          <Crowd episodeId={episodeId} transcript={transcript} shown={shown.length} names={[a.name, b.name]} on={crowdOn && !card} moments={moments} />
          {cutaway && <Cutaway take={cutaway} characters={characters} onDone={() => setCutaway(null)} />}
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
          curtain &&
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
              shareNext={shareNext ?? null}
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
              {shareNext ? <ShareNext card={shareNext} place="theater" /> : <ShareEnding episodeId={episodeId} names={[a.name, b.name]} kind="viewer" />}
              {reportCard && (
                <p className="theater-report">
                  <Link className="button-ghost" href={reportCard} data-track="report-card-open">
                    📝 See its report card
                  </Link>
                </p>
              )}
              {upNext && <TheaterUpNext next={upNext} />}
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
          className={`theater-icon theater-crowd-toggle${crowdOn ? " on" : ""}`}
          onClick={toggleCrowd}
          aria-pressed={crowdOn}
          aria-label="The crowd"
          title="The crowd: viewers' reactions and the show's bots"
          data-track="theater-crowd"
        >
          🍿
        </button>
        <SoundToggle className="theater-sound" />
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

/**
 * A confessional cutaway (2026-11-28): between acts the picture cuts to the booth, where one of them says their piece to
 * the camera, then back to the date. Tapping it goes straight back.
 */
function Cutaway({ take, characters, onDone }: { take: { character_id: string; line: string }; characters: [CharacterRef, CharacterRef]; onDone: () => void }) {
  const who = characters.find((c) => c.id === take.character_id) ?? characters[0];
  const shot = who.shots?.confessional ?? who.portrait ?? characterPortrait(who.id);
  return (
    <button type="button" className="theater-cutaway" onClick={onDone} aria-label={`The confessional: ${who.name}. Back to the date`}>
      <span className="booth-frame theater-cutaway-frame">
        {/* eslint-disable-next-line @next/next/no-img-element -- their own small shot, or the booth's set */}
        <img className="booth-shot" src={shot ?? showSetPath("confessional")} alt="" aria-hidden="true" />
        <span className="booth-marks" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </span>
        <span className="booth-rec" aria-hidden="true">
          <span className="booth-rec-dot" /> REC
        </span>
        <span className="booth-caption">
          <span className="booth-line">
            <span className="booth-speaker">{who.name}:</span> {take.line}
          </span>
        </span>
      </span>
      <span className="theater-cutaway-kicker">The confessional · tap to go back to the date</span>
    </button>
  );
}
