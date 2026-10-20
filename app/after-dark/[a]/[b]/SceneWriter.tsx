"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { requestJson } from "@/app/request";
import type { Media } from "@/lib/adult/media";
import type { CharacterRef } from "@/lib/game";
import AfterDarkTheater from "./AfterDarkTheater";
import Reels from "./Reels";
import Avatar from "@/app/Avatar";
import type { Reel } from "@/lib/adult/reels";
import type { AdultNight, AdultScene } from "@/lib/adult/scenes";
import { STAGES } from "@/lib/adult/stages";

const mediaUrl = (id: string) => `/api/admin/after-dark/media/${id}`;

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
  const [reelNote, setReelNote] = useState<{ text: string; error?: boolean } | null>(null);
  const putReel = useCallback((r: Reel) => setReelList((list) => [r, ...list.filter((x) => x.id !== r.id)]), []);
  async function makeVideo(nightId?: string) {
    setReelNote({ text: "Picking the night's best moments and voicing them…" });
    const res = await requestJson("/api/admin/after-dark/reel", { a: scene.a.id, b: scene.b.id, ...(nightId ? { night_id: nightId } : {}) }).catch(() => null);
    if (!res?.ok) return setReelNote({ text: res?.message ?? "That didn't go through. Try again.", error: true });
    putReel(res.data.reel as Reel);
    setReelNote({ text: "🎬 It's being made: a few minutes. It appears under Their videos, and plays shot by shot." });
  }
  const [theater, setTheater] = useState(play);
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
  const nameOf = (who: "a" | "b") => (who === "a" ? scene.a.name : scene.b.name).split(/\s+/)[0];

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setNote(null);
    const res = await requestJson("/api/admin/after-dark", { a: scene.a.id, b: scene.b.id, ...body }).catch(() => null);
    setBusy(false);
    if (!res) return setNote({ text: "Network error. Try again.", error: true });
    if (!res.ok) return setNote({ text: res.message, error: true });
    setScene(res.data.scene as AdultScene);
    if (Array.isArray(res.data.nights)) setNightList(res.data.nights as AdultNight[]);
    const pictures = (res.data.pictures as Media[] | undefined) ?? [];
    if (pictures.length) setGallery((g) => [...pictures, ...g]);
    const held = Number(res.data.held ?? 0);
    const parts = [
      held ? `${held} line${held === 1 ? "" : "s"} crossed one of the two lines and ${held === 1 ? "was" : "were"} dropped.` : "",
      pictures.length ? `${pictures.length} new picture${pictures.length === 1 ? "" : "s"} below.` : "",
      typeof res.data.picture_note === "string" ? `Picture: ${res.data.picture_note}` : "",
    ].filter(Boolean);
    if (body.set_scene) parts.push("They're there now. Press Next to see them arrive.");
    if (parts.length) setNote({ text: parts.join(" ") });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await send(direction.trim() ? { direction: direction.trim() } : {});
    setDirection("");
  }

  return (
    <section className="after-dark-scene">
      <p>
        <button type="button" className="primary" onClick={() => setTheater(true)}>
          🎬 Watch in theater
        </button>
      </p>
      {theater && (
        <AfterDarkTheater
          scene={{ lines: scene.lines, place: scene.place, stage: scene.stage, dateVenue: scene.date?.venue ?? null, set: scene.set_place }}
          characters={characters}
          busy={busy}
          note={note?.text ?? null}
          onWrite={(d) => send(d ? { direction: d } : {})}
          onSetScene={(place) => send({ set_scene: place })}
          onMakeVideo={() => makeVideo()}
          videoTokens={reelTokens}
          videoNote={reelNote?.text ?? null}
          onExit={() => setTheater(false)}
        />
      )}
      {scene.lines.length > 0 && (
        <p className="muted small">
          {scene.place ? `Now: ${scene.place}. ` : ""}So far: {STAGES[scene.stage] ?? STAGES[0]}.
        </p>
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
        <p className="muted">Nothing yet. Write the first lines, or steer it first.</p>
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
        <label htmlFor="after-dark-direction">Steer it (optional)</label>
        <input id="after-dark-direction" value={direction} maxLength={300} onChange={(e) => setDirection(e.target.value)} placeholder="They go back to hers…" disabled={busy} />
        <p>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Writing…" : "Write the next lines"}
          </button>{" "}
          <button type="button" className="button-ghost" disabled={busy || !scene.lines.length} onClick={() => void send({ reset: true })}>
            Start over
          </button>
        </p>
      </form>
      {watching && (
        <AfterDarkTheater
          scene={{ lines: watching.lines, place: watching.place, stage: watching.stage, dateVenue: watching.date_venue, set: watching.set_place }}
          characters={characters}
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
                {new Date(n.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · {n.lines.length} lines
                {n.place ? ` · ended ${n.place}` : ""}
              </li>
            ))}
          </ul>
        </section>
      )}
      {reelNote && (
        <p className={reelNote.error ? "error" : "muted small"} role="status">
          {reelNote.text}
        </p>
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
