"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Scene from "@/app/Scene";
import ChatThread from "@/app/ChatThread";
import { useReplay } from "@/app/useReplay";
import { DATE_ACTS, endingLabel, WRITE_TIME, type Ending } from "@/lib/rules";
import type { Turn } from "@/lib/conversation";
import type { CharacterRef } from "@/lib/game";
import { placeAt, type PlaceId } from "@/lib/venues";
import CharacterName from "@/app/CharacterName";
import { queueEvent } from "@/app/engagement";
import { markDateWatchedLive, msSinceDateStarted } from "@/lib/engagement-keys";
import type { TheaterVerdict } from "./EpisodeTheater";
import VerdictCard from "./VerdictCard";
import PushToggle from "@/app/notifications/PushToggle";

/** No new line for this long while it's filmed: say it's slower than usual (lines land seconds apart). */
export const SLOW_LINE_MS = 60_000;
/** Still filming this long after the page opened: offer "Tell me when it's ready" (a date takes WRITE_TIME, lib/rules.ts). */
export const OFFER_NOTIFY_MS = 120_000;

/** "4 of about 12 lines filmed", or just the count once a date runs past its usual length (a move adds lines). */
export function filmedLabel(filmed: number, total: number | null | undefined): string {
  if (!total || filmed > total) return `${filmed} ${filmed === 1 ? "line" : "lines"} filmed`;
  return `${filmed} of about ${total} lines filmed`;
}

/**
 * 2026-11-14 feedback ("stalled at 3 lines and still said Filming live 5+ minutes later"): what the wait says. Lines
 * stopped coming for a minute: slower than usual, and the show restarts a writer that died (the episode poll rescues it,
 * lib/jobs.ts). Two minutes in and still filming: offer to tell them when it's ready.
 */
function SlowNote({ episodeId, slow, offerNotify, pushKey, creator, bare = false }: { episodeId: string; slow: boolean; offerNotify: boolean; pushKey?: string | null; creator: boolean; bare?: boolean }) {
  const [asked, setAsked] = useState<"no" | "busy" | "yes" | "failed">("no");
  if (!slow && !offerNotify) return null;
  async function ask() {
    setAsked("busy");
    const res = await fetch(`/api/episodes/${episodeId}/notify-ready`, { method: "POST" }).catch(() => null);
    setAsked(res?.ok ? "yes" : "failed");
  }
  return (
    <div className={bare ? "filming-slow" : "card filming-slow"} role="status" aria-live="polite">
      <p className="muted small">
        {slow
          ? "This one's taking longer than usual. If the writer stalled, the show restarts it by itself."
          : `Still filming. A date takes ${WRITE_TIME}.`}
      </p>
      {offerNotify && creator && (
        <>
          {asked === "yes" ? (
            <p className="small">🔔 Done: you&apos;ll get a notification the moment it&apos;s filmed, so you can leave this page.</p>
          ) : (
            <p>
              <button type="button" className="secondary small" data-track="notify_when_filmed" disabled={asked === "busy"} onClick={() => void ask()}>
                🔔 Tell me when it&apos;s ready
              </button>
              {asked === "failed" && <span className="error small"> That didn&apos;t go through. Try again.</span>}
            </p>
          )}
          {asked === "yes" && pushKey && (
            <PushToggle publicKey={pushKey} prompt emailFallback place="filming" title="Get it as a push" body="So it reaches you with the site closed. Otherwise it waits under the bell." />
          )}
        </>
      )}
    </div>
  );
}

function lastLine(turns: Turn[], side: "a" | "b"): string | null {
  for (let i = turns.length - 1; i >= 0; i--) if (turns[i].side === side) return turns[i].dialogue;
  return null;
}

/** The creator who just sent the date: wait on the theater stage itself, and play the date the moment it's filmed. */
type Stage = {
  characters: [CharacterRef, CharacterRef];
  venue: PlaceId | null;
  canSetScene?: boolean;
  /** Which date it is for the pair (lib/rules.ts endingLabel: "A third date", never "A second date" on a second). */
  dateNumber?: number | null;
  /** What the verdict card needs for the creator (EpisodeTheater.tsx TheaterVerdict); null when their side isn't known. */
  verdict?: TheaterVerdict | null;
};

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
 *
 * The early verdict (the 2026-11-14 core plan, PR3): the job saves the ending the moment the characters' own answers
 * weighed in, with `ending_final` on the view (lib/game.ts), 30-60 s before the recap, texts and reflections make the
 * date ready. Once the stage has played every saved line it shows the same verdict card the theater does
 * (VerdictCard.tsx) and counts `date_watched` with `live: 1`; a "Skip to the ending" control appears as soon as the ending
 * is decided. "Hear from" on the card goes the moment the ending is final (the after-date route takes a generating date
 * with `ending_final`; the first text is built from the ending and the debrief). Exit folds the stage without leaving `?play=1`, so
 * the finished date still opens in the theater (and counts) for a creator who stepped out early.
 */
