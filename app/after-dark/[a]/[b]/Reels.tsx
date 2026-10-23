"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Reel, ReelShot } from "@/lib/adult/reels";
import { reelFailureNote } from "@/lib/adult/reel-failure";
import { REEL_STALLED_MS } from "@/lib/adult/reel-timing";

const mediaUrl = (id: string) => `/api/admin/after-dark/media/${id}`;

/**
 * Their videos of the night (lib/adult/reels.ts). A reel still being made is polled until it's done (the poll is what
 * moves it along). David, 2026-10-19:
 *  - "play from the bottom not the top, so it's the correct timeline": the list is newest first, so "Play the whole
 *    night" runs every finished video from the bottom (the oldest) up, each one's shots in order;
 *  - "preload all the videos before starting, otherwise you get a buffer in between": every shot is downloaded first,
 *    and two stacked players swap on each cut, so one shot runs straight into the next;
 *  - "watch the video in theater mode too": a full-screen stage with the line as a caption.
 */
export default function Reels({ reels, onChange }: { reels: Reel[]; onChange: (r: Reel) => void }) {
  const making = reels.filter((r) => r.status === "making").map((r) => r.id).join(",");
  useEffect(() => {
    if (!making) return;
    const timer = setInterval(async () => {
      for (const id of making.split(",")) {
        const res = await fetch(`/api/admin/after-dark/reel?id=${encodeURIComponent(id)}`).then((r) => r.json()).catch(() => null);
        if (res?.reel) onChange(res.reel as Reel);
      }
    }, 15000);
    return () => clearInterval(timer);
  }, [making, onChange]);

  if (!reels.length) return null;
  // The whole night: from the bottom of the list (the oldest video) up.
  const night = [...reels].reverse().flatMap((r) => readyShots(r));
  const finished = reels.filter((r) => readyShots(r).length).length;
  return (
    <section>
      <h2>Their videos</h2>
      {finished > 1 && (
        <div className="after-dark-night-film">
          <h3>
            The whole night <span className="muted small">· {finished} videos, oldest first · {night.length} shots</span>
          </h3>
          <SeamlessPlayer shots={night} />
        </div>
      )}
      <ul className="after-dark-reels">
        {reels.map((r) => (
          <li key={r.id}>
            <ReelPlayer reel={r} onChange={onChange} />
          </li>
        ))}
      </ul>
    </section>
  );
}

const readyShots = (r: Reel): ReelShot[] => (r.status === "making" ? [] : r.shots.filter((s) => s.status === "ready" && s.media_id));

