/**
 * Unknown ids answer a real 404 (2026-11-22 audit): a route whose loading screen answers 200 before its page runs asks
 * lib/known-ids.ts first, from its layout (app/NotFoundBeforeLoading.tsx), on a page load only; routes without a
 * loading screen call notFound() for a code that was never made. Before, each of these was a 200 with the not-found
 * page in it, which a search engine reads as a "soft 404".
 */
import { existsSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const req = vi.hoisted(() => ({ headers: new Headers(), cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  headers: async () => req.headers,
  cookies: async () => ({ get: (name: string) => (req.cookies.has(name) ? { name, value: req.cookies.get(name)! } : undefined) }),
}));

import NotFoundBeforeLoading from "@/app/NotFoundBeforeLoading";
import { knownAgent, knownCharacter, knownCouple, knownCreator, knownDouble, knownEpisode, knownMixer, knownPair } from "@/lib/known-ids";
import { HOUSE_PARTNER_ID, setupEpisode, startTestDb } from "./helpers";

const NOT_FOUND = /NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/;
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  req.headers = new Headers();
  req.cookies.clear();
});

describe("the early check (app/NotFoundBeforeLoading.tsx)", () => {
  it("is a 404 on a page load when the id is unknown, and nothing at all when it's known", async () => {
    await expect(NotFoundBeforeLoading({ known: async () => false })).rejects.toThrow(NOT_FOUND);
    expect(await NotFoundBeforeLoading({ known: async () => true })).toBeNull();
  });

  it("skips Next's own requests (a prefetch, an in-app move): no read, and the page's own notFound() decides", async () => {
    req.headers = new Headers({ rsc: "1", "next-router-prefetch": "1" });
    const known = vi.fn(async () => false);
    expect(await NotFoundBeforeLoading({ known })).toBeNull();
    expect(known).not.toHaveBeenCalled();
  });

  it("keeps the page when the read fails: a busy pool is never a 404", async () => {
    expect(await NotFoundBeforeLoading({ known: () => Promise.reject(new Error("pool timeout")) })).toBeNull();
  });
});

