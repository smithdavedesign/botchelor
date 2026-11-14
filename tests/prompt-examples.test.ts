import { prerender } from "react-dom/static";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { EXAMPLES_PER_TAG, examplesForTag, pickVaried, pictureTags, resetPromptExamplesForTests, type PromptExample } from "@/lib/prompt-examples";
import { api, named, newUserCookie, startTestDb, userIdOf, validCharacter } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  resetPromptExamplesForTests();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

const CLOSE = "a close-up headshot of a woman with red hair, oil painting, soft light";

/** A creator with a public character and one PG Studio picture of it on the showcase. */
async function publish(opts: { prompt?: string; rating?: "pg" | "nsfw"; hidden?: boolean; visibility?: "public" | "private"; status?: "live" | "removed"; tags?: { kind: string; value: string }[] } = {}) {
  const cookie = newUserCookie();
  const owner = userIdOf(cookie);
  await named(cookie, `Creator ${owner.slice(0, 6)}`);
  const { id: character } = (await (await api.createCharacter(validCharacter({ name: `Pictured ${owner.slice(0, 4)}` }), cookie)).json()) as { id: string };
  if (opts.visibility === "private") await t.db.query("update characters set visibility = 'private' where id = $1", [character]);
  await t.db.query("insert into creator_profiles (user_id, handle, display_name, hidden) values ($1, $2, $3, $4)", [owner, `h${owner.slice(0, 8)}`, "A creator", opts.hidden ?? false]);
  const picture = crypto.randomUUID();
  await t.db.query(
    "insert into studio_pg_pictures (id, owner_id, character_id, prompt, mime, content_rating, tags) values ($1, $2, $3, $4, 'image/webp', $5, $6::jsonb)",
    [picture, owner, character, opts.prompt ?? CLOSE, opts.rating ?? "pg", JSON.stringify(opts.tags ?? [{ kind: "made", value: "shoot" }])],
  );
  const post = crypto.randomUUID();
  await t.db.query(
    "insert into showcase_posts (id, owner_id, source, media_id, character_id, rating, medium, status, published_at) values ($1, $2, 'pg', $3, $4, $5, 'picture', $6, now())",
    [post, owner, picture, character, opts.rating ?? "pg", opts.status ?? "live"],
  );
  return { post, character };
}

