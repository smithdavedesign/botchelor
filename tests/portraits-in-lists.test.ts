import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { listSwitchable } from "@/lib/adult/characters";
import { setMediaFetchForTests } from "@/lib/adult/media";
import { setModerationFetchForTests } from "@/lib/adult/moderation";
import { saveAdultSettings } from "@/lib/adult/settings";
import { withPortraits } from "@/lib/assets";
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

  it("After Dark's switches carry their own characters' portraits", async () => {
    const cookie = newUserCookie();
    const id = await withFace(cookie, "Tess Harrow");
    const owner = (await t.db.query<{ owner_id: string }>(`select owner_id from characters where id = $1`, [id])).rows[0].owner_id;
    const mine = (await listSwitchable(t.db, owner)).find((c) => c.id === id);
    expect(mine?.portrait).toMatch(/^\/api\/assets\//);
  });
});
