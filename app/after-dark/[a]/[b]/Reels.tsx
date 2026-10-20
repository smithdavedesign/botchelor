"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Reel, ReelShot } from "@/lib/adult/reels";

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
            <ReelPlayer reel={r} />
          </li>
        ))}
      </ul>
    </section>
  );
}

const readyShots = (r: Reel): ReelShot[] => (r.status === "making" ? [] : r.shots.filter((s) => s.status === "ready" && s.media_id));

function ReelPlayer({ reel }: { reel: Reel }) {
  const shots = readyShots(reel);
  const done = reel.shots.filter((s) => s.status !== "queued").length;
  if (reel.status === "making") {
    return (
      <p className="muted small" role="status">
        🎬 Making the video: {done} of {reel.shots.length} shots done. It takes a few minutes; you can leave and come back.
      </p>
    );
  }
  if (!shots.length) return <p className="muted small">That video didn&apos;t come through, and its tokens are back.</p>;
  return (
    <>
      <SeamlessPlayer shots={shots} />
      {reel.shots.length > shots.length && <p className="muted small">{reel.shots.length - shots.length} shot(s) discarded by the check.</p>}
    </>
  );
}

/**
 * Plays shots back to back with no gap: every shot is fetched first (a progress count until they're all in), then two
 * stacked <video>s take turns: while one plays, the next is already loaded underneath, and they swap on `ended`.
 */
function SeamlessPlayer({ shots }: { shots: ReelShot[] }) {
  const key = shots.map((s) => s.media_id).join(",");
  const [urls, setUrls] = useState<string[] | null>(null);
  const [loaded, setLoaded] = useState(0);
  const [failed, setFailed] = useState(false);
  const [started, setStarted] = useState(false);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [theater, setTheater] = useState(false);
  // Which of the two players shows shot i: they alternate.
  const players = [useRef<HTMLVideoElement>(null), useRef<HTMLVideoElement>(null)];
  const stage = useRef<HTMLDivElement>(null);

  // Preload: every shot as a blob in memory, so no cut waits on the network.
  useEffect(() => {
    let cancelled = false;
    const made: string[] = [];
    setUrls(null);
    setLoaded(0);
    setFailed(false);
    setStarted(false);
    setI(0);
    (async () => {
      try {
        const out = await Promise.all(
          shots.map(async (s) => {
            const res = await fetch(mediaUrl(s.media_id!));
            if (!res.ok) throw new Error(String(res.status));
            const url = URL.createObjectURL(await res.blob());
            made.push(url);
            if (!cancelled) setLoaded((n) => n + 1);
            return url;
          }),
        );
        if (!cancelled) setUrls(out);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
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
      void cur.play().catch(() => setPlaying(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urls, i, started]);

  const ended = useCallback(() => {
    if (!urls) return;
    if (i + 1 < urls.length) setI(i + 1);
    else setPlaying(false);
  }, [i, urls]);

  function play() {
    if (!urls) return;
    if (!started) setStarted(true);
    const cur = players[i % 2].current;
    void cur?.play().catch(() => setPlaying(false));
  }
  function pause() {
    players[i % 2].current?.pause();
  }
  function restart() {
    players.forEach((p) => p.current?.pause());
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
            onPlay={() => n === i % 2 && setPlaying(true)}
            onPause={(e) => n === i % 2 && !e.currentTarget.ended && setPlaying(false)}
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
