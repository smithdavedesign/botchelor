import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ShowcaseBrowser from "@/app/showcase/ShowcaseBrowser";
import { POST as modPost } from "@/app/api/admin/showcase/route";
import { setModerationFetchForTests } from "@/lib/adult/moderation";
import { saveAdultSettings } from "@/lib/adult/settings";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { pairKey } from "@/lib/relationships";
import { listShowcase, parseFilters, publish, saveCreatorProfile, showcaseFacets, type ShowcaseViewer } from "@/lib/showcase";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { reratePost } from "@/lib/showcase-moderation";
import { api, BASE_URL, newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

// Every showcase filter against a mix of posts (David, 2026-10-29: "check all the filters work… I see some nsfw in safe
// areas and vice versa"): the side is the rating, never where a post was made; "From dates" is only what a date made;
// a row's counts leave out its own pick.

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
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
  await saveAdultSettings(t.db, { enabled: true });
});
afterEach(() => {
  vi.unstubAllEnvs();
  setSeasonCastForTests(null);
  setModerationFetchForTests(null);
});

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ADMIN = (id: string): ShowcaseViewer => ({ id, admin: true, ratings: ["pg", "suggestive", "nsfw"] });
const ANYONE: ShowcaseViewer = { id: null, admin: false, ratings: ["pg"] };

/** One of each: a PG Studio picture, a suggestive twin, a pair's twin kept in After Dark, a date's picture, a Studio clip, a portrait, a boomerang of the clip. */
async function world() {
  const raw = newUserCookie();
  const me = userIdOf(raw);
  const mine = (await (await api.createCharacter(validCharacter({ name: "Mara Quill", pronouns: "she/her" }), raw)).json()).id as string;
  await saveCreatorProfile(t.db, me, { handle: "mara", display_name: "Mara" });
  const [a, b] = pairKey(mine, HOUSE_CHARACTERS[0].id);
  const ad = async (id: string, x: { a?: string; b?: string | null; kind?: string; mime?: string; rating?: string; shoot?: string; twin?: string; derived?: string; source?: string; aspect?: string }) => {
    await t.db.query(
      `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, status, content_rating, shoot_id, twin_of, derived, source_image, aspect)
       values ($1, $2, $3, $4, $5, 'p', $6, $7, 'ready', $8, $9, $10, $11, $12, $13)`,
      [id, me, x.a ?? mine, x.b ?? null, x.kind ?? "scene", x.mime ?? "image/png", PNG, x.rating ?? "nsfw", x.shoot ?? null, x.twin ?? null, x.derived ?? null, x.source ?? null, x.aspect ?? null],
    );
    return id;
  };
  const tag = (id: string, kind: string, value: string) => t.db.query(`insert into adult_media_tags (media_id, owner_id, kind, value, source) values ($1, $2, $3, $4, 'choice')`, [id, me, kind, value]);
  await t.db.query(`insert into adult_studio_shoots (id, owner_id, character_id, kind) values ('shoot-1', $1, $2, 'shoot')`, [me, mine]);
  await t.db.query(
    `insert into studio_pg_pictures (id, owner_id, character_id, prompt, mime, data, content_rating, tags, aspect, twin_of) values
       ('pg-park', $1, $2, 'p', 'image/png', $3, 'pg', '[{"kind":"made","value":"shoot"},{"kind":"place","value":"park"}]', '9:16', null),
       ('pg-sugg', $1, $2, 'p', 'image/png', $3, 'suggestive', '[{"kind":"made","value":"twin"}]', null, 'date-kiss')`,
    [me, mine, PNG],
  );
  await ad("date-kiss", { a, b });
  await tag("date-kiss", "act", "kiss");
  await tag("date-kiss", "place", "bar");
  await tag("date-kiss", "pov", "pov_a");
  await ad("pair-twin", { a, b, rating: "pg", twin: "date-kiss" });
  await tag("pair-twin", "place", "bar");
  await ad("studio-clip", { kind: "video", mime: "video/mp4", shoot: "shoot-1" });
  await ad("portrait", { kind: "baseline" });
  await ad("boomerang", { kind: "video", mime: "video/mp4", derived: "boomerang", source: "studio-pic" });
  await ad("studio-pic", { shoot: "shoot-1" });
  for (const [source, id] of [["pg", "pg-park"], ["pg", "pg-sugg"], ["after_dark", "date-kiss"], ["after_dark", "pair-twin"], ["after_dark", "studio-clip"], ["after_dark", "portrait"], ["after_dark", "boomerang"]] as const) {
    const r = await publish(t.db, me, { source, media_id: id });
    if (!r.ok) throw new Error(`${id}: ${r.message}`);
  }
  return { me, mine, a, b, house: HOUSE_CHARACTERS[0].id };
}

