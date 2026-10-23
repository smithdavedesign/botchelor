"use client";

import { useEffect, useRef, useState } from "react";
import type { ShortShot } from "@/lib/adult/shorts";

/**
 * A Short's video of the night (lib/adult/shorts.ts): its shots one after another, each with its line as a caption. A
 * shot made silent (on Replicate) has its line said by a voice beside it, which starts and pauses with the shot; the next
 * shot waits for a line that runs longer than its own. The files come from the Short's own media route.
 */
export default function ShortVideo({ shots }: { shots: ShortShot[] }) {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const voice = useRef<HTMLAudioElement>(null);
  const shot = shots[Math.min(i, shots.length - 1)];

  // A new shot plays on from the last one while it's playing.
  useEffect(() => {
    const v = video.current;
    if (!v || !started) return;
    v.currentTime = 0;
    if (voice.current) voice.current.currentTime = 0;
    if (playing) {
      void v.play().catch(() => setPlaying(false));
      void voice.current?.play().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  function next() {
    const go = () => (i + 1 < shots.length ? setI(i + 1) : setPlaying(false));
    const a = voice.current;
    if (a && !a.paused && !a.ended) {
      a.onended = () => {
        a.onended = null;
        go();
      };
      return;
    }
    go();
  }
  function play() {
    setStarted(true);
    setPlaying(true);
    void video.current?.play().catch(() => setPlaying(false));
    void voice.current?.play().catch(() => {});
  }
  function pause() {
    setPlaying(false);
    video.current?.pause();
    voice.current?.pause();
  }
  function restart() {
    pause();
    if (i === 0 && video.current) video.current.currentTime = 0;
    setI(0);
  }
  if (!shot) return null;
  return (
    <figure className="after-dark-reel">
      <div className="ad-reel-stage">
        <video
          ref={video}
          key={shot.video}
          className="on"
          src={shot.video}
          poster={shot.poster ?? undefined}
          playsInline
          preload="auto"
          muted={Boolean(shot.audio)}
          autoPlay={started && playing}
          onEnded={next}
        />
        {shot.audio && <audio ref={voice} key={shot.audio} src={shot.audio} preload="auto" />}
        {started && shot.text && <p className="ad-reel-caption">“{shot.text}”</p>}
        <div className="ad-reel-controls">
          {playing ? (
            <button type="button" className="theater-icon" onClick={pause} aria-label="Pause" title="Pause">
              ⏸
            </button>
          ) : (
            <button type="button" className="theater-icon" onClick={play} aria-label="Play" title="Play">
              ▶
            </button>
          )}
          <button type="button" className="theater-icon" onClick={restart} aria-label="From the start" title="From the start">
            ⏮
          </button>
          <span className="ad-reel-count">
            {Math.min(i, shots.length - 1) + 1} / {shots.length}
          </span>
        </div>
      </div>
    </figure>
  );
}
