"use client";

import { useEffect } from "react";

/**
 * A link to something inside a closed <details> (/watch#cast-chat into "More from the show") opens it and scrolls
 * there, on load and on every hash change. Renders nothing.
 */
export default function OpenOnHash() {
  useEffect(() => {
    const open = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      const el = document.getElementById(id);
      const fold = el?.closest("details");
      if (!el || !fold || fold.open) return;
      fold.open = true;
      el.scrollIntoView({ block: "start" });
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  return null;
}