const ids = async (v: ShowcaseViewer, q: string) => (await listShowcase(t.db, v, parseFilters(new URLSearchParams(q)))).posts.map((p) => p.media_id).sort();

describe("the showcase's filters", () => {
  it("splits the sides by rating: safe for work by default, even for an admin; explicit only on After Dark", async () => {
    const w = await world();
    const admin = ADMIN(w.me);
    expect(await ids(admin, "")).toEqual(["pair-twin", "pg-park", "pg-sugg"]);
    expect(await ids(admin, "side=pg")).toEqual(["pair-twin", "pg-park", "pg-sugg"]);
    expect(await ids(admin, "side=after_dark")).toEqual(["boomerang", "date-kiss", "portrait", "studio-clip"]);
    // Nobody else ever gets an explicit one, whichever side they ask for; anyone gets the pg ones.
    expect(await ids(ANYONE, "")).toEqual(["pair-twin", "pg-park"]);
    expect(await ids(ANYONE, "side=after_dark")).toEqual([]);
    expect((await showcaseFacets(t.db, admin, {})).sides).toEqual({ pg: 3, after_dark: 4 });
    expect((await showcaseFacets(t.db, ANYONE, {})).sides).toEqual({ pg: 2, after_dark: 0 });
  });

  it("counts only what a date made as From dates: never a twin, a portrait, a Studio clip or a boomerang of a Studio picture", async () => {
    const w = await world();
    const admin = ADMIN(w.me);
    expect(await ids(admin, "side=after_dark&from=date")).toEqual(["date-kiss"]);
    expect(await ids(admin, "side=after_dark&from=studio")).toEqual(["boomerang", "portrait", "studio-clip"]);
    expect(await ids(admin, "from=date")).toEqual([]);
    expect(await ids(admin, "from=studio")).toEqual(["pair-twin", "pg-park", "pg-sugg"]);
  });

  it("narrows by type, pose, place, first person, shape, character, partner and creator", async () => {
    const w = await world();
    const admin = ADMIN(w.me);
    expect(await ids(admin, "side=after_dark&medium=clip")).toEqual(["studio-clip"]);
    expect(await ids(admin, "side=after_dark&medium=boomerang")).toEqual(["boomerang"]);
    expect(await ids(admin, "side=after_dark&act=kiss")).toEqual(["date-kiss"]);
    expect(await ids(admin, "side=after_dark&pov=1")).toEqual(["date-kiss"]);
    expect(await ids(admin, "place=bar")).toEqual(["pair-twin"]);
    expect(await ids(admin, "place=park")).toEqual(["pg-park"]);
    expect(await ids(admin, "shape=9:16")).toEqual(["pg-park"]);
    expect(await ids(admin, `partner=${w.house}`)).toEqual(["pair-twin"]);
    expect(await ids(admin, `side=after_dark&character=${w.house}`)).toEqual(["date-kiss"]);
    expect(await ids(admin, "creator=mara")).toHaveLength(3);
    expect(await ids(admin, "creator=nobody")).toEqual([]);
  });

  it("counts each row without its own pick, so the other choices stay to pick from", async () => {
    const w = await world();
    const admin = ADMIN(w.me);
    const picked = await showcaseFacets(t.db, admin, parseFilters(new URLSearchParams("place=bar")));
    expect(Object.fromEntries(picked.place)).toEqual({ bar: 1, park: 1 });
    // Every other row keeps the place: only the twin at the bar is left.
    expect(picked.shape).toEqual([["3:4", 1]]);
    expect(picked.sides).toEqual({ pg: 1, after_dark: 1 });
    const ad = await showcaseFacets(t.db, admin, parseFilters(new URLSearchParams("side=after_dark&medium=clip")));
    expect(Object.fromEntries(ad.medium)).toEqual({ picture: 2, clip: 1, boomerang: 1 });
    expect(Object.fromEntries(ad.from)).toEqual({ studio: 1 });
  });

  it("lays the filters out as sides, sort and rows, with what's picked removable one at a time", async () => {
    const w = await world();
    const render = async (v: ShowcaseViewer, q: string) => renderToStaticMarkup(createElement("div", null, await ShowcaseBrowser({ db: t.db, viewer: v, base: "/showcase", filters: parseFilters(new URLSearchParams(q)) })));
    const html = await render(ADMIN(w.me), "place=bar&sort=trending");
    expect(html).toContain('aria-label="Which side"');
    expect(html).toMatch(/Safe for work <span class="showcase-count">1<\/span>/);
    expect(html).toMatch(/🌙 After Dark <span class="showcase-count">1<\/span>/);
    // Turning to After Dark keeps the sort, never the place.
    expect(html).toContain('href="/showcase?sort=trending&amp;side=after_dark"');
    expect(html).toContain('aria-label="Remove: Bar"');
    expect(html).toContain('href="/showcase?sort=trending"');
    // Someone who can't see After Dark gets no side tabs at all.
    expect(await render(ANYONE, "")).not.toContain("Which side");
  });

  it("lets an admin move a post to After Dark at once, or check it again: only a pass brings it to safe for work", async () => {
    const w = await world();
    const admin = ADMIN(w.me);
    await saveAdultSettings(t.db, { venice_key: "placeholder-venice" });
    const postOf = async (m: string) => (await t.db.query<{ id: string }>(`select id from showcase_posts where media_id = $1`, [m])).rows[0].id;
    const verdict = (clothing: string, age = "ADULTS") => setModerationFetchForTests(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ clothing, age }) } }] }));
    // A safe one that isn't: explicit at once, the picture's own rating too.
    expect(await reratePost(t.db, await postOf("pg-park"), "after_dark")).toMatchObject({ ok: true, rating: "nsfw" });
    expect(await ids(admin, "side=after_dark")).toContain("pg-park");
    expect((await t.db.query(`select content_rating from studio_pg_pictures where id = 'pg-park'`)).rows[0]).toEqual({ content_rating: "nsfw" });
    // An explicit one that's dressed: the PG check passes it, so it's safe for work now.
    verdict("CLOTHED");
    expect(await reratePost(t.db, await postOf("date-kiss"), "check")).toMatchObject({ ok: true, rating: "pg" });
    expect(await ids(ANYONE, "")).toContain("date-kiss");
    expect((await t.db.query(`select content_rating from adult_images where id = 'date-kiss'`)).rows[0]).toEqual({ content_rating: "pg" });
    // One the check turns down goes back up; an age doubt holds it too.
    verdict("NUDITY");
    expect(await reratePost(t.db, await postOf("date-kiss"), "check")).toMatchObject({ ok: true, rating: "nsfw", held: false });
    verdict("CLOTHED", "MINOR");
    expect(await reratePost(t.db, await postOf("portrait"), "check")).toMatchObject({ ok: true, rating: "nsfw", held: true });
    expect(await ids(admin, "side=after_dark")).not.toContain("portrait");
    // A clip can only go up; and it's an admin's alone.
    expect(await reratePost(t.db, await postOf("studio-clip"), "check")).toMatchObject({ ok: false, status: 422 });
    const post = (cookie: string) => modPost(new Request(`${BASE_URL}/x`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ post_id: "x", rerate: "after_dark" }) }));
    expect((await post(signedInCookie(userIdOf(newUserCookie())))).status).toBe(403);
    await claimAdmin(t.db, w.me);
    expect((await post(signedInCookie(w.me))).status).toBe(404);
  });
});
