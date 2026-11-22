// The new character's face on the first-date card (2026-11-21): every new character's headshot is drawn after the save,
// so the card asks GET /api/characters/[id]/portrait for a little while and swaps the face in. Only the owner is told.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as getPortrait } from "@/app/api/characters/[id]/portrait/route";
import { api, BASE_URL, newUserCookie, startTestDb, validCharacter } from "./helpers";

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

const ask = (id: string, cookie?: string) =>
  getPortrait(new Request(`${BASE_URL}/api/characters/${id}/portrait`, { headers: cookie ? { cookie } : {} }), { params: Promise.resolve({ id }) });

async function drawn(id: string, review = "approved") {
  await t.db.query(
    `insert into character_assets (id, character_id, kind, source_type, source_model, url, review_status, content_rating)
     values ($1, $2, 'portrait', 'generated', 'test-model', 'https://files.example/p.webp', $3, 'pg')`,
    [`asset-${id}-${review}`, id, review],
  );
  return `asset-${id}-${review}`;
}

describe("the first-date card's face", () => {
  it("tells the owner null until the face is drawn and approved, then its served path", async () => {
    const owner = newUserCookie();
    const made = await (await api.createCharacter(validCharacter({ name: "Leopold Sol" }), owner)).json();

    let res = await ask(made.id, owner);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ character_id: made.id, portrait: null });

    // Drawn but not yet approved: still nothing to show.
    await drawn(made.id, "pending");
    expect((await (await ask(made.id, owner)).json()).portrait).toBeNull();

    const asset = await drawn(made.id);
    res = await ask(made.id, owner);
    expect(await res.json()).toEqual({ character_id: made.id, portrait: `/api/assets/${asset}` });
  });

  it("tells nobody else, not even whether the character exists", async () => {
    const owner = newUserCookie();
    const made = await (await api.createCharacter(validCharacter({ name: "Leopold Sol" }), owner)).json();
    await drawn(made.id);
    for (const res of [await ask(made.id), await ask(made.id, newUserCookie()), await ask("no-such-character", owner)]) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "character_not_found" });
    }
  });
});