/** Stops a reel still being made (DELETE): the shots in are kept, the rest's tokens come back. */
export async function stopReel(id: string): Promise<Reel | null> {
  const res = await fetch(`/api/admin/after-dark/reel?id=${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => r.json()).catch(() => null);
  return (res?.reel as Reel | undefined) ?? null;
}

function ReelPlayer({ reel, onChange }: { reel: Reel; onChange: (r: Reel) => void }) {
  const shots = readyShots(reel);
  const done = reel.shots.filter((s) => s.status !== "queued").length;
  const [stopping, setStopping] = useState(false);
  const [stopFailed, setStopFailed] = useState(false);
  if (reel.status === "making") {
    const minutes = Math.floor((Date.now() - new Date(reel.created_at).getTime()) / 60_000);
    const stalled = minutes * 60_000 > REEL_STALLED_MS;
    // A shot the safety check couldn't look at yet (Hive busy) waits and is tried again.
    const checkBusy = reel.shots.some((s) => s.status === "queued" && s.retry_at);
    return (
      <div className="muted small" role="status">
        <p>
          🎬 Making the video: {done} of {reel.shots.length} shots done
          {minutes >= 1 ? `, started ${minutes} min ago` : ""}.{" "}
          {stalled
            ? "That's much longer than usual, so it looks stuck. Stop it and its tokens come back for the shots that didn't arrive."
            : checkBusy
              ? "The safety check is busy, so some shots wait and are tried again every 10 minutes."
              : "It takes a few minutes; you can leave and come back."}
        </p>
        <p>
          <button
            type="button"
            className={stalled ? "secondary small" : "button-ghost small"}
            disabled={stopping}
            onClick={async () => {
              setStopping(true);
              const r = await stopReel(reel.id);
              setStopping(false);
              if (r) onChange(r);
              else setStopFailed(true);
            }}
          >
            {stopping ? "Stopping…" : "Stop this video"}
          </button>
          {stopFailed && <span className="error"> That didn&apos;t go through. Try again.</span>}
        </p>
      </div>
    );
  }
  // What a provider said when shots failed (Venice out of credits, say), so a failure says what to do.
  const why = reelFailureNote(reel.shots);
  if (!shots.length) {
    const stopped = reel.shots.some((s) => s.reason === "stopped");
    if (stopped && !why) return <p className="muted small">Stopped before any shot came through. Its tokens are back.</p>;
    return <p className={why ? "error small" : "muted small"}>That video didn&apos;t come through, and its tokens are back.{why && ` ${why}`}</p>;
  }
  const discarded = reel.shots.filter((s) => s.status === "discarded").length;
  const failed = reel.shots.filter((s) => s.status === "failed").length;
  return (
    <>
      <SeamlessPlayer shots={shots} />
      {discarded > 0 && <p className="muted small">{discarded} shot(s) discarded by the check.</p>}
      {failed > 0 && (
        <p className={why ? "error small" : "muted small"}>
          {failed} shot(s) didn&apos;t come through, and their share of the tokens is back.{why && ` ${why}`}
        </p>
      )}
    </>
  );
}

/**
 * Plays shots back to back with no gap: every shot is fetched first (a progress count until they're all in), then two
 * stacked <video>s take turns: while one plays, the next is already loaded underneath, and they swap on `ended`.
 *
 * A shot made on Replicate is silent, its line said beside it (`audio_id`, lib/adult/reels.ts): that voice is
 * preloaded with it, starts with the shot, pauses and resumes with it at the shot's time, and a line longer than its
 * shot finishes on the shot's last frame before the next one starts.
 */
function SeamlessPlayer({ shots }: { shots: ReelShot[] }) {
  const key = shots.map((s) => `${s.media_id}${s.audio_id ? `+${s.audio_id}` : ""}`).join(",");
  const [urls, setUrls] = useState<string[] | null>(null);
  const [loaded, setLoaded] = useState(0);
  const [failed, setFailed] = useState(false);
  const [started, setStarted] = useState(false);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [theater, setTheater] = useState(false);
  // Which of the two players shows shot i: they alternate.
  const players = [useRef<HTMLVideoElement>(null), useRef<HTMLVideoElement>(null)];
  // Each shot's own voice, when it has one (null: the video's own sound, or none).
  const voices = useRef<(HTMLAudioElement | null)[]>([]);
  const stage = useRef<HTMLDivElement>(null);

  // Preload: every shot (and its voice) as a blob in memory, so no cut waits on the network.
  useEffect(() => {
    let cancelled = false;
    const made: string[] = [];
    setUrls(null);
    setLoaded(0);
    setFailed(false);
    setStarted(false);
    setI(0);
    // A file in the bucket redirects to it; read across origins, that needs the bucket's CORS rule. Without it (a
    // network error, not a status), the player plays the link itself instead of a preloaded copy.
    const load = async (id: string) => {
      const res = await fetch(mediaUrl(id)).catch(() => null);
      if (!res) return mediaUrl(id);
      if (!res.ok) throw new Error(String(res.status));
      const url = URL.createObjectURL(await res.blob());
      made.push(url);
      return url;
    };
    (async () => {
      try {
        const out = await Promise.all(
          shots.map(async (s) => {
            const both = await Promise.all([load(s.media_id!), s.audio_id ? load(s.audio_id) : null]);
            if (!cancelled) setLoaded((n) => n + 1);
            return both;
          }),
        );
        if (cancelled) return;
        voices.current = out.map(([, voice]) => {
          if (!voice) return null;
          const a = new Audio(voice);
          a.preload = "auto";
          return a;
        });
        setUrls(out.map(([video]) => video));
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      voices.current.forEach((a) => {
        if (!a) return;
        a.onended = null;
        a.pause();
      });
      voices.current = [];
      made.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Keep the player for shot i on it, and the other one on shot i+1, loaded and paused.
  useEffect(() => {
    if (!urls) return;
    const cur = players[i % 2].current;
    const next = players[(i + 1) % 2].current;
    if (cur && cur.dataset.src !== urls[i]) {
      cur.src = urls[i];
      cur.dataset.src = urls[i];
    }
    if (next && i + 1 < urls.length && next.dataset.src !== urls[i + 1]) {
      next.src = urls[i + 1];
      next.dataset.src = urls[i + 1];
      next.load();
    }
    if (started && cur) {
      cur.currentTime = 0;
      // A shot with its own voice plays that, not whatever sound the file has.
      cur.muted = Boolean(voices.current[i]);
      void cur.play().catch(() => setPlaying(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urls, i, started]);

  /** Shot i's voice, in step with its video: from the video's time, unless the line's already over. */
  function sayWith(video: HTMLVideoElement) {
    const v = voices.current[i];
    if (!v || (v.duration && video.currentTime >= v.duration)) return;
    if (Math.abs(v.currentTime - video.currentTime) > 0.2) v.currentTime = video.currentTime;
    void v.play().catch(() => {});
  }

  const ended = useCallback(() => {
    if (!urls) return;
    const next = () => {
      if (i + 1 < urls.length) setI(i + 1);
      else setPlaying(false);
    };
    // A line longer than its shot finishes first, on the shot's last frame.
    const v = voices.current[i];
    if (v && !v.paused && !v.ended) {
      v.onended = () => {
        v.onended = null;
        next();
      };
      return;
    }
    next();
  }, [i, urls]);

  function play() {
    if (!urls) return;
    if (!started) setStarted(true);
    const cur = players[i % 2].current;
    const v = voices.current[i];
    // Paused while a line finished on the shot's last frame: the line goes on, not the shot from its start.
    if (cur?.ended && v && !v.ended) {
      void v.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
      return;
    }
    if (cur) cur.muted = Boolean(v);
    void cur?.play().catch(() => setPlaying(false));
  }
  function pause() {
    players[i % 2].current?.pause();
    const v = voices.current[i];
    if (v && !v.paused) {
      v.pause();
      setPlaying(false);
    }
  }
  function restart() {
    players.forEach((p) => p.current?.pause());
    voices.current.forEach((v) => {
      if (!v) return;
      v.onended = null;
      v.pause();
      v.currentTime = 0;
    });
    setI(0);
    setStarted(true);
  }

  // Theater: full screen where the browser allows it, and the overlay either way. Esc closes it.
  useEffect(() => {
    if (!theater) return;
    const el = stage.current;
    void el?.requestFullscreen?.().catch(() => {});
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setTheater(false);
    const onFs = () => !document.fullscreenElement && setTheater(false);
    window.addEventListener("keydown", onKey);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onFs);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, [theater]);

  const shot = shots[Math.min(i, shots.length - 1)];
  const ready = Boolean(urls);
  return (
    <figure className="after-dark-reel">
      <div ref={stage} className={`ad-reel-stage${theater ? " ad-reel-theater" : ""}`}>
        {players.map((ref, n) => (
          <video
            key={n}
            ref={ref}
            className={n === i % 2 ? "on" : ""}
            playsInline
            preload="auto"
            onEnded={n === i % 2 ? ended : undefined}
            onPlay={(e) => {
              if (n !== i % 2) return;
              setPlaying(true);
              sayWith(e.currentTarget);
            }}
            onPause={(e) => {
              if (n !== i % 2 || e.currentTarget.ended) return;
              setPlaying(false);
              voices.current[i]?.pause();
            }}
          />
        ))}
        {!ready && (
          <div className="ad-reel-loading" role="status">
            {failed ? "A shot couldn't be loaded. Try again in a moment." : `Loading shots ${loaded} of ${shots.length}…`}
          </div>
        )}
        {ready && started && <p className="ad-reel-caption">“{shot.text}”</p>}
        {theater && (
          <button type="button" className="ad-reel-close" onClick={() => setTheater(false)} aria-label="Close theater">
            ✕
          </button>
        )}
        <div className="ad-reel-controls">
          {playing ? (
            <button type="button" className="theater-icon" onClick={pause} aria-label="Pause" title="Pause">
              ⏸
            </button>
          ) : (
            <button type="button" className="theater-icon" onClick={play} disabled={!ready} aria-label="Play" title={ready ? "Play" : "Loading…"}>
              ▶
            </button>
          )}
          <button type="button" className="theater-icon" onClick={restart} disabled={!ready} aria-label="From the start" title="From the start">
            ⏮
          </button>
          <span className="ad-reel-count">
            {Math.min(i, shots.length - 1) + 1} / {shots.length}
          </span>
          {!theater && (
            <button type="button" className="ad-reel-theater-btn" onClick={() => setTheater(true)} disabled={!ready}>
              🎬 Theater
            </button>
          )}
        </div>
      </div>
    </figure>
  );
}
