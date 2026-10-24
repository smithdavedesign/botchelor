/**
 * What search engines and AI crawlers are told about the show: the sitemap's entries and the shared
 * structured data. The sitemap lists the public pages plus the content worth finding — characters that are
 * open to dates or have aired publicly, and every public, aired episode that hasn't been hidden after
 * reports. Private, unlisted, unaired and hidden things are never listed.
 */
import type { MetadataRoute } from "next";
import type { Db } from "./db";
import { REPORT_HIDE_THRESHOLD } from "./rules";
import { seasonCastIds } from "./season-cast";
import { PUBLIC_PATHS, siteUrl } from "./site";

/** The policy pages: they change when the rules do, not daily. */
const POLICY_PATHS: ReadonlySet<string> = new Set(["/terms", "/privacy", "/content-policy", "/report", "/cancel", "/2257"]);
const PRIORITY: Record<string, number> = { "/": 1, "/create": 0.9, "/watch": 0.9, "/agents": 0.8, "/characters": 0.7 };

export function staticSitemap(base: string = siteUrl()): MetadataRoute.Sitemap {
  return PUBLIC_PATHS.map((path) => ({
    url: `${base}${path}`,
    changeFrequency: POLICY_PATHS.has(path) ? "monthly" : "daily",
    priority: PRIORITY[path] ?? 0.5,
  }));
}

/** The episodes and characters worth indexing. Bounded well under the 50,000-URL sitemap limit. */
export async function contentSitemap(db: Db, base: string = siteUrl()): Promise<MetadataRoute.Sitemap> {
  const episodes = await db.query<{ id: string; at: Date | string }>(
    `select e.id, coalesce(e.revealed_at, e.created_at) as at
       from episodes e
      where e.visibility = 'public' and e.revealed_at is not null and e.status = 'ready'
        and (select count(*) from reports r where r.episode_id = e.id) < $1
      order by e.revealed_at desc
      limit 20000`,
    [REPORT_HIDE_THRESHOLD],
  );
  // This season's house cast, every character open to dates, and anyone who has aired publicly.
  const characters = await db.query<{ id: string; at: Date | string }>(
    `select c.id, c.created_at as at
       from characters c
      where c.visibility = 'public' and ((c.is_house and c.premium_sku is null and c.id = any($1)) or c.open_to_dates
         or exists (select 1 from episodes e
                     where (e.character_a = c.id or e.character_b = c.id)
                       and e.visibility = 'public' and e.revealed_at is not null))
      order by c.is_house desc, c.created_at desc
      limit 20000`,
    [seasonCastIds()],
  );
  // Couples whose dates have aired publicly (the relationship graph's public layer).
  const couples = await db.query<{ a: string; b: string; at: Date | string | null }>(
    `select character_a as a, character_b as b, public_last_at as at from relationships
      where public_dates > 0 order by public_last_at desc nulls last limit 5000`,
  );
  return [
    ...characters.rows.map((r) => ({ url: `${base}/characters/${r.id}`, lastModified: new Date(r.at), changeFrequency: "weekly" as const, priority: 0.6 })),
    ...couples.rows.map((r) => ({ url: `${base}/couples/${r.a}/${r.b}`, ...(r.at ? { lastModified: new Date(r.at) } : {}), changeFrequency: "weekly" as const, priority: 0.5 })),
    ...episodes.rows.map((r) => ({ url: `${base}/episodes/${r.id}`, lastModified: new Date(r.at), changeFrequency: "monthly" as const, priority: 0.6 })),
  ];
}

/** The site-wide organization and website, for the home page's JSON-LD. */
export function siteJsonLd(base: string = siteUrl()): Record<string, unknown>[] {
  const org = { "@type": "Organization", "@id": `${base}/#org`, name: "Botchelor", url: base, logo: `${base}/icon.svg` };
  return [
    {
      "@context": "https://schema.org",
      "@graph": [
        org,
        {
          "@type": "WebSite",
          "@id": `${base}/#website`,
          name: "Botchelor",
          alternateName: "Botchelor — a blind-date show for original characters",
          url: base,
          publisher: { "@id": `${base}/#org` },
          inLanguage: "en",
        },
        {
          "@type": "WebApplication",
          name: "Botchelor",
          url: base,
          applicationCategory: "EntertainmentApplication",
          operatingSystem: "Web",
          description:
            "An AI blind-date show for original characters. Build a character — or bring an AI agent over MCP — send it on a date nobody can steer, and predict how other dates end for free points.",
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
          isAccessibleForFree: true,
          publisher: { "@id": `${base}/#org` },
        },
      ],
    },
  ];
}

/* ------------------------------------------------------------------------------------------------------------
 * Page-level structured data. Only PUBLIC fields ever go in (what the contestant card shows): never the soul,
 * the dealbreaker, learned memory, notes or anything owner-only.
 * ---------------------------------------------------------------------------------------------------------- */

/** A breadcrumb trail, e.g. Home › The cast › Ira Fenn. `path` is site-relative. */
export function breadcrumbJsonLd(trail: { name: string; path: string }[], base: string = siteUrl()): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((t, i) => ({ "@type": "ListItem", position: i + 1, name: t.name, item: `${base}${t.path}` })),
  };
}

/** An ordered list of pages (the cast, the feed): lets search engines and AI crawlers see the collection. */
export function itemListJsonLd(name: string, items: { name: string; path: string }[], base: string = siteUrl()): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    numberOfItems: items.length,
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, url: `${base}${it.path}` })),
  };
}

/** A contestant's profile page: a fictional adult character, from its public card only. */
export function characterJsonLd(
  c: { id: string; name: string; bio: string; house: boolean },
  base: string = siteUrl(),
): Record<string, unknown> {
  const url = `${base}/characters/${c.id}`;
  return {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    url,
    name: `${c.name} — a contestant on Botchelor`,
    isPartOf: { "@id": `${base}/#website` },
    mainEntity: {
      "@type": "Person",
      "@id": `${url}#character`,
      name: c.name,
      url,
      description: c.bio,
      // Every character is fictional: say so in the data, not just the page.
      disambiguatingDescription: `A fictional ${c.house ? "house character" : "original character"} on the AI blind-date show Botchelor.`,
    },
  };
}
