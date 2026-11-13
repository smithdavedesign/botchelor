import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as baselinePost } from "@/app/api/admin/after-dark/agent-cast/baseline/route";
import { POST as castPost } from "@/app/api/admin/after-dark/agent-cast/route";
import { baselineFromEditor, type PortraitEdit } from "@/lib/adult/media";
import { loadCharacter } from "@/lib/character";
import { POST as settingsPost } from "@/app/api/admin/after-dark/settings/route";
import { HIVE_VLM, setCheckFetchForTests } from "@/lib/adult/check";
import { faceReferenceId } from "@/lib/adult/steering";
import { claimAdmin } from "@/lib/admins";
import { sessionCookies } from "@/lib/http";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// An agent-cast character's After Dark baseline drawn free on the admin's Mac (David, 2026-11-12) and sent up as bytes:
// kept only through the same checks as a baseline from the portrait, read as nude, and every viewer's default face.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", "a-test-session-secret-that-is-long-enough-0123456789");
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setCheckFetchForTests(null);
});

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
const verdict = (child: number, answer: string) =>
  setCheckFetchForTests(async (input: RequestInfo | URL) =>
    Response.json(
      String(input) === HIVE_VLM
        ? { choices: [{ message: { role: "assistant", content: `{"answer": "${answer}"}` } }] }
        : { output: [{ classes: [{ class: "yes_child_present", value: child }, { class: "no_child_present", value: 1 - child }, { class: "general_nsfw", value: 0.98 }] }] },
    ),
  );

