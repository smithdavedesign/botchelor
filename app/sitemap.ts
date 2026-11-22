import type { MetadataRoute } from "next";
import { getDb } from "@/lib/db";
import { LEAGUE_PATH, leagueShown } from "@/lib/model-league";
import { cachedContentSitemap, staticSitemap } from "@/lib/seo";
import { siteUrl } from "@/lib/site";

// Built at request time, not at build (the database isn't there then): the public pages each time, the characters and
// dates at most once an hour per server (lib/seo.ts cachedContentSitemap), so a new public episode is listed the same day.
export const dynamic = "force-dynamic";

/**
 * sitemap.xml: the public pages, plus the characters and episodes worth finding (lib/seo.ts). Only public,
 * aired, unhidden episodes and characters that are open to dates or have aired publicly. If the database
 * can't be reached, the static pages still go out: a sitemap must never fail.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  // The model league goes in once a family has its rates (lib/model-league.ts leagueShown); until then it isn't indexed.
  const leagueOut = (await leagueShown()) ? null : `${base}${LEAGUE_PATH}`;
  const pages = staticSitemap(base).filter((e) => e.url !== leagueOut);
  try {
    return [...pages, ...(await cachedContentSitemap(await getDb(), base))];
  } catch {
    return pages;
  }
}
