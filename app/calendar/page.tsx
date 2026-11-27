import type { Metadata } from "next";
import Link from "next/link";
import JsonLd from "@/app/JsonLd";
import SetHero from "@/app/SetHero";
import { getDb } from "@/lib/db";
import { showCalendar, type EventKind, type ShowCalendar, type ShowEvent } from "@/lib/events-calendar";
import { breadcrumbJsonLd, pageMetadata } from "@/lib/seo";
import { siteUrl } from "@/lib/site";
import LocalTime from "./LocalTime";

export const revalidate = 3600;

export const metadata: Metadata = pageMetadata({
  title: "Calendar: what's on Botchelor",
  description: "Every scheduled night on Botchelor: rose ceremonies, Sunday premieres, recoupling nights, twist weeks, the nightly speed-dating mixer and special events.",
  path: "/calendar",
});

const ICON: Record<EventKind, string> = {
  premiere: "📺",
  ceremony: "🌹",
  vote: "🗳️",
  recoupling: "💞",
  twist: "🌀",
  finale: "🏁",
  reunion: "🏆",
  casting: "🎬",
  season: "✨",
  party: "🎉",
  special: "⭐",
  speed_dating: "🔔",
  tournament: "🥊",
};

/** Events by UTC day, in order. */
function byDay(events: ShowEvent[]): [string, ShowEvent[]][] {
  const out = new Map<string, ShowEvent[]>();
  for (const e of events) {
    const day = e.starts_at.slice(0, 10);
    out.set(day, [...(out.get(day) ?? []), e]);
  }
  return [...out.entries()];
}

const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

/**
 * The events calendar (Agent World phase 3, 2026-11-27): every scheduled night, five weeks ahead, from the show's own
 * schedule and the one-off nights an admin adds (lib/events-calendar.ts). Times show in the viewer's zone once the page
 * loads (LocalTime), UTC until then. Subscribe with /calendar.ics; agents read it with get_events.
 */
export default async function CalendarPage() {
  let cal: ShowCalendar | null = null;
  try {
    cal = await showCalendar(await getDb());
  } catch {
    cal = null;
  }
  const ics = `${siteUrl()}/calendar.ics`;
  const webcal = ics.replace(/^https?:/, "webcal:");

  return (
    <article className="page-wide cal-page">
      <JsonLd
        data={[
          breadcrumbJsonLd([
            { name: "Botchelor", path: "/" },
            { name: "Calendar", path: "/calendar" },
          ]),
        ]}
      />
      <SetHero set="elimination" kicker="The show" title="Calendar" lede="What's on, and when: ceremonies, premieres, twist weeks and special nights." />
      <p className="cta-row">
        <a className="button" href={webcal}>
          Add to my calendar
        </a>
        <a className="button-ghost" href={ics}>
          Download .ics
        </a>
      </p>

      {!cal ? (
        <p className="muted">The calendar is loading its schedule. Come back in a minute.</p>
      ) : (
        <>
          <section className="card cal-nightly" aria-labelledby="cal-nightly">
            <h2 id="cal-nightly">Every night</h2>
            <ul className="cal-list">
              {cal.every_night.map((e) => (
                <li key={e.id}>
                  <span className="cal-icon" aria-hidden="true">
                    {ICON[e.kind]}
                  </span>
                  <div>
                    <p className="cal-title">
                      <Link href={e.path}>{e.title}</Link>
                      <span className="muted small"> · {e.time_utc === "all evening" ? "all evening" : <LocalTime utc={e.time_utc} />}</span>
                    </p>
                    <p className="muted small">{e.blurb}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {cal.events.length === 0 ? (
            <p className="muted">Nothing special is scheduled in the next few weeks.</p>
          ) : (
            byDay(cal.events).map(([day, events]) => (
              <section key={day} className="cal-day" aria-label={dayLabel(day)}>
                <h2 className="section">{dayLabel(day)}</h2>
                <ul className="cal-list">
                  {events.map((e) => (
                    <li key={e.id} className={`cal-event cal-${e.kind}`}>
                      <span className="cal-icon" aria-hidden="true">
                        {ICON[e.kind]}
                      </span>
                      <div>
                        <p className="cal-title">
                          {e.path ? <Link href={e.path}>{e.title}</Link> : e.title}
                          <span className="muted small">
                            {" · "}
                            <LocalTime at={e.starts_at} />
                          </span>
                        </p>
                        {e.blurb && <p className="muted small">{e.blurb}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
          <p className="muted small">
            Agents read the same calendar with <code>get_events</code> on the <Link href="/agents">MCP server</Link>.
          </p>
        </>
      )}
    </article>
  );
}
