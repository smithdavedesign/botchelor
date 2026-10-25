import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getAsset } from "@/app/api/assets/[id]/route";
import { GET as getAssetTeaser } from "@/app/api/assets/[id]/teaser/route";
import { GET as getAdultTeaser } from "@/app/api/teasers/[id]/route";
import { claimAdmin } from "@/lib/admins";
import { approvedPortraitId, recordAsset, reviewAsset } from "@/lib/assets";
import { mayRerate, rateAsset, ratingForLevel, ratingOf, stricter } from "@/lib/content-rating";
import type { ContentRating } from "@/lib/content-rating";
import { setPlaceForTests } from "@/lib/place";
import { TEASER_HEIGHT, TEASER_WIDTH } from "@/lib/teaser-image";
import { BASE_URL, HOUSE_PARTNER_ID, TEST_SESSION_SECRET, newUserCookie, signedInCookie, startTestDb, userIdOf } from "./helpers";

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
});
afterEach(() => {
  vi.unstubAllEnvs();
  setPlaceForTests({ country: "US", region: "CA" });
});

const GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const req = (path: string, opts: { cookie?: string; ua?: string } = {}) =>
  new Request(`${BASE_URL}${path}`, { headers: { ...(opts.cookie ? { cookie: opts.cookie } : {}), ...(opts.ua ? { "user-agent": opts.ua } : {}) } });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const serve = (id: string, opts?: { cookie?: string; ua?: string }) => getAsset(req(`/api/assets/${id}`, opts), params(id));
const teaser = (id: string, opts?: { cookie?: string; ua?: string }) => getAssetTeaser(req(`/api/assets/${id}/teaser`, opts), params(id));
const adultTeaser = (id: string, opts?: { cookie?: string; ua?: string }) => getAdultTeaser(req(`/api/teasers/${id}`, opts), params(id));

async function png(): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  return sharp({ create: { width: 64, height: 80, channels: 3, background: "#c36" } }).png().toBuffer();
}
async function asset(rating: ContentRating, kind: "portrait" | "photo" = "photo"): Promise<string> {
  const id = await recordAsset(t.db, {
    character_id: HOUSE_PARTNER_ID,
    kind,
    source_type: "generated",
    source_model: "test-1",
    url: `data:image/png;base64,${(await png()).toString("base64")}`,
    content_rating: rating,
  });
  await reviewAsset(t.db, id, "approved");
  return id;
}
const person = () => signedInCookie(userIdOf(newUserCookie()));
async function admin(): Promise<{ id: string; cookie: string }> {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  return { id, cookie: signedInCookie(id) };
}

describe("the rating itself", () => {
  it("fails closed: anything that isn't a rating is nsfw, and so is a picture no check has seen", () => {
    for (const v of [null, undefined, "", "PG", "safe", 0, "explicit"]) expect(ratingOf(v)).toBe("nsfw");
    expect(ratingOf("pg")).toBe("pg");
    expect(rateAsset("pg", null)).toBe("nsfw");
    expect(rateAsset("pg", "pg")).toBe("pg");
  });

  it("is the stricter of what was asked for and what the check saw", () => {
    expect(rateAsset("pg", "suggestive")).toBe("suggestive");
    expect(rateAsset("nsfw", "pg")).toBe("nsfw");
    expect(stricter("suggestive", "pg")).toBe("suggestive");
  });

  it("reads the Studio's levels: dressed pg, suggestive suggestive, nude and explicit nsfw", () => {
    expect([0, 1, 2, 3, 4, "0", null].map(ratingForLevel)).toEqual(["pg", "suggestive", "nsfw", "nsfw", "nsfw", "nsfw", "nsfw"]);
  });

  it("only comes down through a fresh check", () => {
    expect(mayRerate("pg", "nsfw", false)).toBe(true);
    expect(mayRerate("nsfw", "pg", false)).toBe(false);
    expect(mayRerate("nsfw", "pg", true)).toBe(true);
  });

  it("is required in the schema: a row that doesn't say is nsfw, and nothing else can be stored", async () => {
    await t.db.query(`insert into character_assets (id, kind, source_type) values ('raw', 'decoration', 'drawn')`);
    expect((await t.db.query(`select content_rating from character_assets where id = 'raw'`)).rows[0].content_rating).toBe("nsfw");
    await expect(t.db.query(`update character_assets set content_rating = 'r' where id = 'raw'`)).rejects.toThrow();
  });
});

