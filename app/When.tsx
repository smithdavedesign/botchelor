"use client";

import { useEffect, useState } from "react";
import { formatWhen, type WhenStyle } from "@/lib/when";

/**
 * A time by the viewer's own clock (2026-10-31 UX audit: every date was UTC, so "Nov 1" on the evening of Oct 31 in
 * California). The server can't know the zone, so its HTML says UTC; once the page runs, the browser says it again in
 * its own. The full time is the element's title.
 */
export default function When({ iso, style = "ago" }: { iso: string; style?: WhenStyle }) {
  const [local, setLocal] = useState(false);
  useEffect(() => setLocal(true), []);
  return (
    <time dateTime={iso} title={local ? new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : undefined} suppressHydrationWarning>
      {formatWhen(iso, style, Date.now(), local ? undefined : "UTC")}
    </time>
  );
}
