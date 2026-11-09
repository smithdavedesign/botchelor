"use client";

import { useEffect, useRef, useState } from "react";
import Avatar from "@/app/Avatar";
import { useSpeech } from "@/app/stage/useSpeech";
import type { CompanionCharacterRef, CompanionMessageView } from "@/lib/companion-shared";

export type CallVoice = "device" | "own";

/** One turn of the call, from the chat (it owns the thread): their reply, or why there isn't one. */
export type CallTurn =
  | { ok: true; reply: CompanionMessageView[] }
  | {
      ok: false;
      /** The call can't go on (the crisis resources, no replies left, a limit): it ends, and the chat says why. */
      end: boolean;
      /** Say it another way (the PG line): it listens again at once. Otherwise it waits for a tap. */
      again: boolean;
      message: string | null;
    };

export type CallStats = { seconds: number; turns: number; voice: CallVoice };

type Phase = "ready" | "listening" | "thinking" | "speaking" | "paused";

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

/** Calls need the browser to hear you (Chrome, Edge, Safari) and to speak (all of them). */
export function callSupported(): boolean {
  return recognition() !== null && typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Remembered in this browser: how calls work was read, and which voice they pick. */
const SEEN_KEY = "bz_call_ok";
const VOICE_KEY = "bz_call_voice";
/** Nothing said for this long, and the call ends on its own. */
const QUIET_END_MS = 5 * 60_000;
/** Silences in a row before it stops listening and waits for a tap. */
const SILENCES = 3;

function stored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function store(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not remembered: it still works for this call.
  }
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

const MIC_BLOCKED =
  "Your browser didn't let the call use the microphone. Allow it for this site (on an iPhone, turn on Dictation in Settings → General → Keyboard), then tap to talk.";
const RECOGNITION_ERRORS: Record<string, string> = {
  "not-allowed": MIC_BLOCKED,
  "service-not-allowed": MIC_BLOCKED,
  "audio-capture": "No microphone was found. Plug one in or pick another, then tap to talk.",
  network: "Hearing you needs a connection, and it dropped. Tap to talk when you're back online.",
  "language-not-supported": "Your browser can't hear this language. Try another browser, or text instead.",
};

/**
 * A voice call with a companion (docs/companions.md, Calls): you talk, they talk back. The browser hears you (its own
 * speech recognition), what you said goes through the same route as a text (one reply each, the same checks, kept in
 * the thread marked 📞), and their answer is said aloud in the device's voice (free) or their own voice (voice notes).
 * One of you at a time: it doesn't listen while they talk, so it never hears them. Interrupt stops them and listens.
 * Ends when you end it, when a turn can't go on (the crisis resources, no replies left), or after five quiet minutes.
 */
export default function CompanionCall({
  character,
  left,
  voicePrice,
  onSay,
  onVoice,
  onStart,
  onEnd,
}: {
  character: CompanionCharacterRef;
  /** Free replies left (null: no limit). */
  left: number | null;
  /** What their own voice costs this person ("" when the plan or bought ones cover it); null when it isn't offered (a guest). */
  voicePrice: string | null;
  onSay: (text: string) => Promise<CallTurn>;
  /** Their reply in their own voice (a voice note): where it plays from, or why it can't. `buy`: the price was shown. */
  onVoice: (m: CompanionMessageView, buy: boolean) => Promise<{ url: string } | { message: string }>;
  onStart: (voice: CallVoice) => void;
  onEnd: (stats: CallStats, message: string | null) => void;
}) {
  const first = character.name.split(/\s+/)[0] || character.name;
  const who = { id: character.id, pronouns: character.pronouns ?? null };
  const speech = useSpeech();
  const [phase, setPhase] = useState<Phase>("ready");
  const [seen, setSeen] = useState(true);
  const [voice, setVoice] = useState<CallVoice>("device");
  const [heard, setHeard] = useState("");
  const [you, setYou] = useState<string | null>(null);
  const [them, setThem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);

  // What the callbacks below read (they outlive renders): the phase now, how the call is going, the latest props.
  const phaseNow = useRef<Phase>("ready");
  const ended = useRef(false);
  const startedAt = useRef(0);
  const lastAt = useRef(0);
  const turns = useRef(0);
  const silences = useRef(0);
  const voiceNow = useRef<CallVoice>("device");
  const paid = useRef(false);
  const rec = useRef<Recognition | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const props = useRef({ onSay, onVoice, onStart, onEnd, speech });
  props.current = { onSay, onVoice, onStart, onEnd, speech };
  const mainButton = useRef<HTMLButtonElement>(null);
  const endButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setSeen(stored(SEEN_KEY) === "1");
    const v = stored(VOICE_KEY);
    if (v === "own" && voicePrice !== null) setVoice("own");
    mainButton.current?.focus();
    // On arrival only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function go(p: Phase) {
    phaseNow.current = p;
    setPhase(p);
  }

  function stopListening() {
    const r = rec.current;
    rec.current = null;
    if (r) {
      r.onend = null;
      r.onresult = null;
      r.onerror = null;
      try {
        r.abort();
      } catch {
        // Already stopped.
      }
    }
  }

  function stopTalking() {
    props.current.speech.stop();
    const a = audio.current;
    audio.current = null;
    if (a) {
      a.pause();
      a.dispatchEvent(new Event("ended"));
    }
  }

  function end(message: string | null = null) {
    if (ended.current) return;
    ended.current = true;
    stopListening();
    stopTalking();
    const secs = startedAt.current ? Math.round((Date.now() - startedAt.current) / 1000) : 0;
    props.current.onEnd({ seconds: secs, turns: turns.current, voice: voiceNow.current }, message);
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
    r.lang = navigator.language || "en-US";
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

  /** What you said goes in, their reply comes back and is said aloud, then it listens again. */
  async function turn(text: string) {
    go("thinking");
    setYou(text);
    setHeard("");
    setNote(null);
    turns.current += 1;
    lastAt.current = Date.now();
    const r = await props.current.onSay(text);
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
    const words = r.reply.map((m) => m.text).join(" ");
    // Their own voice is made first (a voice note), so they're still thinking until it's ready.
    let url: string | null = null;
    if (voiceNow.current === "own" && r.reply[0]) {
      const v = await props.current.onVoice(r.reply[0], paid.current);
      if (ended.current) return;
      if ("url" in v) url = v.url;
      else {
        voiceNow.current = "device";
        setVoice("device");
        setNote(`${first}'s own voice stopped (${v.message.replace(/\.$/, "")}), so it's your device's voice for now.`);
      }
    }
    setThem(words);
    go("speaking");
    await (url ? play(url) : props.current.speech.speakAll(words, who));
    lastAt.current = Date.now();
    // Stopped by Interrupt: listen now. Paused or ended meanwhile: stay that way.
    if (ended.current || phaseNow.current !== "speaking") return;
    listen();
  }

  function play(url: string): Promise<void> {
    return new Promise<void>((resolve) => {
      const a = new Audio(url);
      audio.current = a;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        if (audio.current === a) audio.current = null;
        resolve();
      };
      a.addEventListener("ended", finish);
      a.addEventListener("error", finish);
      a.play().catch(finish);
    });
  }

  function start() {
    store(SEEN_KEY, "1");
    store(VOICE_KEY, voice);
    voiceNow.current = voice;
    paid.current = voice === "own" && voicePrice !== "";
    // A tap: browsers that speak only after one (Safari) can speak for the rest of the call.
    props.current.speech.unlock();
    startedAt.current = Date.now();
    lastAt.current = Date.now();
    props.current.onStart(voice);
    listen();
  }

  function resume() {
    silences.current = 0;
    lastAt.current = Date.now();
    setNote(null);
    listen();
  }

  function interrupt() {
    // turn() sees it's still "speaking" when the voice stops, and listens.
    stopTalking();
  }

  // Once it's started, the keyboard is on End call (the button that started it has gone).
  useEffect(() => {
    if (phase !== "ready") endButton.current?.focus();
  }, [phase === "ready"]);

  // The clock, and the call ends after five quiet minutes.
  useEffect(() => {
    if (phase === "ready") return;
    const t = setInterval(() => {
      if (ended.current) return;
      setSeconds(Math.round((Date.now() - startedAt.current) / 1000));
      if (Date.now() - lastAt.current > QUIET_END_MS && phaseNow.current !== "thinking" && phaseNow.current !== "speaking") {
        end(`The call with ${first} ended after five quiet minutes.`);
      }
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase === "ready"]);

  // Away from the tab: it stops listening and talking until you're back and tap.
  useEffect(() => {
    const away = () => {
      if (document.visibilityState === "hidden" && (phaseNow.current === "listening" || phaseNow.current === "speaking")) pause("Paused while you were away.");
    };
    document.addEventListener("visibilitychange", away);
    return () => document.removeEventListener("visibilitychange", away);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Leaving the page ends the call.
  useEffect(
    () => () => {
      if (!ended.current && startedAt.current) end();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const status =
    phase === "listening"
      ? "Listening…"
      : phase === "thinking"
        ? `${first} is thinking…`
        : phase === "speaking"
          ? `${first} is talking`
          : phase === "paused"
            ? "Paused"
            : `Call ${first}`;

  return (
    <div
      className={`companion-call is-${phase}`}
      role="dialog"
      aria-modal="true"
      aria-label={`Call with ${first}`}
      onKeyDown={(e) => {
        if (e.key === "Escape") phase === "ready" ? props.current.onEnd({ seconds: 0, turns: 0, voice }, null) : end();
      }}
    >
      <div className="companion-call-inner">
        <p className="companion-call-top">
          <span className="chip companion-ai">🤖 AI character</span>
          {phase !== "ready" && <span className="companion-call-clock">{clock(seconds)}</span>}
        </p>
        <div className="companion-call-face">
          <Avatar seed={character.id} name={character.name} hue={character.hue} house={character.house} portraitSrc={character.portrait} size={136} round />
        </div>
        <h2 className="companion-call-name">{character.name}</h2>
        <p className="companion-call-status" role="status">
          {status}
        </p>

        {phase === "ready" ? (
          <div className="companion-call-ready">
            {voicePrice !== null && (
              <fieldset className="companion-call-voices">
                <legend>Their voice</legend>
                <label className="check">
                  <input type="radio" name="call-voice" checked={voice === "device"} onChange={() => setVoice("device")} />
                  <span>Your device&apos;s voice · free</span>
                </label>
                <label className="check">
                  <input type="radio" name="call-voice" checked={voice === "own"} onChange={() => setVoice("own")} />
                  <span>
                    {first}&apos;s own voice · {voicePrice || "from your voice notes"}
                    <span className="muted small"> (a moment slower each time)</span>
                  </span>
                </label>
              </fieldset>
            )}
            <details className="companion-call-how" open={!seen}>
              <summary>How calls work</summary>
              <p>
                You talk, {first} talks back. Your browser turns what you say into words (Chrome sends your voice to Google to do it, Safari to Apple),
                and only the words come to Botchelor, kept in this conversation like messages. {first} is an AI character, and the voice is made, never
                a real person&apos;s.
              </p>
              <p>Each time {first} answers counts as one reply, the same as a text.{left !== null ? ` You have ${left} left.` : ""}</p>
            </details>
            <p className="companion-call-controls">
              <button type="button" className="button companion-call-go" onClick={start} ref={mainButton} data-track="companion-call-start">
                📞 Call {first}
              </button>
              <button type="button" className="button-ghost" onClick={() => props.current.onEnd({ seconds: 0, turns: 0, voice }, null)}>
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
            {left !== null && <p className="companion-call-left">{left === 1 ? "1 reply left" : `${left} replies left`}</p>}
            <p className="companion-call-controls">
              {phase === "speaking" && (
                <button type="button" className="button-ghost" onClick={interrupt} data-track="companion-call-interrupt">
                  ✋ Interrupt
                </button>
              )}
              {phase === "paused" ? (
                <button type="button" className="button" onClick={resume} ref={mainButton} data-track="companion-call-resume">
                  🎙 Tap to talk
                </button>
              ) : (
                <button type="button" className="button-ghost" onClick={() => pause(null)} disabled={phase === "thinking"}>
                  🔇 Mute
                </button>
              )}
              <button type="button" className="button companion-call-end" onClick={() => end()} ref={endButton} data-track="companion-call-end">
                End call
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
