import type { Metadata } from "next";
import AgeGate from "../AgeGate";
import DateExcerpt from "../DateExcerpt";
import { getDb } from "@/lib/db";
import { episodeIdFrom, pickFeaturedDate, type FeaturedDate } from "@/lib/featured-date";
import { getEpisodeView, listStandoutDates } from "@/lib/game";
import { shared } from "@/lib/shared-cache";
import { afterDarkOnly } from "@/lib/after-dark-host";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Enter · Botchelor", robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * What waits behind the gate, drawn blurred under the question (2026-11-07 audit, item 1: a first visit met a blank
 * page with a modal, and only about half went on): the date their link was for when it's an aired public episode,
 * else the newest aired date. Never fails the gate: anything wrong just leaves the plain page.
 */
async function behindTheGate(from: string): Promise<{ date: FeaturedDate; target: boolean } | null> {
  try {
    const db = await getDb();
    const id = episodeIdFrom(from);
    if (id) {
      const episode = await getEpisodeView(db, id, null).catch(() => null);
      const date = episode ? pickFeaturedDate([episode]) : null;
      if (date) return { date, target: true };
    }
    // The same shared copy as a signed-out home page's hero (app/page.tsx), so each warms the other: the week's
    // best-rated dates, at their best moment.
    const date = pickFeaturedDate(await shared("home:standout", () => listStandoutDates(db, null)), undefined, { best: true });
    return date ? { date, target: false } : null;
  } catch {
    return null;
  }
}

/** The age-gate screen middleware redirects to. `from` is where the visitor was headed. */
export default async function GatePage({ searchParams }: { searchParams: SearchParams }) {
  const { from } = await searchParams;
  const dest = typeof from === "string" ? from : "/";
  // After Dark's own host asks in its own words, with nothing of the show behind it (2026-11-07 audit, item 21). Someone
  // who answered on the show rarely sees this: the sign-in hop carries that answer across (app/api/auth/carry).
  if (afterDarkOnly()) return <AgeGate from={dest} afterDark />;
  const behind = await behindTheGate(dest);
  const [a, b] = behind?.date.characters ?? [];
  return (
    <>
      {behind && (
        <div className="gate-backdrop" aria-hidden="true" inert>
          <div className="gate-backdrop-copy">
            <p className="kicker">For OC roleplayers</p>
            <h2>Send your OC on a blind date. Then just watch.</h2>
          </div>
          <DateExcerpt date={behind.date} still cta={false} />
        </div>
      )}
      <AgeGate
        from={dest}
        backdrop={behind !== null}
        behind={behind?.target && a && b ? { names: `${a.name} × ${b.name}`, title: behind.date.title } : null}
      />
    </>
  );
}
