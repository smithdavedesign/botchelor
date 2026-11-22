import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { listSwitchable } from "@/lib/adult/characters";
import { setMediaFetchForTests } from "@/lib/adult/media";
import { setModerationFetchForTests } from "@/lib/adult/moderation";
import { saveAdultSettings } from "@/lib/adult/settings";
import { recordAsset, reviewAsset, withPortraits } from "@/lib/assets";
import { ensurePortrait, setDefaultPortraitsForTests } from "@/lib/default-portraits";
import { api, newUserCookie, startTestDb, TEST_SESSION_SECRET, validCharacter } from "./helpers";

// 2026-11-03: people's characters showed initials, not their portrait, on lists whose loader never asked for it
// (After Dark's hub and switches, the shorts, the votes, the account page, a profile's people, originality, analytics).

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
  await saveAdultSettings(t.db, { enabled: true, venice_key: "placeholder-venice" });
  setMediaFetchForTests(async () => Response.json({ images: [Buffer.from([137, 80, 78, 71]).toString("base64")] }));
  setModerationFetchForTests(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ clothing: "CLOTHED", age: "ADULTS" }) } }] }));
  setDefaultPortraitsForTests(true);
});
afterEach(() => {
  vi.unstubAllEnvs();
  setDefaultPortraitsForTests(null);
  setMediaFetchForTests(null);
  setModerationFetchForTests(null);
});

async function withFace(cookie: string, name: string) {
  const res = await api.createCharacter(validCharacter({ name }), cookie);
  const id = (await res.json()).id as string;
  expect(["has", "show"]).toContain(await ensurePortrait(t.db, id));
  return id;
}

describe("a character's portrait in every list", () => {
  it("withPortraits adds it, and keeps a private character's back unless asked", async () => {
    const cookie = newUserCookie();
    const shown = await withFace(cookie, "Mara Quill");
    const hidden = await withFace(cookie, "Ivo Lark");
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [hidden]);
    const [a, b] = await withPortraits(t.db, [{ id: shown }, { id: hidden }]);
    expect(a.portrait).toMatch(/^\/api\/assets\//);
    expect(b.portrait).toBeNull();
    expect((await withPortraits(t.db, [{ id: hidden }], { private: true }))[0].portrait).toMatch(/^\/api\/assets\//);
  });

  it("a portrait that is a reviewed file shipped with the app is that file's path, not a trip through the image route (2026-11-22 audit)", async () => {
    const cookie = newUserCookie();
    const id = await withFace(cookie, "Bram Tolley");
    const newer = async (url: string) => {
      const asset = await recordAsset(t.db, { content_rating: "pg", character_id: id, kind: "portrait", source_type: "generated", source_model: "test-1", url });
      await reviewAsset(t.db, asset, "approved");
      await t.db.query(`update character_assets set created_at = now() + (select count(*) from character_assets) * interval '1 minute' where id = $1`, [asset]);
      return asset;
    };
    await newer("/cast/house-bram-v5.webp");
    expect((await withPortraits(t.db, [{ id }]))[0].portrait).toBe("/cast/house-bram-v5.webp");
    // Any other path stays on the route, which checks it (and turns away anything but a file in /cast).
    for (const url of ["/cast/../secrets.png", "/cast/x.svg", "https://evil.example/x.png", "/cast/sub/x.webp"]) {
      const asset = await newer(url);
      expect((await withPortraits(t.db, [{ id }]))[0].portrait, url).toBe(`/api/assets/${asset}`);
    }
    // A generated picture, stored as a data URL, too.
    const drawn = await newer("data:image/png;base64," + Buffer.from("not really a png").toString("base64"));
    expect((await withPortraits(t.db, [{ id }]))[0].portrait).toBe(`/api/assets/${drawn}`);
  });

  it("After Dark's switches carry their own characters' portraits", async () => {
    const cookie = newUserCookie();
    const id = await withFace(cookie, "Tess Harrow");
    const owner = (await t.db.query<{ owner_id: string }>(`select owner_id from characters where id = $1`, [id])).rows[0].owner_id;
    const mine = (await listSwitchable(t.db, owner)).find((c) => c.id === id);
    expect(mine?.portrait).toMatch(/^\/api\/assets\//);
  });
});
