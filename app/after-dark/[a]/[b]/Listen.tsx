"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { requestJson } from "@/app/request";
import type { SceneLine } from "@/lib/adult/scenes";
import type { LineVoice } from "@/lib/adult/voice-lines";

const mediaUrl = (id: string) => `/api/admin/after-dark/media/${id}`;
/** A line that's only an action (no voice) still takes this long, so it's seen. */
const SILENT_MS = 700;
/** The theater waits this long for a line's voice to come, at most; then the next line comes anyway. */
const WAIT_FOR_VOICE_MS = 8000;

/**
 * The voices of a night's lines (lib/adult/voice-lines.ts), asked for as they're about to play: the line and the next two
 * in one request, and remembered for the page's life (the server keeps them too, so a replay costs nothing).
 */
function useVoices(a: string, b: string, nightId: string | null) {
  const cache = useRef(new Map<string, Promise<LineVoice>>());
  useEffect(() => {
    cache.current = new Map();
  }, [a, b, nightId]);
  return useCallback(
    (lines: readonly SceneLine[], i: number): Promise<LineVoice> => {
      const keyOf = (j: number) => `${nightId ?? ""}\n${j}\n${lines[j]?.text ?? ""}`;
      const have = cache.current.get(keyOf(i));
      if (have) return have;
      const batch = [i, i + 1, i + 2].filter((j) => j < lines.length && !cache.current.has(keyOf(j)));
      const asked = requestJson("/api/admin/after-dark/voice", { a, b, night_id: nightId, lines: batch.map((j) => ({ i: j, text: lines[j].text })) })
        .then((res) => (res.ok ? ((res.data.voices as LineVoice[] | undefined) ?? []) : []))
        .catch(() => [] as LineVoice[]);
      for (const j of batch) cache.current.set(keyOf(j), asked.then((vs) => vs.find((v) => v.i === j) ?? { i: j, id: null, reason: "failed" as const }));
      return cache.current.get(keyOf(i))!;
    },
    [a, b, nightId],
  );
}

/**
 * 🔈 Listen in the theater (David, 2026-10-22: voiced nights): each line, as it comes on stage, said in its character's
 * stock voice. While it's being said the theater holds the next line (useReplay's `hold`, through `onHold`), and it comes
 * a beat after; pausing the theater pauses the voice. A jump (⏭ catch up) isn't read out.
 */
export function TheaterListen({
  lines,
  shown,
  playing,
  a,
  b,
  nightId,
  onHold,
}: {
  lines: readonly SceneLine[];
  /** How many lines the stage has shown so far. */
  shown: number;
  playing: boolean;
  a: string;
  b: string;
  /** A saved night's id; null for the running scene. */
  nightId: string | null;
  onHold: (hold: boolean) => void;
}) {
  const voiceOf = useVoices(a, b, nightId);
  const [on, setOn] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const onRef = useRef(on);
  onRef.current = on;
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const audio = useRef<HTMLAudioElement | null>(null);
  const saying = useRef(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const release = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    onHold(false);
  }, [onHold]);
  const holdFor = useCallback(
    (ms: number) => {
      if (timer.current) clearTimeout(timer.current);
      onHold(true);
      timer.current = setTimeout(release, ms);
    },
    [onHold, release],
  );

  const say = useCallback(
    async (i: number) => {
      saying.current = i;
      holdFor(WAIT_FOR_VOICE_MS);
      const v = await voiceOf(linesRef.current, i);
      if (saying.current !== i || !onRef.current) return;
      // The next one, ready when it's due.
      if (i + 1 < linesRef.current.length) void voiceOf(linesRef.current, i + 1);
      if (v.reason === "cap") {
        setNote(v.message ?? "This month's voiced lines are used up.");
        setOn(false);
        return release();
      }
      if (!v.id) return release();
      const el = (audio.current ??= new Audio());
      el.onloadedmetadata = () => saying.current === i && Number.isFinite(el.duration) && holdFor(el.duration * 1000 + 1500);
      el.onended = () => saying.current === i && release();
      el.onerror = () => saying.current === i && release();
      el.src = mediaUrl(v.id);
      await el.play().catch(() => release());
    },
    [voiceOf, holdFor, release],
  );

  // Each new line on stage, said as it comes on; back to the top, quiet.
  const before = useRef(shown);
  useEffect(() => {
    const was = before.current;
    before.current = shown;
    if (!on) return;
    if (shown < was) {
      saying.current = -1;
      audio.current?.pause();
      release();
    } else if (shown === was + 1 && shown > 0) void say(shown - 1);
  }, [shown, on, say, release]);

  // Paused with the theater, and on again with it.
  useEffect(() => {
    const el = audio.current;
    if (!el || !on) return;
    if (!playing && !el.paused) el.pause();
    else if (playing && el.paused && !el.ended && el.currentTime > 0) void el.play().catch(() => {});
  }, [playing, on]);

  // Leaving the theater: quiet, and nothing held.
  useEffect(
    () => () => {
      audio.current?.pause();
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function toggle() {
    if (on) {
      saying.current = -1;
      audio.current?.pause();
      release();
      setOn(false);
      return;
    }
    setNote(null);
    setOn(true);
    onRef.current = true;
    // The line on stage now, so it's heard at once.
    if (shown > 0) void say(shown - 1);
  }

  return (
    <button
      type="button"
      className={`theater-icon${on ? " on" : ""}`}
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? "Stop listening" : "Listen: each line in their own voice"}
      title={note ?? (on ? "Listening: each line in their own voice (tap to stop)" : "Listen: each line in their own voice")}
    >
      {note ? "🔇" : on ? "🔊" : "🔈"}
    </button>
  );
}

