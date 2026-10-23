import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET } from "@/app/api/characters/name/route";
import { BASE_URL, api, newUserCookie, startTestDb, validCharacter } from "./helpers";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const check = async (name: string, except?: string) => {
  const q = new URLSearchParams({ name, ...(except ? { except } : {}) });
  const res = await GET(new Request(`${BASE_URL}/api/characters/name?${q}`));
  return { status: res.status, body: (await res.json()) as Any };
};

describe("GET /api/characters/name (the /create name check)", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  let id: string;
  beforeAll(async () => {
    t = await startTestDb();
    const res = await api.createCharacter(validCharacter({ name: "Juno Marlowe" }), newUserCookie());
    id = String(((await res.json()) as Any).id);
  });
  afterAll(async () => {
    await t.close();
  });

  it("flags a name already on the show, case-blind and trimmed, with free names like it", async () => {
    const { status, body } = await check("  juno MARLOWE ");
    expect(status).toBe(200);
    expect(body.taken).toBe(true);
    expect(body.free_names.length).toBeGreaterThan(0);
    for (const n of body.free_names) {
      expect(n).toMatch(/ Marlowe$/);
      expect(n.toLowerCase()).not.toBe("juno marlowe");
    }
    expect(JSON.stringify(body)).not.toContain(id);
  });

  it("passes a free name, and the edited character's own name", async () => {
    expect((await check("Wren Okafor")).body).toMatchObject({ taken: false, free_names: [] });
    expect((await check("Juno Marlowe", id)).body.taken).toBe(false);
  });

  it("refuses an empty name", async () => {
    expect((await check("  ")).status).toBe(400);
  });
});

describe("POST /api/characters refuses a name already on the show", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
  });

  it("409 with free names; keep_name: true saves it anyway", async () => {
    const cookie = newUserCookie();
    expect((await api.createCharacter(validCharacter({ name: "Ira Fenn" }), cookie)).status).toBe(201);
    const refused = await api.createCharacter({ ...validCharacter({ name: "ira fenn" }), keep_name: false }, cookie);
    expect(refused.status).toBe(409);
    const body = (await refused.json()) as Any;
    expect(body.error).toBe("name_taken");
    expect(body.free_names.length).toBeGreaterThan(0);
    expect(body.message).toMatch(/already a Ira Fenn/);
    expect((await api.createCharacter(validCharacter({ name: "Ira Fenn" }), cookie)).status).toBe(201);
  });
});
