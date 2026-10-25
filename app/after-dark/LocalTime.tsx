"use client";

import { useEffect, useState } from "react";

/**
 * A time in the viewer's own clock, written once the page is in their browser: the server renders in UTC, so a time
 * formatted there and again here differs, and React stops hydrating (error #418; 2026-10-25). Until then, nothing.
 */
export default function LocalTime({ iso, format }: { iso: string; format: Intl.DateTimeFormatOptions & { time?: boolean } }) {
  const [text, setText] = useState("");
  useEffect(() => {
    const { time, ...opts } = format;
    const d = new Date(iso);
    setText(time ? d.toLocaleTimeString([], opts) : d.toLocaleDateString(undefined, opts));
  }, [iso, format]);
  return <time dateTime={iso}>{text}</time>;
}