describe("serving a show asset by its rating", () => {
  it("pg goes to anyone, cached publicly as before", async () => {
    const res = await serve(await asset("pg"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("public");
  });

  it("suggestive goes only to someone signed in, privately cached, never to a bot", async () => {
    const id = await asset("suggestive");
    expect((await serve(id)).status).toBe(404);
    const res = await serve(id, { cookie: person() });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toMatch(/^private/);
    expect((await serve(id, { cookie: person(), ua: GOOGLEBOT })).status).toBe(404);
  });

  it("nsfw: a stranger gets nothing, someone signed in only the teaser, never the bytes", async () => {
    const id = await asset("nsfw");
    expect((await serve(id)).status).toBe(404);
    const cookie = person();
    const res = await serve(id, { cookie });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${BASE_URL}/api/assets/${id}/teaser`);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const tease = await teaser(id, { cookie });
    expect(tease.status).toBe(200);
    expect(tease.headers.get("content-type")).toBe("image/jpeg");
    expect(tease.headers.get("cache-control")).toMatch(/^private/);
    const { default: sharp } = await import("sharp");
    const meta = await sharp(Buffer.from(await tease.arrayBuffer())).metadata();
    expect([meta.width, meta.height]).toEqual([TEASER_WIDTH, TEASER_HEIGHT]);
    // Drawn once and kept.
    expect(await t.count("media_teasers")).toBe(1);
    await teaser(id, { cookie });
    expect(await t.count("media_teasers")).toBe(1);
  });

  it("nsfw: a bot, a stranger, or someone where After Dark is blocked gets no teaser either", async () => {
    const id = await asset("nsfw");
    expect((await teaser(id)).status).toBe(404);
    expect((await serve(id, { cookie: person(), ua: GOOGLEBOT })).status).toBe(404);
    expect((await teaser(id, { cookie: person(), ua: GOOGLEBOT })).status).toBe(404);
    setPlaceForTests({ country: "FR", region: null });
    expect((await serve(id, { cookie: person() })).status).toBe(404);
    expect((await teaser(id, { cookie: person() })).status).toBe(404);
  });

  it("nsfw: an admin (After Dark open to them) gets the bytes, privately", async () => {
    const id = await asset("nsfw");
    const res = await serve(id, { cookie: (await admin()).cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toMatch(/^private/);
  });

  it("a portrait that isn't pg is never anyone's face", async () => {
    await asset("nsfw", "portrait");
    expect(await approvedPortraitId(t.db, HOUSE_PARTNER_ID)).toBeNull();
    const pg = await asset("pg", "portrait");
    expect(await approvedPortraitId(t.db, HOUSE_PARTNER_ID)).toBe(pg);
  });
});

describe("an After Dark picture's teaser", () => {
  async function adultImage(owner: string): Promise<string> {
    const id = crypto.randomUUID();
    await t.db.query(
      `insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data, status) values ($1, $2, $3, 'scene', 'p', 'image/png', $4, 'ready')`,
      [id, owner, HOUSE_PARTNER_ID, await png()],
    );
    return id;
  }

  it("is tagged nsfw without saying so", async () => {
    const id = await adultImage("someone");
    expect((await t.db.query(`select content_rating from adult_images where id = $1`, [id])).rows[0].content_rating).toBe("nsfw");
  });

  it("goes only to its owner (or an admin), signed in, and goes with the picture", async () => {
    const ownerId = userIdOf(newUserCookie());
    const id = await adultImage(ownerId);
    expect((await adultTeaser(id)).status).toBe(404);
    expect((await adultTeaser(id, { cookie: person() })).status).toBe(404);
    expect((await adultTeaser(id, { cookie: signedInCookie(ownerId), ua: GOOGLEBOT })).status).toBe(404);
    const res = await adultTeaser(id, { cookie: signedInCookie(ownerId) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect((await adultTeaser(id, { cookie: (await admin()).cookie })).status).toBe(200);
    await t.db.query(`delete from adult_images where id = $1`, [id]);
    expect(await t.count("media_teasers")).toBe(0);
  });
});