/** Example pictures for a tag, from the show's own published Studio pictures (lib/prompt-examples.ts). */
describe("a tag's example pictures", () => {
  it("are the live PG showcase pictures whose own prompt carries the tag, newest first, four at most", async () => {
    const made = [];
    for (let i = 0; i < EXAMPLES_PER_TAG + 1; i++) made.push(await publish());
    const close = await examplesForTag(t.db, "framing.close");
    expect(close.length).toBe(EXAMPLES_PER_TAG);
    expect(close[0]).toMatchObject({ post_id: made.at(-1)!.post, href: `/showcase/reels?start=${made.at(-1)!.post}`, src: `/api/showcase/${made.at(-1)!.post}/media?size=tile` });
    expect(close[0].alt).toContain("a picture made in the Studio");
    // A tag the prompt doesn't carry has none.
    expect(await examplesForTag(t.db, "framing.wide")).toEqual([]);
  });

  it("shows one of each character before a second of any, newest first within (pickVaried)", () => {
    const ex = (post_id: string, character: string): PromptExample => ({ post_id, character, href: "", src: "", alt: "" });
    const cands = [ex("l1", "Lexi"), ex("l2", "Lexi"), ex("n1", "Nell"), ex("l3", "Lexi"), ex("s1", "Sable"), ex("l4", "Lexi")];
    expect(pickVaried(cands, 4).map((c) => c.post_id)).toEqual(["l1", "l2", "n1", "s1"]);
    expect(pickVaried(cands, 2).map((c) => c.post_id)).toEqual(["l1", "n1"]);
    expect(pickVaried(cands.slice(0, 2), 4).map((c) => c.post_id)).toEqual(["l1", "l2"]);
  });

  it("a picture's picked Studio options count as its tags too (the Studio's own words don't always say them)", async () => {
    expect(pictureTags("a quiet moment", [{ kind: "made", value: "shoot" }, { kind: "light", value: "candle" }, { kind: "framing", value: "close" }, { kind: "nonsense", value: "x" }]).sort()).toEqual(["framing.close", "light.candle"]);
    const { post } = await publish({ prompt: "a quiet moment at home", tags: [{ kind: "made", value: "shoot" }, { kind: "light", value: "candle" }] });
    expect((await examplesForTag(t.db, "light.candle")).map((e) => e.post_id)).toEqual([post]);
    expect(await examplesForTag(t.db, "framing.close")).toEqual([]);
  });

  it("After Dark pictures whose PG twin the showcase shows count too, with the original shoot's picked options", async () => {
    const cookie = newUserCookie();
    const owner = userIdOf(cookie);
    await named(cookie, `Creator ${owner.slice(0, 6)}`);
    const { id: character } = (await (await api.createCharacter(validCharacter({ name: "Pictured in After Dark" }), cookie)).json()) as { id: string };
    await t.db.query("insert into creator_profiles (user_id, handle, display_name) values ($1, $2, $3)", [owner, `h${owner.slice(0, 8)}`, "A creator"]);
    const shoot = crypto.randomUUID();
    await t.db.query("insert into adult_studio_shoots (id, owner_id, character_id, kind, choices) values ($1, $2, $3, 'picture', $4::jsonb)", [shoot, owner, character, JSON.stringify({ place: "rooftop", light: ["golden"], request: { sent: true } })]);
    const original = crypto.randomUUID();
    await t.db.query("insert into adult_images (id, owner_id, character_id, kind, prompt, mime, status, content_rating, shoot_id) values ($1, $2, $3, 'scene', 'on a rooftop at golden hour', 'image/webp', 'ready', 'nsfw', $4)", [original, owner, character, shoot]);
    const twin = crypto.randomUUID();
    await t.db.query("insert into adult_images (id, owner_id, character_id, kind, prompt, mime, status, content_rating, twin_of) values ($1, $2, $3, 'scene', 'on a rooftop at golden hour, dressed', 'image/webp', 'ready', 'pg', $4)", [twin, owner, character, original]);
    const post = crypto.randomUUID();
    await t.db.query("insert into showcase_posts (id, owner_id, source, media_id, character_id, rating, medium, status, published_at) values ($1, $2, 'after_dark', $3, $4, 'pg', 'picture', 'live', now())", [post, owner, twin, character]);
    expect((await examplesForTag(t.db, "place.rooftop")).map((e) => e.post_id)).toEqual([post]);
    expect((await examplesForTag(t.db, "light.golden")).map((e) => e.post_id)).toEqual([post]);
    // The original (not PG) is never an example itself: only the twin the showcase shows.
    const nsfwPost = crypto.randomUUID();
    await t.db.query("insert into showcase_posts (id, owner_id, source, media_id, character_id, rating, medium, status, published_at) values ($1, $2, 'after_dark', $3, $4, 'nsfw', 'picture', 'live', now())", [nsfwPost, owner, original, character]);
    resetPromptExamplesForTests();
    expect((await examplesForTag(t.db, "place.rooftop")).map((e) => e.post_id)).toEqual([post]);
  });

  it("never shows a picture the showcase wouldn't: not PG, a hidden creator, a private character, a removed post", async () => {
    await publish({ rating: "nsfw" });
    await publish({ hidden: true });
    await publish({ visibility: "private" });
    await publish({ status: "removed" });
    expect(await examplesForTag(t.db, "framing.close")).toEqual([]);
    const kept = await publish();
    resetPromptExamplesForTests();
    expect((await examplesForTag(t.db, "framing.close")).map((e) => e.post_id)).toEqual([kept.post]);
  });

  it("the tag page and the filtered library show them; a tag with none shows no box", async () => {
    await publish();
    const { default: TagPage } = await import("@/app/prompts/tag/[id]/page");
    const html = await new Response((await prerender(await TagPage({ params: Promise.resolve({ id: "framing.close" }) }))).prelude).text();
    expect(html).toContain('data-prompt-examples="framing.close"');
    expect(html).toContain("Pictures made with");
    expect(html).toContain("/media?size=tile");
    const { default: PromptsPage } = await import("@/app/prompts/page");
    const lib = await new Response((await prerender(await PromptsPage({ searchParams: Promise.resolve({ tag: "framing.close" }) }))).prelude).text();
    expect(lib).toContain('data-prompt-examples="framing.close"');
    const none = await new Response((await prerender(await PromptsPage({ searchParams: Promise.resolve({ tag: "framing.wide" }) }))).prelude).text();
    expect(none).not.toContain("data-prompt-examples");
  });
});
