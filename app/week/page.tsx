import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { weekRecapOn } from "@/lib/week-recap";
import { loadLatestWeek, weekMetadata } from "./load";
import WeekRecapView from "./WeekRecapView";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  if (!weekRecapOn()) notFound();
  const found = await loadLatestWeek();
  // Nothing to show yet: the page says so, and stays out of search until there is.
  if (!found) return { title: "The week in review · Botchelor", robots: { index: false, follow: true } };
  return weekMetadata(found.recap, "/week", found.dates.map((d) => `${d.date.names[0]} × ${d.date.names[1]}`));
}

/** The newest week in review (lib/week-recap.ts), or, before the first one, where to watch in the meantime. */
export default async function WeekPage() {
  if (!weekRecapOn()) notFound();
  const found = await loadLatestWeek();
  if (!found) {
    return (
      <article className="week-recap week-recap-empty" data-week-recap="none">
        <header className="week-recap-head">
          <p className="kicker">Botchelor</p>
          <h1>The week in review</h1>
          <p className="lede">The first recap lands Sunday: the week&apos;s best dates in about a minute, and how each one ended.</p>
        </header>
        <p>
          <Link className="button" href="/watch">
            Watch the dates
          </Link>
        </p>
      </article>
    );
  }
  return <WeekRecapView {...found} />;
}
