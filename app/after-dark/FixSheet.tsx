"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { requestJson } from "@/app/request";
import type { FixKind, FixState, FixVersion, RepairId, Spot } from "@/lib/adult/fix";
import type { Media } from "@/lib/adult/media";
import FixCompare from "./FixCompare";

/**
 * 🩹 Fix (lib/adult/fix.ts; David, 2026-11-09: "a way to iterate over a broken image and fix it"): the button beside a
 * picture's rating, bolder once they've said what's off, and the sheet it opens. Repair what's broken (chips, their
 * words if they like), the faces, one change in their words, or the same picture undressed; a spot marked on the
 * picture keeps the fix to it. Each fix is a new version, made from the one on screen, so it can be fixed again; Keep
 * makes one the version the galleries show. Before and after compare any version with the one it was made from. The
 * sheet opens on the page's FixHost (outside its galleries) when it has one.
 */
/** What a sheet is opened on, and who's told what it made and what Keep changed. */
type FixAsk = {
  id: string;
  src: (id: string) => string;
  label: string;
  said: readonly string[];
  onAdded?: (picture: Media) => void;
  onKept?: (kept: Media, hidden: string[]) => void;
};

/** The page's FixHost, when it has one: the sheet opens there. */
let openOnHost: ((ask: FixAsk) => void) | null = null;

export default function FixButton({
  id,
  src,
  label,
  nudge = false,
  said = [],
  onAdded,
  onKept,
}: {
  id: string;
  src: (id: string) => string;
  label: string;
  /** Bolder: they've just said something's off with it (a 👎 and what's off). */
  nudge?: boolean;
  /** What they said was off (lib/adult/rating-tags.ts PICTURE_TAGS), to start the sheet on the right fix. */
  said?: readonly string[];
  onAdded?: (picture: Media) => void;
  onKept?: (kept: Media, hidden: string[]) => void;
}) {
  // No FixHost on the page: the sheet opens here, beside the button.
  const [here, setHere] = useState<FixAsk | null>(null);
  const open = () => {
    const ask = { id, src, label, said, onAdded, onKept };
    if (openOnHost) openOnHost(ask);
    else setHere(ask);
  };
  return (
    <div className={`ad-fix${nudge ? " nudge" : ""}`}>
      {nudge && <p className="small">Something off? Fix just that and keep the rest: free, as many as five times.</p>}
      <button
        type="button"
        className={`small ${nudge ? "secondary" : "button-ghost"}`}
        onClick={open}
        title="Fix what's wrong, change one thing, or the same picture undressed"
        data-track="after-dark-fix-open"
      >
        🩹 Fix
      </button>
      {here && <OpenSheet ask={here} onDone={() => setHere(null)} />}
    </div>
  );
}

/**
 * Where the Fix sheet opens, once a page, outside its galleries (the Studio, a night's page). A gallery refreshes on
 * its own (an animation landing, a new picture), and once Keep has taken a version out of it, its tile goes; a sheet
 * that lived in the tile went with it.
 */
export function FixHost() {
  const [ask, setAsk] = useState<FixAsk | null>(null);
  useEffect(() => {
    openOnHost = setAsk;
    return () => {
      if (openOnHost === setAsk) openOnHost = null;
    };
  }, []);
  return ask ? <OpenSheet key={ask.id} ask={ask} onDone={() => setAsk(null)} /> : null;
}

/** An open sheet, and what Keep changed, told to the gallery when it closes (so it isn't rearranged behind the sheet). */
function OpenSheet({ ask, onDone }: { ask: FixAsk; onDone: () => void }) {
  const kept = useRef<{ picture: Media; hidden: string[] } | null>(null);
  const close = () => {
    onDone();
    const k = kept.current;
    kept.current = null;
    if (k) ask.onKept?.(k.picture, k.hidden);
  };
  return (
    <FixSheet
      id={ask.id}
      src={ask.src}
      label={ask.label}
      said={ask.said}
      onClose={close}
      onAdded={ask.onAdded}
      onKept={(picture, hidden) => {
        kept.current = { picture, hidden };
      }}
    />
  );
}

/** What a 👎 can say is off that a fix can put right (lib/adult/rating-tags.ts PICTURE_TAGS). */
const FIXABLE = ["face", "anatomy", "pose", "blurry", "body", "outfit"];
/** Bolder Fix: they've said it's off, and how. */
export const fixNudge = (rating: number | null | undefined, tags: readonly string[]): boolean => rating === -1 && tags.some((t) => FIXABLE.includes(t));

