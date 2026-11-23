"use client";

import { useEffect, useRef, useState } from "react";
import { fetchVoicePiece, playOn, type VoicePiece } from "./voice-client";

/**
 * 🔊 under a reply (docs/after-dark.md "Step in": voice): what the character says in it, out loud, in their own voice.
 * Only the lines inside the reply's quotes are said, never the narration (lib/adult/step-in-shared.ts spokenPieces).
 * Every piece is asked for at once (each is made once and kept, so hearing it again is instant and free) and they play
 * in order; pressing again stops it. `auto`: it plays as it appears (the scene's "read aloud" switch), once.
 */
export default function HearIt({ sceneId, messageId, pieces, name, auto = false }: { sceneId: string; messageId: string; pieces: number; name: string; auto?: boolean }) {
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const [error, setError] = useState<string | null>(null);
  // Each press is a run; a later press, a stop or the reply going away makes an earlier run stale.
  const run = useRef(0);
  const audio = useRef<HTMLAudioElement | null>(null);

  function stop() {
    run.current += 1;
    audio.current?.pause();
    setState("idle");
  }

  async function play() {
    const mine = ++run.current;
    setError(null);
    setState("loading");
    const el = (audio.current ??= new Audio());
    const jobs: Promise<VoicePiece>[] = Array.from({ length: pieces }, (_, i) => fetchVoicePiece(sceneId, messageId, i));
    // Whatever was fetched and not played is let go of, however this ends.
    const letGo = (from: number) => jobs.slice(from).forEach((j) => void j.then((v) => v.ok && URL.revokeObjectURL(v.url)));
    for (let i = 0; i < jobs.length; i++) {
      const v = await jobs[i];
      if (run.current !== mine) return letGo(i);
      if (!v.ok) {
        setError(v.message);
        letGo(i + 1);
        break;
      }
      setState("playing");
      const played = await playOn(el, v.url);
      URL.revokeObjectURL(v.url);
      if (run.current !== mine) return letGo(i + 1);
      if (!played) {
        // The browser wouldn't play it (no tap yet, or a file it couldn't read): say so once, quietly.
        setError("Your browser didn't play it. Press 🔊 to try again.");
        letGo(i + 1);
        break;
      }
    }
    if (run.current === mine) setState("idle");
  }

  // Read aloud as it arrives, once; and nothing keeps playing once the reply is gone from the page.
  useEffect(() => {
    if (auto) void play();
    return () => {
      run.current += 1;
      audio.current?.pause();
    };
    // Once, as it appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <span className="ad-si-hear" data-step-in-hear={messageId}>
      <button type="button" className="button-ghost small" onClick={() => (state === "idle" ? void play() : stop())} aria-pressed={state !== "idle"} aria-label={state === "idle" ? `Hear ${name} say it` : "Stop"} title={state === "idle" ? `Hear ${name} say it` : "Stop"}>
        {state === "idle" ? "🔊 Hear it" : state === "loading" ? "🔊 Getting their voice…" : "⏹ Stop"}
      </button>
      {error && (
        <span className="error small" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
