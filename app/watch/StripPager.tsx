"use client";

import { Children, useState, type ReactNode } from "react";
import Pager from "@/app/Pager";

/**
 * A row of room cards (David, 2026-10-22: "for desktop I don't want horizontal scroll… use pagination"). On a phone it's
 * the swipeable strip it was; on desktop a grid, `per` cards a page with the shared pager (app/Pager.tsx) under it. The
 * cards off the page are only hidden on desktop (globals.css), so a phone still swipes through every one.
 */
export default function StripPager({ children, per = 3, label }: { children: ReactNode; per?: number; label: string }) {
  const items = Children.toArray(children);
  const pages = Math.max(1, Math.ceil(items.length / per));
  const [page, setPage] = useState(1);
  return (
    <>
      <div className="watch-lobby watch-strip strip-paged">
        {items.map((child, i) => (
          <div key={i} className={Math.floor(i / per) + 1 === page ? "strip-item" : "strip-item off-page"}>
            {child}
          </div>
        ))}
      </div>
      <Pager className="strip-pager" page={page} pages={pages} label={label} onPage={setPage} prev="Newer" next="Older" />
    </>
  );
}
