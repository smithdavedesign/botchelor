import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as whyGet } from "@/app/api/admin/after-dark/why/route";
import { POST } from "@/app/api/admin/after-dark/route";
import { POST as settingsPost } from "@/app/api/admin/after-dark/settings/route";
import { pairContent } from "@/lib/adult/graph";
import { runAdultTool } from "@/lib/adult/mcp";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { STEP_LOGGING_FROM, textModelAt, writtenBy, writtenByLabel } from "@/lib/adult/model-log";
import { settingsHistory } from "@/lib/adult/settings";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import { openAICompatibleModel, type ModelOptions } from "@/lib/model";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// Which text model wrote each step, and the settings history (lib/adult/model-log.ts, David 2026-10-22). No live calls.
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
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setAdultModelForTests(null);
  setSeasonCastForTests(null);
});

const [RAFE, JUNIPER] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id];
const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
const call = (handler: (r: Request) => Promise<Response>, path: string, body: unknown, cookie?: string) =>
  handler(new Request(`${BASE_URL}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
const settings = (body: Record<string, unknown>, cookie: string) => call(settingsPost, "/api/admin/after-dark/settings", body, cookie);
async function admin() {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  return { id, cookie: signedIn(id) };
}
const reply = JSON.stringify({ lines: [{ who: "a", text: "You came." }, { who: "b", text: "I said I would." }], explicit: false, picture: null });

describe("the model a step was written by", () => {
  it("is what the response says answered, when it says (OpenRouter's model and host)", async () => {
    const served: { model: string | null; provider: string | null }[] = [];
    const model = openAICompatibleModel({
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "placeholder",
      model: "deepseek/deepseek-chat-v3.1",
      retryDelaysMs: [],
      fetchImpl: async () => Response.json({ model: "deepseek/deepseek-chat-v3.1-0821", provider: "DeepInfra", choices: [{ message: { content: "{}" } }] }),
    });
    await model.complete([{ role: "user", content: "hi" }], { onServed: (s) => served.push(s) });
    expect(served).toEqual([{ model: "deepseek/deepseek-chat-v3.1-0821", provider: "DeepInfra" }]);
    const quiet = openAICompatibleModel({ baseUrl: "https://example.test/v1", apiKey: "k", model: "m", retryDelaysMs: [], fetchImpl: async () => Response.json({ choices: [{ message: { content: "{}" } }] }) });
    await quiet.complete([{ role: "user", content: "hi" }], { onServed: (s) => served.push(s) });
    expect(served[1]).toEqual({ model: null, provider: null });
  });

  it("is recorded on each step: the reported id and host, else the model asked for; and shown on the why view", async () => {
    const { cookie } = await admin();
    await settings({ enabled: true, openrouter_key: "placeholder-text-ABCD" }, cookie);
    // A step whose response names the model and host it was routed to.
    setAdultModelForTests({
      complete: async (_m, o?: ModelOptions) => {
        o?.onServed?.({ model: "deepseek/deepseek-chat-v3.1-0821", provider: "DeepInfra" });
        return reply;
      },
    });
    expect((await call(POST, "/api/admin/after-dark", { a: RAFE, b: JUNIPER }, cookie)).status).toBe(200);
    // One whose response doesn't say: the model it asked for, their writer (GLM-4.6 unless they picked another).
    setAdultModelForTests({ complete: async () => reply.replace("You came.", "Here you are.").replace("I said I would.", "Of course.") }, "deepseek/deepseek-chat-v3.1");
    expect((await call(POST, "/api/admin/after-dark", { a: RAFE, b: JUNIPER }, cookie)).status).toBe(200);
    const rows = (await t.db.query<{ text_model: string; text_provider: string | null }>(`select text_model, text_provider from adult_steps where kind = 'write' order by created_at`)).rows;
    expect(rows).toEqual([
      { text_model: "deepseek/deepseek-chat-v3.1-0821", text_provider: "DeepInfra" },
      { text_model: "z-ai/glm-4.6", text_provider: null },
    ]);
    const why = await (await whyGet(new Request(`${BASE_URL}/api/admin/after-dark/why?a=${RAFE}&b=${JUNIPER}`, { headers: { cookie } }))).json();
    const notes = why.notes ?? why;
    expect(notes.current.steps.map((s: { text_model: string }) => s.text_model)).toEqual(["deepseek/deepseek-chat-v3.1-0821", "z-ai/glm-4.6"]);
    expect(notes.current.written_by).toMatchObject({ models: ["deepseek/deepseek-chat-v3.1-0821", "z-ai/glm-4.6"], providers: ["DeepInfra"], source: "steps" });
    // And over MCP, per chapter.
    const scene = (await runAdultTool(t.db, "after_dark_scene", { a: RAFE, b: JUNIPER })) as { data: { written_by: { chapter: number; models: string[] }[] } };
    expect(scene.data.written_by[0]).toMatchObject({ chapter: 1, models: ["deepseek/deepseek-chat-v3.1-0821", "z-ai/glm-4.6"] });
  });
});

describe("the settings history", () => {
  it("keeps each change to a model or the provider, with who made it, from the page and from MCP; nothing else", async () => {
    const { id, cookie } = await admin();
    await settings({ enabled: true, openrouter_key: "placeholder-text-ABCD", text_temperature: 0.7 }, cookie);
    expect(await settingsHistory(t.db)).toEqual([]);
    await settings({ text_model: "mistralai/mistral-large" }, cookie);
    await settings({ text_model: "mistralai/mistral-large" }, cookie); // no change: nothing new
    await runAdultTool(t.db, "after_dark_settings", { media_provider: "replicate", text_model: "deepseek/deepseek-chat-v3.1" });
    const history = await settingsHistory(t.db);
    // Newest first; one save's changes are written in HISTORY_FIELDS order.
    expect(history.map(({ field, from_value, to_value, by }) => ({ field, from_value, to_value, by }))).toEqual([
      { field: "media_provider", from_value: "venice", to_value: "replicate", by: "mcp" },
      { field: "text_model", from_value: "mistralai/mistral-large", to_value: "deepseek/deepseek-chat-v3.1", by: "mcp" },
      { field: "text_model", from_value: "deepseek/deepseek-chat-v3.1", to_value: "mistralai/mistral-large", by: id },
    ]);
    expect(history.every((h) => /^\d{4}-\d\d-\d\dT/.test(h.at))).toBe(true);
    expect(JSON.stringify(history)).not.toContain("placeholder");
  });

  it("says which text model was set at a time: the change before it, or what the first change replaced", () => {
    const h = [
      { field: "text_model" as const, from_value: "a/old", to_value: "b/mid", at: "2026-10-20T00:00:00.000Z", by: null },
      { field: "text_model" as const, from_value: "b/mid", to_value: "c/new", at: "2026-10-22T00:00:00.000Z", by: null },
    ];
    expect(textModelAt(h, "2026-10-19T00:00:00.000Z")).toBe("a/old");
    expect(textModelAt(h, "2026-10-21T00:00:00.000Z")).toBe("b/mid");
    expect(textModelAt(h, "2026-10-23T00:00:00.000Z")).toBe("c/new");
    expect(textModelAt([], "2026-10-23T00:00:00.000Z")).toBeNull();
    expect(writtenBy([], "2026-10-10T00:00:00.000Z", [])).toMatchObject({ models: [], source: "none", note: "before model logging" });
    expect(writtenBy([{ text_model: null }], "2026-10-22T10:00:00.000Z", [])).toMatchObject({ source: "none", note: "not recorded" });
    expect(writtenBy([], "2026-10-21T00:00:00.000Z", h)).toMatchObject({ models: ["b/mid"], source: "history" });
    expect(writtenByLabel(writtenBy([{ text_model: "c/new", text_provider: "DeepInfra" }], STEP_LOGGING_FROM, h))).toBe("c/new (DeepInfra)");
  });
});

describe("the graph page's payload", () => {
  it("gives each chapter's model from its steps, and 'before model logging' or 'not recorded' when nothing says", async () => {
    const q = (sql: string, args: unknown[]) => t.db.query(sql, args);
    await q(`insert into adult_scenes (id, owner_id, character_a, character_b, lines, chapter) values ('s1', 'admin', $1, $2, '[]'::jsonb, 4)`, [RAFE, JUNIPER]);
    await q(
      `insert into adult_nights (id, owner_id, character_a, character_b, lines, place, stage, chapter, created_at) values
         ('old', 'admin', $1, $2, '[]'::jsonb, 'the pier', 1, 1, '2026-10-10T20:00:00Z'),
         ('unlogged', 'admin', $1, $2, '[]'::jsonb, 'the pier', 1, 2, '2026-10-22T20:00:00Z'),
         ('logged', 'admin', $1, $2, '[]'::jsonb, 'her flat', 3, 3, '2026-10-23T20:00:00Z')`,
      [RAFE, JUNIPER],
    );
    await q(
      `insert into adult_steps (id, owner_id, character_a, character_b, scene_id, night_id, chapter, kind, status, text_model, text_provider) values
         ('st1', 'admin', $1, $2, 's1', 'unlogged', 2, 'write', 'ok', null, null),
         ('st2', 'admin', $1, $2, 's1', 'logged', 3, 'write', 'ok', 'deepseek/deepseek-chat-v3.1', 'DeepInfra'),
         ('st3', 'admin', $1, $2, 's1', 'logged', 3, 'write', 'ok', 'deepseek/deepseek-chat-v3.1', 'CoreWeave'),
         ('st4', 'admin', $1, $2, 's1', null, 4, 'write', 'ok', 'mistralai/mistral-large', null)`,
      [RAFE, JUNIPER],
    );
    const c = (await pairContent(t.db, RAFE, JUNIPER))!;
    const by = Object.fromEntries(c.nights.map((n) => [n.id, n.written_by]));
    expect(by.logged).toEqual({ models: ["deepseek/deepseek-chat-v3.1"], providers: ["DeepInfra", "CoreWeave"], source: "steps", note: null });
    expect(by.unlogged).toMatchObject({ models: [], source: "none", note: "not recorded" });
    expect(by.old).toMatchObject({ models: [], source: "none", note: "before model logging" });
    expect(c.scene).toMatchObject({ chapter: 4, written_by: { models: ["mistralai/mistral-large"], source: "steps" } });
    // With a change in the history, an old chapter reads the model set at the time.
    await q(`insert into adult_settings_history (id, field, from_value, to_value, at) values ('h1', 'text_model', 'mistralai/mistral-large', 'deepseek/deepseek-chat-v3.1', '2026-10-21T00:00:00Z')`, []);
    const again = (await pairContent(t.db, RAFE, JUNIPER))!;
    expect(again.nights.find((n) => n.id === "old")!.written_by).toMatchObject({ models: ["mistralai/mistral-large"], source: "history" });
    expect(again.nights.find((n) => n.id === "unlogged")!.written_by).toMatchObject({ models: ["deepseek/deepseek-chat-v3.1"], source: "history" });
  });
});
