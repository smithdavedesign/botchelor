"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import Scene from "@/app/Scene";
import ChatThread from "@/app/ChatThread";
import { useReplay } from "@/app/useReplay";
import { AUTOPLAY_THEATER_AHEAD } from "@/lib/adult/autoplay";
import type { PublicBeat } from "@/lib/adult/beats";
import type { MoveLog } from "@/lib/adult/continuity";
import type { Suggestion } from "@/lib/adult/director";
import type { SceneLine } from "@/lib/adult/scenes";
import type { Turn } from "@/lib/conversation";
import type { CharacterRef } from "@/lib/game";
import { PLACE_LABEL_MAX, venueName, type PlaceId } from "@/lib/venues";
import { useSteadySet } from "./useSteadySet";
import { TheaterListen } from "./Listen";
import PlaceSound from "./PlaceSound";
import CaptureMenu from "./CaptureMenu";
import SceneBackdrop from "./SceneBackdrop";
import { useSceneMedia } from "./useSceneMedia";
import { presenceUrl, usePresence } from "./usePresence";
import { talkUrl, useTalks } from "./useTalks";
import { stagePicture, useMomentPictures } from "./useMomentPictures";
import { useDrawAhead } from "./useDrawAhead";
import { tokensWord } from "@/lib/adult/price-words";
import TalkPlayer from "./TalkPlayer";
import LivingFace from "../../LivingFace";
import Avatar from "@/app/Avatar";
import VideoChoice from "./VideoChoice";
import type { NightChapter } from "@/lib/adult/nights";
import type { ReelScope } from "@/lib/adult/reels";
import CharacterName from "@/app/CharacterName";
import WriterPicker from "../../WriterPicker";
import type { WriterOptions } from "@/lib/adult/writer";
import { libraryVenueFor, type CatalogScene } from "@/lib/adult/scene-catalog";
import SetSceneModal, { preloadScenes, type RoleplayPick } from "./SetSceneModal";
import PictureContext from "./PictureContext";
import type { Readiness } from "@/lib/adult/readiness";
import type { PictureEdit } from "@/lib/adult/beats";
import { roleplayById, type Roleplay } from "@/lib/adult/roleplays";

/** A saved chapter the 📖 menu can play again (lib/adult/scenes.ts AdultNight, trimmed). */
export type ChapterEntry = { id: string; chapter: number | null; lines: number; created_at: string; place: string | null };

/**
 * A scene line as a date turn: its *actions* apart from what they say. #1040 (the 2026-10-30 ad visitor: "stage
 * directions under the wrong speaker, or as bare '…' lines"): every *…* run counts, leading, in the middle, trailing or
 * several, joined in order; what's left is the speech, with no stray asterisk and no quotes left wrapping nothing. A line
 * that's only actions says "…" (the thread shows it as that line's stage direction).
 */
