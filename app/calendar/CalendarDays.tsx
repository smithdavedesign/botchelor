"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";

/**
 * The calendar's day sections, grouped in the viewer's own zone. The server can only group by UTC day, so a night that
 * starts at 00:00 UTC sat under the next day's heading for anyone in the Americas ("Tuesday, December 1 · The Reunion ·
 * 4:00 PM PST", which is Monday). The server renders UTC days; after the page loads the browser regroups by its local
 * day, the same way LocalTime swaps in local times.
 */
export default function CalendarDays({ items }: { items: { id: string; at: string; node: ReactNode }[] }) {
  // null until the page loads: the server's UTC days, so the first render matches what it sent.
  const [zone, setZone] = useState<string | null>(null);
  useEffect(() => {
    setZone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  }, []);
  const timeZone = zone ?? "UTC";
  const key = (at: string) => new Date(at).toLocaleDateString("en-CA", { timeZone });
  const label = (at: string) =>
    new Date(at).toLocaleDateString(zone ? undefined : "en-US", { weekday: "long", month: "long", day: "numeric", timeZone });
  const days = new Map<string, { label: string; items: typeof items }>();
  for (const item of items) {
    const k = key(item.at);
    const day = days.get(k) ?? { label: label(item.at), items: [] };
    day.items.push(item);
    days.set(k, day);
  }
  return (
    <>
      {[...days.entries()].map(([k, day]) => (
        <section key={k} className="cal-day" aria-label={day.label}>
          <h2 className="section" suppressHydrationWarning>
            {day.label}
          </h2>
          <ul className="cal-list">
            {day.items.map((item) => (
              <Fragment key={item.id}>{item.node}</Fragment>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
