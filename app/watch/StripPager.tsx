"use client";

import { Children, useState, type ReactNode } from "react";

/**
 * A row of room cards. On a phone it's the swipeable strip it always was, every card in it. On desktop it's a grid with
 * no sideways scroll (David, 2026-10-22: "for desktop I don't want horizontal scroll… use pagination"): its first row,
 * and "Show all N" opens the rest in place. It was a numbered pager, which put a second row of page numbers on Watch
 * beside the episodes' own (2026-11-08 UI audit, item 12).
 */
export default function StripPager({ children, per = 3, label }: { children: ReactNode; per?: number; label: string }) {
  const items = Children.toArray(children);
  const [all, setAll] = useState(false);
  return (
    <>
      <div className={`watch-lobby watch-strip strip-paged${all ? " is-all" : ""}`} role="group" aria-label={label}>
        {items.map((child, i) => (
          <div key={i} className={all || i < per ? "strip-item" : "strip-item off-page"}>
            {child}
          </div>
        ))}
      </div>
      {items.length > per && (
        <button type="button" className="link-button strip-more" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
    </>
  );
}
