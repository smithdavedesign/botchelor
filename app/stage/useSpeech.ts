"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Remembered in this browser: whether lines are read aloud. */
const KEY = "bz_read_aloud";

// The device's voices say nothing of who they sound like but their names: the common ones, by platform.
const FEMALE = /\b(samantha|karen|moira|tessa|fiona|victoria|allison|ava|susan|zira|aria|jenny|serena|kate|veena|nicky|joanna|salli|kimberly|emma|amy|libby|sonia|natasha|female)\b/i;
const MALE = /\b(daniel|alex|fred|tom|rishi|oliver|guy|david|mark|aaron|arthur|gordon|reed|eddy|matthew|joey|justin|brian|ryan|thomas|william|male)\b/i;

export type Speaker = { id: string; pronouns?: "she/her" | "he/him" | "they/them" | null };

/** FNV-1a: the same number for the same character on every device. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** A character's voice among the device's English ones: one that fits their pronouns when the names tell, always the same one. */
export function voiceFor(voices: readonly SpeechSynthesisVoice[], who: Speaker): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const fits =
    who.pronouns === "she/her" ? voices.filter((v) => FEMALE.test(v.name)) : who.pronouns === "he/him" ? voices.filter((v) => MALE.test(v.name) && !FEMALE.test(v.name)) : [];
  const pool = fits.length ? fits : voices;
  return pool[hash(who.id) % pool.length];
}

/**
 * Lines read aloud in the browser's own voices (speechSynthesis: free, on the device, the words sent nowhere), each
 * character in a voice of their own. Off until the person turns it on, and remembered in this browser. A server voice
 * (lib/adult/voice-lines.ts today, lib/voice.ts once it's shared) can take its place behind the same say().
 */
export function useSpeech() {
  const [supported, setSupported] = useState(false);
  const [on, setOnState] = useState(false);
  const voices = useRef<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    setSupported(true);
    try {
      setOnState(window.localStorage.getItem(KEY) === "1");
    } catch {
      // Storage blocked: off, as by default.
    }
    const load = () => {
      voices.current = synth.getVoices().filter((v) => /^en([-_]|$)/i.test(v.lang));
    };
    load();
    synth.addEventListener?.("voiceschanged", load);
    return () => {
      synth.removeEventListener?.("voiceschanged", load);
      synth.cancel();
    };
  }, []);

  /** Reads one line aloud now (call it from a tap the first time: Safari speaks only after one). */
  const speak = useCallback((text: string, who: Speaker) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window) || !text.trim()) return;
    const synth = window.speechSynthesis;
    const u = new SpeechSynthesisUtterance(text);
    const v = voiceFor(voices.current, who);
    if (v) {
      u.voice = v;
      u.lang = v.lang;
    }
    // Two characters on the same device voice still sound apart.
    const h = hash(who.id);
    u.pitch = 0.9 + (h % 21) / 100;
    u.rate = 0.96 + ((h >>> 8) % 9) / 100;
    synth.cancel();
    synth.speak(u);
  }, []);

  const setOn = useCallback((next: boolean) => {
    setOnState(next);
    try {
      window.localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      // Not remembered: it still works for this visit.
    }
    if (!next && typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  /** Reads a line aloud while it's on. */
  const say = useCallback(
    (text: string, who: Speaker) => {
      if (on) speak(text, who);
    },
    [on, speak],
  );

  return { supported, on, setOn, say, speak };
}
