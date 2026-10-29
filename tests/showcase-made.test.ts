import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as madeGet } from "@/app/api/showcase/[id]/made/route";
import { saveAdultSettings } from "@/lib/adult/settings";
import { twinPrompt } from "@/lib/adult/sfw-twin";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { pairKey } from "@/lib/relationships";
import { publish, saveCreatorProfile, type ShowcaseViewer } from "@/lib/showcase";
import { madeOf, modelOf } from "@/lib/showcase-made";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { api, BASE_URL, newUserCookie, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

// How a showcase post was made (lib/showcase-made.ts; David, 2026-10-29): its model, its prompt, who's in it.

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
});

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ADMIN: ShowcaseViewer = { id: "a-moderator", admin: true, ratings: ["pg", "suggestive", "nsfw"] };
const ANYONE: ShowcaseViewer = { id: null, admin: false, ratings: ["pg"] };

async function creator() {
  const raw = newUserCookie();
  const id = userIdOf(raw);
  const character = (await (await api.createCharacter(validCharacter({ name: "Mara Quill", pronouns: "she/her", age: 29 }), raw)).json()).id as string;
  await saveCreatorProfile(t.db, id, { handle: `mara_${id.slice(0, 6)}`, display_name: "Mara" });
  return { id, character };
}
type Img = { kind?: string; mime?: string; rating?: string; prompt?: string; model?: string | null; provider?: string | null; request?: unknown; b?: string | null; shoot?: string; twin_of?: string; derived?: string; source?: string; at?: string };
async function image(owner: string, a: string, o: Img = {}) {
  const id = crypto.randomUUID();
  await t.db.query(
    `insert into adult_images (id, owner_id, character_id, character_b, kind, prompt, mime, data, status, content_rating, model, provider, request, shoot_id, twin_of, derived, source_image, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'ready', $9, $10, $11, $12::jsonb, $13, $14, $15, $16, coalesce($17::timestamptz, now()))`,
    [id, owner, a, o.b ?? null, o.kind ?? "scene", o.prompt ?? "p", o.mime ?? "image/png", PNG, o.rating ?? "nsfw", o.model ?? null, o.provider ?? null, o.request ? JSON.stringify(o.request) : null, o.shoot ?? null, o.twin_of ?? null, o.derived ?? null, o.source ?? null, o.at ?? null],
  );
  return id;
}
async function post(owner: string, source: "after_dark" | "pg", media_id: string, show_prompt?: boolean) {
  const r = await publish(t.db, owner, { source, media_id, show_prompt });
  if (!r.ok) throw new Error(r.message);
  return r.post_id;
}

