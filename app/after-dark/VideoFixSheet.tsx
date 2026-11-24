"use client";

import { useEffect, useRef, useState } from "react";
import { requestJson } from "@/app/request";
import { problemsFromTags, type VideoFixState, type VideoFixVersion, type VideoProblem } from "@/lib/adult/video-fix-shared";
import FixButton from "./FixSheet";
import TokenPrice from "./TokenPrice";

/**
 * 🩹 Fix for a Studio animation (lib/adult/video-fix.ts; David, 2026-11-24: "There is no way to fix a video"): the
 * button beside a video's rating, bolder once they've said what's off, and the sheet it opens. Say what went wrong (the
 * chips, started on what the 👎 said) and, if they like, change what happens; it's filmed again from where it started,
 * and lands in the gallery as a new version beside the one it fixed. The first fix of a video marked broken is free.
 * The picture it starts from can be fixed first (the picture's own 🩹 Fix). Keep makes one version the one the
 * galleries show. The sheet opens on the page's VideoFixHost (outside its galleries) when it has one.
 */
type VideoFixAsk = {
  id: string;
  src: (id: string) => string;
  label: string;
  said: readonly string[];
  onMade?: () => void;
  onKept?: () => void;
};

/** The page's VideoFixHost, when it has one: the sheet opens there. */
let openOnHost: ((ask: VideoFixAsk) => void) | null = null;

/** What a 👎 can say is off with a video that filming it again can put right (lib/adult/rating-tags.ts VIDEO_TAGS). */
const FIXABLE = ["wrong_person", "motion", "anatomy", "blurry"];
/** Bolder Fix: they've 👎'd it, for something filming it again can put right (or without saying why). */
export const videoFixNudge = (rating: number | null | undefined, tags: readonly string[]): boolean => rating === -1 && (tags.length === 0 || tags.some((t) => FIXABLE.includes(t)));

export default function VideoFixButton({
  id,
  src,
  label,
  nudge = false,
  said = [],
  onMade,
  onKept,
}: {
  id: string;
  src: (id: string) => string;
  label: string;
  /** Bolder: they've just said something's off with it (a 👎). */
  nudge?: boolean;
  /** What they said was off (VIDEO_TAGS), to start the sheet on those chips. */
  said?: readonly string[];
  /** A fix is being filmed: the page picks it up as it polls. */
  onMade?: () => void;
  /** Keep changed which version the galleries show. */
  onKept?: () => void;
}) {
  // No VideoFixHost on the page: the sheet opens here, beside the button.
  const [here, setHere] = useState<VideoFixAsk | null>(null);
  const open = () => {
    const ask = { id, src, label, said, onMade, onKept };
    if (openOnHost) openOnHost(ask);
    else setHere(ask);
  };
  return (
    <div className={`ad-fix${nudge ? " nudge" : ""}`}>
      {nudge && <p className="small">Something off? Fix films it again, told what went wrong.</p>}
      <button type="button" className={`small ${nudge ? "secondary" : "button-ghost"}`} onClick={open} title="Film it again, told what went wrong" data-track="after-dark-video-fix-open">
        🩹 Fix
      </button>
      {here && <OpenSheet ask={here} onDone={() => setHere(null)} />}
    </div>
  );
}

/** Where the video Fix sheet opens, once a page, outside its galleries (a gallery refreshing would take a tile's sheet with it). */
export function VideoFixHost() {
  const [ask, setAsk] = useState<VideoFixAsk | null>(null);
  useEffect(() => {
    openOnHost = setAsk;
    return () => {
      if (openOnHost === setAsk) openOnHost = null;
    };
  }, []);
  return ask ? <OpenSheet key={ask.id} ask={ask} onDone={() => setAsk(null)} /> : null;
}

/** An open sheet; a Keep is told to the gallery when it closes (so it isn't rearranged behind the sheet). */
function OpenSheet({ ask, onDone }: { ask: VideoFixAsk; onDone: () => void }) {
  const kept = useRef(false);
  const close = () => {
    onDone();
    if (kept.current) ask.onKept?.();
    kept.current = false;
  };
  return (
    <VideoFixSheet
      id={ask.id}
      src={ask.src}
      label={ask.label}
      said={ask.said}
      onClose={close}
      onMade={ask.onMade}
      onKept={() => {
        kept.current = true;
      }}
    />
  );
}

