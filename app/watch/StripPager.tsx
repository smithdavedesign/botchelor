"use client";

import { Children, useState, type ReactNode } from "react";

/**
 * A row of room cards (David, 2026-10-22: "for desktop I don't want horizontal scroll… use pagination"). On a phone it's
 * the swipeable strip it was; on desktop a grid, `per` cards a page with ← Newer / Older →. The cards off the page are
 * only hidden on desktop (globals.css), so a phone still swipes through every one.
 */
export default function StripPager({ children, per = 3, label }: { children: ReactNode; per?: number; label: string }) {
  const items = Children.toArray(children);
  const pages = Math.max(1, Math.ceil(items.length / per));
  const [page, setPage] = useState(0);
  return (
    <>
      <div className="watch-lobby watch-strip strip-paged">
        {items.map((child, i) => (
          <div key={i} className={Math.floor(i / per) === page ? "strip-item" : "strip-item off-page"}>
            {child}
          </div>
        ))}
      </div>
      {pages > 1 && (
        <nav className="watch-pager strip-pager" aria-label={label}>
          <button type="button" className="button-ghost small" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            ← Newer
          </button>
          <span className="muted small">
            Page {page + 1} of {pages}
          </span>
          <button type="button" className="button-ghost small" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>
            Older →
          </button>
        </nav>
      )}
    </>
  );
}
