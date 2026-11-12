/**
 * An RSS 2.0 feed of aired dates (the 2026-11-11 growth plan: syndication with nobody's hands on it). Pure: the route
 * (app/feed.xml/route.ts) loads the dates and this writes the XML. Each item is a teaser (lib/episode-share.ts
 * shareDescription), never the ending: a reader's preview is for people who haven't watched.
 */

export type FeedItem = { title: string; link: string; description: string; pubDate: Date; guid: string };

/** Text safe inside an XML element or attribute. */
export const xmlEscape = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** The feed as XML: the channel, then `items` in the order given (newest first). */
export function rssXml(items: readonly FeedItem[], site: { title: string; link: string; description: string; selfLink: string }): string {
  const built = items[0]?.pubDate ?? new Date(0);
  const lines = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">`,
    `<channel>`,
    `<title>${xmlEscape(site.title)}</title>`,
    `<link>${xmlEscape(site.link)}</link>`,
    `<description>${xmlEscape(site.description)}</description>`,
    `<language>en</language>`,
    `<lastBuildDate>${built.toUTCString()}</lastBuildDate>`,
    `<atom:link href="${xmlEscape(site.selfLink)}" rel="self" type="application/rss+xml"/>`,
  ];
  for (const i of items) {
    lines.push(
      `<item>`,
      `<title>${xmlEscape(i.title)}</title>`,
      `<link>${xmlEscape(i.link)}</link>`,
      `<guid isPermaLink="true">${xmlEscape(i.guid)}</guid>`,
      `<pubDate>${i.pubDate.toUTCString()}</pubDate>`,
      `<description>${xmlEscape(i.description)}</description>`,
      `</item>`,
    );
  }
  lines.push(`</channel>`, `</rss>`);
  return lines.join("\n");
}
