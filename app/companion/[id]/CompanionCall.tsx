"use client";

import { useEffect, useRef, useState } from "react";
import Avatar from "@/app/Avatar";
import { useSpeech } from "@/app/stage/useSpeech";
import { extraPrice, type CompanionCharacterRef, type CompanionExtraState, type CompanionMessageView } from "@/lib/companion-shared";
import { heardSoFar, LIVE_START, liveStep, type Heard, type LiveEvent, type LiveState } from "@/lib/companion-live-shared";
import { sseData } from "@/lib/sse";
import { TRANSCRIPT_START, transcriptStep, type Transcript, type TranscriptEvent } from "@/lib/companion-call-transcript";
import CallTranscript from "./CallTranscript";
import { listen as listenLive, liveSupported, Mic, newAudioContext, PcmPlayer, type Listening } from "./live-audio";

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

type Phase = "ready" | "connecting" | "listening" | "thinking" | "speaking" | "paused";

/** How the call goes: live (P6: Deepgram hears you as you talk, either of you can talk over the other) or taking turns (v1). */
export type CallMode = "live" | "classic";

/** Live calls (P6), when they're on for this person: the route, and where they stand on call minutes. */
export type LiveOffer = { url: string; minutes: CompanionExtraState | null };

/** Their call minutes, in words: free (an admin), what's left, or the price of the next ten. */
export function minutesWords(s: CompanionExtraState | null | undefined): string {
  if (!s || s.free) return "free for you";
  if ((s.included_left ?? 0) > 0) return `${s.included_left} minute${s.included_left === 1 ? "" : "s"} left this month with the plan`;
  if (s.credits > 0) return `${s.credits} minute${s.credits === 1 ? "" : "s"} left`;
  return extraPrice("minute", s);
}

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

/** A live call needs only a microphone, Web Audio and a socket (./live-audio.ts), so Firefox can call live too. */
export { liveSupported };

/** Remembered in this browser: how calls work was read, and which voice they pick. */
const SEEN_KEY = "bz_call_ok";
const VOICE_KEY = "bz_call_voice";
const MODE_KEY = "bz_call_mode";
/** The 💬 Transcript open or closed, remembered on this device (closed until it's opened once). */
const SCRIPT_KEY = "bz_call_transcript";
const SCRIPT_ID = "companion-call-transcript";
/** On a live call, a minute with nobody talking pauses it, so the quiet isn't paid for. */
const LIVE_QUIET_MS = 60_000;
/** How often a live call's started minutes are taken (the server counts from the start either way). */
const TICK_MS = 30_000;
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
 * 💬 Transcript opens what's been said so far on this call (./CallTranscript.tsx), held only in the page.
 */
