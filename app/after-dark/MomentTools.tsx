"use client";

import { createContext, useContext, useState } from "react";
import { requestJson } from "@/app/request";
import { NEXT_WORDS_MAX } from "@/lib/adult/clip-chains";
import type { Media } from "@/lib/adult/media";
import type { Reel } from "@/lib/adult/reels";

const mediaUrl = (id: string) => `/api/admin/after-dark/media/${encodeURIComponent(id)}`;
/** A time as the buttons say it: "4.2 s". */
const secs = (t: number) => `${(Math.round(t * 10) / 10).toFixed(1)} s`;

type Done = { text: string; media?: Media; error?: boolean };

/**
 * Keep going from a moment of a shot (lib/adult/clips.ts): its frame cut and checked first (the moments route, the one
 * ffmpeg runs in), then a new clip from it, with the owner's own words for what happens next when they gave some (asked
 * about first, so words it can't use are refused before a frame is cut). Resolves to the clips route's answer, or null
 * when nothing reached the server.
 */
export async function keepGoingFromMoment(reelId: string, mediaId: string, at: number | "end", mode: "seamless" | "fresh" = "seamless", prompt?: string) {
  const words = prompt?.trim();
  if (words) {
    const ready = await requestJson("/api/admin/after-dark/clips", { continue: reelId, media_id: mediaId, prompt: words, check: true }).catch(() => null);
    if (!ready?.ok) return ready;
  }
  const cut = await requestJson("/api/admin/after-dark/moments", { action: "frame", media_id: mediaId, at }).catch(() => null);
  if (!cut?.ok) return cut;
  const frame = cut.data.frame as { id: string };
  return requestJson("/api/admin/after-dark/clips", { continue: reelId, media_id: mediaId, frame_id: frame.id, mode, ...(words ? { prompt: words } : {}) }).catch(() => null);
}

/**
 * One "What happens next" box for a whole clip chain (Reels.tsx ClipChain, 2026-11-10): its shots' "Keep going from
 * here" read the chain's own box instead of showing a second one. Without it (a night's video) the moments have their own.
 */
export const SharedNextWords = createContext<{ value: string; set: (v: string) => void } | null>(null);

/**
 * "What happens next" (David, 2026-11-09): the owner's own words for the next link kept going, a clip's or a Studio
 * animation's. Optional; the server holds them to everything a motion is held to, and says why when it can't use them.
 */
