"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { BLINK_MS, canTalk, FACE_STILLS, LOOK_MS, lookFor, MOUTH_STILL, mouthFor, nextBlinkIn, syntheticLevel, type FaceKit, type FaceStill, type Look, type Mouth } from "@/lib/face-kit-shared";

/** How long before the loop's end it fades back into the portrait (the loop starts from the portrait, so the restart can't show). */
const FADE_S = 0.45;

export type FacePhase = "ready" | "connecting" | "listening" | "thinking" | "speaking" | "paused";

/**
 * A companion's face on a call (lib/face-kit.ts; docs/PRDs/digital-human.md Tier 0): their portrait, the living loop
 * playing over it while they listen, and while they talk the mouth that fits how loud their voice is right now (the
 * player's level(), or made-up syllables when the device's own voice speaks and can't be measured), a blink now and
 * then, and a smile or a gasp when the line calls for one. Every part is a still of the same portrait with one thing
 * changed, stacked and faded in and out, so nothing ever jumps. With no kit (or one that can't talk yet) it's the
 * `fallback`: the round Avatar as before. The loop stays off with reduced motion.
 */
export default function LiveFace({ kit, phase, level, said, name, size, fallback }: { kit: FaceKit | null; phase: FacePhase; level: () => number; said: string | null; name: string; size: number; fallback: ReactNode }) {
  const [mouth, setMouth] = useState<Mouth>("closed");
  const [blink, setBlink] = useState(false);
  const [look, setLook] = useState<Look | null>(null);
  const [fading, setFading] = useState(false);
  const [still, setStill] = useState(true);
  const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());
  const video = useRef<HTMLVideoElement>(null);
  const mouthNow = useRef<Mouth>("closed");
  const talking = phase === "speaking";

  // Still until it's known it can move: the server's markup has no video, and reduced motion keeps the loop off.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    setStill(q.matches);
    const on = () => setStill(q.matches);
    q.addEventListener?.("change", on);
    return () => q.removeEventListener?.("change", on);
  }, []);

  // The mouth follows the voice while they talk: measured when it can be, made up when it can't.
  useEffect(() => {
    if (!talking) {
      mouthNow.current = "closed";
      setMouth("closed");
      return;
    }
    let frame = 0;
    let last = -1;
    const started = performance.now();
    const tick = () => {
      const t = performance.now();
      const heard = level();
      const l = heard >= 0 ? heard : syntheticLevel(t - started);
      const next = mouthFor(l, mouthNow.current, t);
      if (next !== mouthNow.current) {
        mouthNow.current = next;
        setMouth(next);
      }
      last = t;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      void last;
    };
  }, [talking, level]);

  // A blink now and then, while the loop isn't doing the blinking.
  const loopPlaying = Boolean(kit?.loop && !still && !talking && phase !== "thinking" && !broken.has(kit.loop));
  useEffect(() => {
    if (loopPlaying || !kit?.stills.blink) return;
    let open = 0;
    let close = window.setTimeout(function blinkOnce() {
      setBlink(true);
      open = window.setTimeout(() => setBlink(false), BLINK_MS);
      close = window.setTimeout(blinkOnce, nextBlinkIn(Math.random()));
    }, nextBlinkIn(Math.random()));
    return () => {
      window.clearTimeout(close);
      window.clearTimeout(open);
      setBlink(false);
    };
  }, [loopPlaying, kit?.stills.blink]);

  // A line that laughs or gasps shows it for a moment.
  useEffect(() => {
    const l = said ? lookFor(said) : null;
    if (!l) return;
    setLook(l);
    const t = window.setTimeout(() => setLook(null), LOOK_MS);
    return () => window.clearTimeout(t);
  }, [said]);

  // Near its end the loop fades out onto the portrait, restarts from its first frame (the portrait), and fades back in.
  const onTime = () => {
    const v = video.current;
    if (!v || !v.duration || fading) return;
    if (v.duration - v.currentTime <= FADE_S) {
      setFading(true);
      window.setTimeout(() => {
        if (!video.current) return;
        video.current.currentTime = 0;
        void video.current.play().catch(() => {});
        setFading(false);
      }, FADE_S * 1000);
    }
  };

  if (!canTalk(kit) || !kit.stills.portrait || broken.has(kit.stills.portrait)) return <>{fallback}</>;
  // Which still shows on top: a look while it lasts, a blink, else the mouth.
  const top: FaceStill = look && kit.stills[look] ? look : blink && kit.stills.blink ? "blink" : MOUTH_STILL[mouth];
  const shown = kit.stills[top] && !broken.has(kit.stills[top]!) ? top : "portrait";
  const parts = FACE_STILLS.filter((p): p is FaceStill => Boolean(kit.stills[p]) && !broken.has(kit.stills[p]!));
  return (
    <span className={`companion-live-face is-${phase}${talking ? " talking" : ""}`} style={{ width: size, height: size }} role="img" aria-label={`${name}'s face`}>
      {parts.map((p) => (
        // eslint-disable-next-line @next/next/no-img-element -- the kit's own files, served by our route
        <img key={p} src={kit.stills[p]} alt="" className={`companion-live-still${p === shown ? " is-on" : ""}${p === "portrait" ? " is-base" : ""}`} draggable={false} onError={() => setBroken((b) => new Set([...b, kit.stills[p]!]))} />
      ))}
      {loopPlaying && (
        <video
          ref={video}
          className={`companion-live-loop${fading ? " fading" : ""}`}
          src={kit.loop!}
          poster={kit.stills.portrait}
          muted
          playsInline
          autoPlay
          loop={false}
          preload="auto"
          onTimeUpdate={onTime}
          onError={() => setBroken((b) => new Set([...b, kit.loop!]))}
          aria-hidden="true"
        />
      )}
    </span>
  );
}