async function admin() {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  const cookie = signedIn(id);
  await settingsPost(
    new Request(`${BASE_URL}/api/admin/after-dark/settings`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ enabled: true, image_provider: "venice", openrouter_key: "placeholder-text-ABCD", venice_key: "placeholder-venice", hive_key: "placeholder-hive" }),
    }),
  );
  return { id, cookie };
}
async function castMember(owner: string, open = true): Promise<string> {
  const id = crypto.randomUUID();
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, created_via, visibility, after_dark_open)
     values ($1, $2, false, 'Anthea Vesper', 39, 'Plays chess for money.', '["sharp","calm"]'::jsonb, 'Someone who keeps up', 'Cowardice', 'mcp', 'public', $3)`,
    [id, owner, open],
  );
  await t.db.query(
    `insert into character_assets (id, character_id, kind, source_type, source_model, url, review_status, content_rating)
     values ($1, $2, 'portrait', 'generated', 'test-model', 'https://files.example/p.webp', 'approved', 'pg')`,
    [`asset-${id}`, id],
  );
  return id;
}
const send = (cookie: string | null, q: Record<string, string>, body: Uint8Array = PNG, type = "image/png") =>
  baselinePost(
    new Request(`${BASE_URL}/api/admin/after-dark/agent-cast/baseline?${new URLSearchParams(q)}`, {
      method: "POST",
      headers: { "content-type": type, ...(cookie ? { cookie } : {}) },
      body: new Uint8Array(body),
    }),
  );

describe("a local baseline for the agent cast", () => {
  it("is kept through the output check as their nude baseline, and becomes any viewer's face", async () => {
    const a = await admin();
    const c = await castMember(a.id);
    verdict(0.01, "ADULTS");
    const res = await send(a.cookie, { character_id: c, owner_id: a.id, model: "RealVisXL V5 inpaint (local)" });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    const row = (await t.db.query(`select owner_id, kind, attire, provider, model, prompt from adult_images where id = $1`, [id])).rows[0];
    expect(row).toMatchObject({ owner_id: a.id, kind: "baseline", attire: "nude", provider: "local", model: "RealVisXL V5 inpaint (local)" });
    expect(row.prompt).toMatch(/^Make one photograph of the same person as in Picture 1/);
    // A viewer with no face of their own gets the admins' baseline.
    expect(await faceReferenceId(t.db, crypto.randomUUID(), c)).toBe(id);
    // Once they have one, another isn't stored.
    const again = await send(a.cookie, { character_id: c, owner_id: a.id });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ exists: true });
  });

  it("replaces only an earlier local one, and only once the new one is kept", async () => {
    const a = await admin();
    const c = await castMember(a.id);
    verdict(0.01, "ADULTS");
    const first = ((await (await send(a.cookie, { character_id: c, owner_id: a.id })).json()) as { id: string }).id;
    verdict(0.97, "MINOR");
    expect((await send(a.cookie, { character_id: c, owner_id: a.id, replace: "1" })).status).toBe(422);
    expect((await t.db.query(`select status from adult_images where id = $1`, [first])).rows[0].status).toBe("ready");
    verdict(0.01, "ADULTS");
    const res = await send(a.cookie, { character_id: c, owner_id: a.id, replace: "1" });
    expect(res.status).toBe(201);
    const second = ((await res.json()) as { id: string }).id;
    expect((await t.db.query(`select status from adult_images where id = $1`, [first])).rows[0].status).toBe("failed");
    expect(await faceReferenceId(t.db, crypto.randomUUID(), c)).toBe(second);
    // A baseline from anywhere else is never replaced.
    await t.db.query(`update adult_images set provider = 'replicate' where id = $1`, [second]);
    expect(await (await send(a.cookie, { character_id: c, owner_id: a.id, replace: "1" })).json()).toEqual({ exists: true });
  });

  it("is discarded when the check refuses it", async () => {
    const a = await admin();
    const c = await castMember(a.id);
    verdict(0.97, "MINOR");
    const res = await send(a.cookie, { character_id: c, owner_id: a.id });
    expect(res.status).toBe(422);
    expect((await t.db.query(`select 1 from adult_images where character_id = $1`, [c])).rows).toHaveLength(0);
  });

  it("is only for admins, an admin owner, the open agent cast and an image", async () => {
    const a = await admin();
    const c = await castMember(a.id);
    const closed = await castMember(a.id, false);
    verdict(0.01, "ADULTS");
    expect((await send(null, { character_id: c, owner_id: a.id })).status).toBe(403);
    expect((await send(a.cookie, { character_id: c, owner_id: crypto.randomUUID() })).status).toBe(400);
    expect((await send(a.cookie, { character_id: closed, owner_id: a.id })).status).toBe(404);
    expect((await send(a.cookie, { character_id: c, owner_id: a.id }, PNG, "text/plain")).status).toBe(415);
    expect((await t.db.query(`select 1 from adult_images`)).rows).toHaveLength(0);
  });
});

// The local ones looked like a head pasted on a body (David, 2026-11-12), so the cast is redrawn with the Studio's editor:
// one coherent edit of the portrait, through the same checks, replacing a local one only once it's kept.
describe("an editor-drawn baseline for the agent cast", () => {
  const edit: PortraitEdit = async () => ({ bytes: Buffer.from(PNG), mime: "image/png", provider: "venice", fell_back: false, model: "qwen-edit-uncensored" });

  it("replaces a local one once kept, never another, and isn't stored when refused", async () => {
    const a = await admin();
    const id = await castMember(a.id);
    const c = (await loadCharacter(t.db, id))!;
    verdict(0.01, "ADULTS");
    const local = ((await (await send(a.cookie, { character_id: id, owner_id: a.id })).json()) as { id: string }).id;
    verdict(0.97, "MINOR");
    await expect(baselineFromEditor(t.db, a.id, c, edit)).rejects.toThrow(/discarded/);
    expect((await t.db.query(`select status from adult_images where id = $1`, [local])).rows[0].status).toBe("ready");
    verdict(0.01, "ADULTS");
    const made = (await baselineFromEditor(t.db, a.id, c, edit))!;
    const row = (await t.db.query(`select attire, provider, model from adult_images where id = $1`, [made.id])).rows[0];
    expect(row).toMatchObject({ attire: "nude", provider: "venice", model: "qwen-edit-uncensored" });
    expect((await t.db.query(`select status from adult_images where id = $1`, [local])).rows[0].status).toBe("failed");
    expect(await faceReferenceId(t.db, crypto.randomUUID(), id)).toBe(made.id);
    expect(await baselineFromEditor(t.db, a.id, c, edit)).toBeNull();
  });

  it("is only for admins, an admin owner and the open agent cast", async () => {
    const a = await admin();
    const id = await castMember(a.id);
    const closed = await castMember(a.id, false);
    const post = (cookie: string | null, body: object) =>
      castPost(new Request(`${BASE_URL}/api/admin/after-dark/agent-cast`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ action: "draw_baseline", ...body }) }));
    expect((await post(null, { character_id: id, owner_id: a.id })).status).toBe(403);
    expect((await post(a.cookie, { character_id: id, owner_id: crypto.randomUUID() })).status).toBe(400);
    expect((await post(a.cookie, { character_id: closed, owner_id: a.id })).status).toBe(404);
    expect((await t.db.query(`select 1 from adult_images`)).rows).toHaveLength(0);
  });
});
