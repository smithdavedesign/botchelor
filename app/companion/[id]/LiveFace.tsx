"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from "react";
import { hasFace, type FaceKit } from "@/lib/face-kit-shared";
import { audioPieces, FRAG_CODECS, FRAG_STALL_MS, isClipProvider, loopTimeAtCycleFrame, type ReactionKind, secondsOfFaceAudio, type LiveFaceSession } from "@/lib/live-face-shared";

/** How long before the loop's end it fades back into the portrait (the loop starts from the portrait, so the restart can't show). */
const FADE_S = 0.45;
/** A live stream that hasn't shown a frame by then is given up, and the kit's face stays. */
const LIVE_START_MS = 8_000;
/** A clip whose turn hasn't come (the piece before it never arrived) waits this long, then the order moves on. */
const STALL_MS = 2_500;
/** A clip that ended with the next piece named but its clip still on its way keeps its last frame this long (a pause), then the loop takes over. */
const HOLD_MS = 2_500;

export type FacePhase = "ready" | "connecting" | "listening" | "thinking" | "speaking" | "paused";

/** What the call can do with a live face once it's streaming: feed it the voice, cut it off, hang it up. */
export type LiveFaceHandle = {
  /** The face is streaming (Simli): the voice should go here, not to the call's own player. */
  live: () => boolean;
  /** The face comes as clips (MuseTalk): the call holds each piece's voice for its clip instead of playing it. */
  clips: () => boolean;
  /** A piece of the companion's voice, 16 kHz 16-bit mono (Simli). */
  sendAudio: (bytes: Uint8Array) => void;
  /** Piece i of the reply as a clip with the voice in it (MuseTalk, Ditto): played in order, over the kit's face. `end` is where in the idle cycle it leaves off (0: its first frame, the portrait). */
  clip: (i: number, mp4: Uint8Array, end: number | null) => void;
  /** The reply has named piece i: a clip for it is due, so a clip that ends before it lands holds its last frame rather than drop to the loop. */
  expect: (i: number) => void;
  /** A reaction between replies (Ditto: a nod, a tilt), when the character has the clip and nothing is playing; otherwise nothing. */
  react: (kind: ReactionKind) => void;
  /** Whether this browser can play streamed clauses (MediaSource with the worker's codecs) under a clip session. */
  frags: () => boolean;
  /** Piece i streams: its first piece is on its way (the reply's MediaSource opens on the first). */
  fragStart: (i: number) => void;
  /** A piece of piece i's fragmented MP4, appended in clause order. */
  frag: (i: number, seq: number, bytes: Uint8Array) => void;
  /** Piece i's last piece is in. */
  fragEnd: (i: number) => void;
  /** The reply is over (nothing more will be named): the stream ends once everything appended has played. */
  fragDone: () => void;
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
 * A companion's face on a call (lib/face-kit.ts; docs/PRDs/digital-human.md Tier 0): their portrait with the living
 * loop playing over it the whole call, listening, thinking and talking alike: a few seconds of them breathing, blinking
 * and glancing at the camera, which starts and ends at the portrait so it never jumps. That they're talking is shown by
 * the call screen (the ring around the face swells with their voice: app/stage/useVoiceRing.ts), never by a mouth made
 * of swapped pictures (the kit's old mouth stills, which read as choppy; David, 2026-11-22: "let's just have a loop of
 * the character like a gif"). With no kit it's the `fallback`: their portrait as it is. The loop stays off with reduced
 * motion.
 *
 * With a `session` (lib/live-face, Tier 1) the renderer's picture lands in the same round frame, over the kit:
 *  - Simli: the browser opens the stream and the call feeds it the voice through the handle; the kit's face is what
 *    shows until the first frame, and again the moment the stream fails. The renderer's own audio plays the voice.
 *  - MuseTalk, Ditto: the server sends a clip per piece of the reply (MuseTalk the loop with the mouth saying it,
 *    Ditto the whole head from the portrait, voice included); they play here in order, and between them, and whenever
 *    a clip doesn't come, the kit's face carries on. A Ditto reply ends back at the portrait, so the loop restarts
 *    from its first frame (`end` 0) and nothing jumps. With Ditto the loop itself is the character's Ditto idle when
 *    it's been rendered (lib/live-face/ditto-clips.ts), so idle and talking share one renderer, and the call can ask
 *    for a reaction clip (a nod, a tilt) between replies.
 */
const LiveFace = forwardRef<LiveFaceHandle, { kit: FaceKit | null; phase: FacePhase; name: string; size: number | string; fallback: ReactNode; session?: LiveFaceSession | null; onLive?: (live: boolean) => void }>(
  function LiveFace({ kit, phase, name, size, fallback, session = null, onLive }, ref) {
    const [fading, setFading] = useState(false);
    const [still, setStill] = useState(true);
    const [broken, setBroken] = useState<ReadonlySet<string>>(new Set());
    const [streaming, setStreaming] = useState(false);
    const [onSlot, setOnSlot] = useState<0 | 1 | null>(null);
    const video = useRef<HTMLVideoElement>(null);
    const liveVideo = useRef<HTMLVideoElement>(null);
    const liveAudio = useRef<HTMLAudioElement>(null);
    const clipMode = isClipProvider(session?.provider);
    const clipModeNow = useRef(clipMode);
    clipModeNow.current = clipMode;
    const sessionNow = useRef(session);
    sessionNow.current = session;
    // Ditto's idle, in place of the kit's loop, once the character has one: it begins and ends at the portrait, so it loops as it is.
    const dittoIdle = session?.provider === "ditto" ? (session.idle ?? null) : null;
    const loopSrc = dittoIdle ?? kit?.loop ?? null;

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
    // The highest piece the reply has named so far, and the hold on a clip that ended before the next one's clip came.
    const announced = useRef(-1);
    const holding = useRef(0);
    // Streamed clauses (lib/live-face/ditto.ts speakDittoStream): one MediaSource per reply on a slot element, the
    // pieces of each clause appended in clause order (sequence mode: one continuous timeline); the element holds its
    // last frame while the next piece is on its way and ends when the reply's last piece has played.
    type FragPiece = { parts: Uint8Array[]; ended: boolean; play?: () => Promise<void>; played?: boolean };
    const mse = useRef<{ ms: MediaSource; sb: SourceBuffer | null; url: string; slot: 0 | 1; started: boolean } | null>(null);
    const fragPieces = useRef<Map<number, FragPiece>>(new Map());
    const fragAt = useRef(0);
    const fragOver = useRef(false);
    const fragStall = useRef(0);

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
    // switch is a frame, not a gap. A piece that plays plain (its clip failed) takes its turn in the same order, with
    // the loop carrying on under its voice. The kit's loop pauses under a clip and takes over where the last clip left
    // off (loopTimeAtCycleFrame).
    const slotEl = (s: 0 | 1) => (s === 0 ? liveVideo.current : clipB.current);
    const setBusy = (on: boolean) => {
      busy.current = on;
    };
    // Which MediaSource this browser has for the worker's fragments (Safari's managed one first), if any.
    const msCtor = (): typeof MediaSource | null => {
      if (typeof window === "undefined") return null;
      const w = window as unknown as { ManagedMediaSource?: typeof MediaSource; MediaSource?: typeof MediaSource };
      const C = w.ManagedMediaSource ?? w.MediaSource ?? null;
      try {
        return C && typeof C.isTypeSupported === "function" && C.isTypeSupported(FRAG_CODECS) ? C : null;
      } catch {
        return null;
      }
    };
    const fragTeardown = () => {
      window.clearTimeout(fragStall.current);
      const m = mse.current;
      mse.current = null;
      fragPieces.current = new Map();
      fragAt.current = 0;
      fragOver.current = false;
      if (!m) return;
      const el = slotEl(m.slot);
      try {
        if (m.ms.readyState === "open") m.ms.endOfStream();
      } catch {
        // Already closed.
      }
      if (el) {
        el.pause();
        el.removeAttribute("src");
        el.load();
      }
      URL.revokeObjectURL(m.url);
    };
    const fragFinish = () => {
      // Everything appended: the element plays out and its `ended` lands in finishClips (onSlotEnded).
      const m = mse.current;
      if (!m || !m.sb || m.sb.updating) return;
      try {
        if (m.ms.readyState === "open") m.ms.endOfStream();
      } catch {
        // Already ended.
      }
    };
    const armFragStall = () => {
      window.clearTimeout(fragStall.current);
      fragStall.current = window.setTimeout(() => {
        if (mse.current) fragFinish();
      }, FRAG_STALL_MS);
    };
    const fragPump = () => {
      const m = mse.current;
      if (!m || !m.sb || m.sb.updating) return;
      const piece = fragPieces.current.get(fragAt.current);
      if (!piece) {
        if (fragOver.current && fragAt.current > announced.current) fragFinish();
        return;
      }
      if (piece.play) {
        // A piece that fell back to the plain voice takes its turn here; the element waits at its buffer's end meanwhile.
        if (!piece.played) {
          piece.played = true;
          setBusy(true);
          piece.play().finally(() => {
            setBusy(false);
            fragAt.current += 1;
            fragPump();
          });
        }
        return;
      }
      const part = piece.parts.shift();
      if (part) {
        try {
          m.sb.appendBuffer(part as BufferSource);
        } catch {
          fragTeardown();
          finishClips();
        }
        return;
      }
      if (piece.ended) {
        fragAt.current += 1;
        fragPump();
      }
    };
    const finishClips = () => {
      window.clearTimeout(holding.current);
      holding.current = 0;
      window.clearTimeout(fragStall.current);
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
      window.clearTimeout(holding.current);
      holding.current = 0;
      const next = clipQueue.current[0];
      if (!next) {
        if (clipUp.current && announced.current >= expected.current) {
          // The next piece is named but its clip isn't here yet: keep this clip's last frame a moment (a pause in the
          // talk) rather than drop to the loop; the clip plays the moment it lands (clip/plain call back here).
          holding.current = window.setTimeout(() => {
            holding.current = 0;
            if (clipQueue.current.length) playNextClip();
            else finishClips();
          }, HOLD_MS);
          return;
        }
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
        // The plain way: the kit's face shows, its loop carrying on, until this piece's voice is done.
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
      window.clearTimeout(holding.current);
      holding.current = 0;
      fragTeardown();
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
          if ((!clipUp.current && !busy.current) || holding.current) playNextClip();
          else preloadNext();
        },
        expect: (i) => {
          announced.current = Math.max(announced.current, i);
        },
        frags: () => clipModeNow.current && Boolean(msCtor()),
        fragStart: (i) => {
          if (!clipModeNow.current) return;
          if (!mse.current) {
            const C = msCtor();
            const s = slot.current;
            const el = slotEl(s);
            if (!C || !el) return;
            const ms = new C();
            const url = URL.createObjectURL(ms);
            mse.current = { ms, sb: null, url, slot: s, started: false };
            slot.current = s === 0 ? 1 : 0;
            ms.addEventListener("sourceopen", () => {
              const m = mse.current;
              if (!m || m.ms !== ms) return;
              try {
                m.sb = ms.addSourceBuffer(FRAG_CODECS);
              } catch {
                fragTeardown();
                return;
              }
              m.sb.mode = "sequence";
              m.sb.addEventListener("updateend", () => {
                const mm = mse.current;
                if (!mm || mm.ms !== ms) return;
                if (!mm.started) {
                  mm.started = true;
                  const e = slotEl(mm.slot);
                  e?.play()
                    .then(() => {
                      setOnSlot(mm.slot);
                      setLive(true);
                      video.current?.pause();
                    })
                    .catch(() => {});
                }
                fragPump();
              });
              fragPump();
            });
            if ("disableRemotePlayback" in el) (el as HTMLVideoElement & { disableRemotePlayback: boolean }).disableRemotePlayback = true;
            el.muted = false;
            el.src = url;
            clipUp.current = url;
            lastEnd.current = 0;
          }
          if (!fragPieces.current.has(i)) fragPieces.current.set(i, { parts: [], ended: false });
          armFragStall();
        },
        frag: (i, _seq, bytes) => {
          if (!mse.current) return;
          const p = fragPieces.current.get(i) ?? { parts: [], ended: false };
          fragPieces.current.set(i, p);
          p.parts.push(bytes);
          fragPump();
          armFragStall();
        },
        fragEnd: (i) => {
          const p = fragPieces.current.get(i);
          if (p) p.ended = true;
          fragPump();
        },
        fragDone: () => {
          fragOver.current = true;
          fragPump();
        },
        react: (kind) => {
          const s = sessionNow.current;
          const url = s?.provider === "ditto" ? s.reactions?.[kind] : undefined;
          if (!url || !clipModeNow.current || clipUp.current || busy.current || holding.current || clipQueue.current.length) return;
          const sl = slot.current;
          const el = slotEl(sl);
          if (!el) return;
          // Played like a clip (from the portrait back to it, silent), over the paused idle; its end resumes the idle at its start.
          el.src = url;
          el.muted = true;
          clipUp.current = url;
          lastEnd.current = 0;
          slot.current = sl === 0 ? 1 : 0;
          el.play()
            .then(() => {
              setOnSlot(sl);
              video.current?.pause();
            })
            .catch(() => {
              clipUp.current = null;
              el.removeAttribute("src");
            });
        },
        plain: (i, play) => {
          if (!clipModeNow.current) {
            void play();
            return;
          }
          if (mse.current) {
            // In a streamed reply the plain piece takes its turn in the same order.
            fragPieces.current.set(i, { parts: [], ended: true, play });
            fragPump();
            return;
          }
          clipQueue.current.push({ i, play });
          clipQueue.current.sort((a, b) => a.i - b.i);
          if ((!clipUp.current && !busy.current) || holding.current) playNextClip();
        },
        turn: () => {
          if (!clipModeNow.current) return;
          dropClips();
          expected.current = 0;
          lastEnd.current = null;
          announced.current = -1;
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
      // Made once: everything it calls reads refs, so the first copies stay current.
      // eslint-disable-next-line react-hooks/exhaustive-deps
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

    // The loop plays the whole call: listening, thinking and talking alike. A renderer's stream (Simli) takes its place
    // while it's up; with clips it stays under them, paused while one plays and resumed where the last left off.
    const loopPlaying = Boolean(loopSrc && !still && !broken.has(loopSrc) && (clipMode || !streaming));

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

    // A slot's clip (or a streamed reply) ended: the next clip, or the loop again.
    const onSlotEnded = () => {
      if (mse.current) {
        fragTeardown();
        finishClips();
        return;
      }
      playNextClip();
    };
    // The renderer's elements are always there: a tap unlocks them before any session is known, and the stream (or the
    // clips) has somewhere to land.
    const live = (
      <>
        <video ref={liveVideo} className={`companion-live-stream${(clipMode ? onSlot === 0 : streaming) ? " is-on" : ""}`} autoPlay={!clipMode} playsInline muted={false} aria-hidden="true" onEnded={clipMode ? onSlotEnded : undefined} />
        <video ref={clipB} className={`companion-live-stream${onSlot === 1 ? " is-on" : ""}`} playsInline muted={false} aria-hidden="true" onEnded={clipMode ? onSlotEnded : undefined} preload="auto" />
        <audio ref={liveAudio} autoPlay aria-hidden="true" />
      </>
    );

    if (!hasFace(kit) || broken.has(kit.stills.portrait!)) {
      return (
        <span className={`companion-live-face is-${phase}${streaming ? " streaming" : " bare"}`} style={{ width: size, height: size }} role="img" aria-label={`${name}'s face`}>
          <span className="companion-live-fallback">{fallback}</span>
          {live}
        </span>
      );
    }
    const portrait = kit.stills.portrait!;
    return (
      <span className={`companion-live-face is-${phase}${streaming ? " streaming" : ""}`} style={{ width: size, height: size }} role="img" aria-label={`${name}'s face`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- the kit's own file, served by our route */}
        <img src={portrait} alt="" className="companion-live-still" draggable={false} onError={() => setBroken((b) => new Set([...b, portrait]))} />
        {loopPlaying && (
          <video
            ref={video}
            className={`companion-live-loop${fading ? " fading" : ""}`}
            src={loopSrc!}
            poster={portrait}
            muted
            playsInline
            autoPlay
            loop={Boolean(dittoIdle)}
            preload="auto"
            onTimeUpdate={dittoIdle ? undefined : onTime}
            onError={() => setBroken((b) => new Set([...b, loopSrc!]))}
            aria-hidden="true"
          />
        )}
        {live}
      </span>
    );
  },
);

export default LiveFace;
