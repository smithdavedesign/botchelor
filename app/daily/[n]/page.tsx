import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AiFiction } from "@/app/AiLabel";
import { dailyCard, dailyEpisodeId, dailyStory } from "@/lib/daily";
import { DAILY_PATH, dailyDayLabel, dailyNumberAt, parseDailyNumber, SITE_CARD } from "@/lib/daily-shared";
import { getDb } from "@/lib/db";
import DailySheets from "../Sheets";
import DailyStoryView from "../Story";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ n: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const n = parseDailyNumber((await params).n);
  const title = n ? `Botchelor Daily #${n}: how it ended` : "Botchelor Daily";
  return {
    title,
    description: "A past Daily Date on Botchelor: the two house characters, how their blind date ended and how it went.",
    alternates: { canonical: n ? `${DAILY_PATH}/${n}` : DAILY_PATH },
    // The same date is on its own episode page, which is the one to index; today's game is /daily.
    robots: { index: false, follow: true },
    openGraph: { type: "website", siteName: "Botchelor", title, url: n ? `${DAILY_PATH}/${n}` : DAILY_PATH, images: [SITE_CARD] },
  };
}

/**
 * A past Daily Date (lib/daily.ts), ending shown: the day it was dealt for, the two sheets, and the date. Today's number
 * goes to /daily, where it's still a game; a day still to come, or one nobody dealt, is a 404.
 */
export default async function DailyDayPage({ params }: Props) {
  const n = parseDailyNumber((await params).n);
  const today = dailyNumberAt(new Date());
  if (n === null || n > today) notFound();
  if (n === today) redirect(DAILY_PATH);
  const db = await getDb();
  const episodeId = await dailyEpisodeId(db, n);
  if (!episodeId) notFound();
  const [card, story] = await Promise.all([dailyCard(db, episodeId), dailyStory(db, n, episodeId)]);
  if (!card || !story) notFound();
  const before = n > 1 && (await dailyEpisodeId(db, n - 1)) ? n - 1 : null;

  return (
    <>
      <section className="card daily-hero" data-daily={n}>
        <p className="kicker">Botchelor Daily · {dailyDayLabel(n)}</p>
        <h1>Daily Date #{n}</h1>
        <p className="daily-setting">
          <strong>Where they met:</strong> {card.setting}
        </p>
      </section>
      <DailySheets characters={card.characters} />
      <section className="card daily-result" data-ending={story.ending}>
        <h2>
          It ended: <strong>{story.ending_label}</strong>
        </h2>
        <DailyStoryView story={story} />
      </section>
      <p className="daily-archive">
        {before && (
          <>
            <Link href={`${DAILY_PATH}/${before}`}>← #{before}</Link> ·{" "}
          </>
        )}
        <Link href={DAILY_PATH}>
          <strong>Play today&apos;s Daily Date →</strong>
        </Link>
      </p>
      <AiFiction />
    </>
  );
}
