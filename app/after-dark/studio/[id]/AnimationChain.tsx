"use client";

import { useEffect, useRef, useState } from "react";
import { requestJson } from "@/app/request";
import CameraMoves from "../../CameraMoves";
import { NextWords } from "../../MomentTools";
import { trimStep } from "../../trimPlayback";
import type { CameraMoveId } from "@/lib/adult/camera-moves";
import type { StudioState } from "@/lib/adult/studio";
import { DIALOG_MAX } from "@/lib/adult/studio-catalog";
import { canKeepGoing, chainTo, nextStartsFresh, type AnimationLinks } from "@/lib/adult/studio-chains";
import type { Trim } from "@/lib/adult/trim";

const mediaUrl = (id: string) => `/api/admin/after-dark/media/${encodeURIComponent(id)}`;
/** Just under the Studio route's 300 s, like the Studio's own actions. */
const TIMEOUT_MS = 290_000;

/**
 * A Studio animation's chain and ▶▶ Keep going (lib/adult/studio-keep-going.ts; David, 2026-11-09: "continue it with a
 * new prompt … expanding the scene from the existing video"). Keep going asks first whether it can (so a refusal comes
 * at once and costs nothing), cuts the frame it ends on (the moments route, the one ffmpeg runs in) and animates on
 * from it, with what happens next in the owner's own words, what they say and
 * how the camera moves, at Animate's price; straight on from that frame, or with their faces drawn fresh (every third
 * link is). A link kept going from another says so, and the chain up to it plays as one film, full screen.
 */
