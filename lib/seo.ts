/**
 * What search engines and AI crawlers are told about the show: the sitemap's entries and the shared
 * structured data. The sitemap lists the public pages plus the content worth finding — characters that are
 * open to dates or have aired publicly, and every public, aired episode that hasn't been hidden after
 * reports. Private, unlisted, unaired and hidden things are never listed.
 */
import type { Metadata, MetadataRoute } from "next";
import { ALTERNATIVES, alternativePath } from "./alternatives";
import { OC_NAME_STYLES, ocNamesHref } from "./oc-names";
import { PLACE_STYLES, placeNamesHref } from "./place-names";
import { closedSeasons } from "./season-ref";
import { canonicalShipPath, readName } from "./ship-names";
import { formatPrice, onSale } from "./catalog";
import { BOILERPLATE, COMPANY, FOUNDER, socialLinks } from "./company";
import { landingLastModified } from "./landing-changes";
import { contactEmail } from "./legal-entity";
import type { Db } from "./db";
import { FREE_EPISODES_PER_SEASON, REPORT_HIDE_THRESHOLD } from "./rules";
import { seasonCastIds } from "./season-cast";
import { liveSeasonPaths } from "./season-page";
import { PUBLIC_PATHS, siteUrl } from "./site";
import { listedCharacterSql, listedDateSql } from "./public-cast";
import { originalSql } from "./house-bots";
import { LEAGUE_PATH, modelLeagueOn } from "./model-family";
import { SHOW_ID } from "./show-id";
import { showIdeasOn } from "./show-ideas-switch";
import { stepInOpen } from "./step-in-switch";
import { paymentLinkFromEnv } from "./stripe";
import { FREE_TOOLS, TOOLS_PATH } from "./tools";

/**
 * The home page's title and description, and the fallback for any page that doesn't set its own. "AI" is in it: it's the
 * word in every search in this space (2026-11-22 audit), and the title never said it.
 */
export const SITE_TITLE = "Botchelor: an AI blind-date show for original characters";
export const SITE_DESCRIPTION =
  "Give your original character a love life: AI-written blind dates nobody steers. They text you how it went and take your advice into the next one. Free, no sign-up.";
/** After Dark's own host says what it is instead (the 2026-11-22 audit: it carried the show's "Free, no sign-up"). */
export const AFTER_DARK_DESCRIPTION =
  "Botchelor After Dark: the private, adults-only side of the season. AI-generated fiction between fictional adults, invite only while it's in beta.";

/**
 * The site's share card, drawn with code at build time (app/site-card.tsx). Named by its .png address, the one the CDN
 * keeps (app/share-card.png/route.tsx). The root layout names it too; /opengraph-image is the same card, for old links.
 */
export const SHARE_IMAGE_ALT = "Botchelor: give your character a love life. Blind dates nobody steers; they text you how it went.";
export const SHARE_IMAGE = { url: "/share-card.png", width: 1200, height: 630, alt: SHARE_IMAGE_ALT, type: "image/png" };

type ShareImage = { url: string; width: number; height: number; alt: string; type?: string };

/** The feeds every page of the show names in its head (app/layout.tsx): the RSS feed and the agents' guide. */
export const SITE_FEEDS: Readonly<Record<string, string>> = { "application/rss+xml": "/feed.xml", "text/plain": "/llms.txt" };

/** About as much of a description as a search result shows; past it, the words are cut wherever they fall. */
export const DESCRIPTION_MAX = 155;

/**
 * A page's description as a search result shows it (DESCRIPTION_MAX; the 2026-11-22 audit found them up to 254
 * characters): whole sentences when the first ones say enough, else cut at a word with an ellipsis. One that fits is
 * left as it is.
 */
