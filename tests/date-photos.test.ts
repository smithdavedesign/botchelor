import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as photosGet, POST as photosPost } from "@/app/api/episodes/[id]/photos/route";
import { setModerationFetchForTests } from "@/lib/adult/moderation";
import { saveAdultSettings } from "@/lib/adult/settings";
import { recordAsset, reviewAsset } from "@/lib/assets";
import { datePhotoPrompt, placeWordsOf } from "@/lib/studio/date-photos";
import { setPgStudioFetchForTests, setPgStudioPausesForTests } from "@/lib/studio/pg";
import { loadCharacter } from "@/lib/character";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { api, BASE_URL, signedInCookie, startTestDb, TEST_SESSION_SECRET, validCharacter } from "./helpers";

// Date photos (2026-10-30): a PG picture of the two of them from a finished date, kept with the date and sent in their texts.
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
  setPgStudioPausesForTests(false);
  await saveAdultSettings(t.db, { venice_key: "placeholder-venice", studio: { pg: { open_to: "everyone" } } });
});
afterEach(() => {
  vi.unstubAllEnvs();
  setPgStudioFetchForTests(null);
  setModerationFetchForTests(null);
});

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
function venice(answers: string[]) {
  const drawn: { url: string; body: Record<string, unknown> }[] = [];
  setPgStudioFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    drawn.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return new Response(PNG, { headers: { "content-type": "image/png" } });
  });
  let i = 0;
  setModerationFetchForTests(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ clothing: answers[i++ % answers.length], age: "ADULTS" }) } }] }));
  return drawn;
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (id: string, body: unknown, cookie: string) =>
  photosPost(new Request(`${BASE_URL}/api/episodes/${id}/photos`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }), params(id));
const get = (id: string, cookie: string) => photosGet(new Request(`${BASE_URL}/api/episodes/${id}/photos`, { headers: { cookie } }), params(id));
const tokens = (uid: string, n: number) => t.db.query(`insert into token_grants (id, user_id, episodes, granted_by) values ($1, $2, $3, 'test')`, [crypto.randomUUID(), uid, n]);

/** Their character, with a portrait or not, and a finished date with a house character. */
async function dated(face = true) {
  const uid = crypto.randomUUID();
  const cookie = signedInCookie(uid);
  const id = (await (await api.createCharacter(validCharacter({ name: `Pia ${uid.slice(0, 6)}` }), cookie)).json()).id as string;
  if (face) {
    const a = await recordAsset(t.db, { character_id: id, kind: "portrait", source_type: "generated", source_model: "test", url: `data:image/png;base64,${PNG.toString("base64")}`, content_rating: "pg" });
    await reviewAsset(t.db, a, "approved");
  }
  const ep = crypto.randomUUID();
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, revealed_at, transcript, status, visibility)
     values ($1, $2, $3, $4, 'a rooftop bar at sunset', '{}'::jsonb, '[]'::jsonb, '', '', 'second_date', now(), '[]'::jsonb, 'ready', 'public')`,
    [ep, uid, id, HOUSE_CHARACTERS[0].id],
  );
  return { uid, cookie, id, ep };
}

describe("a date photo", () => {
  it("is for the owner of one of the two only", async () => {
    const me = await dated();
    expect((await get(me.ep, me.cookie)).status).toBe(200);
    expect((await get(me.ep, signedInCookie(crypto.randomUUID()))).status).toBe(404);
    expect((await post(me.ep, { style: "selfie" }, signedInCookie(crypto.randomUUID()))).status).toBe(404);
  });

  it("needs both faces, and tokens, before anything's drawn", async () => {
    const drawn = venice(["CLOTHED"]);
    const noFace = await dated(false);
    expect((await post(noFace.ep, { style: "selfie" }, noFace.cookie)).status).toBe(409);
    const me = await dated();
    expect((await post(me.ep, { style: "selfie" }, me.cookie)).status).toBe(402);
    expect(drawn).toHaveLength(0);
  });

  it("draws both faces in safe mode, keeps only pg, sends the first in their texts, and lists it with the date", async () => {
    const me = await dated();
    await tokens(me.uid, 1);
    const drawn = venice(["CLOTHED", "REVEALING"]);
    const r = await (await post(me.ep, { style: "booth" }, me.cookie)).json();
    expect(r.photos).toHaveLength(1);
    expect(drawn[0].url).toMatch(/\/image\/multi-edit$/);
    expect(drawn[0].body).toMatchObject({ safe_mode: true });
    expect((drawn[0].body.images as string[]).length).toBe(2);
    expect(String(drawn[0].body.prompt)).toMatch(/photo-booth strip.*At a rooftop bar at sunset\./);
    const text = (await t.db.query<{ text: string; photo: string }>(`select text, photo from couple_texts`)).rows;
    expect(text).toEqual([{ text: "📷", photo: r.photos[0].asset_id }]);
    // Never in their Studio gallery (so never on a profile or the showcase with the other face in it).
    expect((await t.db.query(`select 1 from studio_pg_pictures`)).rows).toHaveLength(0);
    const listed = await (await get(me.ep, me.cookie)).json();
    expect(listed.photos.map((p: { asset_id: string }) => p.asset_id)).toEqual([r.photos[0].asset_id]);
  });

  it("gives the token back when nothing passes", async () => {
    const me = await dated();
    await tokens(me.uid, 1);
    venice(["NUDITY"]);
    const r = await (await post(me.ep, { style: "dance" }, me.cookie)).json();
    expect(r).toMatchObject({ photos: [], refunded: true });
    // The refunded token pays for the next one.
    venice(["CLOTHED"]);
    expect((await post(me.ep, { style: "dance" }, me.cookie)).status).toBe(200);
  });

  it("words: a place that isn't PG words becomes a plain evening out", async () => {
    expect(placeWordsOf("the lighthouse.")).toBe("the lighthouse");
    expect(placeWordsOf("a strip club")).toBe("a cosy bar in the evening");
    const a = (await loadCharacter(t.db, HOUSE_CHARACTERS[0].id))!;
    const b = (await loadCharacter(t.db, HOUSE_CHARACTERS[1].id))!;
    expect(datePhotoPrompt("selfie", a, b, "a park")).toMatch(/^A photograph of two people: the \w+ in Picture 1 .* and the \w+ in Picture 2 .*keeping both faces exactly\. An arm's-length selfie/);
  });
});
