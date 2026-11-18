import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as switchPost } from "@/app/api/admin/after-dark/switch/route";
import { claimAdmin } from "@/lib/admins";
import { drawnOutMessage, eligibleIds, listSwitchable, setAdultSwitch } from "@/lib/adult/characters";
import { BASE_URL, signedInCookie, startTestDb, TEST_SESSION_SECRET } from "./helpers";

// David, 2026-11-13: a character made in anime on purpose is never drawn as a real-looking person. After Dark draws
// photographs, so a drawn character (anime, or 2.5D since PRD styles-and-storylines phase 2) stays out of it: their
// switch stays off and says why, and one switched on before they were drawn isn't in anyone's scenes.
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
});

async function character(owner: string, name: string, style?: string): Promise<string> {
  const id = randomUUID();
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, extras) values ($1, $2, false, $3, 29, 'x', '["dry"]'::jsonb, 'x', 'x', $4::jsonb)`,
    [id, owner, name, JSON.stringify(style ? { looks: { style } } : {})],
  );
  return id;
}

describe("anime characters in After Dark", () => {
  it("can't be switched on, says why, and leaves a photoreal character's switch as it was", async () => {
    const owner = randomUUID();
    await claimAdmin(t.db, owner);
    const anime = await character(owner, "Tsukiha Aoi", "anime");
    const real = await character(owner, "Mara Quill", "photoreal");

    const post = (character_id: string, on: boolean) =>
      switchPost(new Request(`${BASE_URL}/api/admin/after-dark/switch`, { method: "POST", headers: { cookie: signedInCookie(owner), "content-type": "application/json" }, body: JSON.stringify({ character_id, on }) }));
    const refused = await post(anime, true);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: "drawn", style: "anime", message: drawnOutMessage("anime") });
    expect(drawnOutMessage("anime")).toMatch(/^They're drawn in anime, and After Dark only draws photographs/);
    expect(await setAdultSwitch(t.db, owner, anime, true)).toBe(false);
    expect((await post(real, true)).status).toBe(200);

    const list = await listSwitchable(t.db, owner);
    expect(list.find((c) => c.id === anime)).toMatchObject({ on: false, drawn: "anime" });
    expect(list.find((c) => c.id === real)).toMatchObject({ on: true, drawn: null });
    const eligible = await eligibleIds(t.db, owner);
    expect(eligible.has(real)).toBe(true);
    expect(eligible.has(anime)).toBe(false);
  });

  it("drops one switched on before they were drawn in anime, and an opened agent-cast one, from everyone's scenes", async () => {
    const owner = randomUUID();
    const earlier = await character(owner, "Ambrose Fenn");
    await t.db.query(`insert into adult_switches (owner_id, character_id) values ($1, $2)`, [owner, earlier]);
    const opened = await character(randomUUID(), "Kaede Ren", "anime");
    await t.db.query(`update characters set after_dark_open = true where id = $1`, [opened]);
    expect((await eligibleIds(t.db, owner)).has(earlier)).toBe(true);

    await t.db.query(`update characters set extras = jsonb_set(extras, '{looks}', '{"style":"anime"}'::jsonb) where id = $1`, [earlier]);
    const eligible = await eligibleIds(t.db, owner);
    expect(eligible.has(earlier)).toBe(false);
    expect(eligible.has(opened)).toBe(false);
    expect((await listSwitchable(t.db, owner)).find((c) => c.id === earlier)).toMatchObject({ on: false, drawn: "anime" });
    // Switching them off still works (nothing is stuck on).
    expect(await setAdultSwitch(t.db, owner, earlier, false)).toBe(true);
  });

  it("keeps a 2.5D character out the same way, and says it's 2.5D (PRD styles-and-storylines phase 2)", async () => {
    const owner = randomUUID();
    await claimAdmin(t.db, owner);
    const painted = await character(owner, "Odessa Lark", "semi_real");
    const res = await switchPost(
      new Request(`${BASE_URL}/api/admin/after-dark/switch`, { method: "POST", headers: { cookie: signedInCookie(owner), "content-type": "application/json" }, body: JSON.stringify({ character_id: painted, on: true }) }),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "drawn", style: "semi_real", message: drawnOutMessage("semi_real") });
    expect(drawnOutMessage("semi_real")).toMatch(/^They're drawn in 2\.5D, /);
    expect(await setAdultSwitch(t.db, owner, painted, true)).toBe(false);
    expect((await listSwitchable(t.db, owner)).find((c) => c.id === painted)).toMatchObject({ on: false, drawn: "semi_real" });
    // Opened for everyone before it was drawn in 2.5D: out of every scene once it is.
    await t.db.query(`update characters set after_dark_open = true where id = $1`, [painted]);
    expect((await eligibleIds(t.db, randomUUID())).has(painted)).toBe(false);
  });
});
