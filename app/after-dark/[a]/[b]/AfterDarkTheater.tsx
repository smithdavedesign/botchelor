"use client";

import { useMemo, useState, type FormEvent } from "react";
import Scene from "@/app/Scene";
import ChatThread from "@/app/ChatThread";
import { useReplay } from "@/app/useReplay";
import type { SceneLine } from "@/lib/adult/scenes";
import { STAGES } from "@/lib/adult/stages";
import type { Turn } from "@/lib/conversation";
import type { CharacterRef } from "@/lib/game";
import { PLACE_LABEL_MAX, venueName, type PlaceId } from "@/lib/venues";
import { useSteadySet } from "./useSteadySet";

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
 */
export default function AfterDarkTheater({
  scene,
  characters,
  busy = false,
  note = null,
  onWrite,
  steerMode = "nudge",
  onSteerMode,
  onSetScene,
  onMakeVideo,
  videoTokens = 15,
  videoNote = null,
  onExit,
}: {
  scene: { lines: SceneLine[]; place: string | null; stage: number; dateVenue: string | null; set?: string | null; chapter?: number };
  characters: [CharacterRef, CharacterRef];
  busy?: boolean;
  note?: string | null;
  /** Writes the next lines; without it, this is a saved night's playback. */
  onWrite?: (direction: string) => Promise<void>;
  /** How strongly a steer is taken: worked toward (nudge) or done now (direct). Shared with the page's form. */
  steerMode?: "nudge" | "direct";
  onSteerMode?: (mode: "nudge" | "direct") => void;
  /** Set the scene: take them anywhere (1 token). */
  onSetScene?: (place: string) => Promise<void>;
  /** The full-night video (lib/adult/reels.ts): the whole conversation, in their voices, for `videoTokens`. */
  onMakeVideo?: () => Promise<void>;
  videoTokens?: number;
  videoNote?: string | null;
  onExit: () => void;
}) {
  const live = Boolean(onWrite);
  const turns = useMemo(() => scene.lines.map(lineToTurn), [scene.lines]);
  // Live: playback waits at the newest line and carries on as the next ones are written.
  const [startAt] = useState(() => (live ? Math.max(0, scene.lines.length - 6) : 0));
  const replay = useReplay(turns, true, { live, startAt });
  const [convo, setConvo] = useState(false);
  const [direction, setDirection] = useState("");
  const [moving, setMoving] = useState(false);
  const [where, setWhere] = useState("");
  const shown = replay.shown;
  const [a, b] = characters;
  const caughtUp = shown.length >= turns.length;
  const latestAction = shown.length ? shown[shown.length - 1].action : "";
  const label = stageLabel(scene, shown.length, caughtUp);
  // The set: preloaded, so the last ready one stays up until the next has loaded (never the placeholder in between).
  const stage = useSteadySet(stageFor(scene.set || scene.place, scene.dateVenue));

  async function next(e: FormEvent) {
    e.preventDefault();
    await onWrite?.(direction.trim());
    setDirection("");
  }

  async function go(e: FormEvent) {
    e.preventDefault();
    if (!where.trim()) return;
    await onSetScene?.(where.trim());
    setWhere("");
    setMoving(false);
  }

  return (
    <div className="theater theater-clean theater-after-dark" role="dialog" aria-label={`${a.name} and ${b.name}, after dark`}>
      <div className={`theater-stage${convo ? " with-convo" : ""}`}>
        <div className="theater-scene-area">
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
        </div>
        <div className="theater-convo">
          <ChatThread characters={characters} turns={shown} typing={busy ? null : replay.typing} tone="dark" follow empty="The scene appears here, line by line." />
        </div>

        <header className="theater-hud">
          <div className="theater-id">
            <strong>
              {a.name} <span className="vs">×</span> {b.name}
            </strong>
            <span className="chip">{live ? "🌙 After Dark" : "🌙 Replay"}</span>
            {scene.place && <span className="chip ad-theater-place">{scene.place}</span>}
          </div>
          <div className="theater-tools">
            <button type="button" className="theater-icon" onClick={replay.toggle} aria-label={replay.playing ? "Pause" : "Play"} title={replay.playing ? "Pause" : "Play"}>
              {replay.playing ? "⏸" : "▶"}
            </button>
            <button type="button" className="theater-icon" onClick={replay.restart} aria-label="From the top" title="From the top">
              ↻
            </button>
            <button type="button" className="theater-icon" onClick={replay.skip} aria-label="Catch up" title="Catch up">
              ⏭
            </button>
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
            {onMakeVideo && (
              <button
                type="button"
                className="secondary small"
                onClick={() => void onMakeVideo()}
                disabled={busy || scene.lines.length < 6}
                title={`A short film of the whole night, in their own voices (${videoTokens} tokens)`}
              >
                🎬 Video of the night · {videoTokens}
              </button>
            )}
            <button type="button" className="secondary small" onClick={onExit}>
              Exit
            </button>
          </div>
        </header>

        {live && moving ? (
        <form className="ad-theater-bar" onSubmit={go}>
          <input
            aria-label="Take them anywhere"
            value={where}
            maxLength={60}
            onChange={(e) => setWhere(e.target.value)}
            placeholder="Take them anywhere: a rooftop pool at midnight…"
            disabled={busy}
            autoFocus
          />
          <button type="submit" className="primary" disabled={busy || !where.trim()}>
            {busy ? "Moving…" : "Go · 1 token"}
          </button>
          <button type="button" className="button-ghost" onClick={() => setMoving(false)} disabled={busy}>
            Cancel
          </button>
          {note && (
            <p className="ad-theater-note" role="status">
              {note}
            </p>
          )}
        </form>
        ) : live ? (
        <form className="ad-theater-bar" onSubmit={next}>
          <input
            aria-label="Steer it (optional)"
            value={direction}
            maxLength={300}
            onChange={(e) => setDirection(e.target.value)}
            placeholder="Steer it (optional)…"
            disabled={busy}
          />
          {onSteerMode && (
            <span className="ad-steer-mode" role="radiogroup" aria-label="How strongly">
              <label title="Worked toward at the scene's own pace">
                <input type="radio" name="theater-steer-mode" checked={steerMode === "nudge"} onChange={() => onSteerMode("nudge")} /> Nudge
              </label>
              <label title="Done now: it can skip ahead">
                <input type="radio" name="theater-steer-mode" checked={steerMode === "direct"} onChange={() => onSteerMode("direct")} /> Direct
              </label>
            </span>
          )}
          <button type="submit" className="primary" disabled={busy || !caughtUp}>
            {busy ? "Writing…" : caughtUp ? "Next" : "Playing…"}
          </button>
          {onSetScene && (
            <button type="button" className="button-ghost" onClick={() => setMoving(true)} disabled={busy} title="Take them anywhere (1 token)">
              📍 Set the scene
            </button>
          )}
          {(videoNote || note) && (
            <p className="ad-theater-note" role="status">
              {videoNote || note}
            </p>
          )}
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
    </div>
  );
}
