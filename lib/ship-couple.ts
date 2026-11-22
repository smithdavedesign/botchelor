/**
 * The real couple a ship-name page is about, when there is one (the 2026-11-22 audit: /ship/juniper/sable said nothing
 * of Juniper and Sable, who are going steady on the show, and its one button made a new character called Juniper). The
 * sitemap lists a ship page for each couple whose dates aired (lib/seo.ts), so search lands on these: a public pair
 * whose first names are the page's two, either way round, the one with the most aired dates.
 */
import type { Db } from "./db";
import { listedCharacterSql } from "./public-cast";
import { shownStage, type Stage } from "./relationship-stages";

export type ShipCouple = {
  /** In the page's order: `a` is the first name in its address. */
  a: { id: string; name: string };
  b: { id: string; name: string };
  /** Dates that aired publicly. */
  dates: number;
  stage: Stage | null;
  /** Their couple page (app/couples/[a]/[b]). */
  path: string;
};

/** A name's first word, as the sitemap builds a ship address from it ("Juniper Vale" → "juniper"). */
const firstWord = (name: string): string => (name.trim().split(/\s+/)[0] ?? "").toLowerCase();

export async function shipCouple(db: Db, first: string, second: string): Promise<ShipCouple | null> {
  const [x, y] = [firstWord(first), firstWord(second)];
  if (!x || !y || x === y) return null;
  const { rows } = await db.query<{ a: string; b: string; name_a: string; name_b: string; dates: number; stage: string | null; shown: string | null }>(
    `select r.character_a as a, r.character_b as b, ca.name as name_a, cb.name as name_b, r.public_dates as dates,
            r.public_stage as stage, r.public_shown_stage as shown
       from relationships r join characters ca on ca.id = r.character_a join characters cb on cb.id = r.character_b
      where r.public_dates >= 1 and ca.visibility = 'public' and cb.visibility = 'public' and ${listedCharacterSql("ca")} and ${listedCharacterSql("cb")}
        and ((lower(split_part(ca.name, ' ', 1)) = $1 and lower(split_part(cb.name, ' ', 1)) = $2)
          or (lower(split_part(ca.name, ' ', 1)) = $2 and lower(split_part(cb.name, ' ', 1)) = $1))
      order by r.public_dates desc, r.public_last_at desc nulls last
      limit 1`,
    [x, y],
  );
  const r = rows[0];
  if (!r) return null;
  const lo = { id: r.a, name: r.name_a };
  const hi = { id: r.b, name: r.name_b };
  const aFirst = firstWord(r.name_a) === x;
  return {
    a: aFirst ? lo : hi,
    b: aFirst ? hi : lo,
    dates: Number(r.dates),
    stage: shownStage(r.stage as Stage | null, r.shown as Stage | null, process.env, Number(r.dates)),
    path: `/couples/${r.a}/${r.b}`,
  };
}
