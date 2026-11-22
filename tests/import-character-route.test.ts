import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/characters/import/route";
import AlternativePage from "@/app/alternatives/character-ai/page";
import ImportPage from "@/app/import/page";
import { importFromFields } from "@/lib/import-character";
import { IMPORT_READ_ALL_LIMITS, IMPORT_READ_LIMITS } from "@/lib/limits";
import { setFrontierModelForTests, setModelForTests } from "@/lib/model";
import { staticSitemap } from "@/lib/seo";
import { jsonRequest, newUserCookie, scriptedModel, startTestDb } from "./helpers";

vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, prefetch: () => {} }),
}));

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});
afterEach(() => {
  setModelForTests(null);
  setFrontierModelForTests(null);
  vi.unstubAllEnvs();
});

const read = (text: string, cookie = newUserCookie()) => POST(jsonRequest("/api/characters/import", { text }, { cookie }));

describe("POST /api/characters/import (free text, the show's free model)", () => {
  it("returns only the labelled fields the model read, which map like any source", async () => {
    const { calls } = scriptedModel([
      '```json\n{"name":"Mara Quill","age":41,"description":"Runs a map stall at the night market.","personality":"sly, kind, restless","wants":"a co-pilot","secret":"ignored"}\n```',
    ]);
    const res = await read("Mara Quill is 41 and runs a map stall at the night market. Sly, kind, restless. Wants a co-pilot.");
    expect(res.status).toBe(200);
    const { fields } = (await res.json()) as { fields: Record<string, string> };
    expect(fields).toEqual({ name: "Mara Quill", age: "41", description: "Runs a map stall at the night market.", personality: "sly, kind, restless", wants: "a co-pilot" });
    expect(calls).toHaveLength(1);
    expect(calls[0][0].content).toMatch(/Never invent/);
    expect(importFromFields("free_text", fields, "")).toMatchObject({ ok: true, draft: { sheet: { age: "41" }, traits: ["sly", "kind", "restless"] } });
  });

  it("refuses a minor before any model reads it", async () => {
    const { calls } = scriptedModel([]);
    const res = await read("a shy 15 year old who loves cats");
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ reason: "minor" });
    expect(calls).toHaveLength(0);
  });

  it("never uses the paid model, even when it's the show's default", async () => {
    vi.stubEnv("FRONTIER_DEFAULT", "1");
    vi.stubEnv("FRONTIER_LLM_BASE_URL", "https://example.invalid/v1");
    vi.stubEnv("FRONTIER_LLM_API_KEY", "test-frontier");
    vi.stubEnv("FRONTIER_LLM_MODEL", "paid-model");
    vi.stubEnv("LLM_API_KEY", "");
    vi.stubEnv("GOOGLE_API_KEY", "");
    const paid = vi.fn(async () => '{"name":"Paid"}');
    setFrontierModelForTests({ complete: paid });
    const res = await read("A grumpy wizard who sells umbrellas in the rain.");
    expect(res.status).toBe(503);
    expect(paid).not.toHaveBeenCalled();
  });

  it("is limited per visitor", async () => {
    scriptedModel(Array.from({ length: IMPORT_READ_LIMITS.perHour + 1 }, () => '{"name":"Ada Lane"}'));
    const cookie = newUserCookie();
    for (let i = 0; i < IMPORT_READ_LIMITS.perHour; i++) expect((await read(`A baker number ${i}.`, cookie)).status).toBe(200);
    expect((await read("One more baker.", cookie)).status).toBe(429);
  });

  it("is limited across everyone too, so fresh cookies and addresses stop at the show's share (2026-11-22 audit)", async () => {
    // This hour's site-wide reads, already used.
    await t.db.query(`insert into rate_hits (bucket, key, at) select 'import_read_all', 'all', now() from generate_series(1, $1)`, [IMPORT_READ_ALL_LIMITS.perHour]);
    scriptedModel(['{"name":"Ada Lane"}']);
    const res = await read("A baker with a fresh cookie.", newUserCookie());
    expect(res.status).toBe(429);
    expect(((await res.json()) as { error: string }).error).toBe("too_many_imports");
  });
});

describe("the import and landing pages", () => {
  it("are in the sitemap", () => {
    const urls = staticSitemap("https://botchelor.com").map((e) => e.url);
    expect(urls).toContain("https://botchelor.com/import");
    expect(urls).toContain("https://botchelor.com/alternatives/character-ai");
  });

  it("/import names the formats it reads, with no claim of affiliation", async () => {
    const html = renderToStaticMarkup(await ImportPage({ searchParams: Promise.resolve({}) }));
    expect(html).toMatch(/Character\.AI, SillyTavern or other apps/);
    expect(html).toMatch(/first_mes/);
    expect(html).not.toMatch(/official|partner|affiliated|endorsed/i);
  });

  it("the landing page explains the show, links to /import and carries FAQ structured data", () => {
    const html = renderToStaticMarkup(AlternativePage());
    expect(html).toMatch(/href="\/import"/);
    expect(html).toMatch(/blind dates/);
    expect(html).toMatch(/Companion/);
    expect(html).toMatch(/"@type":"FAQPage"/);
    expect(html).toMatch(/isn&#x27;t connected to Character\.AI|isn't connected to Character\.AI/);
    expect(html).not.toMatch(/bankrupt|chapter 11|shut(?:ting)? down/i);
    // No other app's logo or screenshot: its only pictures are the show's own set and house cast (the visual pop
    // audit's hero and ribbon, 2026-11-20).
    const pictures = [...html.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]);
    expect(pictures.length).toBeGreaterThan(0);
    for (const src of pictures) expect(src).toMatch(/^\/cast\/(set|house)-[a-z]+-v\d\.webp$/);
  });
});
