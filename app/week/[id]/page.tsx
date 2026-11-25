import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadWeek, weekMetadata } from "../load";
import WeekRecapView from "../WeekRecapView";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const found = await loadWeek(id);
  // No recap for that week (or the switch is off): the not-found page's own title and robots.
  if (!found) notFound();
  return weekMetadata(found.recap, `/week/${found.recap.id}`, found.dates.map((d) => `${d.date.names[0]} × ${d.date.names[1]}`));
}

/** One week's recap (lib/week-recap.ts), by its Monday: /week/2026-11-16. A week with none is a 404. */
export default async function WeekOfPage({ params }: Props) {
  const { id } = await params;
  const found = await loadWeek(id);
  if (!found) notFound();
  return <WeekRecapView {...found} />;
}
