"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { BLINK_MS, canTalk, FACE_STILLS, LOOK_MS, lookFor, MOUTH_STILL, mouthFor, nextBlinkIn, syntheticLevel, type FaceKit, type FaceStill, type Look, type Mouth } from "@/lib/face-kit-shared";
import { audioPieces, secondsOfFaceAudio, type LiveFaceSession } from "@/lib/live-face-shared";

/** How long before the loop's end it fades back into the portrait (the loop starts from the portrait, so the restart can't show). */
const FADE_S = 0.45;
/** A live stream that hasn't shown a frame by then is given up, and the kit's face stays. */
const LIVE_START_MS = 8_000;

export type FacePhase = "ready" | "connecting" | "listening" | "thinking" | "speaking" | "paused";

/** What the call can do with a live face once it's streaming: feed it the voice, cut it off, hang it up. */
export type LiveFaceHandle = {
  /** The face is streaming: the voice should go here, not to the call's own player. */
  live: () => boolean;
  /** A piece of the companion's voice, 16 kHz 16-bit mono. */
  sendAudio: (bytes: Uint8Array) => void;
  /** Drops whatever it hasn't said yet (a barge-in). */
  clear: () => void;
  /** Resolves once it has said everything sent (or at once when it isn't live). */
  idle: () => Promise<void>;
  /** Seconds the stream was up this call. */
  seconds: () => number;
  /** Hangs up the stream. */
  stop: () => void;
};

type SimliModule = typeof import("simli-client");

/**
 * A companion's face on a call (lib/face-kit.ts; docs/PRDs/digital-human.md Tier 0): their portrait, the living loop
 * playing over it while they listen, and while they talk the mouth that fits how loud their voice is right now (the
 * player's level(), or made-up syllables when the device's own voice speaks and can't be measured), a blink now and
 * then, and a smile or a gasp when the line calls for one. Every part is a still of the same portrait with one thing
 * changed, stacked and faded in and out, so nothing ever jumps. With no kit (or one that can't talk yet) it's the
 * `fallback`: the round Avatar as before. The loop stays off with reduced motion.
 *
 * With a `session` (lib/live-face, Tier 1) it opens the renderer's stream in the same round frame, over the kit, and
 * the call feeds it the voice through the handle; the kit's face is what shows until the first frame, and again the
 * moment the stream fails. The renderer's own audio element plays the voice then.
 */
