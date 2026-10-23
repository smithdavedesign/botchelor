"use client";

import { useEffect, useState } from "react";

/**
 * A time the server wrote in UTC ("17:00 UTC"), shown in the viewer's own clock once the page is in their browser
 * ("5:00 PM"). The server can't know the viewer's time zone; the UTC text stays for anyone without JavaScript.
 */
export default function LocalTime({ iso }: { iso: string }) {
  const [text, setText] = useState(`${new Date(iso).toISOString().slice(11, 16)} UTC`);
  useEffect(() => {
    setText(new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
  }, [iso]);
  return <time dateTime={iso}>{text}</time>;
}
