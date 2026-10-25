"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { filterScenes, SCENE_CATEGORIES, SCENE_TAGS, type CatalogScene, type SceneCategory, type SceneTag } from "@/lib/adult/scene-catalog";
import { normalizeScene } from "@/lib/venues";

const ICON = Object.fromEntries(SCENE_CATEGORIES.map((c) => [c.id, c.icon])) as Record<SceneCategory, string>;

/**
 * 📍 Set the scene, as a full-screen picker (David, 2026-10-25: "all the scenes we have in a giant modal popup with
 * filters and tags"): every place in lib/adult/scene-catalog.ts as a card with its picture, narrowed by a roleplay
 * category, any number of tags and a search, with a box to type somewhere of their own. A card takes them there (1
 * token, set_scene); a scenario's card can start the night as that story instead (files tonight, like Start over).
 * Closes on Esc, the ✕ or a click outside the panel.
 */
export default function SetSceneModal({
  scenes,
  busy = false,
  current = null,
  onGo,
  onScenario,
  onClose,
}: {
  scenes: readonly CatalogScene[];
  busy?: boolean;
  /** Where they are now: its card says so. */
  current?: string | null;
  onGo: (place: string) => Promise<void>;
  onScenario?: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const [category, setCategory] = useState<SceneCategory | null>(null);
  const [tags, setTags] = useState<SceneTag[]>([]);
  const [query, setQuery] = useState("");
  const [own, setOwn] = useState("");
  // Cards whose picture didn't load (a set not drawn yet) paint their gradient instead.
  const [broken, setBroken] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const shown = useMemo(() => filterScenes(scenes, { category, tags, query }), [scenes, category, tags, query]);
  const counts = useMemo(() => Object.fromEntries(SCENE_CATEGORIES.map((c) => [c.id, filterScenes(scenes, { category: c.id, tags, query }).length])), [scenes, tags, query]);
  const here = current ? normalizeScene(current) : null;

  async function go(place: string) {
    await onGo(place);
    onClose();
  }
  async function typed(e: FormEvent) {
    e.preventDefault();
    if (own.trim()) await go(own.trim());
  }

  return (
    <div className="ad-scenes-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ad-scenes" role="dialog" aria-modal="true" aria-label="Set the scene">
        <header className="ad-scenes-head">
          <div>
            <h2>📍 Set the scene</h2>
            <p className="muted small">Take them anywhere: 1 token. They arrive with the next lines.</p>
          </div>
          <button type="button" className="theater-icon" aria-label="Close" title="Close" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="ad-scenes-search">
          <input type="search" aria-label="Search the scenes" placeholder="Search: pool, castle, train…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <form onSubmit={typed}>
            <input aria-label="Somewhere of your own" placeholder="Or type your own: a rooftop pool at midnight…" value={own} maxLength={60} onChange={(e) => setOwn(e.target.value)} disabled={busy} />
            <button type="submit" className="primary small" disabled={busy || !own.trim()}>
              Go · 1 token
            </button>
          </form>
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
                      <button type="button" className="primary small" disabled={busy || isHere} onClick={() => void go(s.place)}>
                        Go here · 1 token
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
      </div>
    </div>
  );
}
