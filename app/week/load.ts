import { cache } from "react";
import { getDb } from "@/lib/db";
import { latestWeekRecap, recapDates, recapNeighbours, weekRecap, weekRecapOn, type WeekRecap } from "@/lib/week-recap";
import { pageMetadata } from "@/lib/seo";
import type { Metadata } from "next";
import { weekWords } from "./WeekRecapView";

/** A recap with its cards and its neighbours, read once a request (the metadata and the page both ask). */
const withAll = async (recap: WeekRecap | null) => {
  if (!recap) return null;
  const db = await getDb();
  const [dates, around] = [await recapDates(db, recap), await recapNeighbours(db, recap.id)];
  return { recap, dates, ...around };
};

export const loadLatestWeek = cache(async () => (weekRecapOn() ? withAll(await latestWeekRecap(await getDb())) : null));
export const loadWeek = cache(async (id: string) => (weekRecapOn() ? withAll(await weekRecap(await getDb(), id)) : null));

/** A recap's search and share tags: its own title, and its video where the app plays og:video. */
export function weekMetadata(recap: WeekRecap, path: string, names: string[]): Metadata {
  const label = weekWords(recap.id);
  const who = names.length ? ` ${names.slice(0, 3).join(", ")}${names.length > 3 ? " and more" : ""}.` : "";
  const meta = pageMetadata({
    title: `The week in review, ${label} · Botchelor`,
    description: `The week's best AI blind dates in about a minute: the line of the night from each, and how it ended.${who}`,
    path,
  });
  return { ...meta, openGraph: { ...meta.openGraph, videos: [{ url: recap.src, type: "video/mp4", width: recap.width, height: recap.height }] } };
}
