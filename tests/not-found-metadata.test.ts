/**
 * A 404's metadata is the not-found page's (2026-11-22): Next streams a page's generateMetadata after the page starts,
 * so once a browser had read it all, an unknown id's 404 carried that page's own title and robots ("Agent nobody-here ·
 * Botchelor", "Character not found", "Show not found" with index, follow) over the site's not-found page. A route with
 * an early 404 check runs the same check for its metadata from its layout (app/NotFoundBeforeLoading.tsx
 * notFoundMetadata, one read a request through React's cache); a route without one calls notFound() in its own
 * generateMetadata where its page does.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const req = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock("next/headers", () => ({
  headers: async () => req.headers,
  cookies: async () => ({ get: () => undefined }),
}));
const known = vi.hoisted(() => ({ answer: true as boolean | Error, calls: [] as string[] }));
const answer = (name: string) =>
  vi.fn(async (_db: unknown, ...ids: string[]) => {
    known.calls.push(`${name}:${ids.join("/")}`);
    if (known.answer instanceof Error) throw known.answer;
    return known.answer;
  });
vi.mock("@/lib/known-ids", () => ({
  knownCharacter: answer("character"),
  knownEpisode: answer("episode"),
  knownCouple: answer("couple"),
  knownPair: answer("pair"),
  knownAgent: answer("agent"),
  knownCreator: answer("creator"),
  knownMixer: answer("mixer"),
  knownDouble: answer("double"),
}));
vi.mock("@/lib/db", async (original) => ({ ...(await original<typeof import("@/lib/db")>()), getDb: async () => ({}) }));
vi.mock("@/lib/show-seasons", async (original) => ({ ...(await original<typeof import("@/lib/show-seasons")>()), getShow: async () => null }));

import * as agent from "@/app/agents/[handle]/layout";
import * as alternative from "@/app/alternatives/[slug]/page";
import * as character from "@/app/characters/[id]/layout";
import * as couple from "@/app/couples/[a]/[b]/layout";
import * as creator from "@/app/creators/[handle]/layout";
import * as double from "@/app/doubles/[id]/layout";
import * as episode from "@/app/episodes/[id]/layout";
import * as thread from "@/app/messages/[a]/[b]/layout";
import * as mixer from "@/app/mixers/[id]/layout";
import { notFoundMetadata } from "@/app/NotFoundBeforeLoading";
import * as season from "@/app/seasons/[slug]/page";
import * as show from "@/app/shows/[id]/page";

type Meta = (props: { params: Promise<Record<string, string>> }) => Promise<unknown>;

const NOT_FOUND = /NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/;

beforeEach(() => {
  req.headers = new Headers();
  known.answer = true;
  known.calls = [];
});

describe("notFoundMetadata (app/NotFoundBeforeLoading.tsx)", () => {
  it("is the not-found page's metadata for an unknown id, and adds nothing for a known one", async () => {
    await expect(notFoundMetadata(async () => false)).rejects.toThrow(NOT_FOUND);
    expect(await notFoundMetadata(async () => true)).toEqual({});
  });

  it("skips Next's own requests and keeps the page's own metadata when the read fails, as the early check does", async () => {
    req.headers = new Headers({ rsc: "1" });
    const check = vi.fn(async () => false);
    expect(await notFoundMetadata(check)).toEqual({});
    expect(check).not.toHaveBeenCalled();
    req.headers = new Headers();
    expect(await notFoundMetadata(() => Promise.reject(new Error("pool timeout")))).toEqual({});
  });
});

describe("the layouts with an early check", () => {
  const routes: [string, Meta, Record<string, string>, string][] = [
    ["characters/[id]", character.generateMetadata as Meta, { id: "c1" }, "character:c1"],
    ["episodes/[id]", episode.generateMetadata as Meta, { id: "e1" }, "episode:e1"],
    ["couples/[a]/[b]", couple.generateMetadata as Meta, { a: "a1", b: "b1" }, "couple:a1/b1"],
    ["agents/[handle]", agent.generateMetadata as Meta, { handle: "nobody-here" }, "agent:nobody-here"],
    ["creators/[handle]", creator.generateMetadata as Meta, { handle: "wren" }, "creator:wren"],
    ["mixers/[id]", mixer.generateMetadata as Meta, { id: "m1" }, "mixer:m1"],
  ];

  it("run the same check for the route's metadata: a 404's title and robots are the not-found page's", async () => {
    for (const [route, generateMetadata, params, call] of routes) {
      known.answer = false;
      known.calls = [];
      await expect(generateMetadata({ params: Promise.resolve(params) }), route).rejects.toThrow(NOT_FOUND);
      expect(known.calls, route).toEqual([call]);
      known.answer = true;
      expect(await generateMetadata({ params: Promise.resolve(params) }), route).toEqual({});
      known.answer = new Error("pool timeout");
      expect(await generateMetadata({ params: Promise.resolve(params) }), route).toEqual({});
    }
  });

  it("turn a thread or a double invite away without a visitor, as their pages do", async () => {
    const own: [string, Meta, Record<string, string>][] = [
      ["messages/[a]/[b]", thread.generateMetadata as Meta, { a: "a1", b: "b1" }],
      ["doubles/[id]", double.generateMetadata as Meta, { id: "d1" }],
    ];
    for (const [route, generateMetadata, params] of own) {
      await expect(generateMetadata({ params: Promise.resolve(params) }), route).rejects.toThrow(NOT_FOUND);
    }
  });

  it("share the one read with the early check (React's cache), so a page load still makes one", () => {
    for (const route of [...routes.map(([r]) => r), "messages/[a]/[b]", "doubles/[id]"]) {
      const layout = readFileSync(`app/${route}/layout.tsx`, "utf8");
      expect(layout, route).toMatch(/const known = cache\(async/);
      expect(layout, route).toContain("return notFoundMetadata(() => known(");
      expect(layout, route).toMatch(/<NotFoundBeforeLoading\s+known=\{async \(\) => (known\(|\{)/);
    }
  });
});

describe("pages that turn an unknown address away themselves", () => {
  it("say so in their metadata too: a season, an alternative and a show", async () => {
    await expect(season.generateMetadata({ params: Promise.resolve({ slug: "1999-01" }) } as never)).rejects.toThrow(NOT_FOUND);
    await expect(alternative.generateMetadata({ params: Promise.resolve({ slug: "not-an-app" }) })).rejects.toThrow(NOT_FOUND);
    await expect(show.generateMetadata({ params: Promise.resolve({ id: "not-a-show" }) } as never)).rejects.toThrow(NOT_FOUND);
  });
});
