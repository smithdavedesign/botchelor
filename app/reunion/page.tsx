import type { Metadata } from "next";
import Link from "next/link";
import ReunionPanel from "@/app/ReunionPanel";
import { getDb } from "@/lib/db";
import { getReunion } from "@/lib/reunion";
import { pageHref, parsePage } from "@/lib/paging";
import { privateAmong } from "@/lib/directory";
import { pageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: "The Reunion: this season's awards, couples and confessionals · Botchelor",
  description: "The cast back under the lights: this season's awards, where every couple stands, and the confessionals their creators chose to share.",
  path: "/reunion",
});

/**
 * The Reunion special, on its own page again (2026-10-21). It had moved to the bottom of Watch, with this route
 * redirecting there; Watch now shows one Reunion card that links here (#532), so the redirect sent that link in a loop.
 */
export default async function ReunionPage({ searchParams }: { searchParams?: Promise<{ couples?: string | string[] }> } = {}) {
  const couplesPage = parsePage((await searchParams)?.couples);
  const db = await getDb();
  const reunion = await getReunion(db);
  const hidden = await privateAmong(db, [
    ...reunion.couples.flatMap((c) => [c.a.id, c.b.id]),
    ...reunion.confessionals.map((c) => c.character.id),
  ]);
  const empty = !reunion.couples.length && !reunion.confessionals.length && !reunion.awards.length;
  return (
    <article className="reunion-page">
      <p className="muted">
        <Link href="/watch">← Watch</Link>
      </p>
      {empty ? (
        <section className="card">
          <p className="kicker">Season special</p>
          <h1>The Reunion</h1>
          <p className="muted">Nothing has aired yet this season. The Reunion fills in as dates air: awards, couples and the confessionals creators share.</p>
          <Link className="button" href="/watch">
            Watch a date
          </Link>
        </section>
      ) : (
        <ReunionPanel reunion={reunion} heading="h1" couplesPage={couplesPage} couplesHref={(n) => pageHref("/reunion", {}, "couples", n, "couples")} hidden={hidden} />
      )}
    </article>
  );
}
