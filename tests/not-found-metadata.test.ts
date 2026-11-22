/**
 * A 404's metadata is the not-found page's (2026-11-22): Next streams a page's generateMetadata after the page starts,
 * so once a browser had read it all, an unknown id's 404 carried that page's own title and robots ("Agent nobody-here ·
 * Botchelor", "Character not found", "Show not found" with index, follow) over the site's not-found page.
 *
 * Every page under a layout with an early 404 check runs the same check first in its own generateMetadata
 * (app/NotFoundBeforeLoading.tsx notFoundFirst, one read a request through app/known-once.ts). A page's, never a
 * layout's: a layout's metadata is part of the not-found page's own, so a notFound() there left the 404 with no title
 * at all (live, 2026-11-22). A route without an early check calls notFound() in its own generateMetadata where its
 * page does.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const req = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({
  headers: async () => req.headers,
  cookies: async () => ({ get: () => undefined, has: () => false, getAll: () => [] }),
}));
const { known, answer } = vi.hoisted(() => {
  const known = { answer: true as boolean | Error, calls: [] as string[] };
  const answer = (name: string) => async (...ids: unknown[]) => {
    known.calls.push(`${name}:${ids.filter((x) => typeof x === "string").join("/")}`);
    if (known.answer instanceof Error) throw known.answer;
    return known.answer;
  };
  return { known, answer };
});
vi.mock("@/app/known-once", () => ({
  knownCharacterOnce: answer("character"),
  knownEpisodeOnce: answer("episode"),
  knownCoupleOnce: answer("couple"),
  knownPairOnce: answer("pair"),
  knownAgentOnce: answer("agent"),
  knownCreatorOnce: answer("creator"),
  knownMixerOnce: answer("mixer"),
  knownDoubleOnce: answer("double"),
}));
vi.mock("@/lib/known-ids", () => ({
  knownCharacter: answer("lib-character"),
  knownEpisode: answer("lib-episode"),
  knownCouple: answer("lib-couple"),
  knownPair: answer("lib-pair"),
  knownAgent: answer("lib-agent"),
  knownCreator: answer("lib-creator"),
  knownMixer: answer("lib-mixer"),
  knownDouble: answer("lib-double"),
}));
vi.mock("@/lib/db", async (original) => ({ ...(await original<typeof import("@/lib/db")>()), getDb: async () => ({}) }));
vi.mock("@/lib/show-seasons", async (original) => ({ ...(await original<typeof import("@/lib/show-seasons")>()), getShow: async () => null }));

import * as agent from "@/app/agents/[handle]/page";
import * as alternative from "@/app/alternatives/[slug]/page";
import * as characterEdit from "@/app/characters/[id]/edit/page";
import * as character from "@/app/characters/[id]/page";
import * as relationships from "@/app/characters/[id]/relationships/page";
import * as couple from "@/app/couples/[a]/[b]/page";
import * as creator from "@/app/creators/[handle]/page";
import * as double from "@/app/doubles/[id]/page";
import * as episode from "@/app/episodes/[id]/page";
import * as reportCard from "@/app/episodes/[id]/report-card/page";
import * as thread from "@/app/messages/[a]/[b]/page";
import * as mixer from "@/app/mixers/[id]/page";
import { notFoundFirst } from "@/app/NotFoundBeforeLoading";
import * as season from "@/app/seasons/[slug]/page";
import * as show from "@/app/shows/[id]/page";

type Meta = (props: { params: Promise<Record<string, string>>; searchParams?: Promise<Record<string, string>> }) => Promise<unknown>;

const NOT_FOUND = /NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/;

/** The routes with an early check in their layout (app/NotFoundBeforeLoading.tsx), and the check each one reads. */
const EARLY = ["characters/[id]", "episodes/[id]", "couples/[a]/[b]", "agents/[handle]", "creators/[handle]", "mixers/[id]", "doubles/[id]", "messages/[a]/[b]"];

const pagesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? pagesUnder(p) : f === "page.tsx" ? [p] : [];
  });

beforeEach(() => {
  req.headers = new Headers();
  known.answer = true;
  known.calls = [];
});

describe("notFoundFirst (app/NotFoundBeforeLoading.tsx)", () => {
  it("is the not-found page for an unknown id, and nothing for a known one", async () => {
    await expect(notFoundFirst(async () => false)).rejects.toThrow(NOT_FOUND);
    await expect(notFoundFirst(async () => true)).resolves.toBeUndefined();
  });

  it("skips Next's own requests and lets the page's metadata be when the read fails, as the early check does", async () => {
    req.headers = new Headers({ rsc: "1" });
    const check = vi.fn(async () => false);
    await expect(notFoundFirst(check)).resolves.toBeUndefined();
    expect(check).not.toHaveBeenCalled();
    req.headers = new Headers();
    await expect(notFoundFirst(() => Promise.reject(new Error("pool timeout")))).resolves.toBeUndefined();
  });
});

