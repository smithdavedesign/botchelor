import Link from "next/link";
import { getDb } from "@/lib/db";
import { overnightMarks, overnightOffer } from "@/lib/overnight";
import { OVERNIGHT_COPY, overnightDatesOn } from "@/lib/overnight-shared";
import OvernightOffer from "./OvernightOffer";

/**
 * A couple's overnight dates (lib/overnight.ts), on their page: each one that aired and ended in them leaving together,
 * as anyone may see it from the public record; for an owner of one of the two, also the one fixed line a continued night
 * left ("They spent the night together", theirs alone) and, when the couple has earned an overnight date, the offer.
 * Nothing at all when there's neither, or with OVERNIGHT_DATES=0.
 */
export default async function Overnight({ a, b, viewerId, owner }: { a: string; b: string; viewerId: string | null; owner: boolean }) {
  if (!overnightDatesOn()) return null;
  const db = await getDb();
  const [marks, offer] = await Promise.all([
    overnightMarks(db, { pair: [a, b] }, viewerId).catch(() => []),
    owner && viewerId ? overnightOffer(db, viewerId, a, b).catch(() => null) : null,
  ]);
  if (!marks.length && !offer) return null;
  return (
    <section className="card" id="overnight" aria-labelledby="overnight-title">
      <h2 id="overnight-title">{OVERNIGHT_COPY.chip}</h2>
      {marks.map((m) => (
        <p key={m.episode_id} className="overnight-mark" data-overnight-mark>
          <Link href={`/episodes/${m.episode_id}`}>Their overnight date{m.place ? ` at ${m.place}` : ""}</Link>: {OVERNIGHT_COPY.leftTogether}
          {m.night_together && (
            <>
              {" "}
              <span className="muted small" data-night-together>
                {OVERNIGHT_COPY.nightTogether} (Only the two of you who made them see this.)
              </span>
            </>
          )}
        </p>
      ))}
      {offer && <OvernightOffer offer={offer} />}
    </section>
  );
}
