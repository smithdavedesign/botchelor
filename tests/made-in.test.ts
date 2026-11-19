import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ShowcaseGrid from "@/app/showcase/ShowcaseGrid";
import { ownMedia } from "@/lib/adult/media";
import { ensureSchema } from "@/lib/db";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { madeInFilter, madeInPhrase, madeInSql, madeInTag, madeLabel } from "@/lib/made-in";
import type { Post } from "@/lib/showcase";
import { newUserCookie, startTestDb, userIdOf } from "./helpers";

// Where each picture and video was made, a night or the Studio, by one rule (lib/made-in.ts; David, 2026-11-18: "go
// through all assets and tag accordingly if it's from the studio or from a after dark clip or date ... have a better
// system overall but don't confuse the user looking at these gallerys or showcases"). The Gallery's tags and filter,
// the showcase's "From nights" and its captions all read it; the posts kept before it are tagged by it as they deploy.

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

const [A, B] = [HOUSE_CHARACTERS[0], HOUSE_CHARACTERS[1]];
type Row = { b?: string | null; kind?: string; shoot?: string; twin?: string; derived?: string; source?: string; moment?: number; fixed?: string };

async function world(me: string) {
  const add = (id: string, x: Row = {}) =>
    t.db.query(
      `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, status, shoot_id, twin_of, derived, source_image, moment_at, fixed_from)
       values ($1, $2, $3, $4, $5, 'x', $6, 'ready', $7, $8, $9, $10, $11, $12)`,
      [id, me, A.id, x.b === undefined ? B.id : x.b, x.kind ?? "scene", x.kind === "video" ? "video/mp4" : "image/png", x.shoot ?? null, x.twin ?? null, x.derived ?? null, x.source ?? null, x.moment ?? null, x.fixed ?? null],
    );
  await add("night-pic");
  await add("studio-shot", { shoot: "shoot-1" });
  await add("solo-pic", { b: null });
  await add("face", { kind: "baseline", b: null });
  await add("twin", { twin: "night-pic" });
  await add("night-clip", { kind: "video", source: "night-pic" });
  await add("studio-clip", { kind: "video", shoot: "shoot-2", source: "studio-shot" });
  await add("studio-boomerang", { kind: "video", derived: "boomerang", source: "studio-clip" });
  await add("night-boomerang", { kind: "video", derived: "boomerang", source: "night-clip" });
  await add("studio-still", { moment: 1.5, source: "studio-clip" });
  await add("studio-fix", { fixed: "studio-shot" });
  await add("night-fix", { fixed: "night-pic" });
  // Filmed on a night from a picture pinned from the Studio: it was made on the night.
  await add("night-shot-of-studio-pic", { kind: "video", source: "studio-shot" });
  // A living portrait: a picture post made to move (lib/showcase-loops.ts), never on a night.
  await add("living", { kind: "video" });
  await t.db.query(`insert into showcase_loops (id, owner_id, source, source_id, character_id, status, media_id) values ('loop-1', $1, 'post', 'src-1', $2, 'ready', 'living')`, [me, A.id]);
}

const MADE: Record<string, "night" | "studio"> = {
  "night-pic": "night",
  "studio-shot": "studio",
  "solo-pic": "studio",
  face: "studio",
  twin: "studio",
  "night-clip": "night",
  "studio-clip": "studio",
  "studio-boomerang": "studio",
  "night-boomerang": "night",
  "studio-still": "studio",
  "studio-fix": "studio",
  "night-fix": "night",
  "night-shot-of-studio-pic": "night",
  living: "studio",
};

