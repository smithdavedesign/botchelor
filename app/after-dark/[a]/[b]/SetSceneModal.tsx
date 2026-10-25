"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { filterScenes, SCENE_CATEGORIES, SCENE_TAGS, type CatalogScene, type SceneCategory, type SceneTag } from "@/lib/adult/scene-catalog";
import { normalizeScene } from "@/lib/venues";
import { ROLEPLAYS, roleplayById, rolesLine, type Roleplay } from "@/lib/adult/roleplays";

const ICON = Object.fromEntries(SCENE_CATEGORIES.map((c) => [c.id, c.icon])) as Record<SceneCategory, string>;

/** What the second screen sends: a roleplay for the chapter, or none. */
export type RoleplayPick = { id: string; swap: boolean } | null;

/**
 * 📍 Scene & roleplay, as a full-screen picker in two screens (David, 2026-10-25: after choosing a venue "they can choose a
 * roleplay for the chapter in the same modal it switches to the next screen"). First where, then who they are to each
 * other this chapter (lib/adult/roleplays.ts), or no roleplay; "Just the roleplay" skips the move and its token.
 * The first screen is the full-screen picker (David, 2026-10-25: "all the scenes we have in a giant modal popup with
 * filters and tags"), every place in lib/adult/scene-catalog.ts as a card with its picture, narrowed by a roleplay
 * category, any number of tags and a search, with a box to type somewhere of their own. A card takes them there (1
 * token, set_scene); a scenario's card can start the night as that story instead (files tonight, like Start over).
 * Closes on Esc, the ✕ or a click outside the panel. It stays mounted once opened (hidden while closed), so its pictures,
 * filters and scroll are still there next time; the theater preloads the pictures in the background (preloadScenes).
 */