export default function CompanionCall({
  character,
  left,
  voicePrice,
  onSay,
  onVoice,
  onStart,
  onEnd,
  live = null,
  onRefused,
  onKept,
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
  /** Live calls (P6), when they're on for this person; null: a call takes turns (v1), exactly as before. */
  live?: LiveOffer | null;
  /** A live turn that was refused (the chat takes the crisis resources from it): what the call does next. */
  onRefused?: (status: number, data: Record<string, unknown> | null) => Extract<CallTurn, { ok: false }>;
  /** A live turn was kept: the chat shows it. */
  onKept?: () => void;
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
  const canLive = live !== null && liveSupported();
  // Live first where it's on, unless they picked taking turns last time. Read as it opens (the call screen only ever
  // renders in the browser, after a tap), so the first thing on screen is already the right choice.
  const [mode, setMode] = useState<CallMode>(() => (canLive && stored(MODE_KEY) !== "classic" ? "live" : "classic"));
  const [minutes, setMinutes] = useState<CompanionExtraState | null>(live?.minutes ?? null);
  // Paused because the call minutes ran out: the button to go on shows the price.
  const [buyOffer, setBuyOffer] = useState(false);
  // What's been said on this call (lib/companion-call-transcript.ts), and whether the 💬 Transcript is open.
  const [script, setScript] = useState<Transcript>(TRANSCRIPT_START);
  const [showScript, setShowScript] = useState(false);

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
  const props = useRef({ onSay, onVoice, onStart, onEnd, speech, onRefused, onKept, live });
  props.current = { onSay, onVoice, onStart, onEnd, speech, onRefused, onKept, live };
  // A live call's parts (P6): which way the call goes now, the server's call, the microphone, Deepgram's socket, their
  // voice, the turn-taking state, and the turn in flight (a barge-in drops it).
  const modeNow = useRef<CallMode>("classic");
  const callId = useRef<string | null>(null);
  const segmentAt = useRef(0);
  const ctx = useRef<AudioContext | null>(null);
  const mic = useRef<Mic | null>(null);
  const socket = useRef<Listening | null>(null);
  const player = useRef<PcmPlayer | null>(null);
  const liveState = useRef<LiveState>(LIVE_START);
  const turnSeq = useRef(0);
  const turnAbort = useRef<AbortController | null>(null);
  const heardAt = useRef(0);
  const lastTick = useRef(0);
  const firstAudio = useRef<number[]>([]);
  const bargeIns = useRef(0);
  const voiceOff = useRef(false);
  const minutesNow = useRef<CompanionExtraState | null>(live?.minutes ?? null);
  const mainButton = useRef<HTMLButtonElement>(null);
  const endButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setSeen(stored(SEEN_KEY) === "1");
    const v = stored(VOICE_KEY);
    if (v === "own" && voicePrice !== null) setVoice("own");
    setShowScript(stored(SCRIPT_KEY) === "1");
    mainButton.current?.focus();
    // On arrival only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function go(p: Phase) {
    phaseNow.current = p;
    setPhase(p);
  }

  /** A step of the transcript: only ever kept in the page for this call. */
  function log(e: TranscriptEvent) {
    setScript((s) => transcriptStep(s, e));
  }

  /** What's heard of your turn so far: on the call screen, and muted at the end of the transcript. */
  function hear(text: string) {
    setHeard(text);
    log({ kind: "heard", text });
  }

  function toggleScript() {
    const open = !showScript;
    setShowScript(open);
    store(SCRIPT_KEY, open ? "1" : "0");
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
    stopReply();
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
    log({ kind: "cut" });
    stopListening();
    stopTalking();
    closeLive();
    void ctx.current?.close().catch(() => {});
    const secs = startedAt.current ? Math.round((Date.now() - startedAt.current) / 1000) : 0;
    props.current.onEnd({ seconds: secs, turns: turns.current, voice: voiceNow.current }, message);
  }

  /**
   * Stops listening (or talking) and waits for a tap, saying why when there's a reason. A live call hangs up its line
   * too (nothing's heard or paid for while paused); `buy`: it paused because the call minutes ran out.
   */
  function pause(why: string | null, buy = false) {
    go("paused");
    // Their reply stops here, so whatever of it was still to come is cut off.
    log({ kind: "cut" });
    stopListening();
    stopTalking();
    closeLive();
    hear("");
    setNote(why);
    setBuyOffer(buy);
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
      hear(`${said} ${interim}`.trim());
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
    log({ kind: "you", text });
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
    log({ kind: "reply", text: words });
    go("speaking");
    await (url ? play(url) : props.current.speech.speakAll(words, who));
    // Said to the end (stopped by Interrupt, a pause or the end, it was already marked cut off).
    log({ kind: "done" });
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
    if (canLive) store(MODE_KEY, mode);
    if (canLive && mode === "live") {
      modeNow.current = "live";
      // From the tap, so the browser lets it play their voice (Safari) and speak if it must fall back.
      ctx.current = newAudioContext();
      props.current.speech.unlock();
      startedAt.current = Date.now();
      lastAt.current = Date.now();
      // `buy` only when the button showed the price.
      void liveBegin(extraPrice("minute", minutesNow.current) !== "");
      return;
    }
    classicStart();
  }

  /** Taking turns (v1): the browser hears a phrase, it goes in as a message, their answer is said. */
  function classicStart() {
    modeNow.current = "classic";
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
    if (modeNow.current === "live") {
      const priced = extraPrice("minute", minutesNow.current) !== "";
      setBuyOffer(false);
      void liveBegin(priced);
      return;
    }
    listen();
  }

  function interrupt() {
    log({ kind: "cut" });
    if (modeNow.current === "live") {
      const { state, effects } = liveStep(liveState.current, { kind: "interrupt" });
      liveState.current = state;
      if (effects.length) bargeIns.current += 1;
      stopReply();
      props.current.speech.stop();
      lastAt.current = Date.now();
      heardAt.current = Date.now();
      go("listening");
      return;
    }
    // turn() sees it's still "speaking" when the voice stops, and listens.
    stopTalking();
  }

  /* ------------------------------------------------ live (P6) ------------------------------------------------ */

  type LivePost = { status: number; data: (Record<string, unknown> & { message?: string; extras?: Record<string, CompanionExtraState> | null }) | null };

  async function livePost(body: Record<string, unknown>, keepalive = false): Promise<LivePost> {
    const url = props.current.live?.url;
    if (!url) return { status: 0, data: null };
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), keepalive });
      const data = (await res.json().catch(() => null)) as LivePost["data"];
      const m = data?.extras?.minute;
      if (m) {
        minutesNow.current = m;
        setMinutes(m);
      }
      return { status: res.status, data };
    } catch {
      return { status: 0, data: null };
    }
  }

  /** Starts (or, after a pause, starts again) the live line: a minute taken, a token, the microphone and the socket. */
  async function liveBegin(buy: boolean) {
    go("connecting");
    hear("");
    const r = await livePost({ action: "start", buy, lang: navigator.language });
    const call = r.data?.call as { id?: string } | undefined;
    if (ended.current || (phaseNow.current as Phase) !== "connecting") {
      // Ended or paused while it connected: hang up the call that just started (a quick one gives its minute back).
      if (call?.id) void livePost({ action: "end", call_id: call.id, seconds: 0 }, true);
      return;
    }
    const stt = r.data?.stt as { url?: string; token?: string } | undefined;
    if (r.status === 200 && call?.id && stt?.url && stt.token) {
      callId.current = call.id;
      segmentAt.current = Date.now();
      lastTick.current = Date.now();
      return liveOpen(stt.url, stt.token);
    }
    const message = typeof r.data?.message === "string" ? r.data.message : null;
    if (r.status === 402) return pause(message, true);
    if (r.status === 401 || r.status === 409 || r.status === 429) return end(message);
    // Off, down or unreachable: the free way, if this browser can hear.
    return classicInstead("Live calls aren't working right now");
  }

  async function liveOpen(url: string, token: string) {
    const audio = ctx.current;
    if (!audio) return classicInstead("This browser can't play a live call");
    player.current ??= new PcmPlayer(audio);
    try {
      mic.current?.stop();
      mic.current = new Mic();
      await mic.current.start(audio, (pcm) => socket.current?.send(pcm));
    } catch {
      return pause(MIC_BLOCKED);
    }
    if (ended.current || phaseNow.current !== "connecting") return closeLive();
    try {
      socket.current = await listenLive(url, token, { heard: onHeard, closed: () => void reconnect() });
    } catch {
      closeLive();
      return classicInstead("The live line didn't connect");
    }
    if (ended.current || phaseNow.current !== "connecting") return closeLive();
    liveState.current = LIVE_START;
    heardAt.current = Date.now();
    go("listening");
  }

  /** The socket dropped mid-call: a fresh token and it opens again, or it pauses. */
  async function reconnect() {
    socket.current = null;
    if (ended.current || !callId.current || phaseNow.current === "paused") return;
    const r = await livePost({ action: "token", call_id: callId.current, lang: navigator.language });
    const stt = r.data?.stt as { url?: string; token?: string } | undefined;
    if (ended.current || (phaseNow.current as Phase) === "paused") return;
    if (r.status === 402) return pause(typeof r.data?.message === "string" ? r.data.message : null, true);
    if (r.status !== 200 || !stt?.url || !stt.token) return pause("The connection dropped. Tap to talk to try again.");
    try {
      socket.current = await listenLive(stt.url, stt.token, { heard: onHeard, closed: () => void reconnect() });
    } catch {
      pause("The connection dropped. Tap to talk to try again.");
    }
  }

  /** Hangs up the live line: the socket, the microphone, the reply in flight, and the server's call (its minutes settle). */
  function closeLive() {
    socket.current?.close();
    socket.current = null;
    mic.current?.stop();
    mic.current = null;
    stopReply();
    const id = callId.current;
    callId.current = null;
    if (!id) return;
    const sorted = [...firstAudio.current].sort((a, b) => a - b);
    void livePost(
      {
        action: "end",
        call_id: id,
        seconds: Math.round((Date.now() - segmentAt.current) / 1000),
        first_audio_ms: sorted.length ? Math.round(sorted[Math.floor(sorted.length / 2)]) : undefined,
        barge_ins: bargeIns.current,
        voice_off: voiceOff.current || undefined,
      },
      true,
    );
  }

  /** Their voice stops and the reply in flight is dropped (a barge-in, Interrupt, a pause). */
  function stopReply() {
    turnSeq.current += 1;
    turnAbort.current?.abort();
    turnAbort.current = null;
    player.current?.stop();
  }

  function classicInstead(why: string) {
    closeLive();
    if (!callSupported()) return end(`${why}, and this browser can't take turns either. Try Chrome, Edge or Safari, or text instead.`);
    modeNow.current = "classic";
    setMode("classic");
    setNote(`${why}, so this call takes turns.`);
    voiceNow.current = "device";
    setVoice("device");
    props.current.onStart("device");
    listen();
  }

  /** What Deepgram heard: the turn-taking (lib/companion-live-shared.ts liveStep) decides what it means. */
  function onHeard(e: Heard) {
    if (ended.current || modeNow.current !== "live") return;
    const p = phaseNow.current;
    if (p !== "listening" && p !== "thinking" && p !== "speaking") return;
    if (e.kind === "words" && e.text.trim()) heardAt.current = Date.now();
    const { state, effects } = liveStep(liveState.current, e);
    liveState.current = state;
    for (const fx of effects) {
      if (fx.kind === "barge_in") {
        log({ kind: "cut" });
        bargeIns.current += 1;
        stopReply();
        props.current.speech.stop();
        go("listening");
      } else void liveTurn(fx.text);
    }
    // After a barge-in's cut, so what they've started saying follows the reply it cut off.
    if (state.phase === "listening") hear(heardSoFar(state));
  }

  /** What they said goes in; the reply streams back, shown and said piece by piece as it comes; then the floor is theirs. */
  async function liveTurn(text: string) {
    const url = props.current.live?.url;
    const id = callId.current;
    if (!url || !id) return;
    stopReply();
    const mine = turnSeq.current;
    const abort = new AbortController();
    turnAbort.current = abort;
    go("thinking");
    setYou(text);
    log({ kind: "you", text });
    setHeard("");
    setThem(null);
    setNote(null);
    turns.current += 1;
    lastAt.current = Date.now();
    const sentAt = performance.now();
    const current = () => mine === turnSeq.current && !ended.current;
    let res: Response;
    try {
      res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "turn", call_id: id, text }), signal: abort.signal });
    } catch {
      if (current()) pause("The connection dropped. Tap to talk to try again.");
      return;
    }
    if (!current()) return;
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("event-stream") || !res.body) {
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!current()) return;
      return refused(res.status, data);
    }
    let said = "";
    const texts: string[] = [];
    const voiced = new Set<number>();
    let device: Promise<void> = Promise.resolve();
    let failed: { status: number; data: Record<string, unknown> } | null = null;
    const begin = () => {
      if (phaseNow.current === "speaking") return;
      firstAudio.current.push(performance.now() - sentAt);
      liveState.current = liveStep(liveState.current, { kind: "reply_started" }).state;
      go("speaking");
    };
    const sayOnDevice = (t: string) => {
      begin();
      device = device.then(() => (current() ? props.current.speech.speakAll(t, who) : undefined));
    };
    try {
      for await (const raw of sseData(res.body)) {
        if (!current()) break;
        let ev: LiveEvent;
        try {
          ev = JSON.parse(raw) as LiveEvent;
        } catch {
          continue;
        }
        if (ev.type === "say") {
          texts[ev.i] = ev.text;
          said = `${said} ${ev.text}`.trim();
          setThem(said);
          log({ kind: "piece", text: ev.text });
          liveState.current = liveStep(liveState.current, { kind: "reply_text", text: ev.text }).state;
          if (voiceOff.current) sayOnDevice(ev.text);
        } else if (ev.type === "audio") {
          if (!voiceOff.current && player.current) {
            begin();
            player.current.push(ev.pcm, ev.rate);
          }
        } else if (ev.type === "audio_end") {
          voiced.add(ev.i);
        } else if (ev.type === "voice_off") {
          voiceOff.current = true;
          setNote(`${first}'s voice dropped out, so it's your device's voice for now.`);
          texts.forEach((t, i) => {
            if (t && !voiced.has(i)) sayOnDevice(t);
          });
        } else if (ev.type === "done") {
          props.current.onKept?.();
        } else if (ev.type === "fail") {
          failed = { status: ev.status, data: { error: ev.error, message: ev.message } };
        }
      }
    } catch {
      // Dropped (a barge-in aborts it): nothing more to say.
    }
    if (!current()) return;
    if (failed) {
      log({ kind: "done" });
      return refused(failed.status, failed.data);
    }
    await Promise.all([player.current?.idle(), device]);
    if (!current() || phaseNow.current === "paused") return;
    liveState.current = liveStep(liveState.current, { kind: "reply_done" }).state;
    log({ kind: "done" });
    lastAt.current = Date.now();
    heardAt.current = Date.now();
    go("listening");
  }

  /** A turn that didn't get a reply: the minutes ran out (pause and show the price), or what the chat says it means. */
  function refused(status: number, data: Record<string, unknown> | null) {
    const message = typeof data?.message === "string" ? data.message : null;
    if (status === 402 && data && "price" in data) return pause(message, true);
    const o = props.current.onRefused?.(status, data) ?? { ok: false as const, end: false, again: false, message };
    if (o.end) return end(o.message);
    if (o.again) {
      setNote(o.message);
      liveState.current = LIVE_START;
      go("listening");
      return;
    }
    pause(o.message);
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
        return;
      }
      if (modeNow.current !== "live" || !callId.current) return;
      if (phaseNow.current === "listening" && !liveState.current.said && !liveState.current.interim && Date.now() - Math.max(heardAt.current, lastAt.current) > LIVE_QUIET_MS) {
        pause("Paused after a quiet minute, so it isn't using your call minutes.");
        return;
      }
      if (Date.now() - lastTick.current >= TICK_MS) {
        lastTick.current = Date.now();
        const id = callId.current;
        void livePost({ action: "tick", call_id: id }).then((r) => {
          if (r.status === 402 && callId.current === id && !ended.current) pause(typeof r.data?.message === "string" ? r.data.message : null, true);
        });
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

  // Once the call is on: before it, there's nothing said to show.
  const scriptOpen = showScript && phase !== "ready";

  const status =
    phase === "connecting"
      ? "Connecting…"
      : phase === "listening"
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
      className={`companion-call is-${phase}${scriptOpen ? " has-script" : ""}`}
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
          {phase !== "ready" && modeNow.current === "live" && <span className="chip companion-call-live">Live</span>}
          {phase !== "ready" && <span className="companion-call-clock">{clock(seconds)}</span>}
        </p>
        <div className="companion-call-face">
          <Avatar seed={character.id} name={character.name} hue={character.hue} house={character.house} portraitSrc={character.portrait} size={scriptOpen ? 72 : 136} round />
        </div>
        <h2 className="companion-call-name">{character.name}</h2>
        <p className="companion-call-status" role="status">
          {status}
        </p>

        {phase === "ready" ? (
          <div className="companion-call-ready">
            {canLive && (
              <fieldset className="companion-call-voices companion-call-modes">
                <legend>How to talk</legend>
                <label className="check">
                  <input type="radio" name="call-mode" checked={mode === "live"} onChange={() => setMode("live")} />
                  <span>
                    Live · {minutesWords(minutes)}
                    <span className="muted small"> (talk over each other, {first}&apos;s own voice)</span>
                  </span>
                </label>
                <label className="check">
                  <input type="radio" name="call-mode" checked={mode === "classic"} onChange={() => setMode("classic")} />
                  <span>Taking turns · free</span>
                </label>
              </fieldset>
            )}
            {voicePrice !== null && !(canLive && mode === "live") && (
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
              {canLive && mode === "live" ? (
                <>
                  <p>
                    A live call is like a phone call: talk whenever you like, and if you start talking while {first} is, {first} stops to listen. Your voice
                    goes from your browser to Deepgram, which turns it into words as you speak and keeps nothing; only the words come to Botchelor, kept in
                    this conversation like messages. {first} is an AI character, and the voice is made by Deepgram from {first}&apos;s words, never a real
                    person&apos;s.
                  </p>
                  <p>
                    It&apos;s by the minute: each minute on the line is a call minute ({minutesWords(minutes)}), and a quiet minute pauses it so silence
                    isn&apos;t paid for.
                  </p>
                </>
              ) : (
                <p>
                  You talk, {first} talks back. Your browser turns what you say into words (Chrome sends your voice to Google to do it, Safari to Apple),
                  and only the words come to Botchelor, kept in this conversation like messages. {first} is an AI character, and the voice is made, never
                  a real person&apos;s.
                </p>
              )}
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
            {scriptOpen ? (
              <CallTranscript id={SCRIPT_ID} script={script} name={first} />
            ) : (
              <div className="companion-call-words" aria-live="polite">
                {phase === "listening" && <p className="companion-call-heard">{heard || "Say something…"}</p>}
                {phase === "thinking" && you && <p className="companion-call-heard">“{you}”</p>}
                {(phase === "speaking" || phase === "paused") && them && <p className="companion-call-said">{them}</p>}
              </div>
            )}
            {note && <p className="companion-call-note">{note}</p>}
            {left !== null && <p className="companion-call-left">{left === 1 ? "1 reply left" : `${left} replies left`}</p>}
            <p className="companion-call-controls">
              <button
                type="button"
                className="button-ghost companion-call-script-toggle"
                onClick={toggleScript}
                aria-expanded={showScript}
                aria-controls={showScript ? SCRIPT_ID : undefined}
                data-track="companion-call-transcript"
              >
                💬 Transcript
              </button>
              {phase === "speaking" && (
                <button type="button" className="button-ghost" onClick={interrupt} data-track="companion-call-interrupt">
                  ✋ Interrupt
                </button>
              )}
              {phase === "paused" ? (
                <button type="button" className="button" onClick={resume} ref={mainButton} data-track="companion-call-resume">
                  {modeNow.current === "live" && extraPrice("minute", minutes) !== "" ? `🎙 ${buyOffer ? "Keep talking" : "Tap to talk"} · ${extraPrice("minute", minutes)}` : "🎙 Tap to talk"}
                </button>
              ) : (
                <button type="button" className="button-ghost" onClick={() => pause(null)} disabled={phase === "thinking" || phase === "connecting"}>
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