describe("how it was made", () => {
  it("names a Studio picture's model, where it ran, its prompt and who's in it, only to those who may see the post", async () => {
    const me = await creator();
    await t.db.query(`insert into adult_studio_shoots (id, owner_id, character_id, kind) values ('shoot-1', $1, $2, 'shoot')`, [me.id, me.character]);
    const pic = await image(me.id, me.character, { prompt: "She leans on the rail, golden light.", model: "qwen-edit-uncensored", provider: "venice", shoot: "shoot-1" });
    const id = await post(me.id, "after_dark", pic);
    const made = await madeOf(t.db, ADMIN, id);
    expect(made).toMatchObject({
      how: "A Studio shoot",
      model: { id: "qwen-edit-uncensored", label: "Qwen Edit (uncensored)", provider: "Venice" },
      prompt: "She leans on the rail, golden light.",
      prompt_note: null,
      characters: [{ id: me.character, name: "Mara Quill" }],
      from: null,
    });
    // An explicit post: nobody but an admin (for now) may see it, nor how it was made.
    expect(await madeOf(t.db, ANYONE, id)).toBeNull();
    const res = await madeGet(new Request(`${BASE_URL}/api/showcase/${id}/made`), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(404);
  });

  it("puts a twin's real prompt back where a placeholder was kept, and never says what its original was", async () => {
    const me = await creator();
    const original = await image(me.id, me.character);
    const twin = crypto.randomUUID();
    await t.db.query(
      `insert into studio_pg_pictures (id, owner_id, character_id, prompt, mime, data, content_rating, model, twin_of, tags) values ($1, $2, $3, 'An SFW twin of an After Dark picture', 'image/png', $4, 'pg', 'qwen-image-2-1-turbo-edit', $5, $6::jsonb)`,
      [twin, me.id, me.character, PNG, original, JSON.stringify([{ kind: "made", value: "twin" }])],
    );
    const id = await post(me.id, "pg", twin);
    const res = await madeGet(new Request(`${BASE_URL}/api/showcase/${id}/made`), { params: Promise.resolve({ id }) });
    expect(res.status).toBe(200);
    const made = await res.json();
    expect(made).toMatchObject({ how: "An SFW twin: another picture made again safe for work", model: { label: "Qwen Image 2.1 Turbo Edit", provider: "Venice" }, prompt: twinPrompt(["the woman"]), from: null });
    expect((await t.db.query<{ prompt: string }>(`select prompt from studio_pg_pictures where id = $1`, [twin])).rows[0].prompt).toBe(twinPrompt(["the woman"]));

    // One of two, kept in After Dark rated pg: both named, the same way.
    const [a, b] = pairKey(me.character, HOUSE_CHARACTERS[0].id);
    const pair = await image(me.id, a, { b, rating: "pg", prompt: "An SFW twin", model: "qwen-image-2-1-turbo-edit", provider: "venice", twin_of: original });
    const pairMade = await madeOf(t.db, ANYONE, await post(me.id, "after_dark", pair));
    expect(pairMade?.prompt).toMatch(/^Make Picture 1 again as a safe-for-work photograph: the same two people/);
    expect(pairMade?.characters.map((c) => c.id)).toEqual([a, b]);
    expect(pairMade?.from).toBeNull();
  });

  it("reads a video's prompt from what was sent, its model from its reel, and a boomerang's from the clip it came from", async () => {
    const me = await creator();
    const [a, b] = pairKey(me.character, HOUSE_CHARACTERS[0].id);
    const request = [
      { at: "https://api.venice.ai/api/v1/image/multi-edit", body: { model: "qwen-edit-uncensored", prompt: "The keyframe's words." } },
      { at: "https://api.venice.ai/api/v1/video/queue", body: { model: "wan-3-0-image-to-video", prompt: "They kiss, slowly, the camera steady." } },
    ];
    const clip = await image(me.id, a, { b, kind: "video", mime: "video/mp4", prompt: "Reel shot: hi", provider: "venice", request });
    const bare = await image(me.id, a, { b, kind: "video", mime: "video/mp4", prompt: "Reel shot: bye", provider: "venice" });
    await t.db.query(`insert into adult_reels (id, owner_id, character_a, character_b, status, shots, kind) values ('reel-1', $1, $2, $3, 'ready', $4::jsonb, 'night')`, [
      me.id,
      a,
      b,
      JSON.stringify([
        { line: 0, who: "a", text: "hi", motion: "They kiss.", status: "ready", media_id: clip, model: "wan-3-0-image-to-video" },
        { line: 1, who: "b", text: "bye", motion: "She waves goodbye at the door.", status: "ready", media_id: bare, model: "wan-video/wan-2.2-i2v-fast" },
      ]),
    ]);
    expect(await madeOf(t.db, ADMIN, await post(me.id, "after_dark", clip))).toMatchObject({
      how: "A shot of a date's video",
      model: { id: "wan-3-0-image-to-video", label: "Wan 3.0 (image to video)" },
      prompt: "They kiss, slowly, the camera steady.",
    });
    // Nothing sent was kept: the movement it was asked for, said to be just that.
    const plain = await madeOf(t.db, ADMIN, await post(me.id, "after_dark", bare));
    expect(plain).toMatchObject({ model: { label: "Wan 2.2 (image to video, fast)" }, prompt: "She waves goodbye at the door." });
    expect(plain?.prompt_note).toMatch(/movement it was asked for/);
    // A boomerang: no model or prompt of its own, and the clip it was made from.
    const boom = await image(me.id, a, { b, kind: "video", mime: "video/mp4", prompt: "Boomerang", model: "ffmpeg", derived: "boomerang", source: clip });
    const made = await madeOf(t.db, ADMIN, await post(me.id, "after_dark", boom));
    expect(made).toMatchObject({ how: "A boomerang of a clip", prompt: null, from: { how: "A shot of a date's video", prompt: "They kiss, slowly, the camera steady." } });
    expect(made?.prompt_note).toMatch(/ffmpeg/);
  });

  it("says plainly when the model wasn't kept, hides the prompt when the creator chose to, and keeps After Dark's words off the PG side", async () => {
    const me = await creator();
    const old = await image(me.id, me.character, { provider: "replicate", at: "2026-10-20T12:00:00Z" });
    const made = await madeOf(t.db, ADMIN, await post(me.id, "after_dark", old));
    expect(made?.model).toBeNull();
    expect(made?.model_note).toBe("Made on Replicate; the model wasn't kept (before 2026-10-24).");
    expect(made?.how).toBe("A picture from one of their dates");

    const kept = await image(me.id, me.character, { prompt: "Her secret words.", model: "qwen-edit-uncensored" });
    const quiet = await madeOf(t.db, ADMIN, await post(me.id, "after_dark", kept, false));
    expect(quiet).toMatchObject({ prompt: null, prompt_note: "The creator published this one without its prompt.", model: { id: "qwen-edit-uncensored" } });

    const dressed = await image(me.id, me.character, { rating: "pg", prompt: "Explicit, uncensored adult photograph, fully nude.", model: "qwen-edit-uncensored" });
    const pg = await madeOf(t.db, ANYONE, await post(me.id, "after_dark", dressed));
    expect(pg).toMatchObject({ prompt: null, prompt_note: "Its prompt has After Dark's words, so it isn't shown here.", model: { id: "qwen-edit-uncensored" } });
  });

  it("names models by a readable name, and any it doesn't know by their id", () => {
    expect(modelOf("qwen/qwen-image-edit-2511", "replicate")).toEqual({ id: "qwen/qwen-image-edit-2511", label: "Qwen Image Edit 2511", provider: "Replicate" });
    expect(modelOf("some-new-model", null)).toEqual({ id: "some-new-model", label: "some-new-model", provider: null });
    expect(modelOf("owner/new-model", null)?.provider).toBe("Replicate");
    expect(modelOf(null, "venice")).toBeNull();
  });
});
