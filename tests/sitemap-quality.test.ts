/**
 * What search engines are given (2026-11-22 audit): a date or a couple counts when a person's character or one of the
 * show's own is in it, not two machine-made ones (lib/seo.ts authoredCharacterSql), and the pages it leaves out say
 * noindex; each listed page's lastmod is when it last changed; a ship pair has one address; the characters and dates are
 * built at most once an hour per server; and the prompt library's dotted tag pages meet the 18+ gate like the rest.
 */
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, has: () => false, getAll: () => [] }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
}));

import { generateMetadata as coupleMetadata } from "@/app/couples/[a]/[b]/page";
import { generateMetadata as episodeMetadata } from "@/app/episodes/[id]/page";
import { claimAdmin } from "@/lib/admins";
import type { Db } from "@/lib/db";
import { recentPublicUrls } from "@/lib/indexnow";
import { pairKey } from "@/lib/relationships";
import { cachedContentSitemap, characterIndexable, contentSitemap, coupleIndexable, dateAuthored, forgetContentSitemapForTests } from "@/lib/seo";
import { config, middleware } from "@/middleware";
import { api, HOUSE_PARTNER_ID, setupEpisode, setupPairedEpisode, startTestDb, userIdOf } from "./helpers";

const BASE = "https://b.test";
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

const listed = async () => (await contentSitemap(t.db, BASE)).map((e) => e.url);
const pinged = () => recentPublicUrls(t.db, new Date(Date.now() - 60 * 60_000), BASE);

/** As an outside agent's character: made over MCP, by an agent whose sessions say which client it is. */
async function viaAgent(characterId: string, owner: string, client = "claude-code") {
  await t.db.query(`update characters set created_via = 'mcp' where id = $1`, [characterId]);
  await t.db.query(`insert into mcp_sessions (id, agent_id, client_name) values ($1, $2, $3)`, [`s-${characterId}`, owner, client]);
}

describe("the bar: a person's character or one of the show's own", () => {
  it("lists a date between two people's characters, and leaves one between two agents' characters up but out of search", async () => {
    const { host, partner, hostCharacter, partnerCharacter, episode } = await setupPairedEpisode();
    expect((await api.reveal(episode.id, host)).status).toBeLessThan(300);
    const [lo, hi] = pairKey(hostCharacter.id, partnerCharacter.id);
    await t.db.query(`update relationships set public_dates = 2 where character_a = $1 and character_b = $2`, [lo, hi]);
    const theirs = [`${BASE}/episodes/${episode.id}`, `${BASE}/couples/${lo}/${hi}`, `${BASE}/characters/${hostCharacter.id}`, `${BASE}/characters/${partnerCharacter.id}`];
    expect(await listed()).toEqual(expect.arrayContaining(theirs));
    expect(await pinged()).toEqual(expect.arrayContaining(theirs));
    expect((await episodeMetadata({ params: Promise.resolve({ id: episode.id }) })).robots).toEqual({ index: true, follow: true });
    expect((await coupleMetadata({ params: Promise.resolve({ a: lo, b: hi }), searchParams: Promise.resolve({}) })).robots).toBeUndefined();

    // Both made by outside agents: nothing of theirs listed or pinged, and every page says noindex but keeps its links.
    await viaAgent(hostCharacter.id, userIdOf(host));
    await viaAgent(partnerCharacter.id, userIdOf(partner));
    const after = [...(await listed()), ...(await pinged())];
    for (const url of theirs) expect(after, url).not.toContain(url);
    expect([await dateAuthored(t.db, episode.id), await coupleIndexable(t.db, lo, hi), await characterIndexable(t.db, hostCharacter.id)]).toEqual([false, false, false]);
    expect((await episodeMetadata({ params: Promise.resolve({ id: episode.id }) })).robots).toEqual({ index: false, follow: true });
    expect((await coupleMetadata({ params: Promise.resolve({ a: lo, b: hi }), searchParams: Promise.resolve({}) })).robots).toEqual({ index: false, follow: true });

    // One of them a Botchelor original (the cast script's, its agent linked to an admin): the show's own, so back in.
    await t.db.query(`update mcp_sessions set client_name = 'botchelor-cast' where agent_id = $1`, [userIdOf(host)]);
    await claimAdmin(t.db, "admin-1");
    await t.db.query(`insert into agent_links (agent_id, user_id) values ($1, 'admin-1')`, [userIdOf(host)]);
    expect(await listed()).toEqual(expect.arrayContaining(theirs));
    expect([await dateAuthored(t.db, episode.id), await coupleIndexable(t.db, lo, hi)]).toEqual([true, true]);
  });

  it("keeps an agent's character in once it has dated one of the house cast", async () => {
    const { creator, character, episode } = await setupEpisode();
    expect((await api.reveal(episode.id, creator)).status).toBeLessThan(300);
    await viaAgent(character.id, userIdOf(creator));
    expect(await listed()).toEqual(expect.arrayContaining([`${BASE}/episodes/${episode.id}`, `${BASE}/characters/${character.id}`]));
    expect(await dateAuthored(t.db, episode.id)).toBe(true);
  });

  it("keeps a couple with one date so far out of search, as out of the sitemap", async () => {
    const { creator, character, episode } = await setupEpisode();
    expect((await api.reveal(episode.id, creator)).status).toBeLessThan(300);
    const [lo, hi] = pairKey(character.id, HOUSE_PARTNER_ID);
    expect(await coupleIndexable(t.db, lo, hi)).toBe(false);
    expect((await coupleMetadata({ params: Promise.resolve({ a: lo, b: hi }), searchParams: Promise.resolve({}) })).robots).toEqual({ index: false, follow: true });
  });
});

