"use client";

import { useRef, type ReactNode } from "react";
import { useOverlay } from "@/app/useOverlay";

/**
 * A picker that takes the screen (David, 2026-11-24: "The character select should be more full screen so you can see
 * the characters"): a title, a search, an optional row of kinds, and a grid of pictures to pick one from. Step in's
 * set-up uses it three times: who, the story, and where. The look is the theater's own Set the scene sheet
 * (app/after-dark/[a]/[b]/SetSceneModal.tsx: .ad-scenes-overlay), so the two ways of setting a scene are one thing to
 * learn; the behaviour is the overlay primitive's (app/useOverlay.ts: the page behind is inert and doesn't scroll,
 * Escape and the ✕ close it, focus goes back where it was).
 *
 * Nothing in it is drawn until it's opened: the cast alone can be hundreds of faces.
 */
export default function PickSheet({
  id,
  open,
  title,
  lead,
  onClose,
  search,
  kinds,
  status,
  grid = "cards",
  children,
}: {
  /** Which sheet this is, for the page's own hooks (data-step-in-sheet). */
  id: string;
  open: boolean;
  title: string;
  /** One line under the title. */
  lead?: string;
  onClose: () => void;
  search?: { value: string; onChange: (value: string) => void; placeholder: string; label: string };
  /** The kinds to narrow by: `on` is the one showing. */
  kinds?: { label: string; options: { id: string; label: string; count?: number }[]; on: string; onPick: (id: string) => void };
  /** How many show now, said to a screen reader as a search narrows them. */
  status?: string;
  /** What the grid holds: faces (many, narrow tiles) or cards (a picture over a few lines). */
  grid?: "faces" | "cards";
  /** The grid's items (each an <li>). */
  children: ReactNode;
}) {
  const overlay = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLInputElement>(null);
  useOverlay(open, { root: overlay, onClose, outside: false, focus: search ? box : undefined });
  if (!open) return null;
  return (
    <div ref={overlay} className="ad-scenes-overlay ad-si-sheet-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()} data-step-in-sheet={id}>
      <div className="ad-scenes ad-si-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <header className="ad-scenes-head">
          <div>
            <h2>{title}</h2>
            {lead && <p className="small">{lead}</p>}
          </div>
          <button type="button" className="theater-icon" aria-label="Close" title="Close" onClick={onClose} data-step-in-sheet-close>
            ✕
          </button>
        </header>
        {search && (
          <div className="ad-scenes-search">
            <input
              ref={box}
              type="search"
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              placeholder={search.placeholder}
              aria-label={search.label}
              autoComplete="off"
              spellCheck={false}
              data-step-in-sheet-search
            />
          </div>
        )}
        {kinds && kinds.options.length > 1 && (
          <div className="ad-scenes-cats" role="radiogroup" aria-label={kinds.label}>
            {kinds.options.map((k) => (
              <button key={k.id} type="button" role="radio" aria-checked={kinds.on === k.id} className={kinds.on === k.id ? "on" : undefined} onClick={() => kinds.onPick(k.id)} data-step-in-sheet-kind={k.id}>
                {k.label}
                {k.count !== undefined && <span className="ad-scenes-count">{k.count}</span>}
              </button>
            ))}
          </div>
        )}
        <p className="sr-only" aria-live="polite">
          {status ?? ""}
        </p>
        <ul className={grid === "faces" ? "ad-scenes-grid ad-si-sheet-grid ad-si-sheet-faces" : "ad-scenes-grid ad-si-sheet-grid"} data-step-in-sheet-grid>
          {children}
        </ul>
      </div>
    </div>
  );
}