const LiveFace = forwardRef<LiveFaceHandle, { kit: FaceKit | null; phase: FacePhase; level: () => number; said: string | null; name: string; size: number; fallback: ReactNode; session?: LiveFaceSession | null; onLive?: (live: boolean) => void }>(
  function LiveFace({ kit, phase, level, said, name, size, fallback, session = null, onLive }, ref) {
    const [mouth, setMouth] = useState<Mouth>("closed");
    const [blink, setBlink] = useState(false);
    const [look, setLook] = useState<Look | null>(null);
    const [fading, setFading] = useState(false);
    const [still, setStill] = useState(true);
    const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());
    const [streaming, setStreaming] = useState(false);
    const video = useRef<HTMLVideoElement>(null);
    const liveVideo = useRef<HTMLVideoElement>(null);
    const liveAudio = useRef<HTMLAudioElement>(null);
    const mouthNow = useRef<Mouth>("closed");
    const talking = phase === "speaking";

    // The renderer's client, and what's owed to it: when its voice ends (it says "silent"; a clock stands in).
    const client = useRef<InstanceType<SimliModule["SimliClient"]> | null>(null);
    const isLive = useRef(false);
    const liveFrom = useRef(0);
    const liveTotal = useRef(0);
    const saidUntil = useRef(0);
    const speaking = useRef(false);
    const idleWaiters = useRef<(() => void)[]>([]);
    const onLiveNow = useRef(onLive);
    onLiveNow.current = onLive;

    const settle = () => {
      const w = idleWaiters.current;
      idleWaiters.current = [];
      w.forEach((ok) => ok());
    };
    const setLive = (on: boolean) => {
      if (isLive.current === on) return;
      isLive.current = on;
      if (on) liveFrom.current = performance.now();
      else {
        if (liveFrom.current) liveTotal.current += (performance.now() - liveFrom.current) / 1000;
        liveFrom.current = 0;
        settle();
      }
      setStreaming(on);
      onLiveNow.current?.(on);
    };
    const hangUp = () => {
      const c = client.current;
      client.current = null;
      setLive(false);
      if (c) void c.stop().catch(() => {});
    };

    useImperativeHandle(
      ref,
      () => ({
        live: () => isLive.current,
        sendAudio: (bytes) => {
          const c = client.current;
          if (!c || !isLive.current || !bytes.length) return;
          for (const piece of audioPieces(bytes)) c.sendAudioData(piece);
          const now = performance.now();
          saidUntil.current = Math.max(saidUntil.current, now) + secondsOfFaceAudio(bytes.length) * 1000;
        },
        clear: () => {
          client.current?.ClearBuffer();
          saidUntil.current = 0;
          speaking.current = false;
          settle();
        },
        idle: () => {
          if (!isLive.current) return Promise.resolve();
          const left = saidUntil.current - performance.now();
          if (left <= 0 && !speaking.current) return Promise.resolve();
          return new Promise<void>((ok) => {
            idleWaiters.current.push(ok);
            // The renderer says "silent" when it's done; the clock is the backstop (a little after the audio's length).
            window.setTimeout(() => {
              if (performance.now() >= saidUntil.current) settle();
            }, Math.max(0, left) + 400);
          });
        },
        seconds: () => Math.round(liveTotal.current + (liveFrom.current ? (performance.now() - liveFrom.current) / 1000 : 0)),
        stop: hangUp,
      }),
      [],
    );

    // Opens the renderer's stream for a session (once per token); hangs it up when the session goes.
    useEffect(() => {
      if (!session) {
        hangUp();
        return;
      }
      let cancelled = false;
      let opened: InstanceType<SimliModule["SimliClient"]> | null = null;
      (async () => {
        const v = liveVideo.current;
        const a = liveAudio.current;
        if (!v || !a) return;
        let mod: SimliModule;
        try {
          mod = await import("simli-client");
        } catch {
          return;
        }
        if (cancelled) return;
        const c = new mod.SimliClient(session.token, v, a, null, mod.LogLevel.ERROR);
        opened = c;
        client.current = c;
        c.on("speaking", () => {
          speaking.current = true;
        });
        c.on("silent", () => {
          speaking.current = false;
          if (performance.now() >= saidUntil.current - 250) settle();
        });
        const gone = () => {
          if (client.current === c) {
            client.current = null;
            setLive(false);
          }
        };
        c.on("stop", gone);
        c.on("error", gone);
        c.on("startup_error", gone);
        const timer = window.setTimeout(() => {
          if (client.current === c && !isLive.current) {
            gone();
            void c.stop().catch(() => {});
          }
        }, LIVE_START_MS);
        try {
          await c.start();
          window.clearTimeout(timer);
          if (cancelled || client.current !== c) return;
          setLive(true);
        } catch {
          window.clearTimeout(timer);
          gone();
        }
      })();
      return () => {
        cancelled = true;
        if (opened && client.current === opened) hangUp();
        else if (opened) void opened.stop().catch(() => {});
      };
      // One stream per token.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session?.token]);

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
      if (!talking || streaming) {
        mouthNow.current = "closed";
        setMouth("closed");
        return;
      }
      let frame = 0;
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
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(frame);
    }, [talking, streaming, level]);

    // A blink now and then, while the loop isn't doing the blinking.
    const loopPlaying = Boolean(kit?.loop && !still && !talking && phase !== "thinking" && !broken.has(kit.loop) && !streaming);
    useEffect(() => {
      if (loopPlaying || streaming || !kit?.stills.blink) return;
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
    }, [loopPlaying, streaming, kit?.stills.blink]);

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

    // The renderer's elements are there whenever a session might come, so the stream has somewhere to land.
    const live = (
      <>
        <video ref={liveVideo} className={`companion-live-stream${streaming ? " is-on" : ""}`} autoPlay playsInline muted={false} aria-hidden="true" />
        <audio ref={liveAudio} autoPlay aria-hidden="true" />
      </>
    );

    if (!canTalk(kit) || !kit.stills.portrait || broken.has(kit.stills.portrait)) {
      return (
        <span className={`companion-live-face is-${phase}${streaming ? " streaming" : " bare"}`} style={{ width: size, height: size }} role="img" aria-label={`${name}'s face`}>
          <span className="companion-live-fallback">{fallback}</span>
          {session && live}
        </span>
      );
    }
    // Which still shows on top: a look while it lasts, a blink, else the mouth.
    const top: FaceStill = look && kit.stills[look] ? look : blink && kit.stills.blink ? "blink" : MOUTH_STILL[mouth];
    const shown = kit.stills[top] && !broken.has(kit.stills[top]!) ? top : "portrait";
    const parts = FACE_STILLS.filter((p): p is FaceStill => Boolean(kit.stills[p]) && !broken.has(kit.stills[p]!));
    return (
      <span className={`companion-live-face is-${phase}${talking && !streaming ? " talking" : ""}${streaming ? " streaming" : ""}`} style={{ width: size, height: size }} role="img" aria-label={`${name}'s face`}>
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
        {session && live}
      </span>
    );
  },
);

export default LiveFace;
