"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import Scene from "@/app/Scene";
import ChatThread from "@/app/ChatThread";
import { useReplay } from "@/app/useReplay";
import { AUTOPLAY_THEATER_AHEAD } from "@/lib/adult/autoplay";
import type { PublicBeat } from "@/lib/adult/beats";
import type { Suggestion } from "@/lib/adult/director";
import type { SceneLine } from "@/lib/adult/scenes";
import { STAGES } from "@/lib/adult/stages";
import type { Turn } from "@/lib/conversation";
import type { CharacterRef } from "@/lib/game";
import { PLACE_LABEL_MAX, venueName, type PlaceId } from "@/lib/venues";
import { useSteadySet } from "./useSteadySet";
import { TheaterListen } from "./Listen";
import CaptureMenu from "./CaptureMenu";
import SceneBackdrop from "./SceneBackdrop";
import { useSceneMedia } from "./useSceneMedia";
import VideoChoice from "./VideoChoice";
import type { NightChapter } from "@/lib/adult/nights";
import type { ReelScope } from "@/lib/adult/reels";
import CharacterName from "@/app/CharacterName";
import WriterPicker from "../../WriterPicker";
import type { WriterOptions } from "@/lib/adult/writer";
import { libraryVenueFor, type CatalogScene } from "@/lib/adult/scene-catalog";
import SetSceneModal, { preloadScenes, type RoleplayPick } from "./SetSceneModal";
import { roleplayById } from "@/lib/adult/roleplays";

/** A saved chapter the 📖 menu can play again (lib/adult/scenes.ts AdultNight, trimmed). */
export type ChapterEntry = { id: string; chapter: number | null; lines: number; created_at: string; place: string | null };

