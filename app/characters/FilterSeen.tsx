"use client";

import { useEffect, useRef } from "react";
import { queueEvent } from "@/app/engagement";

/**
 * A filter the Characters page was opened with, as an engagement event (lib/tag-demand.ts artStyleDemand): the page is
 * a plain GET form, so `/characters?style=anime` is someone looking for anime characters, and the stored path has no
 * query to tell. Once per page load, under the beacon's own rules (consent, small enums only). Renders nothing.
 */
export default function FilterSeen({ event, props }: { event: string; props: Record<string, string> }) {
  const sent = useRef(false);
  const key = JSON.stringify(props);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    queueEvent(event, JSON.parse(key) as Record<string, string>);
  }, [event, key]);
  return null;
}
