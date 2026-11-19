// After Dark's Gallery, Videos (app/after-dark/gallery; David, 2026-11-18: "we have reels and clips, really they are
// the same thing. Can we move the tag filters up from clips section. remove the clips and have one combined section ...
// tag acordenly if it's from the studio or from a afer dark clip or date ... still offer the filtering at the top").
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () =>
    new Headers({
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
      ...(jar.cookies.size ? { cookie: [...jar.cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
    }),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => "/after-dark/gallery",
  useSearchParams: () => new URLSearchParams(),
}));
import type { ReactElement } from "react";
import { prerender } from "react-dom/static";
import AfterDarkGalleryPage from "@/app/after-dark/gallery/page";
import { claimAdmin } from "@/lib/admins";
import { ADULT_COOKIE } from "@/lib/age";
import { saveAdultSettings } from "@/lib/adult/settings";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { setPlaceForTests } from "@/lib/place";
import { newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("ADULT_MODE", "1");
  await saveAdultSettings(t.db, { enabled: true });
  jar.cookies.clear();
  setPlaceForTests({ country: "US", region: "CA" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  setPlaceForTests({ country: "US", region: "CA" });
});

const [A, B] = [HOUSE_CHARACTERS[0], HOUSE_CHARACTERS[1]];
const html = async (el: ReactElement) => (await new Response((await prerender(el)).prelude).text()).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

async function admin(): Promise<string> {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  jar.cookies.set("bz_sess", signedInCookie(id).split("=").slice(1).join("="));
  jar.cookies.set(ADULT_COOKIE, "1");
  return id;
}

async function videos(me: string) {
  const add = (id: string, at: string, x: { b?: string | null; shoot?: string; derived?: string; source?: string } = {}) =>
    t.db.query(
      `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, status, created_at, shoot_id, derived, source_image)
       values ($1, $2, $3, $4, 'video', 'x', 'video/mp4', 'ready', $5, $6, $7, $8)`,
      [id, me, A.id, x.b === undefined ? B.id : x.b, at, x.shoot ?? null, x.derived ?? null, x.source ?? null],
    );
  await add("shot-1", "2026-11-01T00:00:00Z");
  await add("shot-2", "2026-11-01T00:01:00Z");
  await t.db.query(`insert into adult_reels (id, owner_id, character_a, character_b, status, shots, kind, created_at) values ('reel-1', $1, $2, $3, 'ready', $4::jsonb, 'night', '2026-11-02T00:00:00Z')`, [
    me,
    A.id,
    B.id,
    JSON.stringify([
      { media_id: "shot-1", status: "ready", frame_id: "frame-1" },
      { media_id: "shot-2", status: "ready" },
    ]),
  ]);
  await add("night-clip", "2026-11-03T00:00:00Z");
  await add("studio-clip", "2026-11-01T12:00:00Z", { b: null, shoot: "shoot-1" });
  await add("studio-boomerang", "2026-11-04T00:00:00Z", { b: null, derived: "boomerang", source: "studio-clip" });
}

describe("the Gallery's Videos", () => {
  it("is one grid under the filters: each night's video a tile among the clips, newest first, no Reels and Clips sections", async () => {
    const me = await admin();
    await videos(me);
    const page = await html(await AfterDarkGalleryPage({ searchParams: Promise.resolve({ tab: "videos" }) }));
    // One section, one grid: no "Reels" and "Clips" headings, no grid of reels apart.
    expect(page).not.toContain("ad-gallery-reels");
    expect(page).not.toContain("data-reels");
    expect(page).not.toMatch(/<h2[^>]*>\s*(Reels|Clips)\b/);
    expect(page.match(/data-gallery="/g)).toHaveLength(1);
    expect([...page.matchAll(/data-media="([^"]+)"/g)].map((m) => m[1])).toEqual(["studio-boomerang", "night-clip", "reel-1", "studio-clip"]);
    // The tab counts the night's video once and its shots not at all.
    expect(page).toMatch(/data-gallery-tab="videos"[^>]*>Videos <span class="segmented-count">4<\/span>/);
    // The filters sit on top of the grid, where it was made first, then what it is.
    const filters = page.indexOf("data-made-filter");
    expect(filters).toBeGreaterThan(-1);
    expect(filters).toBeLessThan(page.indexOf("data-gallery="));
    expect(page).toContain('From nights<span class="media-filter-count">2</span>');
    expect(page).toContain('From the Studio<span class="media-filter-count">2</span>');
    for (const kind of ["Reels", "Clips", "Boomerangs"]) expect(page).toContain(`${kind}<span class="media-filter-count">`);
  });

  it("tags every tile where it was made and what kind of video it is", async () => {
    const me = await admin();
    await videos(me);
    const page = await html(await AfterDarkGalleryPage({ searchParams: Promise.resolve({ tab: "videos" }) }));
    const tile = (id: string) => page.slice(page.indexOf(`data-media="${id}"`)).split("</li>")[0];
    const tags = (id: string) => [...tile(id).matchAll(/<span class="ad-tag"[^>]*>([^<]+)<\/span>/g)].map((m) => m[1]);
    expect(tags("reel-1")).toEqual(["Night", "Reel · 2 shots"]);
    expect(tags("night-clip")).toEqual(["Night", "Clip"]);
    expect(tags("studio-clip")).toEqual(["Studio", "Clip"]);
    expect(tags("studio-boomerang")).toEqual(["Studio", "Boomerang"]);
    // The night's video plays its first shot by itself like a clip, from its keyframe, and ▶ plays the whole reel.
    expect(tile("reel-1")).toMatch(/<video[^>]*src="\/api\/admin\/after-dark\/media\/shot-1"[^>]*poster="\/api\/admin\/after-dark\/media\/frame-1"[^>]*data-autoplay=""/);
    expect(tile("reel-1")).toContain("▶ Play the reel");
    expect(tile("reel-1")).toContain('href="/after-dark/' + A.id + "/" + B.id + '"');
    expect(tile("studio-clip")).toContain('href="/after-dark/studio/' + A.id + '"');
  });

  it("tags pictures where they were made too, and leaves faces untagged (every face is the Studio's)", async () => {
    const me = await admin();
    const add = (id: string, kind: string, b: string | null, shoot: string | null) =>
      t.db.query(`insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, status, shoot_id) values ($1, $2, $3, $4, $5, 'x', 'image/png', 'ready', $6)`, [id, me, A.id, b, kind, shoot]);
    await add("night-pic", "scene", B.id, null);
    await add("studio-pic", "scene", null, "shoot-1");
    await add("face", "baseline", null, null);
    const pictures = await html(await AfterDarkGalleryPage({ searchParams: Promise.resolve({ tab: "pictures" }) }));
    expect(pictures).toMatch(/data-media="night-pic"[\s\S]*?data-made-in="night"/);
    expect(pictures).toMatch(/data-media="studio-pic"[\s\S]*?data-made-in="studio"/);
    const faces = await html(await AfterDarkGalleryPage({ searchParams: Promise.resolve({ tab: "faces" }) }));
    expect(faces).toContain('data-media="face"');
    expect(faces).not.toContain("data-made-in");
  });
});
