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

  /** One utterance in this character's voice. */
  const utter = useCallback((text: string, who: Speaker) => {
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
    return u;
  }, []);

  /** Reads one line aloud now (call it from a tap the first time: Safari speaks only after one). */
  const speak = useCallback(
    (text: string, who: Speaker) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window) || !text.trim()) return;
      const synth = window.speechSynthesis;
      synth.cancel();
      synth.speak(utter(text, who));
    },
    [utter],
  );

  /**
   * Says a whole reply now and resolves once it's said, or stopped (a call waits for it before it listens again).
   * Sentence by sentence, since some browsers cut one long utterance short, and with a timer in case the end never comes.
   */
  const speakAll = useCallback(
    (text: string, who: Speaker): Promise<void> => {
      if (typeof window === "undefined" || !("speechSynthesis" in window) || !text.trim()) return Promise.resolve();
      const synth = window.speechSynthesis;
      const parts = (text.match(/[^.!?…]+[.!?…]*["'”’)]*\s*/g) ?? [text]).map((p) => p.trim()).filter(Boolean);
      synth.cancel();
      return new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve();
        };
        // About two words a second, and some slack.
        const timer = setTimeout(finish, (text.split(/\s+/).length / 2) * 1000 + 4000);
        parts.forEach((p, i) => {
          const u = utter(p, who);
          if (i === parts.length - 1) u.onend = finish;
          u.onerror = finish;
          synth.speak(u);
        });
      });
    },
    [utter],
  );

  /** Call it from a tap: a browser that speaks only after one (Safari) can then speak without one. */
  const unlock = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    window.speechSynthesis.speak(u);
  }, []);

  /** Stops whatever is being said (a speakAll waiting on it resolves). */
  const stop = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
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

  return { supported, on, setOn, say, speak, speakAll, unlock, stop };
}
