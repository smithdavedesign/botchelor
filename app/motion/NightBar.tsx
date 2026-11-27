"use client";

import { useEffect } from "react";

/** The theaters' own night: the colour the browser's bar takes while one is open. */
const NIGHT = "#140a1e";

/**
 * While a theater is open (full screen and dark; it puts `theater-lock` on <html>), the browser's own bar takes the night
 * colour too (2026-11-27, the finish pass), so on a phone the stage runs up into the status bar instead of stopping under
 * a cream strip. One watcher for the whole site, mounted in the layout; it only rewrites the theme-color tags the layout
 * writes (generateViewport) and puts them back the moment the theater closes.
 */
export default function NightBar() {
  useEffect(() => {
    const root = document.documentElement;
    let saved: string[] | null = null;
    const sync = () => {
      const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
      const open = root.classList.contains("theater-lock");
      if (open && !saved) {
        saved = metas.map((m) => m.content);
        for (const m of metas) m.content = NIGHT;
      } else if (!open && saved) {
        metas.forEach((m, i) => (m.content = saved![i] ?? m.content));
        saved = null;
      }
    };
    const watch = new MutationObserver(sync);
    watch.observe(root, { attributes: true, attributeFilter: ["class"] });
    sync();
    return () => watch.disconnect();
  }, []);
  return null;
}
