"use client";

import { useEffect, useState } from "react";

/**
 * A time in the viewer's own zone. The server renders UTC (it can't know the zone); after the page loads, the browser
 * swaps in its local time. `at`: an ISO instant. `utc`: a daily "HH:MM" in UTC (a repeating event).
 */
export default function LocalTime({ at, utc }: { at?: string; utc?: string }) {
  const instant = at ?? (utc ? `${new Date().toISOString().slice(0, 10)}T${utc}:00Z` : null);
  const fallback = at ? `${at.slice(11, 16)} UTC` : utc ? `${utc} UTC` : "";
  const [text, setText] = useState(fallback);
  useEffect(() => {
    if (!instant) return;
    const d = new Date(instant);
    if (Number.isNaN(d.getTime())) return;
    setText(d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" }));
  }, [instant]);
  return (
    <time dateTime={at ?? undefined} suppressHydrationWarning>
      {text}
    </time>
  );
}