export default function SetSceneModal({
  open = true,
  scenes,
  busy = false,
  current = null,
  locked = null,
  names,
  myRoleplays = [],
  createHref = null,
  roleplay = null,
  openAt = "where",
  onGo,
  onScenario,
  onClose,
}: {
  /** Shown; false keeps it mounted but hidden. */
  open?: boolean;
  scenes: readonly CatalogScene[];
  busy?: boolean;
  /** Where they are now: its card says so. */
  current?: string | null;
  /**
   * Why the place can't change now (the two agreed it by text, lib/adult/scenes.ts textedPlan): the picker opens on the
   * roleplays, staying put, and Where says this instead of its cards.
   */
  locked?: string | null;
  /** Their first names, for the roles ("Dex plays the boss"). */
  names: { a: string; b: string };
  /** The owner's own roleplays (lib/studio/library.ts), filed under ✨ Yours with the show's. */
  myRoleplays?: readonly Roleplay[];
  /** Where to make your own venues and roleplays (the Studio's Create tab). */
  createHref?: string | null;
  /** This chapter's roleplay, if one is running. */
  roleplay?: RoleplayPick;
  /** Which screen it opens on: where (the places), or who they are (the roleplays, staying where they are). */
  openAt?: "where" | "who";
  /** A place (null: they stay where they are) and the chapter's roleplay. */
  onGo: (place: string | null, roleplay: RoleplayPick) => Promise<void>;
  onScenario?: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const [category, setCategory] = useState<SceneCategory | null>(null);
  const [tags, setTags] = useState<SceneTag[]>([]);
  const [query, setQuery] = useState("");
  const [own, setOwn] = useState("");
  // Cards whose picture didn't load (a set not drawn yet) paint their gradient instead.
  const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set());
  // The second screen: the place picked on the first (null: staying put), and the roleplay being picked.
  const [step, setStep] = useState<"where" | "who">(openAt);
  const [place, setPlace] = useState<string | null>(null);
  const [pick, setPick] = useState<RoleplayPick>(roleplay);
  const [rpCategory, setRpCategory] = useState<SceneCategory | null>(null);
  // Each time it opens: the screen asked for, the running roleplay picked.
  useEffect(() => {
    if (!open) return;
    setStep(locked ? "who" : openAt);
    setPlace(null);
    setPick(roleplay);
    // Only on opening: the roleplay prop changes after a pick lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, openAt]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  // The ones with a picture first, so the list doesn't open on a row of plain gradients.
  const shown = useMemo(() => {
    const found = filterScenes(scenes, { category, tags, query });
    return [...found.filter((s) => s.image), ...found.filter((s) => !s.image)];
  }, [scenes, category, tags, query]);
  const counts = useMemo(() => Object.fromEntries(SCENE_CATEGORIES.map((c) => [c.id, filterScenes(scenes, { category: c.id, tags, query }).length])), [scenes, tags, query]);
  const here = current ? normalizeScene(current) : null;

  const choose = (where: string | null) => {
    setPlace(where);
    setStep("who");
  };
  async function go(rp: RoleplayPick) {
    await onGo(place, rp);
    onClose();
  }
  function typed(e: FormEvent) {
    e.preventDefault();
    if (own.trim()) choose(own.trim());
  }
  // Theirs first, filed under ✨ Yours (and their own category too).
  const allRoleplays: readonly Roleplay[] = [...myRoleplays, ...ROLEPLAYS];
  const isMine = (r: Roleplay) => r.id.startsWith("u:");
  const inCat = (r: Roleplay, c: SceneCategory) => (c === "mine" ? isMine(r) : r.category === c);
  const rpCats = SCENE_CATEGORIES.filter((c) => allRoleplays.some((r) => inCat(r, c.id)));
  const roleplays = rpCategory ? allRoleplays.filter((r) => inCat(r, rpCategory)) : allRoleplays;
  const picked = pick ? (roleplayById(pick.id) ?? myRoleplays.find((r) => r.id === pick.id) ?? null) : null;
  const fill = (text: string, swap: boolean) => text.replaceAll("{a}", swap ? names.b : names.a).replaceAll("{b}", swap ? names.a : names.b);

  return (
    <div className="ad-scenes-overlay" hidden={!open} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ad-scenes" role="dialog" aria-modal="true" aria-label="Scene and roleplay">
        <header className="ad-scenes-head">
          <div>
            <h2>📍 Scene &amp; roleplay</h2>
            <ol className="ad-scenes-steps" aria-label="Steps">
              <li className={step === "where" ? "on" : ""}>
                <button type="button" className="linklike" onClick={() => setStep("where")} disabled={Boolean(locked)} title={locked ?? undefined}>
                  1. Where{locked ? " 🔒" : ""}
                </button>
              </li>
              <li className={step === "who" ? "on" : ""}>2. Who they are this chapter</li>
            </ol>
          </div>
          <button type="button" className="theater-icon" aria-label="Close" title="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        {step === "who" ? (
          <>
            <div className="ad-scenes-search ad-rp-where">
              <span>
                {place ? (
                  <>
                    📍 <strong>{place}</strong> <span className="muted small">· 1 token</span>
                  </>
                ) : (
                  <span className="muted">📍 They stay where they are</span>
                )}
              </span>
              {locked ? (
                <span className="muted small ad-rp-locked">🔒 {locked}</span>
              ) : (
                <button type="button" className="button-ghost small" onClick={() => setStep("where")}>
                  ← {place ? "Somewhere else" : "Move them too"}
                </button>
              )}
            </div>
            <div className="ad-scenes-cats" role="radiogroup" aria-label="Roleplay category">
              <button type="button" role="radio" aria-checked={!rpCategory} className={!rpCategory ? "on" : ""} onClick={() => setRpCategory(null)}>
                ✨ All <span className="ad-scenes-count">{allRoleplays.length}</span>
              </button>
              {rpCats.map((c) => (
                <button key={c.id} type="button" role="radio" aria-checked={rpCategory === c.id} className={rpCategory === c.id ? "on" : ""} onClick={() => setRpCategory(rpCategory === c.id ? null : c.id)}>
                  {c.icon} {c.label} <span className="ad-scenes-count">{allRoleplays.filter((r) => inCat(r, c.id)).length}</span>
                </button>
              ))}
            </div>
            {createHref && (
              <p className="muted small ad-scenes-make">
                ✨ Your own roleplays sit beside these. <a href={createHref}>Make one in the Studio</a>
              </p>
            )}
            <ul className="ad-scenes-grid ad-rp-grid" role="radiogroup" aria-label="Roleplays">
              <li className={`ad-rp-card${!pick ? " on" : ""}`}>
                <button type="button" role="radio" aria-checked={!pick} className="ad-rp-pick" onClick={() => setPick(null)}>
                  <span className="ad-rp-icon">💬</span>
                  <strong>No roleplay</strong>
                  <span className="muted small">Just the two of them, as themselves.</span>
                </button>
              </li>
              {roleplays.map((r) => {
                const on = pick?.id === r.id;
                const swap = on ? pick!.swap : false;
                return (
                  <li key={r.id} className={`ad-rp-card${on ? " on" : ""}`}>
                    <button type="button" role="radio" aria-checked={on} className="ad-rp-pick" onClick={() => setPick({ id: r.id, swap })}>
                      <span className="ad-rp-icon">{r.icon}</span>
                      <strong>{r.title}</strong>
                      <span className="muted small ad-scene-premise">{fill(r.premise, swap)}</span>
                      {r.roles && <span className="ad-rp-roles">{rolesLine(r, names, swap)}</span>}
                    </button>
                    {on && r.roles && (
                      <button type="button" className="button-ghost small ad-rp-swap" onClick={() => setPick({ id: r.id, swap: !swap })}>
                        ⇄ Swap roles
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            <footer className="ad-rp-go">
              <span className="small">
                {place ? `📍 ${place}` : "📍 Here"} · {picked ? `${picked.icon} ${picked.title}` : "💬 No roleplay"}
              </span>
              {place && (
                <button type="button" className="button-ghost small" disabled={busy} onClick={() => void go(null)}>
                  Skip the roleplay
                </button>
              )}
              <button type="button" className="primary" disabled={busy || (!place && (pick?.id ?? null) === (roleplay?.id ?? null) && pick?.swap === roleplay?.swap)} onClick={() => void go(pick)}>
                {place ? "Go · 1 token" : picked ? "Start the roleplay" : "End the roleplay"}
              </button>
            </footer>
          </>
        ) : (
          <>
        <div className="ad-scenes-search">
          <input type="search" aria-label="Search the scenes" placeholder="Search: pool, castle, train…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <form onSubmit={typed}>
            <input aria-label="Somewhere of your own" placeholder="Or type your own: a rooftop pool at midnight…" value={own} maxLength={60} onChange={(e) => setOwn(e.target.value)} disabled={busy} />
            <button type="submit" className="primary small" disabled={busy || !own.trim()}>
              Next →
            </button>
          </form>
          <button type="button" className="button-ghost small" onClick={() => choose(null)} title="Keep them where they are and pick a roleplay for the chapter (no token)">
            🎭 Just the roleplay →
          </button>
        </div>
        <div className="ad-scenes-cats" role="radiogroup" aria-label="Category">
          <button type="button" role="radio" aria-checked={!category} className={!category ? "on" : ""} onClick={() => setCategory(null)}>
            ✨ All <span className="ad-scenes-count">{filterScenes(scenes, { tags, query }).length}</span>
          </button>
          {SCENE_CATEGORIES.map((c) => (
            <button key={c.id} type="button" role="radio" aria-checked={category === c.id} className={category === c.id ? "on" : ""} disabled={!counts[c.id] && category !== c.id} onClick={() => setCategory(category === c.id ? null : c.id)}>
              {c.icon} {c.label} <span className="ad-scenes-count">{counts[c.id]}</span>
            </button>
          ))}
        </div>
        <div className="ad-scenes-tags" role="group" aria-label="Tags">
          {SCENE_TAGS.map((t) => (
            <button key={t} type="button" aria-pressed={tags.includes(t)} className={tags.includes(t) ? "on" : ""} onClick={() => setTags((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]))}>
              #{t}
            </button>
          ))}
          {(tags.length > 0 || category || query) && (
            <button type="button" className="ad-scenes-clear" onClick={() => (setTags([]), setCategory(null), setQuery(""))}>
              Clear filters
            </button>
          )}
          {createHref && (
            <a className="ad-scenes-make-link" href={createHref}>
              ＋ Make your own venue
            </a>
          )}
        </div>
        {shown.length ? (
          <ul className="ad-scenes-grid">
            {shown.map((s) => {
              const isHere = here === normalizeScene(s.place);
              return (
                <li key={s.id} className={`ad-scene-card${isHere ? " here" : ""}`}>
                  <div className="ad-scene-pic">
                    {s.image && !broken.has(s.id) && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.image} alt="" loading="lazy" onError={() => setBroken((b) => new Set([...b, s.id]))} />
                    )}
                    <span className="ad-scene-cats" aria-hidden>
                      {s.categories.map((c) => ICON[c]).join(" ")}
                    </span>
                    {isHere && <span className="chip ad-scene-here">You&apos;re here</span>}
                  </div>
                  <div className="ad-scene-body">
                    <strong>{s.title}</strong>
                    {s.premise && <span className="muted small ad-scene-premise">{s.premise}</span>}
                    <span className="ad-scene-tags">{s.tags.map((t) => `#${t}`).join(" ")}</span>
                    <span className="ad-scene-actions">
                      <button type="button" className="primary small" disabled={busy || isHere} onClick={() => choose(s.place)}>
                        Go here →
                      </button>
                      {s.scenario && onScenario && (
                        <button
                          type="button"
                          className="button-ghost small"
                          disabled={busy}
                          title="Start the night as this story: tonight's scene is filed under their nights, like Start over"
                          onClick={async () => {
                            await onScenario(s.scenario!);
                            onClose();
                          }}
                        >
                          Start this story
                        </button>
                      )}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted ad-scenes-empty">Nothing matches. Clear a filter, or type somewhere of your own above.</p>
        )}
          </>
        )}
      </div>
    </div>
  );
}

/** Pictures fetched at a time while preloading, so the scene's own set and lines are never kept waiting. */
const PRELOAD_BATCH = 6;

/**
 * Warms the browser's cache with every card's picture, a few at a time whenever the page is idle (David, 2026-10-25:
 * "loading in background and caching it"), so the picker opens with its pictures already there. Returns a cancel.
 */
export function preloadScenes(scenes: readonly CatalogScene[]): () => void {
  const urls = [...new Set(scenes.map((s) => s.image).filter((u): u is string => Boolean(u)))];
  let i = 0;
  let stopped = false;
  let handle: number | null = null;
  const idle = (fn: () => void) => (typeof requestIdleCallback === "function" ? requestIdleCallback(fn, { timeout: 3000 }) : window.setTimeout(fn, 400));
  const unidle = (h: number) => (typeof cancelIdleCallback === "function" ? cancelIdleCallback(h) : window.clearTimeout(h));
  const batch = () => {
    if (stopped || i >= urls.length) return;
    const these = urls.slice(i, i + PRELOAD_BATCH);
    i += these.length;
    let left = these.length;
    for (const url of these) {
      const img = new Image();
      img.decoding = "async";
      img.onload = img.onerror = () => {
        if (--left === 0) handle = idle(batch);
      };
      img.src = url;
    }
  };
  handle = idle(batch);
  return () => {
    stopped = true;
    if (handle !== null) unidle(handle);
  };
}