export function NextWords({ value, onChange, disabled = false, rows }: { value: string; onChange: (v: string) => void; disabled?: boolean; rows?: number }) {
  // In a narrow card (a Studio animation's, AnimationChain.tsx) the words wrap in a box like Animate's guide.
  if (rows)
    return (
      <textarea
        className="ad-studio-custom ad-next-words"
        rows={rows}
        value={value}
        maxLength={NEXT_WORDS_MAX}
        placeholder="What happens next? Optional, in your own words"
        aria-label="What happens next (optional)"
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  return (
    <input
      type="text"
      className="ad-next-words"
      value={value}
      maxLength={NEXT_WORDS_MAX}
      placeholder="What happens next? Optional, in your own words"
      aria-label="What happens next (optional)"
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/**
 * A clip's moments (lib/adult/moments.ts; David, 2026-10-26: "save a image or offering a boomerang for a clip … continue
 * where it left off"): 📸 the frame on screen kept as a picture, ↔ a boomerang and ∞ a loop of what its trim keeps, and,
 * for a shot of one of their videos, ▶▶ keep going from the second it's paused on (lib/adult/clips.ts), straight on from
 * that frame or from a fresh picture of their faces, with what happens next in their own words if they like. The
 * player's own time is read when a button is pressed.
 */
export default function MomentTools({
  mediaId,
  now,
  pause,
  onMedia,
  keepGoing,
}: {
  mediaId: string;
  now: () => number;
  pause?: () => void;
  onMedia?: (m: Media) => void;
  /** `price`: the clip's price in words (Reels.tsx useClipPrice: "included", "free" or the tokens). */
  keepGoing?: { reelId: string; price: string | null; onReel: (r: Reel) => void };
}) {
  const [busy, setBusy] = useState<"save" | "boomerang" | "loop" | "keep" | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [mode, setMode] = useState<"seamless" | "fresh">("seamless");
  const [own, setOwn] = useState("");
  const shared = useContext(SharedNextWords);
  const words = shared ? shared.value : own;
  const setWords = shared ? shared.set : setOwn;

  async function moment(action: "save" | "boomerang" | "loop") {
    pause?.();
    const at = Math.round(now() * 100) / 100;
    setBusy(action);
    setDone(null);
    const res = await requestJson("/api/admin/after-dark/moments", { action, media_id: mediaId, ...(action === "save" ? { at } : {}) }).catch(() => null);
    setBusy(null);
    if (!res) return setDone({ text: "That didn't reach the server. Check your connection and try again.", error: true });
    if (!res.ok) return setDone({ text: res.message, error: true });
    const media = res.data.media as Media;
    onMedia?.(media);
    setDone({ text: action === "save" ? `Saved the moment at ${secs(at)} to the gallery.` : `${action === "boomerang" ? "Boomerang" : "Loop"} made: it's in the gallery.`, media });
  }

  async function keep() {
    if (!keepGoing) return;
    pause?.();
    const at = Math.round(now() * 100) / 100;
    setBusy("keep");
    setDone(null);
    const res = await keepGoingFromMoment(keepGoing.reelId, mediaId, at, mode, words);
    setBusy(null);
    if (!res) return setDone({ text: "That didn't reach the server. Check your connection and try again.", error: true });
    if (!res.ok) return setDone({ text: res.message, error: true });
    setWords("");
    keepGoing.onReel(res.data.reel as Reel);
    setDone({ text: (res.data.note as string | undefined) ?? `The next shot carries on from ${secs(at)}: it's being made, and plays on from this one.` });
  }

  const price = keepGoing?.price;
  const cost = price === null || price === undefined ? "" : ` · ${price}`;
  return (
    <div className="ad-moments" role="group" aria-label="This moment">
      <button type="button" className="button-ghost small" disabled={busy !== null} onClick={() => void moment("save")} title="Keep the frame on screen as a picture in the gallery. Free.">
        {busy === "save" ? "Saving…" : "📸 Save this moment"}
      </button>
      <button type="button" className="button-ghost small" disabled={busy !== null} onClick={() => void moment("boomerang")} title="The clip forward, then backward, on repeat. Free.">
        {busy === "boomerang" ? "Making it…" : "↔ Boomerang"}
      </button>
      <button type="button" className="button-ghost small" disabled={busy !== null} onClick={() => void moment("loop")} title="The end fades into the start, so it loops with no jump. Free.">
        {busy === "loop" ? "Making it…" : "∞ Loop"}
      </button>
      {keepGoing && (
        <span className="ad-moments-keep">
          <button type="button" className="secondary small" disabled={busy !== null} onClick={() => void keep()} title={`A new shot that carries on from the second this one is paused on${shared ? ", with what happens next from the clip's box below" : ""}`}>
            {busy === "keep" ? "Setting it up…" : `▶▶ Keep going from here${cost}`}
          </button>
          <span className="ad-chip-row ad-moments-mode" role="group" aria-label="How it carries on">
            <button type="button" aria-pressed={mode === "seamless"} className={`ad-chip${mode === "seamless" ? " on" : ""}`} disabled={busy !== null} onClick={() => setMode("seamless")} title="Straight on from this exact frame">
              Seamless
            </button>
            <button type="button" aria-pressed={mode === "fresh"} className={`ad-chip${mode === "fresh" ? " on" : ""}`} disabled={busy !== null} onClick={() => setMode("fresh")} title="From a fresh picture of their faces, posed like this frame">
              Fresh faces
            </button>
          </span>
          {!shared && <NextWords value={words} onChange={setWords} disabled={busy !== null} />}
        </span>
      )}
      {done && (
        <p className={`small ad-moments-note${done.error ? " error" : ""}`} role="status">
          {done.media &&
            (done.media.kind === "video" ? (
              <video className="ad-moments-thumb" src={mediaUrl(done.media.id)} muted loop autoPlay playsInline aria-hidden />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="ad-moments-thumb" src={mediaUrl(done.media.id)} alt="The picture just made of this moment" />
            ))}
          {done.text}
        </p>
      )}
    </div>
  );
}