export function lineToTurn(l: SceneLine): Turn {
  const actions: string[] = [];
  const spoken = l.text
    .replace(/\*+([^*]*?)\*+/g, (_, act: string) => {
      if (act.trim()) actions.push(act.trim());
      return " ";
    })
    // An unclosed * (the writer cut off mid-direction): the rest of the line is that direction.
    .replace(/\*([^*]*)$/, (_, act: string) => {
      if (act.trim()) actions.push(act.trim());
      return " ";
    })
    // Quotes that wrapped a direction and nothing else ("'*clears throat*'").
    .replace(/(["'“‘])\s*(["'”’])/g, " ")
    .replace(/\s+([,.!?;:…])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
  const dialogue = /^["'“”‘’\s]*$/.test(spoken) ? "" : spoken;
  return { side: l.who, act: 0, dialogue: dialogue || "…", action: actions.join(" · "), emotion: "", interest: 0 };
}

/**
 * #1017 (the 2026-10-30 ad visitors: "I only found out the steer was queued by seeing the lines change", "nothing on
 * screen showed the steer was queued or used"): the steer said back under the bar, while its lines are written and once
 * they're in, with what the mode does, so a nudge that's only worked toward doesn't look ignored.
 */
export function steerEcho(direction: string, mode: "nudge" | "direct", done: boolean): string {
  const words = direction.trim().replace(/\s+/g, " ");
  const quoted = `"${words.length > 80 ? `${words.slice(0, 79).trimEnd()}…` : words}"`;
  if (!done) return `🎬 Steering (${mode}): ${quoted}. Writing the next lines…`;
  return mode === "direct"
    ? `🎬 Steered (direct): ${quoted}. These lines act on it now.`
    : `🎬 Steered (nudge): ${quoted}. They work toward it at the scene's own pace, over this step and the next few.`;
}

/**
 * The set to stand them in: the date's own venue while they're still there, else a named stage for wherever the scene
 * has gone ("elsewhere@his apartment"), which the scene draws as a generic set with the place's name.
 */
export function stageFor(place: string | null, dateVenue: string | null): PlaceId | null {
  if (!place) return (dateVenue as PlaceId | null) ?? null;
  // A library venue picked by name in the scene picker: its own reviewed set.
  const library = libraryVenueFor(place);
  if (library) return library as PlaceId;
  if (dateVenue) {
    // Whole words that name the place, never a time of day ("a rooftop pool at midnight" isn't "bowling on league night").
    const words = (venueName(dateVenue).toLowerCase().match(/[a-z]{5,}/g) ?? []).filter((w) => !TIME_WORDS.has(w));
    const said = new Set(place.toLowerCase().match(/[a-z]+/g) ?? []);
    if (words.some((w) => said.has(w))) return dateVenue as PlaceId;
  }
  return `elsewhere@${place.slice(0, PLACE_LABEL_MAX)}` as PlaceId;
}

/**
 * The label over the stage: the chapter's roleplay, and what they're doing at the line on screen in the writer's own words
 * (lib/adult/doing.ts): "🕶️ The bodyguard · holding the stalled lift's door". Never a stock phrase for how far it's gone
 * (David, 2026-10-25: "talking and flirting is still wrong, we can't hard code this: he is entering as a bodyguard who
 * has never crossed the line"): a line the writer didn't say it for shows the roleplay alone, or nothing. A new chapter
 * with no lines yet says which chapter it is.
 */
export function stageLabel(
  scene: { lines: SceneLine[]; stage: number; chapter?: number; roleplay?: RoleplayPick },
  shown: number,
  /** The owner's own roleplays (lib/studio/library.ts), beside the show's. */
  mine: readonly Roleplay[] = [],
): string | null {
  const rp = scene.roleplay ? (roleplayById(scene.roleplay.id) ?? mine.find((r) => r.id === scene.roleplay!.id) ?? null) : null;
  const withRoleplay = (label: string | null) => (rp ? (label ? `${rp.icon} ${rp.title} · ${label}` : `${rp.icon} ${rp.title}`) : label);
  if (!scene.lines.length) return withRoleplay(scene.chapter && scene.chapter > 1 ? `Chapter ${scene.chapter}` : null);
  return withRoleplay(scene.lines[Math.max(0, shown - 1)]?.doing ?? null);
}

/**
 * Before the night's first line (David, 2026-10-25: "we shouldn't get the date started until the user hits play or sets
 * the scene"): where they'll be and who they're playing, with Start. A later chapter carries straight on.
 */
export const awaitingStart = (scene: { lines: readonly unknown[]; chapter?: number }): boolean => !scene.lines.length && (scene.chapter ?? 1) === 1;

/**
 * #1030 (the 2026-10-30 ad visitor: "after switching to the hotel corridor, the first line was still the old diner
 * conversation"): where this chapter's paid cuts (Set the scene, lib/adult/scenes.ts setSceneTo) start, so the thread
 * can draw a "Now: <place>" divider there and the stage can leave the old place's bubbles behind. The last cut at a line
 * wins (a second pick before Next replaces the first); a cut past the lines there are (a rewind) is dropped.
 */
export function sceneCuts(scene: { lines: readonly unknown[]; chapter?: number; moves?: readonly MoveLog[] | null }): { at: number; place: string }[] {
  const byLine = new Map<number, string>();
  for (const m of scene.moves ?? []) {
    if (m.taken && m.reason === "set_scene" && m.chapter === (scene.chapter ?? 1) && m.at <= scene.lines.length) byLine.set(m.at, m.to);
  }
  return [...byLine].sort(([x], [y]) => x - y).map(([at, place]) => ({ at, place }));
}

/** #1029: discreet mode's one-time hint in the theater, remembered per browser (a convenience: without storage it shows again next time). */
const BLUR_HINT_KEY = "bz_ad_blur_hint_seen";

/**
 * #1029 (the 2026-10-30 ad visitor: "Dex and Nell are blurred colored squares … nothing on screen says which"): while
 * discreet mode blurs pictures (app/after-dark/discreet.css), the theater says so once, the first time it opens in this
 * browser, and how to see them. It goes after 20 seconds or on ✕.
 */
function BlurHint() {
  const ref = useRef<HTMLParagraphElement>(null);
  const [show, setShow] = useState(false);
  useEffect(() => {
    // Only when blur is on here: the layouts' wrapper says so (lib/adult/discreet.ts DISCREET_ATTR).
    if (!ref.current?.closest('[data-ad-discreet="blur"]')) return;
    try {
      if (window.localStorage.getItem(BLUR_HINT_KEY)) return;
      window.localStorage.setItem(BLUR_HINT_KEY, "1");
    } catch {
      // No storage (a private window): show it this time all the same.
    }
    setShow(true);
    const t = window.setTimeout(() => setShow(false), 20_000);
    return () => window.clearTimeout(t);
  }, []);
  return (
    <p ref={ref} className="ad-blur-hint" role="status" hidden={!show}>
      <span>
        🔒 Pictures are blurred for privacy: tap one to show it, or turn blur off in <a href="/after-dark#privacy">🔒&nbsp;Privacy</a>.
      </span>
      <button type="button" className="ad-blur-hint-close" aria-label="Dismiss" onClick={() => setShow(false)}>
        ✕
      </button>
    </p>
  );
}

/** The heats' labels on the suggestion chips (the page's are the same). */
// "mild" is the wildcard now (lib/adult/director.ts): the key stays so stored scenes still read.
const HEAT_WORD: Record<Suggestion["heat"], string> = { mild: "Surprise me", flirty: "Flirt", spicy: "Spicy" };

const TIME_WORDS: ReadonlySet<string> = new Set(["night", "nights", "evening", "morning", "midnight", "after", "late", "dusk", "sunset", "golden", "hour"]);

const lastOf = (turns: Turn[], side: "a" | "b") => {
  for (let i = turns.length - 1; i >= 0; i--) if (turns[i].side === side) return turns[i].dialogue;
  return null;
};

/**
 * After Dark's theater (David, 2026-10-18: "more immersive"): the show's stage, full screen, the two of them in the
 * place the scene has got to, line by line, with the steer and "Next" inside it, so the scene carries on without
 * leaving. Opens on the latest lines; ↻ plays it from the top. A saved night (no onWrite) plays back from the top.
 * The steer has the page's Nudge/Direct choice too (David, 2026-10-21: no direct way to steer from the theater).
 * Autoplay (lib/adult/autoplay.ts) writes the next lines by itself while the last few are still playing. The last step's
 * suggested next moves (lib/adult/director.ts) sit over the steer: one tap sends one as a nudge.
 * Beat pictures (lib/adult/beats.ts): when playback reaches a moment worth a picture, it stops and asks; 📸 pictures the
 * line on screen whenever the viewer likes.
 * The theater is the only way to watch now (David, 2026-10-25: "force them to watch in theaters"): the page opens on it,
 * and what the page's form did lives here too: the whisper to one of them, Rewind, Redo and Start over. The top bar has
 * 📖 the chapter (and every saved one to play again), 📍 Set the scene (a picker of every place, SetSceneModal.tsx) and
 * 🎬 the video; play, pause, from the top, catch up and listen sit bottom right, like a video player's.
 */
export default function AfterDarkTheater({
  scene,
  characters,
  busy = false,
  note = null,
  onWrite,
  steerDraft,
  steerMode = "nudge",
  onSteerMode,
  autoplay = false,
  onAutoplay,
  onSetScene,
  onMakeVideo,
  onPlanVideo,
  writer = null,
  videoChapters = [],
  videoTokens = 7,
  chapterTokens = 0,
  chapterIncluded = false,
  readiness = [],
  videoNote = null,
  mediaPaused = null,
  feedbackRef = null,
  suggestions = [],
  onSuggest,
  beats = [],
  onBeat,
  onPictureNow,
  picture = null,
  onExit,
  pageTabs,
  onPageTab,
  crisis = null,
  whisperTo = null,
  onWhisperTo,
  whispers = null,
  steps = null,
  chapters = [],
  onReplayChapter,
  scenes = [],
  myRoleplays = [],
  onScenario,
}: {
  scene: {
    lines: SceneLine[];
    place: string | null;
    stage: number;
    dateVenue: string | null;
    set?: string | null;
    chapter?: number;
    roleplay?: RoleplayPick;
    /** Their latest date's setting, where an unplaced night picks up. */
    dateSetting?: string | null;
    /** Where they agreed by text to go (lib/adult/scenes.ts textedPlan): the night starts there, and the place is locked. */
    planned?: { place: string } | null;
    /** This chapter's moves (lib/adult/continuity.ts MoveLog): a paid cut draws its "Now: <place>" divider (#1030). */
    moves?: readonly MoveLog[] | null;
  };
  characters: [CharacterRef, CharacterRef];
  busy?: boolean;
  note?: string | null;
  /** The crisis notice (app/CrisisNotice.tsx), when the viewer's own steer tripped lib/crisis.ts: shown over the stage. */
  crisis?: ReactNode;
  /** Writes the next lines; without it, this is a saved night's playback. */
  onWrite?: (direction: string) => Promise<boolean | void>;
  /** A steer to put back in the box (#1147: one sent before the page closed that never reached the writer). */
  steerDraft?: string | null;
  /** How strongly a steer is taken: worked toward (nudge) or done now (direct). Shared with the page's form. */
  steerMode?: "nudge" | "direct";
  onSteerMode?: (mode: "nudge" | "direct") => void;
  /** The scene carries on by itself, no Next needed. Shared with the page's form, which says when it stops. */
  autoplay?: boolean;
  onAutoplay?: (on: boolean) => void;
  /** Scene & roleplay: take them anywhere (1 token; null stays put) and set the chapter's roleplay (lib/adult/roleplays.ts). */
  onSetScene?: (place: string | null, roleplay: RoleplayPick) => Promise<void>;
  /**
   * The video of the night (lib/adult/reels.ts), in their voices, for `videoTokens`: of this chapter, or of the whole
   * night (`videoChapters`, every chapter since it began), as the viewer picks.
   */
  onMakeVideo?: (scope: ReelScope) => Promise<void>;
  /** Plan the video as a storyboard instead of filming it straight away (docs/PRDs/reel-storyboard.md). */
  onPlanVideo?: (scope: ReelScope) => Promise<void>;
  /** Who writes the lines (lib/adult/writer.ts): the ✍️ button in the tool row, live only. */
  writer?: WriterOptions | null;
  videoChapters?: readonly NightChapter[];
  videoTokens?: number;
  /** A chapter's price for this viewer (0: free, an admin): Start and the Next that opens a chapter say it. */
  chapterTokens?: number;
  /** Chapters are included with the viewer's subscription (#1005; David, 2026-10-30): Start and Next say "included". */
  chapterIncluded?: boolean;
  /** Whether each of them is set up for pictures (lib/adult/readiness.ts): the start card's checklist. */
  readiness?: readonly Readiness[];
  videoNote?: string | null;
  /** Hive's breaker is open (lib/adult/hive-limit.ts): the clip and video buttons are disabled, with this as their tooltip. */
  mediaPaused?: string | null;
  /**
   * What these lines are, for their 👍/👎 (lib/line-feedback.ts): the running scene's id, or the saved night's. A scene's
   * votes move to the night its chapter is filed as, so the running scene's are read again when its lines are replaced.
   */
  feedbackRef?: string | null;
  /** The last step's suggested next moves, and what a tap does (sends it as a nudge). */
  suggestions?: Suggestion[];
  onSuggest?: (text: string) => Promise<void>;
  /** The chapter's moments worth a picture; the viewer's answer to one; and Picture this, at a line. */
  beats?: readonly PublicBeat[];
  onBeat?: (id: string, answer: "now" | "later", guide?: { custom?: string; edit?: PictureEdit }) => Promise<void>;
  onPictureNow?: (line: number, guide?: { custom?: string; edit?: PictureEdit }) => Promise<void>;
  /**
   * #1039 (the 2026-10-30 ad visitor: "after pressing 'Create picture' there was no visible progress"): a picture the
   * viewer asked for is being drawn (said at once, from the press), or has just landed (said for a few seconds).
   */
  picture?: "drawing" | "landed" | null;
  onExit: () => void;
  /**
   * #1061 (the 2026-10-30 ad visitor: "the Gallery / Make / Set up / Two sides tabs are hidden under the full-screen
   * theater"): the page's tabs, in the ⋯ menu: one leaves the theater on that tab.
   */
  pageTabs?: readonly { id: string; label: string }[];
  onPageTab?: (id: string) => void;
  /** The steer goes to one of them only, as a whisper (lib/adult/director.ts); null: to the scene. Shared with the page. */
  whisperTo?: "a" | "b" | null;
  onWhisperTo?: (who: "a" | "b" | null) => void;
  /** The whispers they're carrying, with a way to forget each (the page draws them). */
  whispers?: ReactNode;
  /** Rewind, Redo and Start over, in the ⋯ menu: live only. */
  steps?: { canRewind: boolean; redoTitle: string; canReset: boolean; onRewind: () => void; onRedo: () => void; onReset: () => void } | null;
  /** The saved chapters, newest first, for the 📖 menu: one plays again over the theater. */
  chapters?: readonly ChapterEntry[];
  onReplayChapter?: (id: string) => void;
  /** Every place Set the scene can pick (lib/adult/scene-catalog.ts), and a scenario card's Start this story. */
  scenes?: readonly CatalogScene[];
  /** The owner's own roleplays (lib/studio/library.ts), beside the show's in the picker and the labels. */
  myRoleplays?: readonly Roleplay[];
  onScenario?: (id: string) => Promise<void>;
}) {
  const live = Boolean(onWrite);
  const turns = useMemo(() => scene.lines.map(lineToTurn), [scene.lines]);
  // Live: playback waits at the newest line and carries on as the next ones are written. A replay of a night already
  // watched opens at the end (David, 2026-10-24: revisiting shouldn't make you sit through it again) — ▶ or From the top
  // replays it.
  const [startAt] = useState(() => (live ? Math.max(0, scene.lines.length - 6) : scene.lines.length));
  const [listenHold, setListenHold] = useState(false);
  // 🔈 on: the voices, and the place's sound under them.
  const [listening, setListening] = useState(false);
  // A moment worth a picture, reached: playback waits for the viewer's answer.
  const [beatHold, setBeatHold] = useState(false);
  // A talking moment playing over the stage (TalkPlayer.tsx): the theater waits for it.
  const [talking, setTalking] = useState<{ id: string; name: string } | null>(null);
  const [answered, setAnswered] = useState<ReadonlySet<string>>(() => new Set());
  // Hitting 📸 opens a panel to agree on what the picture shows before it's drawn (David, 2026-10-24); its line.
  const [picturing, setPicturing] = useState<{ line: number } | null>(null);
  // A replay doesn't auto-play on open; the running scene still catches up and carries on.
  const replay = useReplay(turns, live, { live, startAt, hold: listenHold || beatHold || Boolean(talking) });
  const [convo, setConvo] = useState(false);
  // The backdrop's shape while one shows (SceneBackdrop.tsx): a phone sizes the stage to it instead of a thin strip.
  // "Full" gives a phone's whole stage to it, the lines as captions over it (David, 2026-10-25: "more immersive").
  const [mediaShape, setMediaShape] = useState<number | null>(null);
  const [mediaFull, setMediaFull] = useState(false);
  useEffect(() => {
    if (mediaShape === null) setMediaFull(false);
  }, [mediaShape]);
  // Rewind, Redo and Start over fold into "⋯".
  const [tools, setTools] = useState(false);
  // #1004 (2026-10-30 prod loop: "the ⋯ menu stays open after I used other controls"): a tap anywhere else closes it.
  useEffect(() => {
    if (!tools) return;
    const close = (e: PointerEvent) => {
      if (!(e.target instanceof Element && e.target.closest(".ad-tools-more"))) setTools(false);
    };
    // Escape too, like the 📷 menu (CaptureMenu.tsx).
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setTools(false);
    document.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [tools]);
  const [direction, setDirection] = useState("");
  useEffect(() => {
    if (steerDraft) setDirection(steerDraft);
  }, [steerDraft]);
  // The scene picker (SetSceneModal.tsx) and the 📖 chapter menu.
  const [picking, setPicking] = useState<false | "where" | "who">(false);
  // The picker stays mounted once opened, and its pictures load in the background while the scene plays.
  const [pickerOpened, setPickerOpened] = useState(false);
  const canSetScene = live && Boolean(onSetScene);
  useEffect(() => (canSetScene && scenes.length ? preloadScenes(scenes) : undefined), [canSetScene, scenes]);
  const [chapterMenu, setChapterMenu] = useState(false);
  const shown = replay.shown;
  const [a, b] = characters;
  // Media the pair already has of the moment (a picture to offer, a clip to loop behind the scene), live scenes only.
  const sceneMedia = useSceneMedia(a.id, b.id, shown.length, live);
  // A moment being pictured is on the stage when its line comes (docs/PRDs/theater-immersion.md #5): its picture when
  // it's drawn, the closest one they already have until then; otherwise the scene's own backdrop.
  const moments = useMomentPictures(a.id, b.id, beats, live);
  const momentOnStage = stagePicture(moments, shown.length - 1);
  const backdrop = momentOnStage ? { kind: "image" as const, id: momentOnStage.id } : sceneMedia.backdrop;
  // Draw ahead (lib/adult/draw-ahead.ts): the viewer's choice in ⋯, paid by the chapter. Asked again as the chapter and
  // its moments change (it turns itself off when a chapter can't be paid for).
  const drawAhead = useDrawAhead(a.id, b.id, `${scene.chapter ?? 1}:${beats.length}`, live && Boolean(onBeat));
  // Their living faces (lib/adult/presence.ts): the speaker's expression, the listener's loop, else the face.
  const { presence, make: makePresence, asking: presenceAsking } = usePresence(a.id, b.id);
  const [presenceNote, setPresenceNote] = useState<string | null>(null);
  // Once what was asked for has settled, what couldn't be made is said.
  const [presenceAsked, setPresenceAsked] = useState(false);
  useEffect(() => {
    if (!presenceAsked || presenceAsking) return;
    setPresenceAsked(false);
    const wrong = [a, b].flatMap((c) => (presence[c.id]?.failed ? [`${c.name.split(/\s+/)[0]}: ${presence[c.id].failed}`] : []));
    if (wrong.length) setPresenceNote(`Not all of it could be made. ${wrong.join(" ")}`);
  }, [presenceAsked, presenceAsking, presence, a, b]);
  useEffect(() => {
    if (!presenceNote) return;
    const t = window.setTimeout(() => setPresenceNote(null), 12_000);
    return () => window.clearTimeout(t);
  }, [presenceNote]);
  const faceOf = (side: "a" | "b") => {
    const c = side === "a" ? a : b;
    const p = presence[c.id];
    if (!p) return undefined;
    // Their line's expression while it's the one on screen; listening, their loop if they have one, else that look held.
    let expression: string | undefined;
    for (let i = shown.length - 1; i >= 0; i--) {
      if (scene.lines[i]?.who !== side) continue;
      const f = scene.lines[i].face;
      const speaking = i === shown.length - 1;
      expression = f && f !== "neutral" && (speaking || !p.loop) ? p.expressions[f] : undefined;
      break;
    }
    return (
      <LivingFace
        face={p.portrait ? presenceUrl(p.portrait) : `/api/admin/after-dark/media/${encodeURIComponent(p.face_id)}`}
        expression={expression ? presenceUrl(expression) : null}
        loop={p.loop ? presenceUrl(p.loop) : null}
        name={c.name}
        size={132}
        fallback={<Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} portraitSrc={c.portrait} photoSrc={c.photo} size={132} />}
      />
    );
  };
  // 🗣 The line on stage, said by its speaker (lib/adult/talks.ts): offered once they have a portrait; the one asked for
  // opens over the stage when it's ready.
  const talks = useTalks(a.id, b.id);
  const onStage = shown.length - 1;
  const stageLine = onStage >= 0 ? scene.lines[onStage] : undefined;
  const stageSpeaker = stageLine ? (stageLine.who === "a" ? a : b) : null;
  const stageTalk = stageLine ? talks.talks.find((t) => t.who === stageLine.who && t.text === stageLine.text) : undefined;
  const speakerPortrait = stageSpeaker ? Boolean(presence[stageSpeaker.id]?.portrait) : false;
  const sayable = Boolean(stageLine && shown[onStage]?.dialogue && shown[onStage].dialogue !== "…");
  const [awaitingTalk, setAwaitingTalk] = useState<string | null>(null);
  useEffect(() => {
    if (!awaitingTalk) return;
    const t = talks.talks.find((x) => x.id === awaitingTalk);
    if (t?.status === "ready") {
      setAwaitingTalk(null);
      setTalking({ id: t.id, name: (t.who === "a" ? a : b).name });
    } else if (t?.status === "failed") {
      setAwaitingTalk(null);
      setPresenceNote(`The talking moment couldn't be made (${t.error ?? "error"}). Any tokens are back.`);
    }
  }, [awaitingTalk, talks.talks, a, b]);
  const hearIt = async () => {
    if (!stageLine || !stageSpeaker) return;
    setTools(false);
    if (stageTalk?.status === "ready") return setTalking({ id: stageTalk.id, name: stageSpeaker.name });
    const got = await talks.ask(onStage, stageLine.text, live ? null : (feedbackRef ?? null));
    if ("message" in got) return setPresenceNote(got.message);
    if (got.talk.status === "ready") return setTalking({ id: got.talk.id, name: stageSpeaker.name });
    setAwaitingTalk(got.talk.id);
    setPresenceNote(`🗣 ${stageSpeaker.name.split(/\s+/)[0]} is saying it: it opens here in a minute or two.`);
  };
  // "✨ Bring them to life" is offered while either still lacks some of it and nothing's on its way.
  const canBringToLife = [a, b].some((c) => !presence[c.id] || (!presence[c.id].making && presence[c.id].missing > 0));
  const toggleDrawAhead = async () => {
    setTools(false);
    setPresenceNote(await drawAhead.set(!drawAhead.view?.on, Math.max(0, shown.length - 1)));
  };
  const bringToLife = async () => {
    setTools(false);
    setPresenceNote("Bringing them to life: their expressions and a living portrait, ready in a few minutes (no tokens; it counts toward this month's pictures). They change here when it's done.");
    const why = await makePresence();
    if (why) setPresenceNote(why);
    else setPresenceAsked(true);
  };
  const caughtUp = shown.length >= turns.length;
  const left = turns.length - shown.length;
  // Autoplay: the next lines are on their way before the stage runs out (paused playback stops it writing further ahead).
  // Never before the night has started: Start does that, so ticking Autoplay first doesn't begin it.
  const waiting = live && awaitingStart(scene);
  useEffect(() => {
    if (live && autoplay && !busy && !waiting && left <= AUTOPLAY_THEATER_AHEAD) void onWrite?.("");
  }, [live, autoplay, busy, waiting, left, onWrite]);
  // Autoplay means play (the audit, 2026-10-31: a paused player under Autoplay sat at 94 lines for ten minutes and
  // nothing said why): switching it on starts playback, and the viewer's own pause (below) switches it off.
  useEffect(() => {
    if (live && autoplay && !replay.playing) replay.toggle();
    // Only as Autoplay is switched on (or the night goes live), never on every play/pause.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, autoplay]);
  const offer = live && onBeat ? (beats.find((x) => x.status === "offered" && !answered.has(x.id) && x.line < shown.length) ?? null) : null;
  useEffect(() => setBeatHold(Boolean(offer)), [offer]);
  async function answer(id: string, a: "now" | "later", edit?: PictureEdit) {
    setAnswered((s) => new Set([...s, id]));
    await onBeat?.(id, a, a === "now" && edit ? { edit } : undefined);
  }
  // #1030: the last cut playback has reached. The stage shows only the lines since it (never the old place's bubbles), and
  // until the first of them, "Now: <place>" with the Next hint; the thread draws the same divider where the cut is.
  const cuts = useMemo(() => sceneCuts(scene), [scene]);
  const cut = [...cuts].reverse().find((c) => c.at <= shown.length) ?? null;
  const onStageNow = cut ? shown.slice(cut.at) : shown;
  const arriving = Boolean(cut && !onStageNow.length);
  const arriveHint = live ? "Press Next to see them arrive." : null;
  const dividers = useMemo(() => cuts.map((c) => ({ at: c.at, text: `Now: ${c.place}`, hint: c.at === scene.lines.length ? arriveHint : null })), [cuts, scene.lines.length, arriveHint]);
  const latestAction = onStageNow.length ? onStageNow[onStageNow.length - 1].action : "";
  // Arriving, the label is the roleplay alone: the line before the cut said what they were doing at the old place.
  const label = arriving ? stageLabel({ ...scene, lines: [], chapter: 1 }, 0, myRoleplays) : stageLabel(scene, shown.length, myRoleplays);
  // A roleplay by id: the show's, or one of the owner's own.
  const rpOf = (id: string | null | undefined): Roleplay | null => (id ? (roleplayById(id) ?? myRoleplays.find((r) => r.id === id) ?? null) : null);
  // The set: preloaded, so the last ready one stays up until the next has loaded (never the placeholder in between).
  const stage = useSteadySet(stageFor(scene.set || scene.place, scene.dateVenue));
  // The chapter and its first line say which lines these are: both change when a chapter is filed or Start over runs.
  const epoch = `${scene.chapter ?? 1}:${scene.lines[0]?.text.slice(0, 60) ?? ""}`;
  const feedback = useMemo(() => (feedbackRef ? { kind: "after_dark" as const, refId: feedbackRef, epoch } : null), [feedbackRef, epoch]);

  const firstName = (c: CharacterRef) => c.name.split(/\s+/)[0];
  const whisperName = whisperTo ? firstName(whisperTo === "a" ? a : b) : null;

  async function next(e: FormEvent) {
    e.preventDefault();
    // A whisper needs its words; a refused steer or whisper stays in the box, to be reworded.
    if (whisperTo && !direction.trim()) return;
    // #1155 (the 2026-10-31-1808 visitor: "the popup blocks Next"): Next with a picture offer open answers it "later".
    if (offer) void answer(offer.id, "later");
    // The 2026-10-30 prod loop (run 4: "the Playing… lock was the biggest obstacle"): Next during playback jumps to the end
    // and carries on, rather than waiting out a replay of the last lines on every visit.
    // A steer leaves playback running: its lines come after what's playing. Carrying on means playing on: skip() also
    // paused it, so the step's own lines never came on stage and their "Picture this?" never asked (#1061's e2e).
    if (!caughtUp && !direction.trim()) replay.catchUp();
    if ((await onWrite?.(direction.trim())) !== false) setDirection("");
  }

  return (
    <div
      className="theater theater-clean theater-after-dark"
      role="dialog"
      aria-label={`${a.name} and ${b.name}, after dark`}
    >
      <div
        className={`theater-stage${convo ? " with-convo" : ""}${mediaShape ? " has-media" : ""}${mediaFull ? " media-full" : ""}`}
        style={mediaShape ? ({ "--ad-media-ar": String(mediaShape) } as CSSProperties) : undefined}
      >
        <div className="theater-scene-area">
          {live && <SceneBackdrop backdrop={backdrop} onShape={setMediaShape} />}
          {picture === "drawing" ? (
            <p className="ad-moment-drawing" role="status">
              📸 Drawing your picture… about half a minute
            </p>
          ) : picture === "landed" ? (
            <p className="ad-moment-drawing is-landed" role="status">
              📸 Your picture is here: on the stage, and first in the gallery
            </p>
          ) : (
            live &&
            momentOnStage?.drawing && (
              <p className="ad-moment-drawing" role="status">
                📸 Drawing this moment: the closest one they have, until it lands
              </p>
            )
          )}
          {talking && <TalkPlayer src={talkUrl(talking.id)} name={talking.name} onClose={() => setTalking(null)} />}
          {!talking && stageTalk?.status === "ready" && stageSpeaker && (
            <button type="button" className="button-ghost small ad-talk-chip" onClick={() => setTalking({ id: stageTalk.id, name: stageSpeaker.name })}>
              🗣 Hear {stageSpeaker.name.split(/\s+/)[0]} say it ▶
            </button>
          )}
          {mediaShape && (
            // A phone only (CSS): the clip on the whole stage, or back to the thread under it.
            <button type="button" className="ad-media-full-toggle" onClick={() => setMediaFull((v) => !v)} aria-pressed={mediaFull} title={mediaFull ? "Back to the thread" : "Watch it full screen"}>
              {mediaFull ? "↙ Thread" : "⛶ Full"}
            </button>
          )}
          {mediaFull && shown.length > 0 && (
            // The line on screen as a caption over the clip, like subtitles.
            <p className="ad-media-caption" aria-live="polite">
              <strong>{(shown[shown.length - 1].side === "a" ? a : b).name.split(/\s+/)[0]}:</strong> {shown[shown.length - 1].dialogue}
            </p>
          )}
          <Scene
            characters={characters}
            venue={stage.venue}
            setUrl={stage.setUrl}
            lineA={lastOf(onStageNow, "a")}
            lineB={lastOf(onStageNow, "b")}
            faceA={faceOf("a")}
            faceB={faceOf("b")}
            actLabel={label}
            placeholder={waiting || arriving ? "" : scene.lines.length ? "…" : "Press Next to begin."}
          />
          {arriving && cut && !waiting && (
            <p className="ad-scene-cut" role="status">
              <strong>📍 Now: {cut.place}</strong>
              {cut.at === scene.lines.length && arriveHint && <span>{arriveHint}</span>}
            </p>
          )}
          <BlurHint />
          {waiting && (
            <div className="ad-start-card" role="group" aria-label="Before the night starts">
              <p className="kicker">Tonight</p>
              <p className="ad-start-where">
                📍{" "}
                {scene.planned
                  ? scene.planned.place
                  : (scene.set ?? scene.place ?? (scene.dateSetting ? `${scene.dateSetting}, where their date was` : "Wherever they meet: pick a place, or let them choose"))}
              </p>
              {scene.planned && (
                <p className="muted small ad-start-plan">
                  💬 {firstName(a)} × {firstName(b)} decided on {scene.planned.place} by text.
                </p>
              )}
              {readiness.some((r) => !r.ready) && (
                // Creation → their face and body → After Dark (David, 2026-10-25): what's missing, and where to set it.
                <ul className="ad-start-ready" aria-label="Pictures">
                  {readiness.map((r) => (
                    <li key={r.id}>
                      <strong>{r.name.split(/\s+/)[0]}</strong>{" "}
                      {r.ready ? (
                        "✓ ready for pictures"
                      ) : (
                        <>
                          {`${r.face ? "✓" : "○"} face · ${r.body ? "✓" : "○"} body`}{" "}
                          {r.own && (
                            <a href={r.studio} className="ad-start-setup">
                              Set up in the Studio →
                            </a>
                          )}
                        </>
                      )}
                    </li>
                  ))}
                  <li className="muted small">Until both are set up, the night runs without pictures: nothing is guessed.</li>
                </ul>
              )}
              <p className="ad-start-rp">{rpOf(scene.roleplay?.id) ? `${rpOf(scene.roleplay?.id)!.icon} ${rpOf(scene.roleplay?.id)!.title}` : "💬 No roleplay: just the two of them"}</p>
              <div className="ad-start-actions">
                {onSetScene && (
                  <button type="button" className="secondary small" disabled={busy} onClick={() => (setPicking(scene.planned ? "who" : "where"), setPickerOpened(true))}>
                    {scene.planned ? "🎭 Pick a roleplay" : "📍 Scene & roleplay"}
                  </button>
                )}
                <button type="button" className="primary" disabled={busy} onClick={() => void onWrite?.(direction.trim()).then((ok) => ok !== false && setDirection(""))}>
                  {busy ? "Starting…" : `▶ Start the night${chapterTokens ? ` · ${tokensWord(chapterTokens)}` : chapterIncluded ? " · included" : ""}`}
                </button>
              </div>
            </div>
          )}
          {latestAction && <p className="ad-theater-action">{latestAction}</p>}
          {offer && (
            <div className="ad-beat-offer" role="dialog" aria-label="Picture this moment?">
              <p>
                <strong>📸 {offer.label}</strong>
                <span className="muted small"> Picture this moment? It&apos;s drawn from the last few lines and lands in their gallery.</span>
              </p>
              {/* What it'll be drawn from, field by field, each one the owner's to change (lib/adult/beats.ts PictureEdit). */}
              <PictureContext a={a.id} b={b.id} target={{ beat: offer.id }} disabled={Boolean(mediaPaused)} submitLabel="Picture it" cancelLabel="Not now" onSubmit={(edit) => void answer(offer.id, "now", edit)} onCancel={() => void answer(offer.id, "later")} />
            </div>
          )}
          {picturing && onPictureNow && (
            // Agree on what the picture shows before it's drawn (David, 2026-10-24): the moment, and anything to add.
            <div className="ad-beat-offer" role="dialog" aria-label="Create a picture of this moment">
              <p>
                <strong>📸 Picture this moment</strong>
                <span className="muted small"> It draws the two of them from here. Check what it&apos;ll show and put right anything that&apos;s off, then create it.</span>
              </p>
              <PictureContext
                a={a.id}
                b={b.id}
                target={{ line: picturing.line }}
                disabled={Boolean(mediaPaused)}
                submitLabel="Create picture"
                onSubmit={(edit) => {
                  const line = picturing.line;
                  setPicturing(null);
                  void onPictureNow(line, edit ? { edit } : undefined);
                }}
                onCancel={() => setPicturing(null)}
              />
            </div>
          )}
        </div>
        <div className="theater-convo">
          {/* #1040: meta shows each line's actions beside that line, and an action-only line as a stage direction. */}
          <ChatThread characters={characters} turns={shown} typing={busy ? null : replay.typing} tone="dark" follow meta empty="The scene appears here, line by line." feedback={feedback} dividers={dividers} nameEvery />
        </div>

        <header className="theater-hud">
          <div className="theater-id">
            <strong>
              <CharacterName character={a} /> <span className="vs">×</span> <CharacterName character={b} />
            </strong>
            {/* The chapter, and every saved one to play again (David, 2026-10-25: "an icon to the chapter label"). */}
            <div className="ad-chapter">
              <button
                type="button"
                className="chip ad-chapter-chip"
                aria-expanded={chapterMenu}
                aria-haspopup="menu"
                disabled={!chapters.length || !onReplayChapter}
                title={chapters.length && onReplayChapter ? "Chapters: play an earlier one again" : undefined}
                onClick={() => setChapterMenu((v) => !v)}
              >
                📖 {live ? `Chapter ${scene.chapter ?? 1}` : scene.chapter ? `Chapter ${scene.chapter} · replay` : "Replay"}
                {chapters.length > 0 && onReplayChapter ? " ▾" : ""}
              </button>
              {chapterMenu && onReplayChapter && (
                <div className="ad-chapter-menu" role="menu" aria-label="Chapters">
                  {live && (
                    <span className="ad-chapter-item on">
                      ▶ Chapter {scene.chapter ?? 1} <span className="muted small">· now · {scene.lines.length} lines</span>
                    </span>
                  )}
                  {chapters.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      role="menuitem"
                      className="ad-chapter-item"
                      onClick={() => {
                        setChapterMenu(false);
                        onReplayChapter(c.id);
                      }}
                    >
                      ↺ {c.chapter ? `Chapter ${c.chapter}` : "A night"}{" "}
                      <span className="muted small">
                        · {new Date(c.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {c.lines} lines{c.place ? ` · ${c.place}` : ""}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* This chapter's roleplay: opens the picker on its second screen to change or end it. */}
            {live && scene.roleplay && rpOf(scene.roleplay.id) && (
              <button type="button" className="chip ad-roleplay-chip" title="This chapter's roleplay: change or end it" onClick={() => (setPicking("who"), setPickerOpened(true))}>
                {rpOf(scene.roleplay.id)!.icon} {rpOf(scene.roleplay.id)!.title}
              </button>
            )}
          </div>
          <div className="theater-tools">
            {live && onSetScene && (
              <button
                type="button"
                className="secondary small ad-set-scene"
                onClick={() => (setPicking(waiting && scene.planned ? "who" : "where"), setPickerOpened(true))}
                disabled={busy}
                title={waiting && scene.planned ? `They decided on ${scene.planned.place} by text: pick who they are this chapter` : "Take them anywhere (1 token), and pick who they are this chapter"}
              >
                📍 <span className="ad-tool-word">Scene &amp; roleplay</span>
              </button>
            )}
            {onMakeVideo && (
              <VideoChoice chapters={videoChapters} scene={{ chapter: scene.chapter ?? 1, lines: scene.lines.length }} tokens={videoTokens} busy={busy} paused={mediaPaused} onMake={onMakeVideo} onPlan={onPlanVideo} />
            )}
            <button
              type="button"
              className={`theater-icon theater-icon-wide${convo ? " on" : ""}`}
              onClick={() => setConvo((v) => !v)}
              aria-pressed={convo}
              aria-label="The scene so far"
              title="The scene so far"
            >
              {/* #1099 (the 2026-10-31-1329 visitor: "the small 📜 icon. Its meaning is unlabeled"): a word beside it. */}
              📜 <span className="theater-icon-word">Story</span>
            </button>
            {/* Who writes the lines (David, 2026-10-25: "the writer drop down as a logo in the theatre mode"). */}
            {live && writer && <WriterPicker initial={writer} icon />}
            <CaptureMenu
              a={a.id}
              b={b.id}
              at={shown.length - 1}
              nightId={live ? null : feedbackRef}
              paused={mediaPaused}
              onPicture={live && onPictureNow ? () => setPicturing({ line: Math.max(0, shown.length - 1) }) : null}
              canPicture={shown.length > 0}
              match={live ? sceneMedia.match : null}
            />
            {steps && (
              <div className={`ad-tools-more${tools ? " open" : ""}`}>
                <button type="button" className="theater-icon ad-tools-toggle" aria-expanded={tools} aria-label="More tools" title="Rewind, redo, start over" onClick={() => setTools((v) => !v)}>
                  ⋯
                </button>
                <div className="ad-tools-items ad-tools-steps">
                  <button type="button" className="button-ghost small" disabled={busy || !steps.canRewind} onClick={() => (setTools(false), steps.onRewind())} title={steps.canRewind ? "Take the last step back: its lines, and where the scene was" : "Nothing to rewind yet"}>
                    ↺ Rewind
                  </button>
                  <button type="button" className="button-ghost small" disabled={busy || !steps.canRewind} onClick={() => (setTools(false), steps.onRedo())} title={steps.redoTitle}>
                    ↻ Redo
                  </button>
                  <button type="button" className="button-ghost small" disabled={busy || !steps.canReset} onClick={() => (setTools(false), steps.onReset())} title="File tonight under their nights and start a new one">
                    Start over
                  </button>
                  {/* #1061: the tabs under the theater, reachable from it (the theater covers the page). */}
                  {onPageTab &&
                    pageTabs?.map((t) => (
                      <button key={t.id} type="button" className="button-ghost small ad-tools-page-tab" onClick={() => (setTools(false), onPageTab(t.id))} title="Leave the theater for this tab below it">
                        {t.label}
                      </button>
                    ))}
                  {stageSpeaker && sayable && (
                    <button
                      type="button"
                      className="button-ghost small"
                      disabled={!speakerPortrait || stageTalk?.status === "making"}
                      onClick={() => void hearIt()}
                      title={
                        !speakerPortrait
                          ? `✨ Bring them to life first: a talking moment starts from ${firstName(stageSpeaker)}'s portrait`
                          : stageTalk?.status === "making"
                            ? "Being made: it opens here when it's ready"
                            : `A few seconds of ${firstName(stageSpeaker)} saying the line on screen, in their voice`
                      }
                    >
                      🗣 Hear it from {firstName(stageSpeaker)}
                      {stageTalk?.status !== "ready" && talks.price > 0 ? ` · ${talks.price} token${talks.price === 1 ? "" : "s"}` : ""}
                    </button>
                  )}
                  {/* #1099: why it's greyed out, on screen (a title never shows on a phone or to a keyboard). */}
                  {stageSpeaker && sayable && !speakerPortrait && (
                    <span className="muted small ad-tools-why">Bring them to life first: a talking moment starts from {firstName(stageSpeaker)}&apos;s portrait.</span>
                  )}
                  {canBringToLife && (
                    <button type="button" className="button-ghost small" onClick={() => void bringToLife()} title="Their expressions as they speak, and a living portrait in place of the still face: made once, kept for every night. No tokens: it counts toward this month's pictures, and takes a few minutes">
                      {/* #1099: what it costs and how long, before it starts. */}
                      ✨ Bring them to life · no tokens, a few minutes
                    </button>
                  )}
                  {drawAhead.view?.offered && (
                    <button
                      type="button"
                      className="button-ghost small"
                      aria-pressed={drawAhead.view.on}
                      onClick={() => void toggleDrawAhead()}
                      title={
                        drawAhead.view.on
                          ? "Each moment is drawn as soon as it's written. Tap to stop: moments wait for \"Picture this?\" again"
                          : `Each moment drawn as soon as it's written, so it's on the stage when its line plays: up to ${drawAhead.view.pictures} more pictures a chapter, without agreeing on each first (Redraw stays)`
                      }
                    >
                      {drawAhead.view.on ? "⚡ Drawing ahead ✓" : `⚡ Draw ahead${drawAhead.view.price > 0 ? ` · ${tokensWord(drawAhead.view.price)} a chapter` : drawAhead.view.included ? " · included" : ""}`}
                    </button>
                  )}
                </div>
              </div>
            )}
            <button type="button" className="secondary small" onClick={onExit}>
              Exit
            </button>
          </div>
        </header>

        <div className="ad-theater-bottom">
          {/* Like a video player's controls (David, 2026-10-25): bottom right, over the stage. */}
          <div className="ad-player" role="group" aria-label="Playback">
            <button type="button" className="theater-icon" onClick={replay.restart} aria-label="From the top" title="From the top">
              ⏮
            </button>
            <button type="button" className="theater-icon ad-player-main" onClick={() => (replay.playing && autoplay && onAutoplay?.(false), replay.toggle())} aria-label={replay.playing ? "Pause" : "Play"} title={replay.playing ? "Pause" : "Play"}>
              {replay.playing ? "⏸" : "▶"}
            </button>
            <button type="button" className="theater-icon" onClick={replay.skip} aria-label="Catch up" title="Catch up">
              ⏭
            </button>
            <TheaterListen lines={scene.lines} shown={shown.length} playing={replay.playing} a={a.id} b={b.id} nightId={live ? null : feedbackRef} onHold={setListenHold} onListening={setListening} />
            <PlaceSound venue={stage.venue} on={listening} playing={replay.playing} />
          </div>
          {live ? (
            <form className="ad-theater-bar" onSubmit={next}>
              {whispers}
              <div className="ad-theater-steer">
                <input
                  aria-label={whisperName ? `Whisper to ${whisperName}` : "Steer it (optional)"}
                  value={direction}
                  maxLength={whisperTo ? 200 : 300}
                  onChange={(e) => setDirection(e.target.value)}
                  placeholder={whisperName ? `A secret for ${whisperName} alone…` : "Steer it (optional)…"}
                  disabled={busy}
                />
                {/* Autoplay is always writing ahead, so a steer goes as soon as it's typed. */}
                {/* #1017 (the 2026-10-30 prod loop: "pressing Enter in the steer box did nothing"): a typed steer goes while the
                    last lines still play, as with autoplay; a browser won't submit a form whose button is disabled. */}
                <button type="submit" className="primary" disabled={busy || (Boolean(whisperTo) && !direction.trim())} title={caughtUp ? undefined : "Skips to the end of what's playing and carries on"}>
                  {busy
                    ? "Writing…"
                    : whisperTo
                      ? "Whisper"
                      : // #1148: the button stays Next; a typed steer rides with it (it skips to the end of what's playing).
                        !caughtUp && direction.trim()
                        ? "Next · with steer"
                        : // The Next that opens a chapter pays for it (lib/adult/settings.ts chapter_tokens).
                          // #1005: after that, Next says it's already paid for, so no step looks free or unexplained.
                          // A subscriber's chapters are included (#1005, David 2026-10-30): every Next says so.
                          `Next${chapterTokens ? (scene.lines.length ? " · included" : ` · ${tokensWord(chapterTokens)}`) : chapterIncluded ? " · included" : ""}`}
                </button>
              </div>
              <div className="ad-theater-options">
                {onSteerMode && (
                  <span className="ad-steer-mode" role="radiogroup" aria-label="How strongly">
                    <label title="Worked toward at the scene's own pace">
                      <input type="radio" name="theater-steer-mode" checked={!whisperTo && steerMode === "nudge"} onChange={() => (onWhisperTo?.(null), onSteerMode("nudge"))} /> Nudge
                    </label>
                    <label title="Done now: it can skip ahead">
                      <input type="radio" name="theater-steer-mode" checked={!whisperTo && steerMode === "direct"} onChange={() => (onWhisperTo?.(null), onSteerMode("direct"))} /> Direct
                    </label>
                    {onWhisperTo &&
                      (["a", "b"] as const).map((who) => (
                        <label key={who} title={`A secret for ${firstName(who === "a" ? a : b)} alone: ${firstName(who === "a" ? b : a)} won't know it`}>
                          <input type="radio" name="theater-steer-mode" checked={whisperTo === who} onChange={() => onWhisperTo(who)} /> 🤫{" "}
                          <CharacterName character={who === "a" ? a : b} label={firstName(who === "a" ? a : b)} link={false} size={18} />
                        </label>
                      ))}
                  </span>
                )}
                {onAutoplay && (
                  <label className="ad-steer-mode" title="It carries on by itself, no Next needed, until the chapter ends">
                    <input type="checkbox" checked={autoplay} onChange={(e) => onAutoplay(e.target.checked)} /> Autoplay
                  </label>
                )}
                {onSuggest && suggestions.length > 0 && (
                  <span className="ad-suggestions" role="group" aria-label="Suggested next moves">
                    {suggestions.map((sg) => (
                      <button
                        key={sg.heat}
                        type="button"
                        className={`ad-suggestion is-${sg.heat}`}
                        disabled={busy}
                        // #1155: Flirt and Spicy put their words in the steer box, to send as they are or change first;
                        // Surprise me stays a surprise and goes at once.
                        onClick={() => (sg.heat === "mild" ? void onSuggest(sg.text) : (setDirection(sg.text), onWhisperTo?.(null), onSteerMode?.("nudge")))}
                        title={sg.heat === "mild" ? "A surprise: something they didn't see coming (sent at once)" : `Puts it in the steer box: "${sg.text}"`}
                        aria-label={sg.heat === "mild" ? "Surprise me: send a surprise turn" : `${HEAT_WORD[sg.heat]}: put "${sg.text}" in the steer box`}
                      >
                        <span className="ad-heat">{HEAT_WORD[sg.heat]}</span>
                      </button>
                    ))}
                  </span>
                )}
              </div>
              {(videoNote || note || presenceNote) && (
                <p className="ad-theater-note" role="status">
                  {videoNote || note || presenceNote}
                </p>
              )}
              {crisis}
            </form>
          ) : (
            replay.done && (
              <div className="theater-verdict">
                <p className="muted">
                  That&apos;s the night.{" "}
                  <button type="button" className="linklike" onClick={replay.restart}>
                    Watch again
                  </button>
                </p>
              </div>
            )
          )}
        </div>
        {pickerOpened && onSetScene && (
          <SetSceneModal
            open={Boolean(picking)}
            openAt={picking || "where"}
            scenes={scenes}
            busy={busy}
            current={scene.set || scene.place}
            locked={waiting && scene.planned ? `${firstName(a)} × ${firstName(b)} decided on ${scene.planned.place} by text, so the night starts there. Once they're there you can take them somewhere else.` : null}
            names={{ a: firstName(a), b: firstName(b) }}
            roleplay={scene.roleplay ?? null}
            myRoleplays={myRoleplays}
            createHref={`/after-dark/studio/${a.id}?tab=create`}
            onGo={onSetScene}
            onScenario={onScenario}
            onClose={() => setPicking(false)}
          />
        )}
      </div>
    </div>
  );
}
