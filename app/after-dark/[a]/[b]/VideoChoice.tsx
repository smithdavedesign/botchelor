"use client";

import { useState } from "react";
import type { NightChapter } from "@/lib/adult/nights";
import type { ReelScope } from "@/lib/adult/reels";

/** A video needs at least this many lines (lib/adult/reels.ts makeReel). */
const MIN_LINES = 6;

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * The video of the night's control (lib/adult/reels.ts): of this chapter, or of the whole night, every chapter since it
 * began (David, 2026-10-23: a video made on chapter 2 showed nothing of chapter 1). Each choice says what it covers and
 * its price before anything is spent; with more than one chapter, the whole night is picked to begin with. With one
 * chapter there's nothing to choose, so it's one button, as before.
 */
export default function VideoChoice({
  chapters,
  scene,
  tokens,
  busy = false,
  onMake,
}: {
  /** The running night's chapters with lines, oldest first (lib/adult/nights.ts runningNight). */
  chapters: readonly NightChapter[];
  /** The chapter being written now, and its lines so far (none yet, just after a chapter closed). */
  scene: { chapter: number; lines: number };
  tokens: number;
  busy?: boolean;
  onMake: (scope: ReelScope) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<ReelScope>("night");
  const whole = chapters.reduce((t, c) => t + c.lines, 0);
  const price = `${tokens} tokens`;
  const nums = chapters.map((c) => c.chapter).filter((n): n is number => typeof n === "number");
  const span = nums.length ? `chapters ${Math.min(...nums)}–${Math.max(...nums)}` : `${chapters.length} chapters`;
  const thisOne = `chapter ${scene.chapter}`;
  if (chapters.length <= 1) {
    return (
      <button
        type="button"
        className="secondary small"
        onClick={() => void onMake("night")}
        disabled={busy || whole < MIN_LINES}
        title={`A short film of the night, in their own voices (${price})`}
      >
        🎬 Video of the night · {price}
      </button>
    );
  }
  const options: { scope: ReelScope; label: string; covers: string; lines: number }[] = [
    { scope: "night", label: `The whole night (${span})`, covers: `${plural(chapters.length, "chapter")}, ${plural(whole, "line")}`, lines: whole },
    { scope: "chapter", label: "This chapter", covers: `${thisOne}, ${plural(scene.lines, "line")}`, lines: scene.lines },
  ];
  const picked = options.find((o) => o.scope === scope)!;
  return (
    <span className="ad-video-choice">
      <button type="button" className="secondary small" aria-expanded={open} onClick={() => setOpen((v) => !v)} disabled={busy} title="A short film, in their own voices: of this chapter or the whole night">
        🎬 Video · {price}
      </button>
      {open && (
        <span className="ad-video-choice-panel" role="group" aria-label="What the video covers">
          {options.map((o) => (
            <label key={o.scope} className={o.lines < MIN_LINES ? "muted" : undefined}>
              <input type="radio" name="ad-video-scope" value={o.scope} checked={scope === o.scope} disabled={o.lines < MIN_LINES} onChange={() => setScope(o.scope)} />{" "}
              <strong>{o.label}</strong> <span className="small">· {o.covers} · {price}</span>
            </label>
          ))}
          <span className="ad-video-choice-go">
            <button
              type="button"
              className="primary small"
              disabled={busy || picked.lines < MIN_LINES}
              onClick={async () => {
                setOpen(false);
                await onMake(scope);
              }}
            >
              🎬 Make it · {price}
            </button>
            <button type="button" className="button-ghost small" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </span>
        </span>
      )}
    </span>
  );
}
