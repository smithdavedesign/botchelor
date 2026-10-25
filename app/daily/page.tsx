import type { Metadata } from "next";
import Link from "next/link";
import { AiFiction } from "@/app/AiLabel";
import { dailyCard, dailyEpisodeId, ensureDailyEpisodeId } from "@/lib/daily";
import { DAILY_PATH, DAILY_SHARE_PATH, dailyDayLabel, dailyNumberAt, SITE_CARD } from "@/lib/daily-shared";
import { getDb } from "@/lib/db";
import { siteUrl } from "@/lib/site";
import DailyGame from "./DailyGame";
import DailySheets from "./Sheets";

// Today is the server's UTC day, and its date is dealt on its first read (lib/daily.ts).
export const dynamic = "force-dynamic";

const DESCRIPTION =
  "One blind date a day between two of the show's house characters, the same for everyone. Read their sheets, call how it ends (a second date, just friends or a disaster), then see the date and keep your streak. Free, no account.";

export async function generateMetadata(): Promise<Metadata> {
  const title = `Botchelor Daily #${dailyNumberAt(new Date())}: how does today's blind date end?`;
  return {
    title,
    description: DESCRIPTION,
    alternates: { canonical: DAILY_PATH },
    // A page's own openGraph replaces the one it would inherit, image and all, so the site's card is named here.
    openGraph: { type: "website", siteName: "Botchelor", title, description: DESCRIPTION, url: DAILY_PATH, images: [SITE_CARD] },
    twitter: { card: "summary_large_image", title, description: DESCRIPTION, images: [SITE_CARD.url] },
  };
}

/**
 * The Daily Date (lib/daily.ts): one house-vs-house date a UTC day at a fixed address, to call without an account.
 * Before a pick the page has the two sheets and where they met, and nothing that says how it ends: the ending comes
 * from POST /api/daily once a pick is in (DailyGame). Past days are at /daily/{n}, ending shown.
 */
export default async function DailyPage() {
  const n = dailyNumberAt(new Date());
  const db = await getDb();
  const episodeId = await ensureDailyEpisodeId(db, n);
  const card = episodeId ? await dailyCard(db, episodeId) : null;
  const yesterday = n > 1 && (await dailyEpisodeId(db, n - 1)) ? n - 1 : null;

  return (
    <>
      <section className="card daily-hero" data-daily={n}>
        <p className="kicker">Botchelor Daily · {dailyDayLabel(n)}</p>
        <h1>Daily Date #{n}</h1>
        <p className="lede">
          One blind date a day, the same for everyone: two of the show&apos;s house characters on a date nobody can steer.
          Read their sheets, then call how it ends.
        </p>
        {card && (
          <p className="daily-setting">
            <strong>Where they met:</strong> {card.setting}
          </p>
        )}
      </section>

      {card ? (
        <>
          <DailySheets characters={card.characters} />
          <DailyGame n={n} shareUrl={`${siteUrl()}${DAILY_SHARE_PATH}`} />
        </>
      ) : (
        <section className="card">
          <p>
            Today&apos;s Daily Date is still being filmed. Check back soon, or <Link href="/watch">watch the latest dates</Link>{" "}
            meanwhile.
          </p>
        </section>
      )}

      {yesterday && (
        <p className="daily-archive">
          <Link href={`${DAILY_PATH}/${yesterday}`}>How yesterday&apos;s ended (#{yesterday}) →</Link>
        </p>
      )}
      <AiFiction />

      <section className="card daily-cta">
        <h2>Got an original character?</h2>
        <p>
          Every Daily Date is from the show&apos;s own cast. Make your own character and it goes on a blind date written by
          AI that nobody can steer, while friends call how it ends. Free to start, no sign-up.
        </p>
        <Link className="button" href="/create">
          Make your character
        </Link>
      </section>
    </>
  );
}