describe("every page under a layout with an early check", () => {
  const pages: [string, Meta, Record<string, string>, string][] = [
    ["characters/[id]", character.generateMetadata as Meta, { id: "c1" }, "character:c1"],
    ["characters/[id]/relationships", relationships.generateMetadata as Meta, { id: "c1" }, "character:c1"],
    ["characters/[id]/edit", characterEdit.generateMetadata as Meta, { id: "c1" }, "character:c1"],
    ["episodes/[id]", episode.generateMetadata as Meta, { id: "e1" }, "episode:e1"],
    ["episodes/[id]/report-card", reportCard.generateMetadata as Meta, { id: "e1" }, "episode:e1"],
    ["couples/[a]/[b]", couple.generateMetadata as Meta, { a: "a1", b: "b1" }, "couple:a1/b1"],
    ["agents/[handle]", agent.generateMetadata as Meta, { handle: "nobody-here" }, "agent:nobody-here"],
    ["creators/[handle]", creator.generateMetadata as Meta, { handle: "wren" }, "creator:wren"],
    ["mixers/[id]", mixer.generateMetadata as Meta, { id: "m1" }, "mixer:m1"],
    ["doubles/[id]", double.generateMetadata as Meta, { id: "d1" }, "double:d1"],
    ["messages/[a]/[b]", thread.generateMetadata as Meta, { a: "a1", b: "b1" }, "pair:a1/b1"],
  ];

  it("checks first, with its layout's read, so a 404's title and robots are the not-found page's", async () => {
    for (const [route, generateMetadata, params, call] of pages) {
      known.answer = false;
      known.calls = [];
      await expect(generateMetadata({ params: Promise.resolve(params), searchParams: Promise.resolve({}) }), route).rejects.toThrow(NOT_FOUND);
      expect(known.calls, route).toEqual([call]);
    }
  });

  it("is every page there is: a new page under one of these layouts checks too", () => {
    const tested = new Set(pages.map(([route]) => `app/${route}/page.tsx`));
    // Only ever a redirect, to the character's studio on /studio: nothing of its own to title.
    const redirects = new Set(["app/characters/[id]/studio/page.tsx"]);
    for (const route of EARLY) {
      for (const page of pagesUnder(`app/${route}`).map((p) => p.replace(/\\/g, "/"))) {
        if (redirects.has(page)) continue;
        expect(tested.has(page), page).toBe(true);
        expect(readFileSync(page, "utf8"), page).toMatch(/await notFoundFirst\(\(\) => known[A-Z][a-zA-Z]+Once\(/);
      }
    }
  });
});

describe("the layouts with an early check", () => {
  it("never decide the metadata: a notFound() there takes the not-found page's own title with it", () => {
    for (const route of EARLY) {
      const layout = readFileSync(`app/${route}/layout.tsx`, "utf8");
      expect(layout, route).toContain("<NotFoundBeforeLoading");
      expect(layout, route).not.toMatch(/generateMetadata|export const metadata/);
      // The page's check is this same read, once a request (React's cache).
      expect(layout, route).toMatch(/known[A-Z][a-zA-Z]+Once\(/);
    }
  });

  it("turn a thread or a double invite away without a visitor, with no read", async () => {
    const real = await vi.importActual<typeof import("@/app/known-once")>("@/app/known-once");
    expect(await real.knownPairOnce("a1", "b1")).toBe(false);
    expect(await real.knownDoubleOnce("d1")).toBe(false);
    expect(known.calls).toEqual([]);
    expect(await real.knownCharacterOnce("c1")).toBe(true);
    expect(known.calls).toEqual(["lib-character:c1"]);
  });
});

describe("pages that turn an unknown address away themselves", () => {
  it("say so in their metadata too: a season, an alternative and a show", async () => {
    await expect(season.generateMetadata({ params: Promise.resolve({ slug: "1999-01" }) } as never)).rejects.toThrow(NOT_FOUND);
    await expect(alternative.generateMetadata({ params: Promise.resolve({ slug: "not-an-app" }) })).rejects.toThrow(NOT_FOUND);
    await expect(show.generateMetadata({ params: Promise.resolve({ id: "not-a-show" }) } as never)).rejects.toThrow(NOT_FOUND);
  });
});