describe("what counts as known (lib/known-ids.ts)", () => {
  it("characters, dates, pairs and couples by their rows", async () => {
    const { character, episode } = await setupEpisode();
    expect(await knownCharacter(t.db, character.id)).toBe(true);
    expect(await knownCharacter(t.db, "not-a-real-character")).toBe(false);
    expect(await knownEpisode(t.db, episode.id)).toBe(true);
    expect(await knownEpisode(t.db, "00000000-0000-4000-8000-000000000000")).toBe(false);
    expect(await knownPair(t.db, character.id, HOUSE_PARTNER_ID)).toBe(true);
    expect(await knownPair(t.db, character.id, "nobody")).toBe(false);
    expect(await knownPair(t.db, character.id, character.id)).toBe(false);
    // A couple: a pair that dated (in either order), not two characters that never met.
    expect(await knownCouple(t.db, character.id, HOUSE_PARTNER_ID)).toBe(true);
    expect(await knownCouple(t.db, HOUSE_PARTNER_ID, character.id)).toBe(true);
    const [other] = (await t.db.query<{ id: string }>(`select id from characters where is_house and id <> $1 limit 1`, [HOUSE_PARTNER_ID])).rows;
    expect(await knownPair(t.db, other.id, HOUSE_PARTNER_ID)).toBe(true);
    expect(await knownCouple(t.db, other.id, HOUSE_PARTNER_ID)).toBe(false);
    // …or two that matched (swipes) and haven't dated yet.
    const [lo, hi] = [other.id, HOUSE_PARTNER_ID].sort();
    await t.db.query(`insert into matches (character_lo, character_hi) values ($1, $2)`, [lo, hi]);
    expect(await knownCouple(t.db, other.id, HOUSE_PARTNER_ID)).toBe(true);
  });

  it("an agent's handle, a creator's handle (in any case, never a hidden one)", async () => {
    await t.db.query(`insert into agent_handles (agent_id, handle) values ('agent-1', 'k3agent')`);
    expect(await knownAgent(t.db, "k3agent")).toBe(true);
    expect(await knownAgent(t.db, "nobody-here")).toBe(false);
    await t.db.query(`insert into creator_profiles (user_id, handle, display_name, hidden) values ('u-1', 'wren', 'Wren', false), ('u-2', 'gone', 'Gone', true)`);
    expect(await knownCreator(t.db, "Wren")).toBe(true);
    expect(await knownCreator(t.db, "gone")).toBe(false);
    expect(await knownCreator(t.db, "nobody-here")).toBe(false);
  });

  it("a mixer that wasn't called off, and a double invite only for its two people", async () => {
    const night = (id: string, kind: string, status: string, by = "house", to: string | null = null) =>
      t.db.query(`insert into group_nights (id, kind, venue, created_by, invite_to, status, couple_a, couple_b) values ($1, $2, 'rooftop_bar', $3, $4, $5, '{}'::jsonb, '{}'::jsonb)`, [
        id,
        kind,
        by,
        to,
        status,
      ]);
    await night("m-on", "mixer", "done");
    await night("m-off", "mixer", "cancelled");
    expect(await knownMixer(t.db, "m-on")).toBe(true);
    expect(await knownMixer(t.db, "m-off")).toBe(false);
    expect(await knownMixer(t.db, "not-a-mixer")).toBe(false);
    await night("d-1", "double", "invited", "asker", "answerer");
    expect(await knownDouble(t.db, "d-1", "asker")).toBe(true);
    expect(await knownDouble(t.db, "d-1", "answerer")).toBe(true);
    expect(await knownDouble(t.db, "d-1", "someone-else")).toBe(false);
    expect(await knownDouble(t.db, "m-on", "house")).toBe(false);
  });
});

describe("the routes", () => {
  const source = (path: string) => readFileSync(path, "utf8");

  it("every route with its own loading screen checks first, from a layout beside it", () => {
    const routes: [string, string][] = [
      ["app/characters/[id]", "knownCharacter"],
      ["app/episodes/[id]", "knownEpisode"],
      ["app/couples/[a]/[b]", "knownCouple"],
      ["app/messages/[a]/[b]", "knownPair"],
      ["app/agents/[handle]", "knownAgent"],
      ["app/creators/[handle]", "knownCreator"],
      ["app/mixers/[id]", "knownMixer"],
      ["app/doubles/[id]", "knownDouble"],
    ];
    for (const [dir, check] of routes) {
      expect(existsSync(`${dir}/loading.tsx`), dir).toBe(true);
      const layout = source(`${dir}/layout.tsx`);
      expect(layout, dir).toContain("<NotFoundBeforeLoading");
      expect(layout, dir).toContain(check);
    }
  });

  it("no loading screen above a character or a companion thread: the lists keep theirs in a (list) group", () => {
    for (const dir of ["app/characters", "app/companion"]) {
      expect(existsSync(`${dir}/loading.tsx`), dir).toBe(false);
      expect(existsSync(`${dir}/(list)/loading.tsx`), dir).toBe(true);
      expect(existsSync(`${dir}/(list)/page.tsx`), dir).toBe(true);
    }
    // A companion thread has no loading screen of its own, so its page's notFound() is already a real 404.
    expect(existsSync("app/companion/[id]/loading.tsx")).toBe(false);
  });

  it("a link code that was never made is a 404; one that's off still says so", () => {
    for (const page of ["app/double/[code]/page.tsx", "app/date/[code]/page.tsx"]) {
      expect(source(page), page).toMatch(/if \(!(link|invite)\) notFound\(\);/);
      expect(source(page), page).toContain("isn&apos;t open any more");
    }
    expect(source("app/casting/invite/[code]/page.tsx")).toContain('if (view.state === "invalid" && read) notFound();');
  });
});