type Mode = FixKind;
const MODES: { id: Mode; label: string }[] = [
  { id: "repair", label: "🩹 Repair" },
  { id: "faces", label: "🙂 Faces" },
  { id: "change", label: "✏️ Change" },
  { id: "undress", label: "Undressed" },
];
const KIND_LABEL: Record<FixKind, string> = { faces: "Faces", repair: "Repair", change: "Change", undress: "Undressed" };

/** Where the sheet starts, from what they said was off: the faces, or a repair with its chips picked. */
function startFrom(said: readonly string[]): { mode: Mode; repairs: RepairId[] } {
  if (said.includes("face")) return { mode: "faces", repairs: [] };
  const repairs = new Set<RepairId>();
  if (said.includes("anatomy")) ["hands", "limbs"].forEach((r) => repairs.add(r as RepairId));
  if (said.includes("pose")) repairs.add("limbs");
  if (said.includes("blurry")) repairs.add("glitches");
  return { mode: "repair", repairs: [...repairs] };
}

const versionName = (v: FixVersion, n: number): string => (v.kind ? `Fix ${n} · ${KIND_LABEL[v.kind]}` : "Original");
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function FixSheet({
  id,
  src,
  label,
  said,
  onClose,
  onAdded,
  onKept,
}: {
  id: string;
  src: (id: string) => string;
  label: string;
  said: readonly string[];
  onClose: () => void;
  onAdded?: (picture: Media) => void;
  onKept?: (kept: Media, hidden: string[]) => void;
}) {
  const start = startFrom(said);
  const [state, setState] = useState<FixState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [current, setCurrent] = useState(id);
  const [mode, setMode] = useState<Mode>(start.mode);
  const [repairs, setRepairs] = useState<RepairId[]>(start.repairs);
  const [note, setNote] = useState("");
  const [who, setWho] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);
  const [spot, setSpot] = useState<Spot | null>(null);
  const [busy, setBusy] = useState<"fix" | "keep" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);
  const pic = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const strip = useRef<HTMLOListElement>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/admin/after-dark/fix?media_id=${encodeURIComponent(id)}`)
      .then(async (r) => ({ ok: r.ok, body: (await r.json().catch(() => ({}))) as { state?: FixState; message?: string } }))
      .then(({ ok, body }) => {
        if (!live) return;
        if (ok && body.state) setState(body.state);
        else setLoadError(body.message ?? "That picture can't be fixed.");
      })
      .catch(() => live && setLoadError("That didn't reach the server. Close and try again."));
    closeButton.current?.focus();
    return () => {
      live = false;
    };
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  // Marking a spot: on a phone the picture can be scrolled out of sight above the form, so it comes back into view.
  useEffect(() => {
    if (marking) pic.current?.scrollIntoView({ block: "nearest" });
  }, [marking]);

  // The version on screen in view in the strip, which on a phone runs past the edge: scrolled sideways only.
  const count = state?.versions.length ?? 0;
  useEffect(() => {
    const ol = strip.current;
    const on = ol?.querySelector<HTMLElement>(".is-on");
    if (!ol || !on) return;
    const by = on.getBoundingClientRect().left - ol.getBoundingClientRect().left - (ol.clientWidth - on.offsetWidth) / 2;
    ol.scrollLeft = Math.max(0, ol.scrollLeft + by);
  }, [current, count]);

  const versions = state?.versions ?? [];
  const at = versions.findIndex((v) => v.id === current);
  const shownVersion = at >= 0 ? versions[at] : null;
  const parent = shownVersion?.from ?? null;
  // Keep is for a version that isn't already the only one the galleries show.
  const keepable = Boolean(shownVersion) && !(shownVersion!.shown && versions.filter((v) => v.shown).length === 1);
  const shownPeople = (state?.people ?? []).filter((p) => p.shown);
  const left = state?.left ?? 0;
  const undress = state?.undress;

  // A spot: dragged across the picture, kept as fractions of it.
  const point = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = pic.current!.getBoundingClientRect();
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
  };
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!marking || !pic.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = point(e);
    setSpot({ ...drag.current, w: 0, h: 0 });
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const p = point(e);
    const o = drag.current;
    setSpot({ x: Math.min(o.x, p.x), y: Math.min(o.y, p.y), w: Math.abs(p.x - o.x), h: Math.abs(p.y - o.y) });
  };
  const up = () => {
    if (!drag.current) return;
    drag.current = null;
    setMarking(false);
    setSpot((s) => (s && s.w >= 0.04 && s.h >= 0.04 ? s : null));
  };

  const spotFits = mode === "repair" || mode === "change";
  const faceMissing = mode === "faces" && shownPeople.filter((p) => !who || p.id === who).some((p) => !p.face);
  const ready =
    Boolean(state) &&
    !state?.blocked &&
    left > 0 &&
    !busy &&
    (mode === "repair" ? repairs.length > 0 || note.trim().length > 0 : mode === "change" ? note.trim().length > 0 : mode === "undress" ? Boolean(undress?.ok) : !faceMissing);

  async function fix() {
    setBusy("fix");
    setError(null);
    setDone(null);
    const body = {
      media_id: current,
      kind: mode,
      ...(mode === "repair" ? { repairs } : {}),
      ...(spotFits && note.trim() ? { note: note.trim() } : {}),
      ...(spotFits && spot ? { spot } : {}),
      ...(who && (mode === "faces" || mode === "undress") ? { who } : {}),
    };
    const res = await requestJson("/api/admin/after-dark/fix", body, "POST", { timeoutMs: 290_000 }).catch(() => null);
    setBusy(null);
    if (!res) return setError("That didn't reach the server. Try again.");
    if (!res.ok) return setError(res.message);
    const picture = res.data.picture as Media;
    if (res.data.state) setState(res.data.state as FixState);
    setCurrent(picture.id);
    setCompare(true);
    setSpot(null);
    setDone("Here it is, beside the one it came from: compare them, keep it, or fix it again from here.");
    onAdded?.(picture);
  }

  async function keep(versionId: string) {
    setBusy("keep");
    setError(null);
    const res = await requestJson("/api/admin/after-dark/fix", { action: "keep", media_id: versionId }).catch(() => null);
    setBusy(null);
    if (!res) return setError("That didn't reach the server. Try again.");
    if (!res.ok) return setError(res.message);
    setState(res.data.state as FixState);
    const hidden = (res.data.hidden as string[]) ?? [];
    setDone(versionId === state?.root ? "Back to the original: the fixes leave the gallery when you close this." : "Kept: the gallery shows this one, not the others, when you close this.");
    onKept?.(res.data.picture as Media, hidden);
  }

  const pick = (v: FixVersion) => {
    setCurrent(v.id);
    setCompare(false);
    setSpot(null);
    setMarking(false);
    setDone(null);
  };

  return (
    <div className="ad-storyboard-backdrop ad-fixsheet-backdrop" role="dialog" aria-modal="true" aria-label={`Fix ${label.toLowerCase()}`} onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="ad-storyboard ad-fixsheet">
        <div className="ad-storyboard-head">
          <strong>🩹 Fix it</strong>
          {state && <span className="small muted">{left > 0 ? `${left} fix${left === 1 ? "" : "es"} left for this picture` : "No fixes left for this picture"}</span>}
          <button type="button" className="button-ghost small" onClick={onClose} ref={closeButton}>
            {busy === "fix" ? "Close (it carries on)" : "Close"}
          </button>
        </div>
        {loadError && (
          <p className="error small" role="status">
            {loadError}
          </p>
        )}
        {!state && !loadError && (
          <p className="small muted" role="status">
            Looking at the picture…
          </p>
        )}
        {state && (
          <div className="ad-fixsheet-body">
            <div className="ad-fixsheet-view">
              {compare && parent ? (
                <FixCompare before={src(parent)} after={src(current)} label={label} />
              ) : (
                <div
                  ref={pic}
                  className={`ad-fixsheet-pic${marking ? " is-marking" : ""}`}
                  onPointerDown={down}
                  onPointerMove={move}
                  onPointerUp={up}
                  onPointerCancel={up}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- private, presigned media */}
                  <img src={src(current)} alt={`${label}${shownVersion ? `, ${versionName(shownVersion, at).toLowerCase()}` : ""}`} draggable={false} />
                  {spot && spot.w > 0 && (
                    <span className="ad-fixsheet-spot" style={{ left: `${spot.x * 100}%`, top: `${spot.y * 100}%`, width: `${spot.w * 100}%`, height: `${spot.h * 100}%` }} aria-hidden="true" />
                  )}
                </div>
              )}
              <div className="ad-chip-row ad-fixsheet-view-tools">
                {parent && (
                  <button type="button" className={`ad-chip${compare ? " on" : ""}`} aria-pressed={compare} onClick={() => setCompare((c) => !c)}>
                    Before and after
                  </button>
                )}
                {spotFits && !compare && (
                  <>
                    <button type="button" className={`ad-chip${marking ? " on" : ""}`} aria-pressed={marking} onClick={() => setMarking((m) => !m)} title="Drag across what's wrong: only that spot changes">
                      {spot ? "▭ Mark again" : "▭ Mark the spot"}
                    </button>
                    {spot && (
                      <button type="button" className="ad-chip" onClick={() => setSpot(null)}>
                        Clear the spot
                      </button>
                    )}
                  </>
                )}
              </div>
              {marking && <p className="small muted">Drag across what&apos;s wrong. Only that spot changes; the rest stays exactly as it is.</p>}
              {versions.length > 1 && (
                <ol ref={strip} className="ad-fixsheet-versions" aria-label="Versions">
                  {versions.map((v, n) => (
                    <li key={v.id}>
                      <button type="button" className={`ad-fixsheet-version${v.id === current ? " is-on" : ""}`} aria-pressed={v.id === current} onClick={() => pick(v)}>
                        {/* eslint-disable-next-line @next/next/no-img-element -- private, presigned media */}
                        <img src={src(v.id)} alt="" loading="lazy" />
                        <span className="small">{versionName(v, n)}</span>
                        {state.kept === v.id && <span className="badge small">Kept</span>}
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              {versions.length > 1 && (
                <div className="ad-chip-row">
                  {keepable && shownVersion && (
                    <button type="button" className="secondary small" disabled={Boolean(busy)} onClick={() => void keep(current)} data-track="after-dark-fix-keep">
                      {busy === "keep" ? "Keeping…" : shownVersion.kind ? "✓ Keep this one" : "↩ Back to the original"}
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="ad-fixsheet-form">
              <div className="ad-chip-row ad-fixsheet-modes" role="radiogroup" aria-label="What to fix">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={mode === m.id}
                    className={`ad-chip${mode === m.id ? " on" : ""}`}
                    onClick={() => {
                      setMode(m.id);
                      setError(null);
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {mode === "repair" && (
                <>
                  <p className="small muted">What&apos;s broken? Pick any, mark the spot if you like, and only that gets redrawn.</p>
                  <div className="ad-chip-row" role="group" aria-label="What's broken">
                    {state.repairs.map((r) => {
                      const on = repairs.includes(r.id);
                      return (
                        <button key={r.id} type="button" aria-pressed={on} className={`ad-chip${on ? " on" : ""}`} onClick={() => setRepairs((x) => (on ? x.filter((y) => y !== r.id) : [...x, r.id]))}>
                          {r.label}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
              {mode === "change" && <p className="small muted">One change, in a few words: &ldquo;take the glass off the table&rdquo;, &ldquo;her hair a little shorter&rdquo;.</p>}
              {spotFits && (
                <label className="ad-fixsheet-words">
                  <span className="small">{mode === "change" ? "The change" : "Or say what's wrong (optional)"}</span>
                  <textarea
                    value={note}
                    maxLength={state.note_max}
                    rows={2}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={mode === "change" ? "What to change" : "Her left hand has six fingers"}
                  />
                </label>
              )}
              {mode === "faces" && (
                <p className="small muted">
                  {faceMissing ? "Each of them needs a face picked first: pick one in the Studio." : "Each face redrawn as the face they keep. Nothing else changes."}
                </p>
              )}
              {mode === "undress" && (
                <p className="small muted">
                  {undress?.ok
                    ? `The same picture, the same pose and place, without clothes${undress.empty_place ? ", and with the place empty: it's somewhere public" : ""}.`
                    : undress?.why}
                </p>
              )}
              {(mode === "faces" || mode === "undress") && shownPeople.length > 1 && (
                <div className="ad-chip-row" role="radiogroup" aria-label="Who">
                  {[{ id: null as string | null, name: "Both" }, ...shownPeople.map((p) => ({ id: p.id as string | null, name: p.name }))].map((p) => (
                    <button key={p.id ?? "both"} type="button" role="radio" aria-checked={who === p.id} className={`ad-chip${who === p.id ? " on" : ""}`} onClick={() => setWho(p.id)}>
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
              {shownVersion && versions.length > 1 && <p className="small muted">Fixing from {versionName(shownVersion, at).toLowerCase()}.</p>}
              <div className="ad-storyboard-actions">
                <button type="button" className="primary" disabled={!ready} onClick={() => void fix()} data-track={`after-dark-fix-${mode}`}>
                  {busy === "fix"
                    ? "Fixing… about a minute"
                    : mode === "undress"
                      ? `Undress ${shownPeople.length > 1 && !who ? "them" : (shownPeople.find((p) => p.id === who)?.name ?? shownPeople[0]?.name ?? "them")}${undress && undress.price > 0 ? ` · ${undress.price} token${undress.price === 1 ? "" : "s"}` : " · free"}`
                      : mode === "change"
                        ? "Make the change · free"
                        : mode === "faces"
                          ? "Fix the faces · free"
                          : "Fix it · free"}
                </button>
                {state.blocked ? (
                  <span className="small muted">{state.blocked}</span>
                ) : (
                  left === 0 && <span className="small muted">That&apos;s the most for one picture: a new one is the better start.</span>
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
