"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Avatar, { sized } from "@/app/Avatar";
import LiveFace from "@/app/companion/[id]/LiveFace";
import { newAudioContext, PcmPlayer } from "@/app/companion/[id]/live-audio";
import { useVoiceRing } from "@/app/stage/useVoiceRing";
import { callWords, type StepInCharacter, type StepInMessageView } from "@/lib/adult/step-in-shared";
import type { FaceKit } from "@/lib/face-kit-shared";
import { characterPortrait } from "@/lib/portraits";
import { fetchVoicePiece, playOn } from "./voice-client";

/** The browser's speech recognition, as much of it as a call uses (not in TypeScript's DOM types). */
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function recognition(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** A call needs the browser to hear the viewer (Chrome, Edge and Safari can; Firefox can't). */
export function stepInCallSupported(): boolean {
  return recognition() !== null;
}

/** What saying a line came to: the character's spoken reply, or why not, and what the call does about it. */
export type CallSaid =
  | { ok: true; reply: StepInMessageView; stepsLeft: number | null }
  /** `again`: the line was refused or nothing answered; the call listens again. `end`: the call can't go on (a pause, the cap, the scene over). */
  | { ok: false; message: string; again?: boolean; end?: boolean };

type Phase = "ready" | "listening" | "thinking" | "speaking" | "paused";

/** Nothing said for this long, and the call ends on its own. */
const QUIET_END_MS = 5 * 60_000;
/** Silences in a row before it stops listening and waits for a tap. */
const SILENCES = 3;
/** A moment of silence, played from the tap that starts a call so a phone lets the call play their voice later (Safari). */
const SILENCE = "data:audio/wav;base64,UklGRjQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YRAAAAAAAAAAAAAAAAAAAAAAAAAA";
/** The face on the call, drawn this big when there's no kit (the tile fills what the screen leaves). */
const BIG_FACE = 768;

const MIC_BLOCKED = "Your browser didn't let the call use the microphone. Allow it for this site (on an iPhone, turn on Dictation in Settings → General → Keyboard), then tap to talk.";
const RECOGNITION_ERRORS: Record<string, string> = {
  "not-allowed": MIC_BLOCKED,
  "service-not-allowed": MIC_BLOCKED,
  "audio-capture": "No microphone was found. Plug one in or pick another, then tap to talk.",
  network: "Hearing you needs a connection, and it dropped. Tap to talk when you're back online.",
  "language-not-supported": "Your browser can't hear this language. Try another browser, or write instead.",
};

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/**
 * A call in a Step in scene (docs/after-dark.md "Step in": voice and calls; David, 2026-11-22: "we should have the
 * ability to live call in after dark"). The same scene, said out loud: the viewer talks, the browser's own speech
 * recognition turns it into words (Chrome sends the audio to Google for that, Safari to Apple; Botchelor gets only the
 * words), the words go in as a line of the scene (`onSay`: the scene's `say` move, with every check a written line
 * gets), and the character answers in a few spoken sentences, in their own voice, a piece at a time (./voice-client.ts,
 * lib/adult/step-in-voice.ts). Then it listens again. It takes turns: it doesn't listen while they talk, so it never
 * hears itself; ✋ Interrupt stops them and listens.
 *
 * Their face is the show's living loop of them when they have one (app/companion/[id]/LiveFace.tsx: a PG loop, drawn
 * for the show's calls, playing the whole call), else their portrait, with the ring around it swelling with their
 * voice (app/stage/useVoiceRing.ts). No lip-sync renderer is involved: none allows adult scenes, and a loop with a real
 * voice is what the best-known sites do (docs/audits/2026-11-22-companion-field.md).
 *
 * The screen is the show's call screen (app/ux/companion.css `.companion-call`), so a call looks the same on both
 * sides. Nothing is recorded: the microphone's audio never reaches Botchelor, and their voice is made from the words.
 */
export default function StepInCall({
  sceneId,
  character,
  kit,
  stepsLeft,
  onSay,
  onClose,
}: {
  sceneId: string;
  character: StepInCharacter;
  /** The show's face kit for them (its links on the show's own address), when they have one. */
  kit: FaceKit | null;
  /** Scene steps left this month when the call opens; null for an admin, who's never capped. */
  stepsLeft: number | null;
  onSay: (text: string) => Promise<CallSaid>;
  /** The call is over: `message` when it ended for a reason the scene should show. */
  onClose: (message: string | null) => void;
}) {
  const first = firstName(character.name);
  const [phase, setPhase] = useState<Phase>("ready");
  const [heard, setHeard] = useState("");
  const [you, setYou] = useState("");
  const [them, setThem] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [left, setLeft] = useState(stepsLeft);

  const phaseNow = useRef<Phase>("ready");
  const ended = useRef(false);
  const rec = useRef<Recognition | null>(null);
  const silences = useRef(0);
  const startedAt = useRef(0);
  const lastAt = useRef(0);
  // Each reply being said is a run; Interrupt, a pause or the end makes it stale.
  const talk = useRef(0);
  const ctx = useRef<AudioContext | null>(null);
  const player = useRef<PcmPlayer | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const tile = useRef<HTMLDivElement>(null);
  const mainButton = useRef<HTMLButtonElement>(null);
  const endButton = useRef<HTMLButtonElement>(null);
  const handlers = useRef({ onSay, onClose });
  handlers.current = { onSay, onClose };

  const go = (p: Phase) => {
    phaseNow.current = p;
    setPhase(p);
  };

  function stopListening() {
    const r = rec.current;
    rec.current = null;
    if (!r) return;
    r.onend = null;
    r.onresult = null;
    r.onerror = null;
    try {
      r.abort();
    } catch {
      // Already stopped.
    }
  }

  function stopTalking() {
    talk.current += 1;
    audio.current?.pause();
  }

  function end(message: string | null = null) {
    if (ended.current) return;
    ended.current = true;
    stopListening();
    stopTalking();
    void ctx.current?.close().catch(() => {});
    handlers.current.onClose(message);
  }

  /** Stops listening (or talking) and waits for a tap, saying why when there's a reason. */
  function pause(why: string | null) {
    go("paused");
    stopListening();
    stopTalking();
    setHeard("");
    setNote(why);
  }

  function listen() {
    if (ended.current) return;
    // Their answer came while the tab was in the background: wait for them to come back rather than listen to the room.
    if (document.visibilityState === "hidden") return pause("Paused while you were away.");
    const Ctor = recognition();
    if (!Ctor) return end("This browser can't hear you, so calls don't work here. Try Chrome, Edge or Safari.");
    stopListening();
    go("listening");
    const r = new Ctor();
    // After Dark is English only (lib/safety.ts checkAdultText refuses anything else), so it listens for English.
    r.lang = /^en\b/i.test(navigator.language || "") ? navigator.language : "en-US";
    r.continuous = false;
    r.interimResults = true;
    r.maxAlternatives = 1;
    let said = "";
    let error: string | null = null;
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) said += result[0].transcript;
        else interim += result[0].transcript;
      }
      setHeard(`${said} ${interim}`.trim());
    };
    r.onerror = (e) => {
      error = e.error;
    };
    r.onend = () => {
      if (rec.current !== r) return;
      rec.current = null;
      if (ended.current || phaseNow.current !== "listening") return;
      const text = said.replace(/\s+/g, " ").trim();
      if (text) {
        silences.current = 0;
        void turn(text);
        return;
      }
      if (error && RECOGNITION_ERRORS[error]) return pause(RECOGNITION_ERRORS[error]);
      // Nothing heard: listen again a few times, then wait for a tap (a phone left on the table stops listening).
      if (++silences.current >= SILENCES) return pause(null);
      listen();
    };
    rec.current = r;
    try {
      r.start();
    } catch {
      pause("The microphone didn't start. Tap to talk to try again.");
    }
  }

  /** What they said goes in as a line of the scene, the character's answer comes back and is said aloud, then it listens again. */
  async function turn(text: string) {
    go("thinking");
    setYou(text);
    setHeard("");
    setNote(null);
    lastAt.current = Date.now();
    const r = await handlers.current.onSay(text);
    if (ended.current) return;
    if (!r.ok) {
      if (r.end) return end(r.message);
      if (r.again) {
        setNote(r.message);
        listen();
        return;
      }
      return pause(r.message);
    }
    setLeft(r.stepsLeft);
    const words = callWords(r.reply.text);
    const pieces = r.reply.spoken ?? 0;
    const mine = ++talk.current;
    // Every piece of the answer is asked for at once; they're said in order as they come.
    const jobs = Array.from({ length: pieces }, (_, i) => fetchVoicePiece(sceneId, r.reply.id, i));
    const letGo = (from: number) => jobs.slice(from).forEach((j) => void j.then((v) => v.ok && URL.revokeObjectURL(v.url)));
    setThem(words);
    go("speaking");
    const el = audio.current;
    for (let i = 0; i < jobs.length; i++) {
      const v = await jobs[i];
      if (ended.current || talk.current !== mine) return letGo(i);
      if (!v.ok) {
        letGo(i + 1);
        // Their words are on screen and in the scene; the voice is what's missing.
        return pause(`${first}'s voice didn't come (${v.message.replace(/\.$/, "")}). What they said is here and in the scene. Tap to talk to carry on.`);
      }
      const played = el ? await playOn(el, v.url) : false;
      URL.revokeObjectURL(v.url);
      if (ended.current || talk.current !== mine) return letGo(i + 1);
      if (!played) {
        letGo(i + 1);
        return pause("Your browser didn't play their voice. Tap to talk to try again.");
      }
    }
    lastAt.current = Date.now();
    // Stopped by Interrupt: it's listening already. Paused or ended meanwhile: stay that way.
    if (ended.current || phaseNow.current !== "speaking" || talk.current !== mine) return;
    listen();
  }

  function start() {
    // From this tap: an audio context and an element the browser will let play later, and their voice through one
    // analyser so the ring can follow it.
    const c = newAudioContext();
    ctx.current = c;
    const a = new Audio();
    audio.current = a;
    if (c) {
      player.current = new PcmPlayer(c);
      player.current.attach(a);
    }
    a.src = SILENCE;
    void a.play().catch(() => {});
    startedAt.current = Date.now();
    lastAt.current = Date.now();
    silences.current = 0;
    listen();
  }

  function interrupt() {
    stopTalking();
    listen();
  }

  function resume() {
    setNote(null);
    silences.current = 0;
    lastAt.current = Date.now();
    listen();
  }

  /** How loud their voice is right now, for the ring; -1 when it can't be measured. */
  const level = useCallback(() => player.current?.level() ?? -1, []);
  useVoiceRing(tile, level, phase === "speaking");

  // Where the keyboard is: on Call before it starts, on End call once it has.
  useEffect(() => {
    (phase === "ready" ? mainButton : endButton).current?.focus();
    // Only when the call starts, not on each phase after it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase === "ready"]);

  // The clock, and the call ends after five quiet minutes.
  useEffect(() => {
    if (phase === "ready") return;
    const t = setInterval(() => {
      if (ended.current) return;
      setSeconds(Math.round((Date.now() - startedAt.current) / 1000));
      if (Date.now() - lastAt.current > QUIET_END_MS && phaseNow.current !== "thinking" && phaseNow.current !== "speaking") end(`The call with ${first} ended after five quiet minutes.`);
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase === "ready"]);

  // Away from the tab: it stops listening and talking until they're back and tap.
  useEffect(() => {
    const away = () => {
      if (document.visibilityState === "hidden" && (phaseNow.current === "listening" || phaseNow.current === "speaking")) pause("Paused while you were away.");
    };
    document.addEventListener("visibilitychange", away);
    return () => document.removeEventListener("visibilitychange", away);
  }, []);

  // Leaving the page ends the call: nothing keeps listening or talking.
  useEffect(
    () => () => {
      ended.current = true;
      stopListening();
      talk.current += 1;
      audio.current?.pause();
      void ctx.current?.close().catch(() => {});
    },
    [],
  );

  const big = phase !== "ready";
  const portrait = characterPortrait(character.id) ?? sized(character.portrait, BIG_FACE);
  const backdrop = kit?.stills.portrait ?? portrait;
  const status = phase === "listening" ? "Listening…" : phase === "thinking" ? `${first} is thinking…` : phase === "speaking" ? `${first} is talking` : phase === "paused" ? "Paused" : `Call ${first}`;

  return (
    <div
      className={`companion-call ad-si-call is-${phase}`}
      role="dialog"
      aria-modal="true"
      aria-label={`Call with ${first}`}
      data-step-in-call={phase}
      onKeyDown={(e) => {
        if (e.key === "Escape") end();
      }}
    >
      <div className="companion-call-inner">
        <p className="companion-call-top">
          <span className="chip companion-ai">🤖 AI character</span>
          {big && <span className="companion-call-clock">{clock(seconds)}</span>}
        </p>
        <div className="companion-call-face" ref={tile}>
          {big && backdrop && (
            // eslint-disable-next-line @next/next/no-img-element -- the face's own portrait, blurred behind it
            <img src={backdrop} alt="" className="companion-call-backdrop" aria-hidden="true" draggable={false} />
          )}
          <LiveFace
            kit={kit}
            phase={phase}
            name={first}
            // On the call the tile is a size container (companion.css): a square as tall as the tile.
            size={big ? "100cqh" : 136}
            fallback={
              big && portrait ? (
                // eslint-disable-next-line @next/next/no-img-element -- their portrait at the tile's size (Avatar draws a fixed one)
                <img src={portrait} alt="" className="companion-call-portrait" draggable={false} />
              ) : (
                <Avatar seed={character.id} name={character.name} hue={character.hue ?? 0} house={character.house} portraitSrc={character.portrait} size={big ? 200 : 136} round />
              )
            }
          />
        </div>
        <h2 className="companion-call-name">{character.name}</h2>
        <p className="companion-call-status" role="status">
          {status}
        </p>

        {phase === "ready" ? (
          <div className="companion-call-ready">
            <p className="companion-call-how" data-step-in-call-how>
              The same scene, said out loud: you talk, {first} answers in {first}&apos;s own voice, a few sentences at a time. Your browser turns what you say into words
              (Chrome sends your voice to Google to do it, Safari to Apple); only the words come to Botchelor, kept in this scene like the lines you write, with the same
              limits and checks. {first} is an AI character, and the voice is made from {first}&apos;s words, never a real person&apos;s. Each answer is one scene step.
              {left !== null ? ` You have ${left} left this month.` : ""}
            </p>
            <p className="companion-call-controls">
              <button type="button" className="button companion-call-go" onClick={start} ref={mainButton} data-step-in-call-start>
                📞 Call {first}
              </button>
              <button type="button" className="button-ghost" onClick={() => end()}>
                Not now
              </button>
            </p>
          </div>
        ) : (
          <>
            <div className="companion-call-words" aria-live="polite">
              {phase === "listening" && <p className="companion-call-heard">{heard || "Say something…"}</p>}
              {phase === "thinking" && you && <p className="companion-call-heard">“{you}”</p>}
              {(phase === "speaking" || phase === "paused") && them && <p className="companion-call-said">{them}</p>}
            </div>
            {note && <p className="companion-call-note">{note}</p>}
            {left !== null && <p className="companion-call-left">{left === 1 ? "1 scene step left this month" : `${left} scene steps left this month`}</p>}
            <p className="companion-call-controls">
              {phase === "speaking" && (
                <button type="button" className="button-ghost" onClick={interrupt}>
                  ✋ Interrupt
                </button>
              )}
              {phase === "paused" ? (
                <button type="button" className="button" onClick={resume}>
                  🎙 Tap to talk
                </button>
              ) : (
                <button type="button" className="button-ghost" onClick={() => pause(null)} disabled={phase === "thinking"}>
                  🔇 Mute
                </button>
              )}
              <button type="button" className="button companion-call-end" onClick={() => end()} ref={endButton} data-step-in-call-end>
                End call
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
