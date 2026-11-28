"use client";

import { useEffect, useRef, useState } from "react";
import type { CharacterExtras } from "@/lib/extras";
import { okJson } from "@/lib/ok-json";
import type { SetExtras } from "./DetailsStep";

type Pick = { id: string; label: string; sounds: "she" | "he" };

/**
 * How they sound out loud (lib/voice-picks.ts): one of the stock voices, with a ▶ to hear each say the same line, or
 * their default voice. It shows only while picking is open (VOICE_PICKER, asked of /api/voice), so the builder is
 * unchanged with it off. The pick is `extras.voice`, saved with the rest of the card.
 */
export default function SpokenVoicePicker({ extras, setExtras }: { extras: CharacterExtras; setExtras: SetExtras }) {
  const [picks, setPicks] = useState<Pick[] | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/voice")
      .then(okJson)
      .then((j: { on?: boolean; picks?: Pick[] } | null) => live && setPicks(j?.on && j.picks?.length ? j.picks : []))
      .catch(() => live && setPicks([]));
    return () => {
      live = false;
      audio.current?.pause();
    };
  }, []);

  if (!picks?.length) return null;
  const chosen = extras.voice ?? null;
  const choose = (id: string | null) =>
    setExtras((p) => {
      const { voice: _old, ...rest } = p;
      return id ? { ...rest, voice: id } : rest;
    });

  function play(id: string) {
    audio.current?.pause();
    if (playing === id) {
      setPlaying(null);
      return;
    }
    const a = new Audio(`/api/voice/sample/${encodeURIComponent(id)}`);
    audio.current = a;
    setFailed(null);
    setPlaying(id);
    a.onended = () => setPlaying((p) => (p === id ? null : p));
    a.onerror = () => {
      setPlaying((p) => (p === id ? null : p));
      setFailed(id);
    };
    a.play().catch(() => setPlaying((p) => (p === id ? null : p)));
  }

  return (
    <details className="detail-group" open={Boolean(chosen)}>
      <summary>Their speaking voice</summary>
      <p className="muted small">The voice of their voice notes. Tap ▶ to hear each one. Stock voices only, never a real person&apos;s.</p>
      <div className="voice-picks" role="radiogroup" aria-label="Their speaking voice">
        <button type="button" role="radio" aria-checked={!chosen} className={`look-chip${!chosen ? " chosen" : ""}`} onClick={() => choose(null)}>
          Default
        </button>
      </div>
      {(["she", "he"] as const).map((group) => (
        <div key={group} className="voice-picks" role="radiogroup" aria-label={group === "she" ? "Higher voices" : "Lower voices"}>
          {picks
            .filter((p) => p.sounds === group)
            .map((p) => (
              <span key={p.id} className="detail-row">
                <button type="button" className="dice" aria-label={playing === p.id ? `Stop ${p.label}` : `Hear ${p.label}`} title={playing === p.id ? "Stop" : "Hear it"} onClick={() => play(p.id)}>
                  {playing === p.id ? "■" : "▶"}
                </button>
                <button type="button" role="radio" aria-checked={chosen === p.id} className={`look-chip${chosen === p.id ? " chosen" : ""}`} onClick={() => choose(p.id)}>
                  {p.label}
                </button>
              </span>
            ))}
        </div>
      ))}
      {failed && <p className="muted small" role="status">That sample isn&apos;t available right now. You can still pick it.</p>}
    </details>
  );
}