describe("lastmod: when the page last changed", () => {
  it("a character's is its latest public date, not the day it was made; a creator's is their latest PG post", async () => {
    const { creator, character, episode } = await setupEpisode();
    expect((await api.reveal(episode.id, creator)).status).toBeLessThan(300);
    await t.db.query(`update characters set created_at = '2026-10-13T00:00:00Z' where id = $1`, [character.id]);
    await t.db.query(`update episodes set revealed_at = '2026-11-20T18:00:00Z' where id = $1`, [episode.id]);
    const entry = (await contentSitemap(t.db, BASE)).find((e) => e.url === `${BASE}/characters/${character.id}`);
    expect(entry?.lastModified).toEqual(new Date("2026-11-20T18:00:00Z"));

    const owner = userIdOf(creator);
    await t.db.query(`insert into creator_profiles (user_id, handle, display_name, created_at) values ($1, 'wren', 'Wren', '2026-10-01T00:00:00Z')`, [owner]);
    const post = (id: string, rating: string, at: string) =>
      t.db.query(`insert into showcase_posts (id, owner_id, source, media_id, character_id, rating, medium, created_at) values ($1, $2, 'pg', $1, $3, $4, 'picture', $5)`, [
        id,
        owner,
        character.id,
        rating,
        at,
      ]);
    await post("p-1", "pg", "2026-11-02T00:00:00Z");
    await post("p-2", "pg", "2026-11-09T00:00:00Z");
    await post("p-3", "suggestive", "2026-11-21T00:00:00Z");
    const creatorEntry = (await contentSitemap(t.db, BASE)).find((e) => e.url === `${BASE}/creators/wren`);
    expect(creatorEntry?.lastModified).toEqual(new Date("2026-11-09T00:00:00Z"));
  });
});

describe("ship pages", () => {
  it("are listed at the pair's one address, the names in alphabetical order", async () => {
    const { creator, episode } = await setupEpisode();
    expect((await api.reveal(episode.id, creator)).status).toBeLessThan(300);
    await t.db.query(`update relationships set public_dates = 2`);
    const ships = (await listed()).filter((u) => u.startsWith(`${BASE}/ship/`));
    expect(ships.length).toBeGreaterThan(0);
    for (const url of ships) {
      const [a, b] = url.slice(`${BASE}/ship/`.length).split("/");
      expect(a <= b, url).toBe(true);
    }
  });
});

describe("built at most once an hour per server (cachedContentSitemap)", () => {
  /** t.db, counting its reads. */
  const counting = () => {
    const seen = { reads: 0 };
    const db: Db = {
      query<T>(sql: string, params?: unknown[]) {
        seen.reads++;
        return t.db.query<T>(sql, params);
      },
      exec: (sql) => t.db.exec(sql),
    };
    return { db, seen };
  };

  it("answers again within the hour without reading, and builds afresh after it", async () => {
    const { db, seen } = counting();
    const now = Date.now();
    const first = await cachedContentSitemap(db, BASE, now);
    const reads = seen.reads;
    expect(reads).toBeGreaterThan(0);
    expect(await cachedContentSitemap(db, BASE, now + 59 * 60_000)).toBe(first);
    expect(seen.reads).toBe(reads);
    await cachedContentSitemap(db, BASE, now + 61 * 60_000);
    expect(seen.reads).toBeGreaterThan(reads);
    // Another base or another database is its own build.
    const more = seen.reads;
    await cachedContentSitemap(db, "https://other.test", now + 61 * 60_000);
    expect(seen.reads).toBeGreaterThan(more);
  });

  it("never keeps a build that failed", async () => {
    let tries = 0;
    const down: Db = {
      async query() {
        tries++;
        throw new Error("connection refused");
      },
      async exec() {},
    };
    forgetContentSitemapForTests();
    await expect(cachedContentSitemap(down, BASE)).rejects.toThrow("connection refused");
    const after = tries;
    await expect(cachedContentSitemap(down, BASE)).rejects.toThrow("connection refused");
    expect(tries).toBeGreaterThan(after);
  });
});

describe("the prompt library's tag pages meet the 18+ gate, a dotted tag id too", () => {
  const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
  it("is matched by name: the pages-only rule takes a dot for a file and would skip it", () => {
    const pagesOnly = new RegExp(`^${String(config.matcher[0])}$`);
    expect(pagesOnly.test("/prompts/tag/style:photo")).toBe(true);
    expect(pagesOnly.test("/prompts/tag/light.golden")).toBe(false);
    expect(config.matcher).toContain("/prompts/tag/:path*");
    const res = middleware(new NextRequest("https://botchelor.com/prompts/tag/light.golden", { headers: { "user-agent": CHROME } }));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/gate");
  });
});
