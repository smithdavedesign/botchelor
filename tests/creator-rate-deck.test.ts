import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as favPost } from "@/app/api/admin/after-dark/favorites/route";
import { listMedia } from "@/lib/adult/media";
import { saveAdultSettings } from "@/lib/adult/settings";
import { api, BASE_URL, newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

// Favorites and the rating deck (the creator suite, 2026-10-26).

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

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const fav = (body: unknown, cookie: string) =>
  favPost(new Request(`${BASE_URL}/api/admin/after-dark/favorites`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));
async function owner() {
  const raw = newUserCookie();
  const id = userIdOf(raw);
  const character = (await (await api.createCharacter(validCharacter({ name: "Mara Quill" }), raw)).json()).id as string;
  await t.db.query(`insert into adult_entitlements (user_id, subscription_status, age_verified_at) values ($1, 'active', now())`, [id]);
  return { id, cookie: signedInCookie(id), character };
}

describe("favorites", () => {
  it("star and unstar the owner's own pictures, show on the gallery, and are nobody else's to star", async () => {
    await saveAdultSettings(t.db, { enabled: true });
    const me = await owner();
    await t.db.query(`insert into adult_images (id, owner_id, character_id, kind, prompt, mime, data, status) values ('pic-1', $1, $2, 'scene', 'p', 'image/png', $3, 'ready')`, [me.id, me.character, Buffer.from(PNG)]);
    expect((await fav({ media_id: "pic-1", on: true }, me.cookie)).status).toBe(200);
    expect((await listMedia(t.db, [me.character], me.id)).find((m) => m.id === "pic-1")?.favorite).toBe(true);
    const other = await owner();
    expect((await fav({ media_id: "pic-1", on: true }, other.cookie)).status).toBe(404);
    expect((await fav({ media_id: "pic-1", on: false }, me.cookie)).status).toBe(200);
    expect((await listMedia(t.db, [me.character], me.id)).find((m) => m.id === "pic-1")?.favorite).toBe(false);
  });
});

describe("the rating deck", () => {
  it("shows the top picture with its three ways and says what the ratings do", async () => {
    const { createElement } = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { default: RateDeck } = await import("@/app/after-dark/RateDeck");
    const items = [{ id: "a" }, { id: "b" }].map((x) => ({ ...x, character_id: "c", character_b: null, kind: "scene" as const, status: "ready", created_at: "", mime: "image/png" }));
    const html = renderToStaticMarkup(createElement(RateDeck, { items, src: (id: string) => `/m/${id}`, onClose: () => {} }));
    expect(html).toContain('src="/m/a"');
    expect(html).not.toContain('src="/m/b"');
    expect(html).toContain("2 to go");
    for (const l of ["More like this", "Not right", "A favorite"]) expect(html).toContain(`aria-label="${l}"`);
    expect(html).toContain("steers their next pictures");
  });
});
