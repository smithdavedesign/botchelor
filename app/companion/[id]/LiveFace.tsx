"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { BLINK_MS, canTalk, FACE_STILLS, LOOK_MS, lookFor, MOUTH_STILL, mouthFor, nextBlinkIn, syntheticLevel, type FaceKit, type FaceStill, type Look, type Mouth } from "@/lib/face-kit-shared";
import { audioPieces, loopTimeAtCycleFrame, secondsOfFaceAudio, type LiveFaceSession } from "@/lib/live-face-shared";

/** How long before the loop's end it fades back into the portrait (the loop starts from the portrait, so the restart can't show). */
const FADE_S = 0.45;
/** A live stream that hasn't shown a frame by then is given up, and the kit's face stays. */
const LIVE_START_MS = 8_000;
/** A clip whose turn hasn't come (the piece before it never arrived) waits this long, then the order moves on. */
const STALL_MS = 2_500;

export type FacePhase = "ready" | "connecting" | "listening" | "thinking" | "speaking" | "paused";

/** What the call can do with a live face once it's streaming: feed it the voice, cut it off, hang it up. */
export type LiveFaceHandle = {
  /** The face is streaming (Simli): the voice should go here, not to the call's own player. */
  live: () => boolean;
  /** The face comes as clips (MuseTalk): the call holds each piece's voice for its clip instead of playing it. */
  clips: () => boolean;
  /** A piece of the companion's voice, 16 kHz 16-bit mono (Simli). */
  sendAudio: (bytes: Uint8Array) => void;
  /** Piece i of the reply as a clip with the voice in it (MuseTalk): played in order, over the kit's face. `end` is where in the idle cycle it leaves off. */
  clip: (i: number, mp4: Uint8Array, end: number | null) => void;
  /** Piece i plays the plain way instead (its clip failed): `play` runs in its turn among the clips and resolves when the voice is done. */
  plain: (i: number, play: () => Promise<void>) => void;
  /** A new reply: the order starts over at piece 0, and clips left from the last one go. */
  turn: () => void;
  /** From a tap: lets the clips' element play with sound later (phones). */
  unlock: (silence: string) => void;
  /** Drops whatever it hasn't said yet (a barge-in). */
  clear: () => void;
  /** Resolves once it has said everything sent (or at once when it isn't live). */
  idle: () => Promise<void>;
  /** Seconds the stream was up, or clips played, this call. */
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
 * With a `session` (lib/live-face, Tier 1) the renderer's picture lands in the same round frame, over the kit:
 *  - Simli: the browser opens the stream and the call feeds it the voice through the handle; the kit's face is what
 *    shows until the first frame, and again the moment the stream fails. The renderer's own audio plays the voice.
 *  - MuseTalk: the server sends a clip per piece of the reply (the loop with the mouth saying it, voice included);
 *    they play here in order, and between them, and whenever a clip doesn't come, the kit's face carries on.
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
    const [onSlot, setOnSlot] = useState<0 | 1 | null>(null);
    const [plainUp, setPlainUp] = useState(false);
    const video = useRef<HTMLVideoElement>(null);
    const liveVideo = useRef<HTMLVideoElement>(null);
    const liveAudio = useRef<HTMLAudioElement>(null);
    const mouthNow = useRef<Mouth>("closed");
    const talking = phase === "speaking";
    const clipMode = session?.provider === "musetalk";
    const clipModeNow = useRef(clipMode);
    clipModeNow.current = clipMode;

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
    // Clips waiting their turn (MuseTalk), and the one playing.
    type Entry = { i: number; url: string; end: number | null } | { i: number; play: () => Promise<void> };
    const clipQueue = useRef<Entry[]>([]);
    const clipUp = useRef<string | null>(null);
    const clipB = useRef<HTMLVideoElement>(null);
    const slot = useRef<0 | 1>(0);
    const expected = useRef(0);
    const lastEnd = useRef<number | null>(null);
    const loaded = useRef<{ slot: 0 | 1; url: string } | null>(null);
    const busy = useRef(false);
    const stall = useRef(0);

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

    // The clips, in the order of the reply's pieces, through two elements: the next loads while one plays, so the
    // switch is a frame, not a gap. A piece that plays plain (its clip failed) takes its turn in the same order. The
    // kit's loop pauses under a clip and takes over where the last clip left off (loopTimeAtCycleFrame).
    const slotEl = (s: 0 | 1) => (s === 0 ? liveVideo.current : clipB.current);
    const setBusy = (on: boolean) => {
      busy.current = on;
      setPlainUp(on);
    };
    const finishClips = () => {
      clipUp.current = null;
      setBusy(false);
      setOnSlot(null);
      setLive(false);
      settle();
      const v = video.current;
      if (v && lastEnd.current !== null && Number.isFinite(v.duration) && v.duration > 0) {
        try {
          v.currentTime = loopTimeAtCycleFrame(lastEnd.current, v.duration);
        } catch {
          // Not seekable yet: it plays on from where it is.
        }
      }
      void v?.play().catch(() => {});
    };
    const preloadNext = () => {
      const next = clipQueue.current[0];
      if (!next || !("url" in next) || next.i !== expected.current) return;
      const el = slotEl(slot.current);
      if (!el || loaded.current?.url === next.url) return;
      el.src = next.url;
      el.load();
      loaded.current = { slot: slot.current, url: next.url };
    };
    const playNextClip = () => {
      window.clearTimeout(stall.current);
      const next = clipQueue.current[0];
      if (!next) {
        finishClips();
        return;
      }
      if (next.i !== expected.current) {
        // Not its turn: the piece before it is still on its way. Not for long, though.
        stall.current = window.setTimeout(() => {
          expected.current = next.i;
          playNextClip();
        }, STALL_MS);
        return;
      }
      clipQueue.current.shift();
      expected.current = next.i + 1;
      if ("play" in next) {
        // The plain way: the kit's face shows, its mouth moving to the voice, until this piece is done.
        clipUp.current = null;
        setOnSlot(null);
        setLive(false);
        setBusy(true);
        next.play().finally(() => {
          setBusy(false);
          playNextClip();
        });
        return;
      }
      const s = slot.current;
      const el = slotEl(s);
      if (!el) {
        URL.revokeObjectURL(next.url);
        playNextClip();
        return;
      }
      if (loaded.current?.slot !== s || loaded.current.url !== next.url) el.src = next.url;
      loaded.current = null;
      el.muted = false;
      const prev = clipUp.current;
      clipUp.current = next.url;
      lastEnd.current = next.end;
      slot.current = s === 0 ? 1 : 0;
      el.play()
        .then(() => {
          setOnSlot(s);
          setLive(true);
          video.current?.pause();
          if (prev) {
            slotEl(s === 0 ? 1 : 0)?.removeAttribute("src");
            URL.revokeObjectURL(prev);
          }
          preloadNext();
        })
        .catch(() => {
          // Refused (the page never got a tap, or the clip is broken): this piece's voice is lost; the next may play.
          URL.revokeObjectURL(next.url);
          if (prev) URL.revokeObjectURL(prev);
          clipUp.current = null;
          playNextClip();
        });
    };
    const dropClips = () => {
      window.clearTimeout(stall.current);
      for (const c of clipQueue.current) if ("url" in c) URL.revokeObjectURL(c.url);
      clipQueue.current = [];
      loaded.current = null;
      for (const s of [0, 1] as const) {
        const el = slotEl(s);
        if (!el) continue;
        el.pause();
        el.removeAttribute("src");
      }
      if (clipUp.current) URL.revokeObjectURL(clipUp.current);
      clipUp.current = null;
      setBusy(false);
      setOnSlot(null);
      setLive(false);
      void video.current?.play().catch(() => {});
    };

    useImperativeHandle(
      ref,
      () => ({
        live: () => isLive.current && !clipModeNow.current,
        clips: () => clipModeNow.current && Boolean(liveVideo.current),
        sendAudio: (bytes) => {
          const c = client.current;
          if (!c || !isLive.current || !bytes.length) return;
          for (const piece of audioPieces(bytes)) c.sendAudioData(piece);
          const now = performance.now();
          saidUntil.current = Math.max(saidUntil.current, now) + secondsOfFaceAudio(bytes.length) * 1000;
        },
        clip: (i, mp4, end) => {
          if (!clipModeNow.current || !mp4.length) return;
          const url = URL.createObjectURL(new Blob([mp4 as BlobPart], { type: "video/mp4" }));
          clipQueue.current.push({ i, url, end });
          clipQueue.current.sort((a, b) => a.i - b.i);
          if (!clipUp.current && !busy.current) playNextClip();
          else preloadNext();
        },
        plain: (i, play) => {
          if (!clipModeNow.current) {
            void play();
            return;
          }
          clipQueue.current.push({ i, play });
          clipQueue.current.sort((a, b) => a.i - b.i);
          if (!clipUp.current && !busy.current) playNextClip();
        },
        turn: () => {
          if (!clipModeNow.current) return;
          dropClips();
          expected.current = 0;
          lastEnd.current = null;
        },
        unlock: (silence) => {
          // Before the session is known (the tap comes first), so the elements are always there (see `live` below).
          if (client.current || clipUp.current) return;
          for (const el of [liveVideo.current, clipB.current]) {
            if (!el) continue;
            try {
              el.src = silence;
              el.muted = false;
              void el.play().catch(() => {});
            } catch {
              // No play from here: the clips may play muted on this phone.
            }
          }
        },
        clear: () => {
          if (clipModeNow.current) dropClips();
          client.current?.ClearBuffer();
          saidUntil.current = 0;
          speaking.current = false;
          settle();
        },
        idle: () => {
          if (clipModeNow.current) {
            if (!clipUp.current && !busy.current && !clipQueue.current.length) return Promise.resolve();
            return new Promise<void>((ok) => idleWaiters.current.push(ok));
          }
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
        stop: () => {
          dropClips();
          hangUp();
        },
      }),
      [],
    );

    // Opens Simli's stream for a session (once per token); hangs it up when the session goes. Clips need no opening.
    useEffect(() => {
      if (!session || session.provider !== "simli") {
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
    }, [session?.provider === "simli" ? session.token : null]);

    // Clips are dropped with their session.
    useEffect(() => {
      if (!clipMode) dropClips();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clipMode]);

    // Still until it's known it can move: the server's markup has no video, and reduced motion keeps the loop off.
    useEffect(() => {
      if (typeof window === "undefined" || !window.matchMedia) return;
      const q = window.matchMedia("(prefers-reduced-motion: reduce)");
      setStill(q.matches);
      const on = () => setStill(q.matches);
      q.addEventListener?.("change", on);
      return () => q.removeEventListener?.("change", on);
    }, []);

    // The kit's mouth moves while they talk the plain way: not under a stream or a clip, and with clips only for a
    // piece that plays plain (between clips the loop carries on; nothing is being said).
    const mouthOn = talking && !streaming && (!clipMode || plainUp);
    // The mouth follows the voice while they talk: measured when it can be, made up when it can't.
    useEffect(() => {
      if (!mouthOn) {
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
    }, [mouthOn, level]);

    // The loop plays while they listen (and, with clips, under and between the clips too, so the motion never stops);
    // it stops when the kit's stills must show the mouth: Tier 0 talking, or a clipped piece that fell back to the voice.
    const loopPlaying = Boolean(kit?.loop && !still && !broken.has(kit.loop) && (clipMode ? !(plainUp && !streaming) : !talking && phase !== "thinking" && !streaming));
    // A blink now and then, while the loop isn't doing the blinking.
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

    // The renderer's elements are always there: a tap unlocks them before any session is known, and the stream (or the
    // clips) has somewhere to land.
    const live = (
      <>
        <video ref={liveVideo} className={`companion-live-stream${(clipMode ? onSlot === 0 : streaming) ? " is-on" : ""}`} autoPlay={!clipMode} playsInline muted={false} aria-hidden="true" onEnded={clipMode ? playNextClip : undefined} />
        <video ref={clipB} className={`companion-live-stream${onSlot === 1 ? " is-on" : ""}`} playsInline muted={false} aria-hidden="true" onEnded={clipMode ? playNextClip : undefined} preload="auto" />
        <audio ref={liveAudio} autoPlay aria-hidden="true" />
      </>
    );

    if (!canTalk(kit) || !kit.stills.portrait || broken.has(kit.stills.portrait)) {
      return (
        <span className={`companion-live-face is-${phase}${streaming ? " streaming" : " bare"}`} style={{ width: size, height: size }} role="img" aria-label={`${name}'s face`}>
          <span className="companion-live-fallback">{fallback}</span>
          {live}
        </span>
      );
    }
    // Which still shows on top: a look while it lasts, a blink, else the mouth.
    const top: FaceStill = look && kit.stills[look] ? look : blink && kit.stills.blink ? "blink" : MOUTH_STILL[mouth];
    const shown = kit.stills[top] && !broken.has(kit.stills[top]!) ? top : "portrait";
    const parts = FACE_STILLS.filter((p): p is FaceStill => Boolean(kit.stills[p]) && !broken.has(kit.stills[p]!));
    return (
      <span className={`companion-live-face is-${phase}${mouthOn ? " talking" : ""}${streaming ? " streaming" : ""}`} style={{ width: size, height: size }} role="img" aria-label={`${name}'s face`}>
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
        {live}
      </span>
    );
  },
);

export default LiveFace;
