"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Scene from "@/app/Scene";
import ChatThread from "@/app/ChatThread";
import { useReplay } from "@/app/useReplay";
import { DATE_ACTS } from "@/lib/rules";
import type { Turn } from "@/lib/conversation";
import type { CharacterRef } from "@/lib/game";
import { placeAt, type PlaceId } from "@/lib/venues";
import CharacterName from "@/app/CharacterName";

function lastLine(turns: Turn[], side: "a" | "b"): string | null {
  for (let i = turns.length - 1; i >= 0; i--) if (turns[i].side === side) return turns[i].dialogue;
  return null;
}

/** The creator who just sent the date: wait on the theater stage itself, and play the date the moment it's filmed. */
type Stage = { characters: [CharacterRef, CharacterRef]; venue: PlaceId | null; canSetScene?: boolean };

/**
 * Set the scene while it's filmed (lib/scene-suggestions.ts): any place, 1 token. The next line suggests it and the
 * other one decides; the token comes back if they don't go.
 */
function SetSceneBar({ episodeId }: { episodeId: string }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  async function go(e: FormEvent) {
    e.preventDefault();
    if (!place.trim()) return;
    setBusy(true);
    const res = await fetch(`/api/episodes/${episodeId}/set-scene`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ place: place.trim() }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as { message?: string; suggestion?: { label: string } } | null;
    setBusy(false);
    if (!res?.ok) return setNote({ text: data?.message ?? "That didn't go through. Try again.", error: true });
    setNote({ text: `Sent. The next line suggests ${data?.suggestion?.label ?? "it"}. They can still say no, and your token comes back if they don't go.` });
    setPlace("");
    setOpen(false);
  }
  return (
    <div className="ad-theater-bar set-scene-bar">
      {open ? (
        <form onSubmit={go} className="set-scene-form">
          <input aria-label="Take them anywhere" value={place} maxLength={60} onChange={(e) => setPlace(e.target.value)} placeholder="Take them anywhere: a rooftop pool at midnight…" disabled={busy} autoFocus />
          <button type="submit" className="primary" disabled={busy || !place.trim()}>
            {busy ? "Sending…" : "Suggest it · 1 token"}
          </button>
          <button type="button" className="button-ghost" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </button>
        </form>
      ) : (
        <button type="button" className="button-ghost" onClick={() => setOpen(true)} title="Take them anywhere (1 token)">
          📍 Set the scene
        </button>
      )}
      {note && (
        <p className="ad-theater-note" role="status">
          {note.text}
        </p>
      )}
    </div>
  );
}

/**
 * M10 part 2: while an episode is 'generating', poll its status and refresh the page the moment the
 * background worker finishes. If the episode disappears (404), generation failed terminally — the date
 * was given back — so offer another try. No websockets; a light poll, like the watch room.
 *
 * On the stage (the creator who just sent it), the date plays while it's filmed: the worker saves each line
 * as it's written (lib/jobs.ts), the poll brings them in, and they play on the scene at the replay's pace. When
 * it's done, the finished date picks up from the line they'd reached instead of starting over.
 */
export default function GeneratingPoller({ episodeId, stage }: { episodeId: string; stage?: Stage }) {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const [lines, setLines] = useState<Turn[]>([]);
  const replay = useReplay(lines, true, { live: true });
  // The poll reads how far playback got when the date finishes, without re-arming on every line.
  const reached = useRef(0);
  reached.current = replay.shown.length;

  useEffect(() => {
    if (failed) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const res = await fetch(`/api/episodes/${episodeId}`, { cache: "no-store" });
        if (res.status === 404) {
          if (active) setFailed(true);
          return;
        }
        if (res.ok) {
          const data = (await res.json()) as { status?: string; transcript?: Turn[] };
          if (data.status && data.status !== "generating") {
            // On the stage, go straight into the playback (from the line they'd reached); otherwise show the finished episode.
            if (stage) router.replace(`/episodes/${episodeId}?play=1${reached.current ? `&from=${reached.current}` : ""}`);
            else router.refresh();
            return;
          }
          if (stage && Array.isArray(data.transcript)) {
            const next = data.transcript;
            setLines((prev) => (next.length === prev.length ? prev : next));
          }
        }
      } catch {
        /* a dropped poll is harmless; the next one catches up */
      }
      if (active) timer = setTimeout(tick, stage ? 2000 : 2500);
    };
    timer = setTimeout(tick, stage ? 1000 : 2500);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [episodeId, router, failed, stage]);

  if (failed) {
    return (
      <section className="card">
        <h2>That date didn&apos;t work out</h2>
        <p className="muted">
          The filming didn&apos;t come together this time, and your date has been given back. Send them
          out again.
        </p>
        <p>
          <Link href="/">Make another date</Link>
        </p>
      </section>
    );
  }

  if (stage) {
    const [a, b] = stage.characters;
    const shown = replay.shown;
    const caughtUp = shown.length >= lines.length;
    // Caught up with the writing: whoever speaks next is "typing" (sides alternate; Act 1 opens on a).
    const last = shown[shown.length - 1];
    const typing = caughtUp ? (lines.length ? (last?.side === "a" ? "b" : "a") : null) : replay.typing;
    const actLabel = last ? DATE_ACTS[last.act] ?? null : null;
    return (
      <div className="theater theater-clean theater-filming">
        <div className="theater-stage with-convo">
          <div className="theater-scene-area">
            <Scene
              characters={stage.characters}
              venue={placeAt(shown, stage.venue)}
              lineA={lastLine(shown, "a")}
              lineB={lastLine(shown, "b")}
              actLabel={actLabel}
              placeholder="They're arriving…"
            />
          </div>
          <div className="theater-convo">
            <ChatThread
              characters={stage.characters}
              turns={shown}
              typing={typing}
              tone="dark"
              follow
            />
          </div>
          <header className="theater-hud">
            <div className="theater-id">
              <strong>
                <CharacterName character={a} /> <span className="vs">×</span> <CharacterName character={b} />
              </strong>
              <span className="chip">🔴 Filming live</span>
            </div>
            <div className="theater-tools">
              <Link href={`/episodes/${episodeId}`} className="button secondary small">
                Exit
              </Link>
            </div>
          </header>
          {stage.canSetScene && <SetSceneBar episodeId={episodeId} />}
          {!shown.length && (
            <div className="theater-verdict" role="status" aria-live="polite">
              <p className="ending">Filming the date…</p>
              <p className="muted">The first lines appear here as they&apos;re filmed, usually within a minute.</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <section className="card watch-preshow" aria-live="polite">
      <h2>🎬 Filming the date…</h2>
      <p className="muted">
        The two characters are on their date right now. This usually takes under a minute — the page will
        update itself the moment it&apos;s ready.
      </p>
    </section>
  );
}