/** A scene line as a date turn: the leading *action* apart from what they say. */
export function lineToTurn(l: SceneLine): Turn {
  const m = l.text.match(/^\*([^*]+)\*\s*([\s\S]*)$/);
  return { side: l.who, act: 0, dialogue: (m ? m[2] : l.text).trim() || "…", action: m ? m[1].trim() : "", emotion: "", interest: 0 };
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
 * The label over the stage: how far it had gone at the line on screen (each line keeps its stage), so a replay climbs
 * with the night instead of showing its end from the first hello. A line from before lines kept one shows nothing until
 * playback catches up with the latest, and a new chapter with no lines yet says which chapter it is.
 */
export function stageLabel(scene: { lines: SceneLine[]; stage: number; chapter?: number }, shown: number, caughtUp: boolean): string | null {
  if (!scene.lines.length) return scene.chapter && scene.chapter > 1 ? `Chapter ${scene.chapter}` : (STAGES[0] ?? null);
  const at = scene.lines[Math.max(0, shown - 1)]?.stage;
  if (typeof at === "number") return STAGES[at] ?? null;
  return caughtUp ? (STAGES[scene.stage] ?? null) : null;
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
  steerMode = "nudge",
  onSteerMode,
  autoplay = false,
  onAutoplay,
  onSetScene,
  onMakeVideo,
  onPlanVideo,
  writer = null,
  videoChapters = [],
  videoTokens = 15,
  videoNote = null,
  mediaPaused = null,
  feedbackRef = null,
  suggestions = [],
  onSuggest,
  beats = [],
  onBeat,
  onPictureNow,
  onExit,
  crisis = null,
  whisperTo = null,
  onWhisperTo,
  whispers = null,
  steps = null,
  chapters = [],
  onReplayChapter,
  scenes = [],
  onScenario,
}: {
  scene: { lines: SceneLine[]; place: string | null; stage: number; dateVenue: string | null; set?: string | null; chapter?: number; roleplay?: RoleplayPick };
  characters: [CharacterRef, CharacterRef];
  busy?: boolean;
  note?: string | null;
  /** The crisis notice (app/CrisisNotice.tsx), when the viewer's own steer tripped lib/crisis.ts: shown over the stage. */
  crisis?: ReactNode;
  /** Writes the next lines; without it, this is a saved night's playback. */
  onWrite?: (direction: string) => Promise<boolean | void>;
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
  onBeat?: (id: string, answer: "now" | "later", guide?: { custom?: string }) => Promise<void>;
  onPictureNow?: (line: number, guide?: { custom?: string }) => Promise<void>;
  onExit: () => void;
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
  onScenario?: (id: string) => Promise<void>;
}) {
  const live = Boolean(onWrite);
  const turns = useMemo(() => scene.lines.map(lineToTurn), [scene.lines]);
  // Live: playback waits at the newest line and carries on as the next ones are written. A replay of a night already
  // watched opens at the end (David, 2026-10-24: revisiting shouldn't make you sit through it again) — ▶ or From the top
  // replays it.
  const [startAt] = useState(() => (live ? Math.max(0, scene.lines.length - 6) : scene.lines.length));
  const [listenHold, setListenHold] = useState(false);
  // A moment worth a picture, reached: playback waits for the viewer's answer.
  const [beatHold, setBeatHold] = useState(false);
  const [answered, setAnswered] = useState<ReadonlySet<string>>(() => new Set());
  // The owner's own words for the next scene picture (David, 2026-10-24: "more specifics otherwise it fails the scene").
  const [guide, setGuide] = useState("");
  // Hitting 📸 opens a panel to agree on what the picture shows before it's drawn (David, 2026-10-24); its line.
  const [picturing, setPicturing] = useState<{ line: number } | null>(null);
  // A replay doesn't auto-play on open; the running scene still catches up and carries on.
  const replay = useReplay(turns, live, { live, startAt, hold: listenHold || beatHold });
  const [convo, setConvo] = useState(false);
  // Rewind, Redo and Start over fold into "⋯".
  const [tools, setTools] = useState(false);
  const [direction, setDirection] = useState("");
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
  const caughtUp = shown.length >= turns.length;
  const left = turns.length - shown.length;
  // Autoplay: the next lines are on their way before the stage runs out (paused playback stops it writing further ahead).
  useEffect(() => {
    if (live && autoplay && !busy && left <= AUTOPLAY_THEATER_AHEAD) void onWrite?.("");
  }, [live, autoplay, busy, left, onWrite]);
  const offer = live && onBeat ? (beats.find((x) => x.status === "offered" && !answered.has(x.id) && x.line < shown.length) ?? null) : null;
  useEffect(() => setBeatHold(Boolean(offer)), [offer]);
  async function answer(id: string, a: "now" | "later") {
    setAnswered((s) => new Set([...s, id]));
    await onBeat?.(id, a, a === "now" && guide.trim() ? { custom: guide.trim() } : undefined);
    setGuide("");
  }
  const latestAction = shown.length ? shown[shown.length - 1].action : "";
  const label = stageLabel(scene, shown.length, caughtUp);
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
    if ((await onWrite?.(direction.trim())) !== false) setDirection("");
  }

  return (
    <div
      className="theater theater-clean theater-after-dark"
      role="dialog"
      aria-label={`${a.name} and ${b.name}, after dark`}
    >
      <div className={`theater-stage${convo ? " with-convo" : ""}`}>
        <div className="theater-scene-area">
          {live && <SceneBackdrop backdrop={sceneMedia.backdrop} />}
          <Scene
            characters={characters}
            venue={stage.venue}
            setUrl={stage.setUrl}
            lineA={lastOf(shown, "a")}
            lineB={lastOf(shown, "b")}
            actLabel={label}
            placeholder={scene.lines.length ? "…" : "Press Next to begin."}
          />
          {latestAction && <p className="ad-theater-action">{latestAction}</p>}
          {offer && (
            <div className="ad-beat-offer" role="dialog" aria-label="Picture this moment?">
              <p>
                <strong>📸 {offer.label}</strong>
                <span className="muted small"> Picture this moment? It&apos;s drawn from the last few lines and lands in their gallery.</span>
              </p>
              {/* The owner can say exactly what the picture should show, so it does the exact scene (lib/adult/beats.ts). */}
              <input className="ad-beat-guide" type="text" value={guide} maxLength={400} placeholder="Add exactly what it should show (optional) — this leads the picture" disabled={Boolean(mediaPaused)} onChange={(e) => setGuide(e.target.value)} />
              <div className="ad-beat-actions">
                <button type="button" className="primary small" onClick={() => void answer(offer.id, "now")}>
                  Picture it
                </button>
                <button type="button" className="button-ghost small" onClick={() => void answer(offer.id, "later")} title="Carry on. Press 📸 when you want it; if you never do, it's drawn when the chapter ends.">
                  Not now
                </button>
              </div>
            </div>
          )}
          {picturing && onPictureNow && (
            // Agree on what the picture shows before it's drawn (David, 2026-10-24): the moment, and anything to add.
            <div className="ad-beat-offer" role="dialog" aria-label="Create a picture of this moment">
              <p>
                <strong>📸 Picture this moment</strong>
                <span className="muted small"> It draws the two of them from here: “{(scene.lines[picturing.line]?.text ?? "the scene so far").slice(0, 140)}”. Add anything it should show, then create it.</span>
              </p>
              <input className="ad-beat-guide" type="text" value={guide} maxLength={400} placeholder="Add exactly what it should show (optional) — this leads the picture" disabled={Boolean(mediaPaused)} onChange={(e) => setGuide(e.target.value)} />
              <div className="ad-beat-actions">
                <button
                  type="button"
                  className="primary small"
                  disabled={Boolean(mediaPaused)}
                  onClick={() => {
                    const line = picturing.line;
                    const g = guide.trim() ? { custom: guide.trim() } : undefined;
                    setPicturing(null);
                    setGuide("");
                    void onPictureNow(line, g);
                  }}
                >
                  Create picture
                </button>
                <button type="button" className="button-ghost small" onClick={() => { setPicturing(null); setGuide(""); }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="theater-convo">
          <ChatThread characters={characters} turns={shown} typing={busy ? null : replay.typing} tone="dark" follow empty="The scene appears here, line by line." feedback={feedback} />
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
            {live && scene.roleplay && roleplayById(scene.roleplay.id) && (
              <button type="button" className="chip ad-roleplay-chip" title="This chapter's roleplay: change or end it" onClick={() => (setPicking("who"), setPickerOpened(true))}>
                {roleplayById(scene.roleplay.id)!.icon} {roleplayById(scene.roleplay.id)!.title}
              </button>
            )}
          </div>
          <div className="theater-tools">
            {live && onSetScene && (
              <button type="button" className="secondary small ad-set-scene" onClick={() => (setPicking("where"), setPickerOpened(true))} disabled={busy} title="Take them anywhere (1 token), and pick who they are this chapter">
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
              📜
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
            <button type="button" className="theater-icon ad-player-main" onClick={replay.toggle} aria-label={replay.playing ? "Pause" : "Play"} title={replay.playing ? "Pause" : "Play"}>
              {replay.playing ? "⏸" : "▶"}
            </button>
            <button type="button" className="theater-icon" onClick={replay.skip} aria-label="Catch up" title="Catch up">
              ⏭
            </button>
            <TheaterListen lines={scene.lines} shown={shown.length} playing={replay.playing} a={a.id} b={b.id} nightId={live ? null : feedbackRef} onHold={setListenHold} />
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
                <button type="submit" className="primary" disabled={busy || (Boolean(whisperTo) && !direction.trim()) || (!caughtUp && !(autoplay && direction.trim()))}>
                  {busy ? "Writing…" : whisperTo ? "Whisper" : caughtUp || (autoplay && direction.trim()) ? "Next" : "Playing…"}
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
                        onClick={() => void onSuggest(sg.text)}
                        title={sg.heat === "mild" ? "A surprise: something they didn't see coming" : `Send it as a nudge: ${sg.text}`}
                      >
                        <span className="ad-heat">{HEAT_WORD[sg.heat]}</span>
                      </button>
                    ))}
                  </span>
                )}
              </div>
              {(videoNote || note) && (
                <p className="ad-theater-note" role="status">
                  {videoNote || note}
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
            names={{ a: firstName(a), b: firstName(b) }}
            roleplay={scene.roleplay ?? null}
            onGo={onSetScene}
            onScenario={onScenario}
            onClose={() => setPicking(false)}
          />
        )}
      </div>
    </div>
  );
}
