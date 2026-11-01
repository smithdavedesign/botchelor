/**
 * What search engines and AI crawlers are told about the show: the sitemap's entries and the shared
 * structured data. The sitemap lists the public pages plus the content worth finding — characters that are
 * open to dates or have aired publicly, and every public, aired episode that hasn't been hidden after
 * reports. Private, unlisted, unaired and hidden things are never listed.
 */
import type { Metadata, MetadataRoute } from "next";
import { formatPrice, PACK_5 } from "./catalog";
import type { Db } from "./db";
import { FREE_EPISODES_PER_SEASON, REPORT_HIDE_THRESHOLD } from "./rules";
import { seasonCastIds } from "./season-cast";
import { PUBLIC_PATHS, siteUrl } from "./site";
import { paymentLinkFromEnv } from "./stripe";

/** The home page's title and description, and the fallback for any page that doesn't set its own. */
export const SITE_TITLE = "Botchelor: a blind-date show for original characters";
export const SITE_DESCRIPTION =
  "Send your original character — or your AI agent — on an AI-written blind date nobody can steer. Friends predict how it ends, for free points.";

/** The site's share card, drawn with code at build time (app/opengraph-image.tsx). */
export const SHARE_IMAGE_ALT = "Botchelor: a blind-date show for original characters. Friends predict the ending, for free points.";
export const SHARE_IMAGE = { url: "/opengraph-image", width: 1200, height: 630, alt: SHARE_IMAGE_ALT, type: "image/png" };

type ShareImage = { url: string; width: number; height: number; alt: string; type?: string };

/**
 * One public page's search and share tags: its own title and description, its canonical address, and Open Graph and
 * Twitter tags that say the same. Next replaces the root layout's openGraph and twitter whole when a page sets them, so
 * the site's fields and the share card are repeated here. A page that draws its own card (an opengraph-image file
 * beside it) passes `image: null`, so that file is the one used.
 */
export function pageMetadata({
  title,
  description,
  path,
  image = SHARE_IMAGE,
}: {
  title: string;
  description: string;
  path: string;
  image?: ShareImage | null;
}): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "website", siteName: "Botchelor", locale: "en_US", url: path, title, description, ...(image ? { images: [image] } : {}) },
    // twitter:image follows og:image when it isn't set here (Next fills it in), the page's own card included.
    twitter: { card: "summary_large_image", title, description },
  };
}

/** The policy pages: they change when the rules do, not daily. */
const POLICY_PATHS: ReadonlySet<string> = new Set(["/terms", "/privacy", "/content-policy", "/report", "/cancel", "/2257", "/safety"]);
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

/**
 * What the show costs, for search engines: free dates every week, and the one pack on sale (REVENUE.md: $4 once), listed
 * only while purchases are open (STRIPE_PAYMENT_LINK set), as the shop shows its Buy button only then.
 */
export function siteOffers(env: Record<string, string | undefined> = process.env, base: string = siteUrl()): Record<string, unknown>[] {
  const free = { "@type": "Offer", name: `${FREE_EPISODES_PER_SEASON} free dates a week`, price: "0", priceCurrency: "USD" };
  if (!paymentLinkFromEnv(env)) return [free];
  const pack = {
    "@type": "Offer",
    name: PACK_5.name,
    description: `${PACK_5.episodes} more dates for ${formatPrice(PACK_5.price_cents)}, paid once. Not a subscription.`,
    price: (PACK_5.price_cents / 100).toFixed(2),
    priceCurrency: "USD",
    url: `${base}/shop`,
    availability: "https://schema.org/InStock",
  };
  return [free, pack];
}

/** The site-wide organization, website and app, in every public page's JSON-LD (app/layout.tsx). */
export function siteJsonLd(base: string = siteUrl(), env: Record<string, string | undefined> = process.env): Record<string, unknown>[] {
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
          "@type": "SoftwareApplication",
          "@id": `${base}/#app`,
          name: "Botchelor",
          url: base,
          applicationCategory: "EntertainmentApplication",
          operatingSystem: "Web",
          description:
            "An AI blind-date show for original characters. Build a character — or bring an AI agent over MCP — send it on a date nobody can steer, and predict how other dates end for free points.",
          offers: siteOffers(env, base),
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
