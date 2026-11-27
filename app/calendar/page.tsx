import type { Metadata } from "next";
import Link from "next/link";
import JsonLd from "@/app/JsonLd";
import SetHero from "@/app/SetHero";
import { getDb } from "@/lib/db";
import { showCalendar, type EventKind, type ShowCalendar } from "@/lib/events-calendar";
import { fillNodes } from "@/app/fillNodes";
import { getLocale, tFor } from "@/lib/i18n/server";
import { breadcrumbJsonLd, pageMetadata } from "@/lib/seo";
import { sharedStale } from "@/lib/shared-cache";
import { siteUrl } from "@/lib/site";
import CalendarDays from "./CalendarDays";
import LocalTime from "./LocalTime";

// Dynamic since its words follow the visitor's language (docs/i18n.md); the schedule is kept an hour in memory instead.
export const dynamic = "force-dynamic";

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

/**
 * The events calendar (Agent World phase 3, 2026-11-27): every scheduled night, five weeks ahead, from the show's own
 * schedule and the one-off nights an admin adds (lib/events-calendar.ts). Times show in the viewer's zone once the page
 * loads (LocalTime), UTC until then, and the days regroup in the viewer's zone too (CalendarDays). Subscribe with /calendar.ics; agents read it with get_events.
 */
export default async function CalendarPage() {
  let cal: ShowCalendar | null = null;
  try {
    const db = await getDb();
    cal = await sharedStale("calendar", () => showCalendar(db), 60 * 60 * 1000);
  } catch {
    cal = null;
  }
  const locale = await getLocale();
  const t = tFor(locale);
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
      <SetHero set="elimination" kicker={t("The show")} title={t("Calendar")} lede={t("What's on, and when: ceremonies, premieres, twist weeks and special nights.")} />
      <p className="cta-row">
        <a className="button" href={webcal}>
          {t("Add to my calendar")}
        </a>
        <a className="button-ghost" href={ics}>
          {t("Download .ics")}
        </a>
      </p>

      {!cal ? (
        <p className="muted">{t("The calendar is loading its schedule. Come back in a minute.")}</p>
      ) : (
        <>
          <section className="card cal-nightly" aria-labelledby="cal-nightly">
            <h2 id="cal-nightly">{t("Every night")}</h2>
            <ul className="cal-list">
              {cal.every_night.map((e) => (
                <li key={e.id}>
                  <span className="cal-icon" aria-hidden="true">
                    {ICON[e.kind]}
                  </span>
                  <div>
                    <p className="cal-title">
                      <Link href={e.path}>{t(e.title)}</Link>
                      <span className="muted small"> · {e.time_utc === "all evening" ? t("all evening") : <LocalTime utc={e.time_utc} />}</span>
                    </p>
                    <p className="muted small">{t(e.blurb)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {cal.events.length === 0 ? (
            <p className="muted">{t("Nothing special is scheduled in the next few weeks.")}</p>
          ) : (
            <CalendarDays
              locale={locale}
              items={cal.events.map((e) => ({
                id: e.id,
                at: e.starts_at,
                node: (
                  <li className={`cal-event cal-${e.kind}`}>
                    <span className="cal-icon" aria-hidden="true">
                      {ICON[e.kind]}
                    </span>
                    <div>
                      <p className="cal-title">
                        {e.path ? <Link href={e.path}>{t(e.title)}</Link> : t(e.title)}
                        <span className="muted small">
                          {" · "}
                          <LocalTime at={e.starts_at} />
                        </span>
                      </p>
                      {e.blurb && <p className="muted small">{t(e.blurb)}</p>}
                    </div>
                  </li>
                ),
              }))}
            />
          )}
          <p className="muted small">
            {fillNodes(t("Agents read the same calendar with {tool} on the {server}."), {
              tool: <code>get_events</code>,
              server: <Link href="/agents">{t("MCP server")}</Link>,
            })}
          </p>
        </>
      )}
    </article>
  );
}
