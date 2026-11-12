// Search plumbing with nobody's hands on it (the 2026-11-11 growth plan): the sitemap and IndexNow reach every page
// worth indexing, aired dates come as RSS, episodes are TV episodes, and the PG tool pages open to a search visitor.
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as feed } from "@/app/feed.xml/route";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { recentPublicUrls } from "@/lib/indexnow";
import { rssXml } from "@/lib/rss";
import { contentSitemap, staticSitemap } from "@/lib/seo";
import { middleware, UNGATED_PREFIXES } from "@/middleware";
import { api, episodeJson, newUserCookie, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
const page = (path: string) => middleware(new NextRequest(`https://botchelor.com${path}`, { headers: { "user-agent": CHROME } }));

describe("the PG tool pages open to a search visitor", () => {
  it("lets /tools, /ship and /alternatives through without the 18+ cookie; a date still meets the gate", () => {
    expect([...UNGATED_PREFIXES]).toEqual(["/tools/", "/ship/", "/alternatives/"]);
    for (const p of ["/tools/ship-name-generator", "/tools/oc-chemistry-test", "/ship/juniper/dex", "/alternatives/character-ai", "/tools"]) {
      expect(page(p).headers.get("location"), p).toBeNull();
    }
    for (const p of ["/create", "/episodes/abc", "/characters/abc", "/watch"]) {
      expect(page(p).headers.get("location"), p).toContain("/gate?from=");
    }
  });
});

describe("RSS", () => {
  it("writes well-formed RSS 2.0 with escaped text, newest first", () => {
    const xml = rssXml(
      [{ title: 'A & B: "quotes" <tags>', link: "https://botchelor.com/episodes/1?play=1", guid: "https://botchelor.com/episodes/1", description: "A meets B.", pubDate: new Date("2026-11-10T20:00:00Z") }],
      { title: "Botchelor: new dates", link: "https://botchelor.com/watch", description: "d", selfLink: "https://botchelor.com/feed.xml" },
    );
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"')).toBe(true);
    expect(xml).toContain("<title>A &amp; B: &quot;quotes&quot; &lt;tags&gt;</title>");
    expect(xml).toContain("<pubDate>Tue, 10 Nov 2026 20:00:00 GMT</pubDate>");
    expect(xml).toContain('<guid isPermaLink="true">https://botchelor.com/episodes/1</guid>');
    expect(xml).toContain('rel="self" type="application/rss+xml"');
    expect(xml.trim().endsWith("</rss>")).toBe(true);
  });

  it("the layout announces the feed and the sitemap lists it", () => {
    expect(readFileSync("app/layout.tsx", "utf8")).toContain('"application/rss+xml": "/feed.xml"');
    expect(staticSitemap("https://botchelor.com").map((e) => e.url)).toEqual(expect.arrayContaining(["https://botchelor.com/feed.xml", "https://botchelor.com/seasons"]));
  });
});

describe("episodes are TV episodes, and the seasons have a page", () => {
  it("marks an aired episode as a TVEpisode of the series and its season, with no VideoObject", () => {
    const src = readFileSync("app/episodes/[id]/page.tsx", "utf8");
    expect(src).toContain('"@type": ["CreativeWork", "TVEpisode"]');
    expect(src).toContain('partOfSeries: { "@type": "TVSeries", name: "Botchelor"');
    expect(src).toContain('"@type": "TVSeason"');
    expect(src).not.toContain('"@type": "VideoObject"');
  });

  it("lists every closed season and points at the Reunion for the one running", async () => {
    const { default: SeasonsPage } = await import("@/app/seasons/page");
    const html = renderToStaticMarkup(createElement(SeasonsPage));
    expect(html).toContain("<h1>Seasons</h1>");
    expect(html).toContain('href="/reunion"');
    expect(html).toContain('"@type":"ItemList"');
  });
});

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});

async function airedDate(name = "Pell Ardent") {
  const owner = newUserCookie();
  const character = (await (await api.createCharacter(validCharacter({ name }), owner)).json()).id;
  scriptOutcome({ ending: "second_date" });
  scriptedModel([episodeJson()]);
  const ep = await (await api.createEpisode({ character_id: character, partner_id: HOUSE_CHARACTERS[0].id }, owner)).json();
  expect((await api.reveal(ep.id, owner)).status).toBeLessThan(300);
  await t.db.query(`update episodes set visibility = 'public', revealed_at = now() - interval '2 hours' where id = $1`, [ep.id]);
  return { id: ep.id as string, character: character as string, owner };
}

describe("the feed, the sitemap and IndexNow carry the new pages", () => {
  it("/feed.xml has the aired date as a teaser with a tagged theater link, cached", async () => {
    const { id } = await airedDate();
    const res = await feed();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/rss+xml");
    expect(res.headers.get("cache-control")).toContain("s-maxage=3600");
    const xml = await res.text();
    expect(xml).toContain(`/episodes/${id}?play=1&amp;utm_source=rss&amp;utm_medium=feed`);
    expect(xml).toContain("Pell Ardent ×");
    expect(xml).toContain("Guess how it ends");
    expect(xml).not.toMatch(/second date/i);
  });

  it("the sitemap lists the couple's ship page and a creator with a PG post; IndexNow sends the couple", async () => {
    const { id, character, owner } = await airedDate();
    const ownerId = (await t.db.query<{ owner_id: string }>(`select owner_id from characters where id = $1`, [character])).rows[0].owner_id;
    await t.db.query(`insert into creator_profiles (user_id, handle, display_name) values ($1, 'pell', 'Pell')`, [ownerId]);
    await t.db.query(
      `insert into showcase_posts (id, owner_id, source, media_id, character_id, rating, medium) values ('p1', $1, 'pg', 'm1', $2, 'pg', 'picture')`,
      [ownerId, character],
    );
    const urls = (await contentSitemap(t.db, "https://botchelor.com")).map((e) => e.url);
    expect(urls).toContain(`https://botchelor.com/episodes/${id}`);
    expect(urls).toContain("https://botchelor.com/creators/pell");
    expect(urls.some((u) => /^https:\/\/botchelor\.com\/ship\/pell\/[a-z0-9-]+$/.test(u) || /^https:\/\/botchelor\.com\/ship\/[a-z0-9-]+\/pell$/.test(u))).toBe(true);
    // A hidden creator, or one with only suggestive posts, is left out.
    await t.db.query(`update creator_profiles set hidden = true where handle = 'pell'`);
    expect((await contentSitemap(t.db, "https://botchelor.com")).map((e) => e.url)).not.toContain("https://botchelor.com/creators/pell");
    const recent = await recentPublicUrls(t.db, new Date(Date.now() - 86_400_000), "https://botchelor.com");
    expect(recent).toContain(`https://botchelor.com/episodes/${id}`);
    expect(recent.some((u) => u.startsWith("https://botchelor.com/couples/"))).toBe(true);
    void owner;
  });
});