export default function AnimationChain({
  id,
  characterId,
  links,
  trimOf,
  price,
  disabled = false,
  onState,
}: {
  id: string;
  characterId: string;
  links: AnimationLinks;
  /** Each video's trim, so the film plays what each one keeps (lib/adult/trim.ts). */
  trimOf: (id: string) => Trim | null;
  /** Animate's price for 5 or 10 seconds, in words ("3 tokens", "free"). */
  price: (seconds: 5 | 10) => string;
  disabled?: boolean;
  onState: (s: StudioState) => void;
}) {
  const chain = chainTo(id, links);
  const room = canKeepGoing(id, links);
  const forced = nextStartsFresh(id, links);
  const said = links[id]?.words ?? null;
  const [open, setOpen] = useState(false);
  const [film, setFilm] = useState(false);
  const [words, setWords] = useState("");
  const [dialog, setDialog] = useState("");
  const [camera, setCamera] = useState<CameraMoveId>("steady");
  const [seconds, setSeconds] = useState<5 | 10>(5);
  const [mode, setMode] = useState<"seamless" | "fresh">("seamless");
  const [busy, setBusy] = useState<"check" | "cut" | "send" | null>(null);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const off = disabled || busy !== null;
  const offline = "That didn't reach the server. Check your connection and try again.";

  async function keepGoing() {
    setNote(null);
    const ask = {
      action: "keep_going",
      character_id: characterId,
      video_id: id,
      seconds,
      mode,
      ...(words.trim() ? { prompt: words.trim() } : {}),
      ...(dialog.trim() ? { dialog: dialog.trim() } : {}),
      ...(camera !== "steady" ? { camera } : {}),
    };
    // Asked first, without a frame: a refusal comes at once and costs nothing, not even one of the month's moments.
    setBusy("check");
    const ready = await requestJson("/api/admin/after-dark/studio", ask).catch(() => null);
    if (!ready?.ok) {
      setBusy(null);
      return setNote({ text: ready?.message ?? offline, error: true });
    }
    // Its last frame, cut and checked where ffmpeg runs, then the next link from it.
    setBusy("cut");
    const cut = await requestJson("/api/admin/after-dark/moments", { action: "frame", media_id: id, at: "end" }).catch(() => null);
    if (!cut?.ok) {
      setBusy(null);
      return setNote({ text: cut?.message ?? offline, error: true });
    }
    setBusy("send");
    const frame = cut.data.frame as { id: string };
    const res = await requestJson("/api/admin/after-dark/studio", { ...ask, frame_id: frame.id }, "POST", { timeoutMs: TIMEOUT_MS }).catch(() => null);
    setBusy(null);
    if (!res) return setNote({ text: "That didn't reach the server, or took too long. Check the gallery in a minute, then try again.", error: true });
    if (!res.ok) return setNote({ text: res.message, error: true });
    if (res.data.state) onState(res.data.state as StudioState);
    setOpen(false);
    setWords("");
    setDialog("");
    setNote({ text: typeof res.data.message === "string" ? res.data.message : "Keeping it going: it lands in the gallery in a few minutes." });
  }

  return (
    <div className="ad-anim-chain">
      {chain.length > 1 && (
        <p className="small ad-anim-chain-line">
          <span className="muted">
            🎞 Kept going · shot {chain.length} of {chain.length}
            {said ? ` · “${said}”` : ""}
          </span>{" "}
          <button type="button" className="button-ghost small" onClick={() => setFilm(true)} title="The animation it began with and every link up to this one, as one film">
            ▶ Play all {chain.length}
          </button>
        </p>
      )}
      {room ? (
        <button type="button" className="button-ghost small" aria-expanded={open} disabled={off} onClick={() => setOpen((v) => !v)} title="Carry it on from its last frame, with what happens next in your own words">
          ▶▶ Keep going…
        </button>
      ) : (
        <p className="muted small">Kept going as far as it goes: start a new one to carry on.</p>
      )}
      {open && room && (
        <div className="ad-studio-share ad-anim-keep">
          <NextWords value={words} onChange={setWords} disabled={off} rows={2} />
          <input className="ad-studio-own" type="text" maxLength={DIALOG_MAX} value={dialog} placeholder="Dialog — what they say (optional)" aria-label="Dialog (optional)" disabled={off} onChange={(e) => setDialog(e.target.value)} />
          {/* How the camera moves through it (lib/adult/camera-moves.ts): steady unless picked. */}
          <CameraMoves value={camera} onChange={setCamera} disabled={off} />
          <div className="ad-chip-row" role="group" aria-label="How long">
            {([5, 10] as const).map((sec) => (
              <button key={sec} type="button" className={`ad-chip${seconds === sec ? " on" : ""}`} aria-pressed={seconds === sec} disabled={off} onClick={() => setSeconds(sec)}>
                {sec} s
              </button>
            ))}
          </div>
          <div className="ad-chip-row" role="group" aria-label="How it carries on">
            <button type="button" aria-pressed={mode === "seamless"} className={`ad-chip${mode === "seamless" ? " on" : ""}`} disabled={off} onClick={() => setMode("seamless")} title="Straight on from its last frame">
              Seamless
            </button>
            <button type="button" aria-pressed={mode === "fresh"} className={`ad-chip${mode === "fresh" ? " on" : ""}`} disabled={off} onClick={() => setMode("fresh")} title="From its last frame with their faces drawn fresh">
              Fresh faces
            </button>
          </div>
          {forced && mode === "seamless" && <p className="muted small">This one starts with their faces drawn fresh: every third link does, so they keep looking like themselves.</p>}
          <button type="button" className="primary small" disabled={off} onClick={() => void keepGoing()}>
            {busy === "check" ? "Checking…" : busy === "cut" ? "Cutting its last frame…" : busy === "send" ? "Setting up the next shot…" : `▶▶ Keep going · ${price(seconds)}`}
          </button>
        </div>
      )}
      {note && (
        <p className={`small${note.error ? " error" : " muted"}`} role={note.error ? "alert" : "status"}>
          {note.text}
        </p>
      )}
      {film && <ChainFilm ids={chain} trimOf={trimOf} onClose={() => setFilm(false)} />}
    </div>
  );
}

