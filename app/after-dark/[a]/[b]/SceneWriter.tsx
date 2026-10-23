"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { requestJson } from "@/app/request";
import type { Media } from "@/lib/adult/media";
import type { CharacterRef } from "@/lib/game";
import AfterDarkTheater from "./AfterDarkTheater";
import Limits from "./Limits";
import Memory from "./Memory";
import Link from "next/link";
import Reels, { stopReel } from "./Reels";
import Avatar from "@/app/Avatar";
import type { BusyReel, Reel } from "@/lib/adult/reels";
import { AUTOPLAY_PAGE_PAUSE_MS, autoplayStop } from "@/lib/adult/autoplay";
import type { Heat } from "@/lib/adult/director";
import type { AdultNight, AdultScene } from "@/lib/adult/scenes";
import { SOFT_CHAPTERS, STAGES } from "@/lib/adult/stages";

const mediaUrl = (id: string) => `/api/admin/after-dark/media/${id}`;

/** The suggested next moves' labels (lib/adult/director.ts): one per heat. */
const HEAT_LABEL: Record<Heat, string> = { mild: "Mild", flirty: "Flirty", spicy: "Spicy" };

/** The scene so far, the way to write more (a few lines at a time, with an optional steer), and the gallery. */
export default function SceneWriter({
  initial,
  gallery: firstGallery,
  characters,
  play = false,
  nights = [],
  reels = [],
  reelTokens = 15,
}: {
  initial: AdultScene;
  gallery: Media[];
  characters: [CharacterRef, CharacterRef];
  /** Open straight into the theater (`?play=1`). */
  play?: boolean;
  /** Their saved nights (each Start over files the scene that ran), newest first. */
  nights?: AdultNight[];
  /** Their videos of the night, and what one costs in tokens (lib/adult/reels.ts). */
  reels?: Reel[];
  reelTokens?: number;
}) {
  const [reelList, setReelList] = useState(reels);
  const [reelNote, setReelNote] = useState<{ text: string; error?: boolean; busy?: BusyReel } | null>(null);
  const putReel = useCallback((r: Reel) => {
    setReelList((list) => [r, ...list.filter((x) => x.id !== r.id)]);
    // Done, either way: the "it's being made" note would contradict the video below (a failure says why there).
    if (r.status !== "making") setReelNote((n) => (n && !n.error && !n.busy ? null : n));
  }, []);
  async function makeVideo(nightId?: string) {
    setReelNote({ text: "Picking the night's best moments and setting up a shot of the two of them for each (about a minute)…" });
    const res = await requestJson("/api/admin/after-dark/reel", { a: scene.a.id, b: scene.b.id, ...(nightId ? { night_id: nightId } : {}) }).catch(() => null);
    if (!res) return setReelNote({ text: "That didn't reach the server. Check your connection and try again.", error: true });
    // One at a time: the refusal names the video in the way (maybe another pair's), so it can be stopped from here.
    if (!res.ok) return setReelNote({ text: res.message, error: true, busy: (res.data.busy as BusyReel | undefined) ?? undefined });
    const reel = res.data.reel as Reel;
    putReel(reel);
    // A video can be done already (every shot refused at once, say): then its own line below says how it went.
    if (reel.status === "making") setReelNote({ text: "🎬 It's being made: a few minutes. It appears under Their videos, and plays shot by shot." });
  }
  const [theater, setTheater] = useState(play);
  // A steer is a nudge by default (worked toward at the scene's own pace); direct does it now.
  const [steerMode, setSteerMode] = useState<"nudge" | "direct">("nudge");
  // Or the words go to one of them only, as a whisper (lib/adult/director.ts): their secret, not the other's.
  const [whisperTo, setWhisperTo] = useState<"a" | "b" | null>(null);
  // Whether the end of the lines is on screen: the skip-to-bottom button shows only when it isn't.
  const endRef = useRef<HTMLSpanElement>(null);
  const [atEnd, setAtEnd] = useState(true);
  useEffect(() => {
    const el = endRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setAtEnd(e.isIntersecting), { rootMargin: "0px 0px 120px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const [nightList, setNightList] = useState(nights);
  const [watching, setWatching] = useState<AdultNight | null>(null);
  const [scene, setScene] = useState(initial);
  const [gallery, setGallery] = useState(firstGallery);
  const [direction, setDirection] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  // Autoplay (lib/adult/autoplay.ts): one switch for the page and the theater. Each paces its own steps.
  const [autoplay, setAutoplay] = useState(false);
  const writing = useRef(false);
  const pause = useRef(0);
  function switchAutoplay(on: boolean) {
    pause.current = 0;
    setAutoplay(on);
  }
  // The pair is stored either way round: the same two characters, in any order.
  const isThisPair = (r: BusyReel) => new Set([r.a, r.b, scene.a.id, scene.b.id]).size === 2;
  const nameOf = (who: "a" | "b") => (who === "a" ? scene.a.name : scene.b.name).split(/\s+/)[0];

  /** Sends one action to the scene's route; whether it went through. */
  async function send(body: Record<string, unknown>): Promise<boolean> {
    if (writing.current) return false;
    writing.current = true;
    setBusy(true);
    setNote(null);
    const res = await requestJson("/api/admin/after-dark", { a: scene.a.id, b: scene.b.id, ...body }).catch(() => null);
    writing.current = false;
    setBusy(false);
    if (!res || !res.ok) setAutoplay(false);
    if (!res) {
      setNote({ text: "Network error. Try again.", error: true });
      return false;
    }
    if (!res.ok) {
      setNote({ text: res.message, error: true });
      return false;
    }
    const next = res.data.scene as AdultScene;
    setScene(next);
    if (Array.isArray(res.data.nights)) setNightList(res.data.nights as AdultNight[]);
    if (body.rewind) {
      // Taking a step back is the viewer taking over: autoplay would only write it again.
      setAutoplay(false);
      const n = Number(res.data.rewound ?? 0);
      setNote({ text: `Rewound: ${n} line${n === 1 ? "" : "s"} taken back, and the scene is where it was before them.` });
      return true;
    }
    if (body.redo) setAutoplay(false);
    if (body.limits) return true;
    const pictures = (res.data.pictures as Media[] | undefined) ?? [];
    if (pictures.length) setGallery((g) => [...pictures, ...g]);
    const held = Number(res.data.held ?? 0);
    const repeats = Number(res.data.repeats ?? 0);
    const dropped = Number(res.data.dropped ?? 0);
    const parts = [
      held ? `${held} line${held === 1 ? "" : "s"} crossed one of the two lines and ${held === 1 ? "was" : "were"} dropped.` : "",
      repeats ? `${repeats} line${repeats === 1 ? "" : "s"} repeating what was already said ${repeats === 1 ? "was" : "were"} dropped.` : "",
      dropped ? `${dropped} line${dropped === 1 ? "" : "s"} that named someone else, broke the turn-taking or stepped out of the scene ${dropped === 1 ? "was" : "were"} dropped.` : "",
      pictures.length ? `${pictures.length} new picture${pictures.length === 1 ? "" : "s"} below.` : "",
      typeof res.data.picture_note === "string" ? `Picture: ${res.data.picture_note}` : "",
    ].filter(Boolean);
    if (body.set_scene) parts.push("They're there now. Press Next to see them arrive.");
    if (body.redo) parts.unshift("Rewritten: the last step was taken back and written again.");
    if (body.whisper) parts.push(`🤫 Whispered to ${nameOf((body.whisper as { to: "a" | "b" }).to)}: it shapes this step and the next.`);
    const stop = autoplay && !body.reset && body.set_scene === undefined && !body.forget_whisper ? autoplayStop(scene, next, Number(res.data.added ?? 0)) : null;
    if (stop) {
      setAutoplay(false);
      parts.push(stop);
    }
    pause.current = AUTOPLAY_PAGE_PAUSE_MS;
    if (parts.length) setNote({ text: parts.join(" ") });
    return true;
  }

  // Autoplay on the page (the theater paces it by what's left to play): a pause to read, then the next lines. Not while
  // the tab is hidden, so a forgotten tab doesn't write all night.
  useEffect(() => {
    if (!autoplay || theater || watching || busy) return;
    const step = () => {
      if (document.visibilityState === "hidden") return document.addEventListener("visibilitychange", step, { once: true });
      void send({});
    };
    const timer = setTimeout(step, pause.current);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", step);
    };
    // send is a fresh closure each render; the scene it writes from changes with `busy`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoplay, theater, watching, busy]);
  // Following along: while the end is in view, each step's new lines scroll in.
  const lineCount = scene.lines.length;
  useEffect(() => {
    if (autoplay && !theater && atEnd) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineCount]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const words = direction.trim();
    // A refused steer or whisper stays in the box, to be reworded.
    if (await send(!words ? {} : whisperTo ? { whisper: { to: whisperTo, text: words } } : { direction: words, steer_mode: steerMode })) setDirection("");
  }
  const other = (who: "a" | "b") => (who === "a" ? "b" : "a");
  const lastAsked = scene.rewind?.last;
  const redoTitle = lastAsked
    ? `Take the last step back and write it again${lastAsked.direction ? `, steered the same way (${lastAsked.steer_mode}): "${lastAsked.direction}"` : ""}${lastAsked.whisper ? `, with the same whisper to ${nameOf(lastAsked.whisper.to)}` : ""}`
    : "Nothing to redo yet";
  const whispers = (["a", "b"] as const).filter((who) => scene.whispers?.[who]);

  return (
    <section className="after-dark-scene">
      <p>
        <button type="button" className="primary" onClick={() => setTheater(true)}>
          🎬 Watch in theater
        </button>
      </p>
      {theater && (
        <AfterDarkTheater
          scene={{ lines: scene.lines, place: scene.place, stage: scene.stage, dateVenue: scene.date?.venue ?? null, set: scene.set_place, chapter: scene.chapter }}
          characters={characters}
          busy={busy}
          note={note?.text ?? null}
          onWrite={async (d) => void (await send(d ? { direction: d, steer_mode: steerMode } : {}))}
          steerMode={steerMode}
          onSteerMode={setSteerMode}
          autoplay={autoplay}
          onAutoplay={switchAutoplay}
          onSetScene={async (place) => void (await send({ set_scene: place }))}
          suggestions={scene.suggestions}
          onSuggest={async (text) => void (await send({ direction: text, steer_mode: "nudge" }))}
          onMakeVideo={() => makeVideo()}
          videoTokens={reelTokens}
          videoNote={reelNote?.text ?? null}
          feedbackRef={scene.id}
          onExit={() => setTheater(false)}
        />
      )}
      {(scene.lines.length > 0 || scene.chapter > 1) && (
        <p className="muted small">
          {scene.chapter > 1 ? `Chapter ${scene.chapter}. ` : ""}
          {scene.place ? `Now: ${scene.place}. ` : ""}So far: {STAGES[scene.stage] ?? STAGES[0]}.
          {scene.chapter > 1 ? " The earlier chapters are under Their nights, and they still remember them." : ""}
        </p>
      )}
      {scene.chapter > SOFT_CHAPTERS && (
        <p className="muted small">This night has run {scene.chapter - 1} chapters. It might be a good place to end it: Start over files it, and the next night begins fresh.</p>
      )}
      {scene.lines.length ? (
        <ol className="after-dark-lines">
          {scene.lines.map((l, i) => {
            const c = l.who === "a" ? characters[0] : characters[1];
            return (
              <li key={i} className={`after-dark-line is-${l.who}`}>
                <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} portraitSrc={c.portrait} size={34} />
                <p>
                  <strong>{nameOf(l.who)}</strong> {l.text}
                </p>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="muted">{scene.chapter > 1 ? `Chapter ${scene.chapter} starts here: write the next lines.` : "Nothing yet. Write the first lines, or steer it first."}</p>
      )}
      {note && (
        <p className={note.error ? "error" : "muted small"} role={note.error ? "alert" : "status"}>
          {note.text}
        </p>
      )}
      <span ref={endRef} aria-hidden="true" />
      {/* Sticks to the bottom of the screen while it's scrolled past, until it reaches its own place under the lines. */}
      <form className="after-dark-form" onSubmit={onSubmit}>
        {!atEnd && scene.lines.length > 8 && (
          <button type="button" className="after-dark-skip" onClick={() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })} aria-label="Skip to the latest lines" title="Skip to the latest lines">
            ↓
          </button>
        )}
        {(scene.suggestions?.length ?? 0) > 0 && (
          // The last step's suggested next moves, one per heat (lib/adult/director.ts): one tap sends it as a nudge.
          <div className="ad-suggestions" role="group" aria-label="Suggested next moves">
            {scene.suggestions.map((sg) => (
              <button
                key={sg.heat}
                type="button"
                className={`ad-suggestion is-${sg.heat}`}
                disabled={busy}
                onClick={() => void send({ direction: sg.text, steer_mode: "nudge" })}
                title={`Send it as a nudge: ${sg.text}`}
              >
                <span className="ad-heat">{HEAT_LABEL[sg.heat]}</span> <span className="ad-suggestion-text">{sg.text}</span>
              </button>
            ))}
          </div>
        )}
        {whispers.length > 0 && (
          <p className="ad-whispers">
            {whispers.map((who) => (
              <span
                key={who}
                className="ad-whisper-chip"
                title={`Only ${nameOf(who)} knows this; ${nameOf(other(who))} doesn't. It shapes the next ${scene.whispers[who]!.steps_left === 1 ? "step" : `${scene.whispers[who]!.steps_left} steps`}.`}
              >
                <span className="ad-whisper-who">🤫 {nameOf(who)}:</span> <q>{scene.whispers[who]!.text}</q>
                <button type="button" className="ad-whisper-forget" aria-label={`Forget the whisper to ${nameOf(who)}`} disabled={busy} onClick={() => void send({ forget_whisper: who })}>
                  ×
                </button>
              </span>
            ))}
          </p>
        )}
        <label htmlFor="after-dark-direction">{whisperTo ? `Whisper to ${nameOf(whisperTo)} (only ${nameOf(whisperTo)} knows it)` : "Steer it (optional)"}</label>
        <span className="after-dark-steer-mode" role="radiogroup" aria-label="How">
          <label title="Worked toward at the scene's own pace">
            <input type="radio" name="steer-mode" checked={!whisperTo && steerMode === "nudge"} onChange={() => (setWhisperTo(null), setSteerMode("nudge"))} /> Nudge
          </label>
          <label title="Done now: it can skip ahead">
            <input type="radio" name="steer-mode" checked={!whisperTo && steerMode === "direct"} onChange={() => (setWhisperTo(null), setSteerMode("direct"))} /> Direct
          </label>
          {(["a", "b"] as const).map((who) => (
            <label key={who} title={`A secret for ${nameOf(who)} alone: ${nameOf(other(who))} won't know it`}>
              <input type="radio" name="steer-mode" checked={whisperTo === who} onChange={() => setWhisperTo(who)} /> 🤫 {nameOf(who)}
            </label>
          ))}
        </span>
        <input
          id="after-dark-direction"
          value={direction}
          maxLength={whisperTo ? 200 : 300}
          onChange={(e) => setDirection(e.target.value)}
          placeholder={whisperTo ? `${nameOf(other(whisperTo))} wants you to take the lead…` : "They go back to hers…"}
          disabled={busy}
        />
        <p className="ad-steer-buttons">
          <button type="submit" className="primary" disabled={busy || (Boolean(whisperTo) && !direction.trim())}>
            {busy ? "Writing…" : whisperTo ? "Whisper and write" : "Write the next lines"}
          </button>{" "}
          <button type="button" className="button-ghost" disabled={busy || !scene.rewind?.depth} onClick={() => void send({ rewind: true })} title={scene.rewind?.depth ? "Take the last step back: its lines, and where the scene was" : "Nothing to rewind yet"}>
            ↺ Rewind
          </button>{" "}
          <button type="button" className="button-ghost" disabled={busy || !scene.rewind?.depth} onClick={() => void send({ redo: true })} title={redoTitle}>
            ↻ Redo
          </button>{" "}
          <button type="button" className="button-ghost" disabled={busy || !scene.lines.length} onClick={() => void send({ reset: true })}>
            Start over
          </button>{" "}
          <label className="after-dark-autoplay" title="It carries on by itself, no button needed, until the chapter ends">
            <input type="checkbox" checked={autoplay} onChange={(e) => switchAutoplay(e.target.checked)} /> Autoplay
          </label>
        </p>
      </form>
      {/* The viewer's limits for the pair, and what the two of them remember (both theirs to see and change): under the
          steer bar, which settles into its place above them, so it never covers them. */}
      <div className="ad-panels">
        <Limits intensity={scene.intensity} hardNos={scene.hard_nos} busy={busy} onSave={(limits) => send({ limits })} />
        <Memory a={scene.a} b={scene.b} onScene={setScene} />
      </div>
      {watching && (
        <AfterDarkTheater
          scene={{ lines: watching.lines, place: watching.place, stage: watching.stage, dateVenue: watching.date_venue, set: watching.set_place }}
          characters={characters}
          feedbackRef={watching.id}
          onExit={() => setWatching(null)}
        />
      )}
      {nightList.length > 0 && (
        <section>
          <h2>Their nights</h2>
          <ul className="after-dark-nights">
            {nightList.map((n) => (
              <li key={n.id}>
                <button type="button" className="button-ghost" onClick={() => setWatching(n)}>
                  ▶ Play
                </button>{" "}
                <button type="button" className="button-ghost" onClick={() => void makeVideo(n.id)} title={`A short film of this night, in their voices (${reelTokens} tokens)`}>
                  🎬 Video · {reelTokens} tokens
                </button>{" "}
                {new Date(n.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                {n.chapter ? ` · Chapter ${n.chapter}` : ""} · {n.lines.length} lines
                {n.place ? ` · ended ${n.place}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
      {reelNote && (
        <div className={reelNote.error ? "error" : "muted small"} role="status">
          <p>{reelNote.text}</p>
          {reelNote.busy && (
            <p>
              <button
                type="button"
                className="secondary small"
                onClick={async () => {
                  const r = await stopReel(reelNote.busy!.id);
                  if (!r) return setReelNote({ text: "Stopping it didn't go through. Try again.", error: true, busy: reelNote.busy });
                  if (isThisPair(reelNote.busy!)) putReel(r);
                  setReelNote({ text: "Stopped: the shots that came through are kept and the rest's tokens are back. You can make a new one now." });
                }}
              >
                Stop that video
              </button>
              {!isThisPair(reelNote.busy) && (
                <>
                  {" "}
                  <Link href={`/after-dark/${reelNote.busy.a}/${reelNote.busy.b}`}>Go to {reelNote.busy.names[0]} and {reelNote.busy.names[1]}</Link>
                </>
              )}
            </p>
          )}
        </div>
      )}
      <Reels reels={reelList} onChange={putReel} />
      <Gallery items={gallery} problem={scene.picture_note} onAdd={(m) => setGallery((g) => [m, ...g])} />
    </section>
  );
}

/** Their pictures and clips. A picture can be made to move (a clip takes a minute or more on fal.ai). */
function Gallery({ items, problem, onAdd }: { items: Media[]; problem: string | null; onAdd: (m: Media) => void }) {
  const [motion, setMotion] = useState("");
  const [pending, setPending] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  // Poll each pending clip every 6 seconds until it's ready or failed.
  useEffect(() => {
    const ids = items.filter((m) => m.kind === "video" && (pending[m.id] ?? m.status) === "pending").map((m) => m.id);
    if (!ids.length) return;
    const timer = setInterval(async () => {
      for (const id of ids) {
        const res = await fetch(`/api/admin/after-dark/clip?id=${encodeURIComponent(id)}`).then((r) => r.json()).catch(() => null);
        if (res?.status && res.status !== "pending") setPending((p) => ({ ...p, [id]: res.status }));
      }
    }, 6000);
    return () => clearInterval(timer);
  }, [items, pending]);

  async function makeClip(imageId: string) {
    setError(null);
    const res = await requestJson("/api/admin/after-dark/clip", { image_id: imageId, motion }).catch(() => null);
    if (!res?.ok) return setError(res?.message ?? "The clip didn't start.");
    onAdd(res.data.clip as Media);
  }

  const problemNote = problem ? (
    <p className="error" role="status">
      The last picture didn&apos;t come through: {problem}
    </p>
  ) : null;
  if (!items.length) {
    return (
      <>
        {problemNote}
        <p className="muted small">No pictures yet: the first ones come when a scene turns explicit, or when they ask each other for one.</p>
      </>
    );
  }
  return (
    <section>
      <h2>Gallery</h2>
      {problemNote}
      {items.some((m) => m.clip) && (
        <>
          <label htmlFor="after-dark-motion">Clip motion (optional)</label>
          <input id="after-dark-motion" value={motion} maxLength={300} onChange={(e) => setMotion(e.target.value)} placeholder="She turns toward the camera…" />
        </>
      )}
      {items.some((m) => m.kind !== "video" && !m.clip) && <p className="muted small">Explicit pictures can&apos;t be made into clips yet.</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <ul className="after-dark-gallery">
        {items.map((m) => {
          const status = pending[m.id] ?? m.status;
          return (
            <li key={m.id}>
              {m.kind === "video" ? (
                status === "ready" ? (
                  <video src={mediaUrl(m.id)} controls playsInline />
                ) : (
                  <p className="muted small">{status === "failed" ? "The clip failed." : "Clip on its way…"}</p>
                )
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={mediaUrl(m.id)} alt={m.kind === "baseline" ? "Baseline picture" : "Scene picture"} loading="lazy" />
              )}
              <span className="badge">{m.kind}</span>
              {m.clip && (
                <button type="button" className="button-ghost small" onClick={() => void makeClip(m.id)}>
                  Make it move
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
