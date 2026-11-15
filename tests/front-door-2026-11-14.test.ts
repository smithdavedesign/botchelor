// The front door (2026-11-14, "build 1-7": item 5): the hero says what the product is now, "Give your character a love
// life.", and the old line ("Send your OC on a blind date. Then just watch.") is gone from the page, the gate's backdrop,
// the share cards and the site description.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
import { renderToStaticMarkup } from "react-dom/server";
import { SHARE_IMAGE_ALT, SITE_DESCRIPTION } from "@/lib/seo";
import { startTestDb } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  jar.cookies.clear();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const OLD = "Send your OC on a blind date";

describe("the hero", () => {
  it("promises your character a love life, keeps the three doors and the trust line", async () => {
    const Home = (await import("@/app/page")).default;
    const html = renderToStaticMarkup(await Home({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('<p class="kicker">Your character&#x27;s love life</p>');
    expect(html).toContain("<h1>Give your character a love life.</h1>");
    expect(html).toContain("They go on blind dates nobody steers, text you how it went, and take your advice into the next one.");
    expect(html).toContain("free, no");
    expect(html).toContain('href="/create">Make your character</a>');
    expect(html).toContain('href="/watch">Watch episodes</a>');
    expect(html).toContain('href="/create?sample=1"');
    expect(html).toContain("Bring your character");
    expect(html).toContain('<p class="trust-micro">Fictional characters only, no real people</p>');
    expect(html).not.toContain(OLD);
    expect(html).not.toContain("For OC roleplayers");
  });

  it("the gate's backdrop, the share cards and the site description say the same", () => {
    expect(SITE_DESCRIPTION).toContain("Give your original character a love life");
    expect(SITE_DESCRIPTION).not.toContain(OLD);
    expect(SHARE_IMAGE_ALT).toContain("give your character a love life");
    for (const file of ["app/gate/page.tsx", "app/opengraph-image.tsx", "app/characters/[id]/opengraph-image.tsx", "app/page.tsx"]) {
      const src = readFileSync(join(__dirname, "..", file), "utf8");
      expect(src, file).not.toContain(OLD);
      expect(src, file).toContain("Give your character a love life.");
    }
  });
});