/**
 * A chain played as one film, full screen (Lightbox.tsx's look): each animation to the end of its trim, then the next,
 * and round again. Two players take turns, the next one loaded while this one plays, so a cut doesn't wait on it (the
 * reel player's way, app/after-dark/[a]/[b]/Reels.tsx).
 */
function ChainFilm({ ids, trimOf, onClose }: { ids: string[]; trimOf: (id: string) => Trim | null; onClose: () => void }) {
  // Which shot is on, and which of the two players has it; the other holds the shot after it.
  const [on, setOn] = useState<{ k: number; slot: 0 | 1 }>({ k: 0, slot: 0 });
  // The same, as the players' events see it at once (state lags a render), so a shot's end moves on only once.
  const onNow = useRef(on);
  const [playing, setPlaying] = useState(false);
  const a = useRef<HTMLVideoElement>(null);
  const b = useRef<HTMLVideoElement>(null);
  const players = [a, b] as const;
  const after = (k: number) => (k + 1) % ids.length;
  const shotIn = (slot: 0 | 1) => (slot === on.slot ? on.k : after(on.k));

  /** On to the next shot (the first again after the last), from the player that just finished. */
  const advance = (slot: 0 | 1) => {
    if (onNow.current.slot !== slot) return;
    players[slot].current?.pause();
    const next = { k: after(onNow.current.k), slot: slot === 0 ? 1 : 0 } as const;
    onNow.current = next;
    setOn(next);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    // Don't scroll the page behind the film while it's open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  // The shot that's on plays from its trim's start; the other waits, loaded and paused, on the one after.
  useEffect(() => {
    const v = players[on.slot].current;
    if (!v) return;
    const start = () => {
      v.currentTime = trimOf(ids[on.k])?.start ?? 0;
      void v.play().catch(() => setPlaying(false));
    };
    if (v.readyState >= 1) start();
    else v.addEventListener("loadedmetadata", start, { once: true });
    return () => v.removeEventListener("loadedmetadata", start);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the shot on changes
  }, [on]);

  /** Over the parts its trim cuts out, and on to the next shot at its trim's end. */
  const step = (slot: 0 | 1) => {
    if (onNow.current.slot !== slot) return;
    const v = players[slot].current;
    if (!v) return;
    const r = trimStep(trimOf(ids[onNow.current.k]), v.currentTime);
    if (r && "seek" in r) v.currentTime = r.seek;
    else if (r) advance(slot);
  };
  const toggle = () => {
    const v = players[onNow.current.slot].current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => setPlaying(false));
    else v.pause();
  };

  return (
    <div className="ad-lightbox ad-chain-film" role="dialog" aria-modal="true" aria-label="The whole film, full screen" onClick={onClose}>
      <button type="button" className="ad-lightbox-close" onClick={onClose} aria-label="Close the film">
        ✕
      </button>
      <div className="ad-chain-film-stage" onClick={(e) => e.stopPropagation()}>
        {([0, 1] as const).map((slot) => (
          <video
            key={slot}
            ref={players[slot]}
            className={`ad-lightbox-media${slot === on.slot ? "" : " ad-chain-film-waiting"}`}
            src={mediaUrl(ids[shotIn(slot)])}
            preload="auto"
            playsInline
            aria-hidden={slot !== on.slot}
            aria-label={slot === on.slot ? `Shot ${on.k + 1} of ${ids.length}` : undefined}
            onTimeUpdate={() => step(slot)}
            onEnded={() => advance(slot)}
            onPlay={() => slot === onNow.current.slot && setPlaying(true)}
            onPause={(e) => slot === onNow.current.slot && !e.currentTarget.ended && setPlaying(false)}
            onClick={toggle}
          />
        ))}
        <p className="ad-chain-film-bar small">
          Shot {on.k + 1} of {ids.length}{" "}
          <button type="button" className="button-ghost small" onClick={toggle}>
            {playing ? "⏸ Pause" : "▶ Play"}
          </button>
        </p>
      </div>
    </div>
  );
}
