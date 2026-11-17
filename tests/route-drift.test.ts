// The 2026-11-17 route audit: old addresses that dropped their query, PG pages left behind the 18+ gate, pages no index
// listed, a sitemap that listed pages a switch had taken away, and redirects aimed at yesterday's homes.
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import PgStudioRedirect from "@/app/characters/[id]/studio/page";
import { staticSitemap } from "@/lib/seo";
import { SHOW_WORD_REDIRECTS } from "@/lib/site-redirects";
import { middleware } from "@/middleware";

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const redirectOf = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run();
  } catch (e) {
    const digest = String((e as { digest?: string }).digest ?? "");
    if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2];
    throw e;
  }
  throw new Error("no redirect");
};

describe("a character's old Studio address", () => {
  it("goes to My studio with the character picked and the rest of its query, so Shoot like this keeps its ?remix", async () => {
    const to = await redirectOf(() => PgStudioRedirect({ params: Promise.resolve({ id: "c 1" }), searchParams: Promise.resolve({ remix: "post-9", character: "other" }) }));
    const url = new URL(to, "https://botchelor.com");
    expect(url.pathname).toBe("/studio");
    expect(url.searchParams.get("character")).toBe("c 1");
    expect(url.searchParams.get("remix")).toBe("post-9");
    expect(await redirectOf(() => PgStudioRedirect({ params: Promise.resolve({ id: "c1" }) }))).toBe("/studio?character=c1");
  });

  it("is no longer what the app links to: the links go straight to /studio", () => {
    expect(source("app/showcase/RemixButton.tsx")).toContain("`/studio?character=${encodeURIComponent(id)}&remix=${encodeURIComponent(post.id)}`");
    for (const file of ["app/showcase/RemixButton.tsx", "app/characters/[id]/page.tsx", "app/studio/ChoosePicture.tsx", "app/after-dark/SfwTwin.tsx"]) {
      expect(source(file), file).not.toMatch(/href=\{`\/characters\/\$\{[^}]+\}\/studio/);
      expect(source(file), file).not.toMatch(/`\/characters\/\$\{id\}\/studio\?remix/);
    }
  });
});

describe("the PG show's pages the gate had missed", () => {
  const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
  it("open without the 18+ step: the Constellation, the reviews and the Sunday letter's page", () => {
    for (const path of ["/graph", "/reviews", "/newsletter"]) {
      const res = middleware(new NextRequest(`https://botchelor.com${path}`, { headers: { "user-agent": CHROME } }));
      expect(res.headers.get("location"), path).toBeNull();
    }
  });
});

describe("the indexes", () => {
  it("/everything lists the public pages the footer and the show link to", () => {
    const page = source("app/everything/page.tsx");
    for (const href of ["/safety", "/seasons", "/casting", "/calls", "/newsletter", "/llms.txt"]) expect(page, href).toContain(`href="${href}"`);
  });

  it("the admin index links the Gallery's held posts, where creators are told to look", () => {
    expect(source("lib/showcase-moderation.ts")).toContain("/admin/showcase");
    expect(source("app/admin/page.tsx")).toContain('href: "/admin/showcase"');
  });
});

describe("the sitemap and switches", () => {
  afterEach(() => vi.unstubAllEnvs());
  const paths = () => staticSitemap("https://botchelor.com").map((e) => e.url.replace("https://botchelor.com", ""));

  it("lists the show's own page with /shows, and drops both when SHOW_IDEAS=0", () => {
    expect(paths()).toEqual(expect.arrayContaining(["/shows", "/shows/botchelor", "/step-in"]));
    vi.stubEnv("SHOW_IDEAS", "0");
    expect(paths()).not.toContain("/shows");
    expect(paths()).not.toContain("/shows/botchelor");
  });

  it("drops /step-in when STEP_IN_OPEN=0", () => {
    vi.stubEnv("STEP_IN_OPEN", "0");
    expect(paths()).not.toContain("/step-in");
    expect(paths()).toContain("/watch");
  });
});

describe("the show's words as addresses", () => {
  it("send /messages to the Chat door and /reels to the Gallery's reels", () => {
    const to = Object.fromEntries(SHOW_WORD_REDIRECTS.map((r) => [r.source, r.destination]));
    expect(to["/messages"]).toBe("/chat");
    expect(to["/reels"]).toBe("/showcase/reels");
  });
});