const versionName = (v: VideoFixVersion, n: number): string => (n === 0 ? "Original" : `Fix ${n}`);

function VideoFixSheet({
  id,
  src,
  label,
  said,
  onClose,
  onMade,
  onKept,
}: {
  id: string;
  src: (id: string) => string;
  label: string;
  said: readonly string[];
  onClose: () => void;
  onMade?: () => void;
  onKept?: () => void;
}) {
  const [state, setState] = useState<VideoFixState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [current, setCurrent] = useState(id);
  const [problems, setProblems] = useState<VideoProblem[]>(() => problemsFromTags(said));
  const [words, setWords] = useState<string | null>(null);
  const [busy, setBusy] = useState<"fix" | "keep" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  // The sheet's state for the version on screen (its words, the picture it starts from), the versions the same for all.
  const load = (mediaId: string, live: () => boolean = () => true) =>
    fetch(`/api/admin/after-dark/video-fix?media_id=${encodeURIComponent(mediaId)}`)
      .then(async (r) => ({ ok: r.ok, body: (await r.json().catch(() => ({}))) as { state?: VideoFixState; message?: string } }))
      .then(({ ok, body }) => {
        if (!live()) return;
        if (ok && body.state) setState(body.state);
        else setLoadError(body.message ?? "That video can't be fixed.");
      })
      .catch(() => live() && setLoadError("That didn't reach the server. Close and try again."));

  useEffect(() => {
    let live = true;
    void load(id, () => live);
    closeButton.current?.focus();
    return () => {
      live = false;
    };
    // Loaded once a sheet: `id` is the video it was opened on.
  }, [id]);

  useEffect(() => {
    // The picture's own Fix sheet, opened from this one, sits on top: Escape is that one's until it closes.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || busy) return;
      const open = document.querySelectorAll(".ad-fixsheet-backdrop");
      if (open.length && open[open.length - 1] !== sheet.current) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const versions = state?.versions ?? [];
  const at = versions.findIndex((v) => v.id === current);
  const shownVersion = at >= 0 ? versions[at] : null;
  const keepable = Boolean(shownVersion) && !(shownVersion!.shown && versions.filter((v) => v.shown).length === 1);
  const left = state?.left ?? 0;
  const text = words ?? state?.words ?? "";
  const changed = state ? text.trim().replace(/\s+/g, " ") !== state.words : false;
  const free = Boolean(state?.free) && problems.length > 0;
  const ready = Boolean(state) && left > 0 && !state?.making && !busy && (problems.length > 0 || changed);

  async function fix() {
    setBusy("fix");
    setError(null);
    setDone(null);
    const body = { media_id: current, problems, ...(changed ? { words: text } : {}) };
    const res = await requestJson("/api/admin/after-dark/video-fix", body).catch(() => null);
    setBusy(null);
    if (!res) return setError("That didn't reach the server. Try again.");
    if (!res.ok) return setError(res.message);
    if (res.data.state) setState(res.data.state as VideoFixState);
    setDone(typeof res.data.message === "string" ? res.data.message : "Filming it again: it lands in the gallery in a few minutes.");
    onMade?.();
  }

  async function keep(versionId: string) {
    setBusy("keep");
    setError(null);
    const res = await requestJson("/api/admin/after-dark/video-fix", { action: "keep", media_id: versionId }).catch(() => null);
    setBusy(null);
    if (!res) return setError("That didn't reach the server. Try again.");
    if (!res.ok) return setError(res.message);
    setState(res.data.state as VideoFixState);
    setDone(versionId === state?.root ? "Back to the original: the fixes leave the gallery when you close this." : "Kept: the gallery shows this one, not the others, when you close this.");
    onKept?.();
  }

  const pick = (v: VideoFixVersion) => {
    setCurrent(v.id);
    setWords(null);
    setDone(null);
    void load(v.id);
  };

  return (
    <div
      ref={sheet}
      className="ad-storyboard-backdrop ad-fixsheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`Fix ${label.toLowerCase()}`}
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <div className="ad-storyboard ad-fixsheet">
        <div className="ad-storyboard-head">
          <strong>🩹 Fix the video</strong>
          {state && <span className="small muted">{left > 0 ? `${left} fix${left === 1 ? "" : "es"} left for this video` : "No fixes left for this video"}</span>}
          <button type="button" className="button-ghost small" onClick={onClose} ref={closeButton}>
            Close
          </button>
        </div>
        {loadError && (
          <p className="error small" role="status">
            {loadError}
          </p>
        )}
        {!state && !loadError && (
          <p className="small muted" role="status">
            Looking at the video…
          </p>
        )}
        {state && (
          <div className="ad-fixsheet-body">
            <div className="ad-fixsheet-view">
              <div className="ad-fixsheet-clip">
                <video key={current} src={src(current)} controls playsInline loop autoPlay muted preload="metadata" aria-label={`${label}, ${shownVersion ? versionName(shownVersion, at).toLowerCase() : "the video"}`} />
              </div>
              {shownVersion?.note && <p className="small muted">{`${versionName(shownVersion, at)}: ${shownVersion.note}`}</p>}
              {versions.length > 1 && (
                <div className="ad-chip-row" role="radiogroup" aria-label="Versions">
                  {versions.map((v, n) => (
                    <button key={v.id} type="button" role="radio" aria-checked={v.id === current} className={`ad-chip${v.id === current ? " on" : ""}`} onClick={() => pick(v)}>
                      {versionName(v, n)}
                      {state.kept === v.id ? " · kept" : ""}
                    </button>
                  ))}
                </div>
              )}
              {versions.length > 1 && keepable && shownVersion && (
                <div className="ad-chip-row">
                  <button type="button" className="secondary small" disabled={Boolean(busy)} onClick={() => void keep(current)} data-track="after-dark-video-fix-keep">
                    {busy === "keep" ? "Keeping…" : at > 0 ? "✓ Keep this one" : "↩ Back to the original"}
                  </button>
                </div>
              )}
            </div>

            <div className="ad-fixsheet-form">
              <p className="small muted">What went wrong? Pick any: it&apos;s filmed again from where it started, told to put that right.</p>
              <div className="ad-chip-row" role="group" aria-label="What went wrong">
                {state.problems.map((p) => {
                  const on = problems.includes(p.id);
                  return (
                    <button key={p.id} type="button" aria-pressed={on} className={`ad-chip${on ? " on" : ""}`} onClick={() => setProblems((x) => (on ? x.filter((y) => y !== p.id) : [...x, p.id]))}>
                      {p.label}
                    </button>
                  );
                })}
              </div>
              <label className="ad-fixsheet-words">
                <span className="small">{state.words ? "What happens (change it if you like)" : "What should happen (optional)"}</span>
                <textarea
                  value={text}
                  maxLength={state.words_max}
                  rows={2}
                  onChange={(e) => setWords(e.target.value)}
                  placeholder={state.motion ? `As it was: ${state.motion.toLowerCase()}` : "She turns to the camera and laughs"}
                />
              </label>
              {state.start && (
                <div className="ad-fixsheet-start">
                  {/* eslint-disable-next-line @next/next/no-img-element -- private, presigned media */}
                  <img src={`${src(state.start)}?w=160`} alt="The picture it starts from" />
                  <p className="small muted">
                    It starts from this picture. If the trouble&apos;s in the picture (a face, a hand), fix it first and keep the fixed one: the video starts from the one you keep.
                  </p>
                  <FixButton id={state.start} src={src} label="The picture it starts from" onKept={() => void load(current)} />
                </div>
              )}
              {versions.length > 1 && shownVersion && <p className="small muted">Fixing {versionName(shownVersion, at).toLowerCase()}.</p>}
              <div className="ad-storyboard-actions">
                <button type="button" className="primary" disabled={!ready} onClick={() => void fix()} data-track="after-dark-video-fix">
                  {busy === "fix" ? (
                    "Sending it…"
                  ) : (
                    <>
                      🎬 Film it again · <TokenPrice tokens={free ? 0 : state.price} />
                    </>
                  )}
                </button>
                {state.making ? (
                  <span className="small muted">A fix of it is being filmed: it lands in the gallery in a few minutes.</span>
                ) : left === 0 ? (
                  <span className="small muted">That&apos;s the most for one video: animating the picture again is the better start.</span>
                ) : (
                  state.free &&
                  !problems.length && <span className="small muted">The first fix is free once you say what went wrong.</span>
                )}
              </div>
              {error && (
                <p className="error small" role="status">
                  {error}
                </p>
              )}
              {done && (
                <p className="small" role="status">
                  {done}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
