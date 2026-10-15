/**
 * What search engines and AI crawlers are told about the show: the sitemap's entries and the shared
 * structured data. The sitemap lists the public pages plus the content worth finding — characters that are
 * open to dates or have aired publicly, and every public, aired episode that hasn't been hidden after
 * reports. Private, unlisted, unaired and hidden things are never listed.
 */
import type { MetadataRoute } from "next";
import type { Db } from "./db";
import { REPORT_HIDE_THRESHOLD } from "./rules";
import { PUBLIC_PATHS, siteUrl } from "./site";

const PRIORITY: Record<string, number> = { "/": 1, "/create": 0.9, "/feed": 0.9, "/watch": 0.8, "/agents": 0.8, "/cast": 0.7 };

export function staticSitemap(base: string = siteUrl()): MetadataRoute.Sitemap {
  return PUBLIC_PATHS.map((path) => ({
    url: `${base}${path}`,
    changeFrequency: path === "/terms" || path === "/privacy" ? "monthly" : "daily",
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
  const characters = await db.query<{ id: string; at: Date | string }>(
    `select c.id, c.created_at as at
       from characters c
      where (c.is_house and c.premium_sku is null) or c.open_to_dates
         or exists (select 1 from episodes e
                     where (e.character_a = c.id or e.character_b = c.id)
                       and e.visibility = 'public' and e.revealed_at is not null)
      order by c.is_house desc, c.created_at desc
      limit 20000`,
  );
  return [
    ...characters.rows.map((r) => ({ url: `${base}/characters/${r.id}`, lastModified: new Date(r.at), changeFrequency: "weekly" as const, priority: 0.6 })),
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