describe("where it was made", () => {
  it("tags every asset a night's or the Studio's by how it was made, what's cut from a clip or fixed as where that came from", async () => {
    const me = userIdOf(newUserCookie());
    await world(me);
    const { rows } = await t.db.query<{ id: string; made: string }>(`select i.id, ${madeInSql("i")} as made from adult_images i where i.owner_id = $1`, [me]);
    expect(Object.fromEntries(rows.map((r) => [r.id, r.made]))).toEqual(MADE);
  });

  it("comes with every item a gallery lists", async () => {
    const me = userIdOf(newUserCookie());
    await world(me);
    const items = await ownMedia(t.db, me, 120, { withArchived: true });
    expect(items.length).toBeGreaterThan(10);
    for (const m of items) expect(m.made_in, m.id).toBe(MADE[m.id]);
  });

  it("says it in each side's words: After Dark's dates are nights", () => {
    expect([madeInTag("night"), madeInTag("studio"), madeInTag("night", "show")]).toEqual(["Night", "Studio", "Date"]);
    expect([madeInFilter("night"), madeInFilter("studio"), madeInFilter("night", "show")]).toEqual(["From nights", "From the Studio", "From dates"]);
    expect([madeInPhrase("night"), madeInPhrase("night", "show")]).toEqual(["From a night", "From a date"]);
    expect([madeLabel("night", "clip"), madeLabel("studio", "reel"), madeLabel("studio", "picture", "show")]).toEqual(["Night clip", "Studio reel", "Studio picture"]);
  });
});

describe("the posts kept before", () => {
  it("are tagged by the same rule as they deploy, and a night's shot posted on its own is a clip, not a reel", async () => {
    const me = userIdOf(newUserCookie());
    await world(me);
    await t.db.query(`insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, status, derived) values ('joined', $1, $2, $3, 'video', 'x', 'video/mp4', 'ready', 'chain')`, [me, A.id, B.id]);
    // As they were kept: a living portrait "from a date", a night's clip "from the Studio", a shot of a night's video a "reel".
    const post = (id: string, media: string, medium: string, fromDate: boolean) =>
      t.db.query(
        `insert into showcase_posts (id, owner_id, source, media_id, character_id, character_b, rating, medium, from_date, status, published_at) values ($1, $2, 'after_dark', $3, $4, $5, 'nsfw', $6, $7, 'live', now())`,
        [id, me, media, A.id, B.id, medium, fromDate],
      );
    await post("p-living", "living", "clip", true);
    await post("p-night-clip", "night-clip", "reel", false);
    await post("p-joined", "joined", "reel", true);
    await post("p-studio", "studio-clip", "clip", false);
    await ensureSchema(t.db);
    const { rows } = await t.db.query<{ id: string; medium: string; from_date: boolean }>(`select id, medium, from_date from showcase_posts where owner_id = $1 order by id`, [me]);
    expect(rows).toEqual([
      { id: "p-joined", medium: "reel", from_date: true },
      { id: "p-living", medium: "clip", from_date: false },
      { id: "p-night-clip", medium: "clip", from_date: true },
      { id: "p-studio", medium: "clip", from_date: false },
    ]);
  });
});

describe("the showcase's tiles", () => {
  const base: Omit<Post, "id" | "medium" | "from_date"> = {
    source: "after_dark", media_id: "m", mime: "video/mp4", rating: "nsfw", aspect: null, act: null, place: "hotel", pov: false, caption: null, status: "live", published_at: "",
    mine: false, creator: { handle: "mara", display_name: "Mara" }, character: { id: "c", name: "Juniper" }, partner: null, likes: 0, liked: false, remixable: false,
  };
  const posts: Post[] = [
    { ...base, id: "p1", medium: "clip", from_date: true },
    { ...base, id: "p2", medium: "boomerang", from_date: false },
    { ...base, id: "p3", medium: "picture", mime: "image/png", from_date: true },
  ];

  it("say where each was made and what it is, in the galleries' words: never a clip called a date reel", () => {
    const ad = renderToStaticMarkup(createElement(ShowcaseGrid, { posts, place: "after_dark" }));
    for (const words of ["Night clip · Hotel", "Studio boomerang · Hotel", "Night picture · Hotel"]) expect(ad).toContain(words);
    expect(ad).not.toContain("Date reel");
    const show = renderToStaticMarkup(createElement(ShowcaseGrid, { posts: posts.map((p) => ({ ...p, rating: "pg" as const })), place: "show" }));
    expect(show).toContain("Date clip · Hotel");
  });
});