export function fitDescription(text: string, max: number = DESCRIPTION_MAX): string {
  const s = text.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  let end = 0;
  for (const m of s.matchAll(/[.!?](?= )/g)) {
    const at = (m.index ?? 0) + 1;
    if (at > max) break;
    end = at;
  }
  if (end >= max * 0.6) return s.slice(0, end);
  const cut = s.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 1)).replace(/[\s,;:(—–-]+$/, "")}…`;
}

/**
 * One public page's search and share tags: its own title and description, its canonical address, and Open Graph and
 * Twitter tags that say the same. Next replaces the root layout's openGraph and twitter whole when a page sets them, so
 * the site's fields and the share card are repeated here. A page that draws its own card (an opengraph-image file
 * beside it) passes `image: null`, so that file is the one used. The search description fits a result
 * (fitDescription); the share cards keep the whole of it.
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
    description: fitDescription(description),
    alternates: { canonical: path },
    openGraph: { type: "website", siteName: "Botchelor", locale: "en_US", url: path, title, description, ...(image ? { images: [image] } : {}) },
    // twitter:image follows og:image when it isn't set here (Next fills it in), the page's own card included.
    twitter: { card: "summary_large_image", title, description },
  };
}

/** The policy pages: they change when the rules do, not daily. */
const POLICY_PATHS: ReadonlySet<string> = new Set(["/terms", "/privacy", "/content-policy", "/report", "/cancel", "/2257", "/safety", "/security", "/accessibility"]);
// /import and the Character.AI landing are the rescue door (2026-11-14): as findable as the agents page.
const PRIORITY: Record<string, number> = { "/": 1, "/create": 0.9, "/watch": 0.9, "/agents": 0.8, "/import": 0.8, "/alternatives/character-ai": 0.8, "/characters": 0.7 };

/**
 * The search landings beside PUBLIC_PATHS: the other /alternatives pages and the OC and place name generators' style pages. Not
 * the prompts library's tag pages (listed 2026-11-11 until the 2026-11-22 audit): their words are an open dataset's, and
 * the library sits behind the 18+ gate, so a search result sent people to the gate (app/prompts: noindex now).
 */
export function landingPaths(): string[] {
  return [...ALTERNATIVES.filter((a) => !(PUBLIC_PATHS as readonly string[]).includes(alternativePath(a.slug))).map((a) => alternativePath(a.slug)), ...OC_NAME_STYLES.map((s) => ocNamesHref(s)), ...PLACE_STYLES.map((s) => placeNamesHref(s))];
}

export function staticSitemap(base: string = siteUrl(), now: Date = new Date()): MetadataRoute.Sitemap {
  // A switch that takes a page away takes it out of the sitemap too: MODEL_LEAGUE=0 the league (lib/model-league.ts),
  // SHOW_IDEAS=0 /shows and the show's own page, STEP_IN_OPEN=0 /step-in (each 404s for people then).
  const off = new Set<string>([...(modelLeagueOn() ? [] : [LEAGUE_PATH]), ...(showIdeasOn() ? [] : ["/shows"]), ...(stepInOpen() ? [] : ["/step-in"])]);
  const shows = showIdeasOn() ? [`/shows/${SHOW_ID}`] : [];
  // /feed.xml is announced in every page's head and in robots.txt, not listed here as a page (2026-11-22 audit).
  const paths = [...PUBLIC_PATHS, ...shows, ...landingPaths()].filter((path) => !off.has(path));
  return paths.map((path): MetadataRoute.Sitemap[number] => {
    // A landing rewritten on a known day says so (lib/landing-changes.ts); every other page says nothing rather than guess.
    const lastModified = landingLastModified(path, now);
    return {
      url: `${base}${path}`,
      ...(lastModified ? { lastModified } : {}),
      changeFrequency: POLICY_PATHS.has(path) ? "monthly" : "daily",
      priority: PRIORITY[path] ?? 0.5,
    };
  });
}

/**
 * A couple's own pages (/couples/a/b and its ship page) go in the sitemap once they've aired this many dates. With one
 * date the couple page mostly repeats that episode, and Search Console (2026-11-15) had 440 such couples' pages
 * "Discovered/Crawled - currently not indexed", crowding out /pricing and the landings. The pages stay up and linked.
 */
export const SITEMAP_MIN_COUPLE_DATES = 2;

/**
 * A character page worth a search engine's time (David, 2026-11-19, before the catalog cast adds up to 90 characters a
 * day): public, and either on this season's house cast or in a date that aired publicly. Until then the page is up,
 * linked and followed, but says noindex and stays out of the sitemap and IndexNow: a fresh profile is a name and a bio,
 * and Google reads many of those at once as scaled content (and judges a site's quality as a whole). Never a deleted
 * account's character (lib/public-cast.ts: kept only so aired dates keep both names). `$cast` is the placeholder
 * holding seasonCastIds(). The date that counts is one worth indexing itself (authoredDateSql): an outside agent's
 * character is in once it has dated a person's character or one of the show's own (2026-11-22 audit).
 */
export const indexableCharacterSql = (alias: string, cast: string): string =>
  `(${alias}.visibility = 'public' and ${listedCharacterSql(alias)} and ((${alias}.is_house and ${alias}.premium_sku is null and ${alias}.id = any(${cast}))
     or exists (select 1 from episodes ie
                 where (ie.character_a = ${alias}.id or ie.character_b = ${alias}.id)
                   and ie.visibility = 'public' and ie.revealed_at is not null and ie.status = 'ready' and ${authoredDateSql("ie")})))`;

/**
 * SQL: the character in `alias` was made by a person, or is one of the show's own (a house character or a Botchelor
 * original, lib/origin.ts): not by an outside AI agent or one of the show's loop bots. The search bar for dates and
 * couples (2026-11-22 audit): 263 of the sitemap's 652 dates were between two machine-made characters, the kind of page
 * Google was already declining in bulk ("Discovered, not indexed"), and it judges a site's quality as a whole. Those
 * pages stay up and linked; they say noindex and stay out of the sitemap and IndexNow.
 */
export const authoredCharacterSql = (alias: string): string =>
  `(${alias}.is_house or ${alias}.created_via is distinct from 'mcp' or coalesce(${originalSql(`${alias}.owner_id`)}, false))`;

/** SQL: at least one of the two characters of the episode in `e` is authored (authoredCharacterSql). */
export const authoredDateSql = (e: string): string =>
  `exists (select 1 from characters ac where ac.id in (${e}.character_a, ${e}.character_b) and ${authoredCharacterSql("ac")})`;

/** Whether one date is worth indexing beyond its public, aired state: a person's or the show's own character is in it. */
export async function dateAuthored(db: Db, episodeId: string): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>(`select ${authoredDateSql("e")} as ok from episodes e where e.id = $1`, [episodeId]);
  return rows[0]?.ok === true;
}

/**
 * Whether a couple's page is worth indexing, as the sitemap lists couples: at least SITEMAP_MIN_COUPLE_DATES public
 * dates, and one of the two authored (authoredCharacterSql). `a` and `b` in the page's order (the lower id first).
 */
export async function coupleIndexable(db: Db, a: string, b: string): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>(
    `select r.public_dates >= $3 and (${authoredCharacterSql("ca")} or ${authoredCharacterSql("cb")}) as ok
       from relationships r join characters ca on ca.id = r.character_a join characters cb on cb.id = r.character_b
      where r.character_a = $1 and r.character_b = $2`,
    [a, b, SITEMAP_MIN_COUPLE_DATES],
  );
  return rows[0]?.ok === true;
}

/** Whether one character's page is worth indexing (indexableCharacterSql). */
export async function characterIndexable(db: Db, id: string): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>(`select ${indexableCharacterSql("c", "$2")} as ok from characters c where c.id = $1`, [id, seasonCastIds()]);
  return rows[0]?.ok === true;
}

/**
 * The episodes and characters worth indexing. Bounded well under the 50,000-URL sitemap limit. A date or couple with a
 * deleted account's character isn't listed (lib/public-cast.ts), nor a couple with a private one: the page stays up for
 * the other side, and says noindex.
 */
export async function contentSitemap(db: Db, base: string = siteUrl()): Promise<MetadataRoute.Sitemap> {
  const episodes = await db.query<{ id: string; at: Date | string }>(
    `select e.id, coalesce(e.revealed_at, e.created_at) as at
       from episodes e
      where e.visibility = 'public' and e.revealed_at is not null and e.status = 'ready'
        and (select count(*) from reports r where r.episode_id = e.id) < $1
        and ${listedDateSql("e")} and ${authoredDateSql("e")}
      order by e.revealed_at desc
      limit 20000`,
    [REPORT_HIDE_THRESHOLD],
  );
  // This season's house cast and anyone who has aired publicly (indexableCharacterSql). Open to dates alone isn't enough
  // since 2026-11-19: a profile with no date yet is a name and a bio. Last changed: their latest public date's airing
  // (the page shows every date), else the day they were made (2026-11-22 audit: the house cast all said 2026-10-13).
  const characters = await db.query<{ id: string; at: Date | string }>(
    `select c.id, coalesce((select max(le.revealed_at) from episodes le
                             where (le.character_a = c.id or le.character_b = c.id)
                               and le.visibility = 'public' and le.status = 'ready'), c.created_at) as at
       from characters c
      where ${indexableCharacterSql("c", "$1")}
      order by c.is_house desc, c.created_at desc
      limit 20000`,
    [seasonCastIds()],
  );
  // Couples whose dates have aired publicly (the relationship graph's public layer), with both names for their ship page.
  const couples = await db.query<{ a: string; b: string; at: Date | string | null; name_a: string; name_b: string }>(
    `select r.character_a as a, r.character_b as b, r.public_last_at as at, ca.name as name_a, cb.name as name_b
       from relationships r join characters ca on ca.id = r.character_a join characters cb on cb.id = r.character_b
      where r.public_dates >= $1 and ca.visibility = 'public' and cb.visibility = 'public' and ${listedCharacterSql("ca")} and ${listedCharacterSql("cb")}
        and (${authoredCharacterSql("ca")} or ${authoredCharacterSql("cb")})
      order by r.public_last_at desc nulls last limit 5000`,
    [SITEMAP_MIN_COUPLE_DATES],
  );
  // Creators with a handle (lib/showcase.ts) and at least one PG post: their page lists what they published, so it
  // last changed with their latest one.
  const creators = await db.query<{ handle: string; at: Date | string }>(
    `select cp.handle, coalesce((select max(lp.created_at) from showcase_posts lp where lp.owner_id = cp.user_id and lp.rating = 'pg'), cp.created_at) as at
       from creator_profiles cp
      where not cp.hidden and exists (select 1 from showcase_posts sp where sp.owner_id = cp.user_id and sp.rating = 'pg')
      order by cp.created_at desc limit 5000`,
  );
  // The ship-name page of each aired couple (app/ship/[a]/[b]): a search landing that nothing else listed (2026-11-11),
  // at its one address, the names in order (canonicalShipPath), as the page's canonical says.
  const ships = couples.rows.flatMap((r) => {
    const a = readName(r.name_a.split(/\s+/)[0] ?? "");
    const b = readName(r.name_b.split(/\s+/)[0] ?? "");
    return a && b && a.slug !== b.slug ? [{ url: `${base}${canonicalShipPath(a, b)}`, ...(r.at ? { lastModified: new Date(r.at) } : {}), changeFrequency: "monthly" as const, priority: 0.4 }] : [];
  });
  // Every closed season's finale (lib/season-ref.ts): the page never changes once the month ends.
  const seasons = closedSeasons().map((s) => ({ url: `${base}${s.path}`, changeFrequency: "yearly" as const, priority: 0.6 }));
  // A lead season's own page while it's this month's or the next's (lib/season-page.ts, docs/season-page.md): it
  // changes every day, and it's where the December clips send people.
  const live = (await liveSeasonPaths(db).catch(() => [])).map((s) => ({ url: `${base}${s.path}`, changeFrequency: "daily" as const, priority: 0.8 }));
  return [
    ...live,
    ...characters.rows.map((r) => ({ url: `${base}/characters/${r.id}`, lastModified: new Date(r.at), changeFrequency: "weekly" as const, priority: 0.6 })),
    ...couples.rows.map((r) => ({ url: `${base}/couples/${r.a}/${r.b}`, ...(r.at ? { lastModified: new Date(r.at) } : {}), changeFrequency: "weekly" as const, priority: 0.5 })),
    ...episodes.rows.map((r) => ({ url: `${base}/episodes/${r.id}`, lastModified: new Date(r.at), changeFrequency: "monthly" as const, priority: 0.6 })),
    ...seasons,
    ...creators.rows.map((r) => ({ url: `${base}/creators/${r.handle}`, lastModified: new Date(r.at), changeFrequency: "weekly" as const, priority: 0.5 })),
    ...ships,
  ];
}

/** How long a server keeps the sitemap's content part (cachedContentSitemap). */
const CONTENT_SITEMAP_KEEP_MS = 60 * 60_000;
let keptContent: { db: Db; base: string; at: number; urls: Promise<MetadataRoute.Sitemap> } | null = null;

/**
 * contentSitemap at most once an hour per server, for app/sitemap.ts: every request for /sitemap.xml read five tables
 * again, though the route's comment said a CDN kept it (2026-11-22 audit; the route answers max-age=0, so none did).
 * Crawlers asking at once share one build, and a build that fails isn't kept. A new aired date still gets IndexNow's ping
 * the same day (lib/indexnow.ts).
 */
export function cachedContentSitemap(db: Db, base: string = siteUrl(), now: number = Date.now()): Promise<MetadataRoute.Sitemap> {
  const kept = keptContent;
  if (kept && kept.db === db && kept.base === base && now - kept.at < CONTENT_SITEMAP_KEEP_MS) return kept.urls;
  const entry = { db, base, at: now, urls: contentSitemap(db, base) };
  keptContent = entry;
  entry.urls.catch(() => {
    if (keptContent === entry) keptContent = null;
  });
  return entry.urls;
}

/** Tests: the next sitemap is built afresh (tests/helpers.ts reset). */
export function forgetContentSitemapForTests(): void {
  keptContent = null;
}

/**
 * What the show costs, for search engines: free dates every week, and each pack on sale (REVENUE.md: $4 once; the $10
 * pack once its link is set), listed only while purchases are open (the small pack's link set), as the shop shows its
 * Buy button only then.
 */
export function siteOffers(env: Record<string, string | undefined> = process.env, base: string = siteUrl()): Record<string, unknown>[] {
  const free = { "@type": "Offer", name: `${FREE_EPISODES_PER_SEASON} free dates a week`, price: "0", priceCurrency: "USD" };
  if (!paymentLinkFromEnv(env)) return [free];
  const packs = onSale(env).map((pack) => ({
    "@type": "Offer",
    name: pack.name,
    description: `${pack.episodes} more dates for ${formatPrice(pack.price_cents)}, paid once. Not a subscription.`,
    price: (pack.price_cents / 100).toFixed(2),
    priceCurrency: "USD",
    // The open price page: /shop is behind the 18+ gate for people, so a search result there landed on the gate.
    url: `${base}/pricing`,
    availability: "https://schema.org/InStock",
  }));
  return [free, ...packs];
}

/**
 * The show as an organization: its logo, its own accounts (`sameAs`, so search engines tie X, Bluesky, TikTok, Discord and GitHub
 * to the brand), the support address once CONTACT_EMAIL is set, and who makes it (lib/company.ts).
 */
export function organizationJsonLd(base: string = siteUrl(), env: Record<string, string | undefined> = process.env): Record<string, unknown> {
  const email = contactEmail(env);
  return {
    "@type": "Organization",
    "@id": `${base}/#org`,
    name: "Botchelor",
    legalName: COMPANY,
    url: base,
    // A raster logo of at least 112px is what Google's logo guidance asks for; the SVG stays the favicon.
    logo: logoJsonLd(base),
    description: BOILERPLATE.oneLine,
    founder: { "@type": "Person", name: FOUNDER },
    sameAs: socialLinks(env).map((s) => s.url),
    ...(email
      ? { email, contactPoint: [{ "@type": "ContactPoint", contactType: "customer support", email, url: `${base}/contact`, availableLanguage: ["English"] }] }
      : {}),
  };
}

