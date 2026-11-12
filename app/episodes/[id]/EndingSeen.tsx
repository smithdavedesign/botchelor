"use client";

import { useEffect, useRef } from "react";
import { queueEvent } from "@/app/engagement";

/**
 * "Watched it end" for readers (2026-11-11 growth plan, measurement first). The funnel's aha step, `date_watched`, fired
 * only in the theater, yet the episode page prints the whole date as text with the ending at the bottom, and visitors
 * sat on episode pages for minutes without the event ever firing (zero rows in a month). This marks the ending's
 * block once it has been half on screen: a reader who scrolled to how it ended counts, with `via: "page"` so the two
 * ways stay apart. Renders nothing; a browser with no IntersectionObserver simply counts nothing.
 */
export default function EndingSeen() {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen.current || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (seen.current || !entries.some((e) => e.isIntersecting)) return;
        seen.current = true;
        queueEvent("date_watched", { via: "page" });
        io.disconnect();
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return <span ref={ref} data-ending-seen aria-hidden="true" />;
}