type Poll = { status?: string; transcript?: Turn[]; ending?: Ending; ending_final?: true };

export default function GeneratingPoller({
  episodeId,
  stage,
  characters,
  totalLines,
  creator = false,
  pushKey = null,
}: {
  episodeId: string;
  stage?: Stage;
  /** The pair, for the filmed-so-far lines on the plain page (its creator only: nobody else gets lines before it airs). */
  characters?: [CharacterRef, CharacterRef];
  /** About how many lines the date runs (its format's length; a move or the talk setting can change it). */
  totalLines?: number | null;
  /** The viewer made this date: they get the lines so far, and the offer to hear when it's ready. */
  creator?: boolean;
  pushKey?: string | null;
}) {
  const router = useRouter();
  const [failed, setFailed] = useState(false);
  const [lines, setLines] = useState<Turn[]>([]);
  // The ending as it will stand (the early verdict), once the poll has carried it; null while the date is still open.
  const [final, setFinal] = useState<Ending | null>(null);
  // The job finished while the verdict card was up: the card stays (no jump to the theater) and "Hear from" can go.
  const [ready, setReady] = useState(false);
  const [exited, setExited] = useState(false);
  const replay = useReplay(lines, true, { live: true });
  const replayRef = useRef(replay);
  const linesLen = useRef(0);
  replayRef.current = replay;
  // When the page opened and when the last new line came, against a clock that ticks while they wait.
  const [openedAt] = useState(() => Date.now());
  const [lastLineAt, setLastLineAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  // A writer that died was restarted from the top (lib/jobs.ts rescueStuckJob): its first lines replace the old ones.
  const [restarted, setRestarted] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  // The poll reads how far playback got when the date finishes, without re-arming on every line.
  const reached = useRef(0);
  reached.current = replay.shown.length;
  // Whether the stage already showed the verdict (and counted it), and whether they stepped out: read by the poll.
  const watched = useRef(false);
  const exitedRef = useRef(false);
  const skipped = useRef(false);

  useEffect(() => {
    if (failed || ready) return;
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
          const data = (await res.json()) as Poll;
          if (!active) return;
          if (Array.isArray(data.transcript)) {
            const next = data.transcript;
            const had = linesLen.current;
            if (next.length !== had) {
              linesLen.current = next.length;
              setLines(next);
              setLastLineAt(Date.now());
              if (next.length < had) {
                setRestarted(true);
                replayRef.current.restart();
              }
            }
          }
          // Only an ending the job marked final counts: the booked one can still move until then (lib/choices.ts).
          if (stage && data.ending_final && data.ending) setFinal(data.ending);
          if (data.status && data.status !== "generating") {
            if (!stage) {
              router.refresh();
              return;
            }
            if (watched.current) {
              // They saw the verdict here already: the finished page if they stepped out, else the card stays as it is.
              if (exitedRef.current) router.replace(`/episodes/${episodeId}`);
              else setReady(true);
              return;
            }
            // Straight into the playback (from the line they'd reached): the theater shows the ending and counts it.
            router.replace(`/episodes/${episodeId}?play=1${reached.current ? `&from=${reached.current}` : ""}`);
            return;
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
  }, [episodeId, router, failed, ready, stage]);

  const decidedNow = final !== null;
  const slow = !decidedNow && now - lastLineAt > SLOW_LINE_MS;
  const offerNotify = !decidedNow && now - openedAt > OFFER_NOTIFY_MS;
  const shown = replay.shown;
  const caughtUp = shown.length >= lines.length;
  const decided = final !== null;
  // Every saved line has played and the ending stands: the verdict. (A date whose lines never came out shows it too.)
  const verdictShowing = Boolean(stage) && decided && caughtUp;

  // The aha moment, counted once here (lib/engagement-keys.ts tells the theater not to count it again in this tab).
  useEffect(() => {
    if (!verdictShowing || watched.current) return;
    watched.current = true;
    markDateWatchedLive(episodeId);
    queueEvent("date_watched", { via: "stage", live: 1, just_filmed: true, skipped: skipped.current, ms_since_start: msSinceDateStarted() });
  }, [verdictShowing, episodeId]);

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

  if (stage && exited) {
    return (
      <section className="card watch-preshow" aria-live="polite">
        <h2>🎬 Filming the date…</h2>
        <p className="muted">
          The two characters are on their date right now. It opens in the theater the moment it&apos;s ready, from the line
          you&apos;d reached.
        </p>
        <p>
          <button
            type="button"
            className="secondary small"
            onClick={() => {
              exitedRef.current = false;
              setExited(false);
            }}
          >
            Back to the stage
          </button>
        </p>
      </section>
    );
  }

  if (stage) {
    const [a, b] = stage.characters;
    // Caught up with the writing: whoever speaks next is "typing" (sides alternate; Act 1 opens on a); nobody once it's decided.
    const last = shown[shown.length - 1];
    const typing = caughtUp ? (lines.length && !decided ? (last?.side === "a" ? "b" : "a") : null) : replay.typing;
    const actLabel = last ? DATE_ACTS[last.act] ?? null : null;
    const label = final ? endingLabel(final, stage.dateNumber) : "";
    const skipToEnding = () => {
      skipped.current = true;
      replay.skip();
    };
    const exit = () => {
      if (ready) {
        router.replace(`/episodes/${episodeId}`);
        return;
      }
      exitedRef.current = true;
      setExited(true);
    };
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
              <span className="chip">{ready ? "Just filmed" : verdictShowing ? "Wrapping up" : `🔴 Filming live · ${filmedLabel(lines.length, totalLines)}`}</span>
            </div>
            <div className="theater-tools">
              {decided && !caughtUp && (
                <button type="button" className="secondary small" onClick={skipToEnding} data-track="skip-to-ending">
                  Skip to the ending
                </button>
              )}
              <button type="button" className="secondary small" onClick={exit}>
                Exit
              </button>
            </div>
          </header>
          {stage.canSetScene && !decided && <SetSceneBar episodeId={episodeId} />}
          {!ready && !verdictShowing && (
            <div className="ad-theater-bar">
              {restarted && <p className="ad-theater-note">The filming hit a snag and restarted from the top. Same date, same ending.</p>}
              <SlowNote episodeId={episodeId} slow={slow} offerNotify={offerNotify} pushKey={stage.verdict?.pushKey ?? pushKey} creator bare />
            </div>
          )}
          {!shown.length && !verdictShowing && (
            <div className="theater-verdict" role="status" aria-live="polite">
              <p className="ending">Filming the date…</p>
              <p className="muted">The first lines appear here as they&apos;re filmed, usually within a minute; the whole date takes {WRITE_TIME}.</p>
            </div>
          )}
          {verdictShowing &&
            (stage.verdict ? (
              <VerdictCard
                episodeId={episodeId}
                endingLabel={label}
                you={stage.characters[stage.verdict.mine]}
                partner={stage.characters[stage.verdict.mine === 0 ? 1 : 0]}
                preview={stage.verdict.reflection}
                pushKey={stage.verdict.pushKey}
                onRestart={replay.restart}
                // "Hear from" goes as soon as the ending is final (lib/after-date-text.ts takes a generating date with
                // ending_final); the card only shows once it is, so this greys nothing today and stays for a card without it.
                pending={!ready && final === null}
              />
            ) : (
              <div className="theater-verdict">
                <p className="ending">{label}</p>
                <p className="muted">
                  That&apos;s how it ended.{" "}
                  <button type="button" className="linklike" onClick={replay.restart}>
                    Watch again
                  </button>
                </p>
              </div>
            ))}
        </div>
      </div>
    );
  }

  // The plain page (no ?play=1): what's filmed so far, for its creator, and the way onto the stage.
  return (
    <section className="card watch-preshow" aria-live="polite">
      <h2>🎬 Filming the date…</h2>
      <p className="muted">
        The two characters are on their date right now. It takes {WRITE_TIME}, and this page updates itself
        the moment it&apos;s ready.
      </p>
      {creator && (
        <p>
          {lines.length > 0 && <strong>{filmedLabel(lines.length, totalLines)}. </strong>}
          <Link className="button secondary small" href={`/episodes/${episodeId}?play=1`} data-track="watch_filming">
            ▶ Watch it being filmed
          </Link>
        </p>
      )}
      {restarted && <p className="muted small">The filming hit a snag and restarted from the top. Same date, same ending.</p>}
      {creator && characters && lines.length > 0 && <ChatThread characters={characters} turns={lines} />}
      <SlowNote episodeId={episodeId} slow={slow && lines.length > 0} offerNotify={offerNotify} pushKey={pushKey} creator={creator} />
    </section>
  );
}