/**
 * 🔈 Listen on the page: the scene's lines read aloud in their stock voices, from the newest step on, and each new step as
 * it's written. ⏮ reads from the top; with it on, tapping a line reads from there. The line being said is marked.
 */
export default function ListenLines({ lines, a, b, names }: { lines: SceneLine[]; a: string; b: string; names: [string, string] }) {
  const voiceOf = useVoices(a, b, null);
  const [on, setOn] = useState(false);
  const [at, setAt] = useState<number | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const onRef = useRef(on);
  onRef.current = on;
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const next = useRef(0);
  const running = useRef(false);
  const wake = useRef<(() => void) | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const bar = useRef<HTMLDivElement>(null);

  /** Stops what's being said now (the loop carries on from `next`, or ends when it's off). */
  const interrupt = useCallback(() => {
    audio.current?.pause();
    wake.current?.();
  }, []);

  // Reads from `next` to the end of what's written, a line at a time.
  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    while (onRef.current && next.current < linesRef.current.length) {
      const i = next.current;
      setAt(i);
      const v = await voiceOf(linesRef.current, i);
      if (!onRef.current) break;
      if (next.current !== i) continue;
      if (v.reason === "cap") {
        setNote(v.message ?? "This month's voiced lines are used up.");
        setOn(false);
        break;
      }
      // The next one, ready when it's due.
      if (i + 1 < linesRef.current.length) void voiceOf(linesRef.current, i + 1);
      await new Promise<void>((done) => {
        wake.current = done;
        if (!v.id) return void setTimeout(done, SILENT_MS);
        const el = (audio.current ??= new Audio());
        el.onended = () => done();
        el.onerror = () => done();
        el.src = mediaUrl(v.id);
        el.play().catch(() => done());
      });
      wake.current = null;
      if (next.current === i) next.current = i + 1;
    }
    running.current = false;
    setAt(null);
  }, [voiceOf]);

  // New lines while it's on are read in turn. Lines taken back (a rewind) stop it where they now end; a new chapter, or
  // Start over (a different first line), starts it at the top of what's there.
  const first = useRef(lines[0]?.text ?? null);
  useEffect(() => {
    const top = lines[0]?.text ?? null;
    if (top !== first.current) {
      first.current = top;
      next.current = 0;
      interrupt();
    } else if (next.current > lines.length) {
      next.current = lines.length;
      interrupt();
    }
    if (on) void run();
  }, [lines, on, run, interrupt]);

  // With it on, tapping a line reads from there.
  useEffect(() => {
    const list = bar.current?.nextElementSibling;
    if (!on || !(list instanceof HTMLOListElement)) return;
    const onClick = (e: MouseEvent) => {
      const li = (e.target as HTMLElement).closest("li");
      if (!li || li.parentElement !== list) return;
      next.current = Array.prototype.indexOf.call(list.children, li);
      interrupt();
      void run();
    };
    list.addEventListener("click", onClick);
    return () => list.removeEventListener("click", onClick);
  }, [on, run, interrupt, lines.length]);

  // The line being said, kept in view.
  useEffect(() => {
    if (at === null) return;
    const li = bar.current?.nextElementSibling?.children[at] as HTMLElement | undefined;
    li?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [at]);

  // Gone: quiet.
  useEffect(() => () => audio.current?.pause(), []);

  function start(from: number) {
    setNote(null);
    next.current = Math.max(0, Math.min(from, linesRef.current.length));
    interrupt();
    setOn(true);
    onRef.current = true;
    void run();
  }
  function stop() {
    setOn(false);
    onRef.current = false;
    interrupt();
  }

  if (!lines.length) return <div ref={bar} hidden />;
  const who = at !== null ? names[lines[at]?.who === "b" ? 1 : 0] : null;
  return (
    <div ref={bar} className="ad-listen" role="group" aria-label="Listen to the lines">
      {/* The line being said, marked; with it on, every line can be tapped to read from there. */}
      {on && (
        <style>{`.after-dark-lines > li { cursor: pointer; }${at !== null ? ` .after-dark-lines > li:nth-child(${at + 1}) { box-shadow: inset 3px 0 0 #c9a2ff; background: rgba(201, 162, 255, 0.1); border-radius: 0.5rem; }` : ""}`}</style>
      )}
      <button type="button" className={`ad-chip${on ? " on" : ""}`} aria-pressed={on} onClick={() => (on ? stop() : start(Math.max(0, lines.length - 6)))}>
        {on ? "🔊 Listening" : "🔈 Listen"}
      </button>{" "}
      <button type="button" className="ad-chip" onClick={() => start(0)} title="Read the chapter from its first line">
        ⏮ From the top
      </button>{" "}
      <span className="muted small ad-listen-status" role="status">
        {note ?? (on && who !== null && at !== null ? `${who}, line ${at + 1} of ${lines.length}. Tap a line to read from there.` : on ? "New lines are read as they're written." : "Each line in their own voice.")}
      </span>
    </div>
  );
}