/** The site-wide organization, website and app, in every public page's JSON-LD (app/layout.tsx). */
export function siteJsonLd(base: string = siteUrl(), env: Record<string, string | undefined> = process.env): Record<string, unknown>[] {
  const org = organizationJsonLd(base, env);
  return [
    {
      "@context": "https://schema.org",
      "@graph": [
        org,
        {
          "@type": "WebSite",
          "@id": `${base}/#website`,
          name: "Botchelor",
          alternateName: "Botchelor — an AI blind-date show for original characters",
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

/**
 * A free tool's page (lib/tools.ts): a web app anyone can use for free, and its place under the tools hub (the
 * 2026-11-22 audit found four of the five with no page-level data at all).
 */
export function toolJsonLd(path: string, base: string = siteUrl()): Record<string, unknown>[] {
  const tool = FREE_TOOLS.find((t) => t.path === path);
  if (!tool) return [];
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: tool.name,
      url: `${base}${tool.path}`,
      description: tool.blurb,
      applicationCategory: "EntertainmentApplication",
      operatingSystem: "Any",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      isPartOf: { "@id": `${base}/#website` },
      publisher: { "@id": `${base}/#org` },
    },
    breadcrumbJsonLd(
      [
        { name: "Botchelor", path: "/" },
        { name: "Free OC tools", path: TOOLS_PATH },
        { name: tool.name, path: tool.path },
      ],
      base,
    ),
  ];
}

/** The show's logo as structured data wants it: the raster one (Google's logo guidance), not the SVG favicon. */
export function logoJsonLd(base: string = siteUrl()): Record<string, unknown> {
  return { "@type": "ImageObject", url: `${base}/icons/icon-512.png`, width: 512, height: 512 };
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
  /** Their portrait, as the page shows it (site-relative), when they have one. */
  image: string | null = null,
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
      ...(image ? { image: image.startsWith("/") ? `${base}${image}` : image } : {}),
      // Every character is fictional: say so in the data, not just the page.
      disambiguatingDescription: `A fictional ${c.house ? "house character" : "original character"} on the AI blind-date show Botchelor.`,
    },
  };
}
