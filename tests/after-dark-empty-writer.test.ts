import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/admin/after-dark/route";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { FALLBACK_WRITER } from "@/lib/adult/writer-config";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import { ModelError, openAICompatibleModel, type ChatMessage } from "@/lib/model";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { setSetsFetchForTests } from "@/lib/sets";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// 2026-10-25: GLM-4.6 sent back no text on 5 of 18 steps in six hours, each one an error the owner had to retry.
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
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", "a-test-session-secret-that-is-long-enough-0123456789");
  vi.stubEnv("ADULT_MODE", "1");
  setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
  setSetsFetchForTests(async () => new Response("no", { status: 500 }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setAdultModelForTests(null);
  setSeasonCastForTests(null);
  setSetsFetchForTests(null);
});

const [CAST_A, CAST_B] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id].sort();
const LINES = JSON.stringify({ lines: [{ who: "a", text: "*leans on the rail* The tide's turning." }, { who: "b", text: "*grins* So are you." }] });
/** A writer that sends back nothing `empties` times, then lines. */
function writer(empties: number) {
  let n = 0;
  setAdultModelForTests({
    complete: async (m: ChatMessage[]) => {
      if (/running recap|factual memory|what a private night left behind/.test(m[0].content)) return "{}";
      if (n++ < empties) throw new ModelError("model returned no text (finish_reason: length)");
      return LINES;
    },
  } as never);
}
async function step() {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  const cookie = sessionCookies({ userId: id, authenticated: true })[0].split(";")[0];
  return POST(new Request(`${BASE_URL}/api/admin/after-dark`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ a: CAST_A, b: CAST_B }) }));
}
const lastFlags = async () => (await t.db.query<{ flags: Record<string, unknown> }>(`select flags from adult_steps where kind = 'write' order by created_at desc limit 1`)).rows[0].flags;

describe("a writer that sends back nothing", () => {
  it("is asked once more", async () => {
    writer(1);
    expect((await step()).status).toBe(200);
    expect(await lastFlags()).toMatchObject({ empty_text_retry: true });
    expect((await lastFlags()).fell_back_to).toBeUndefined();
  });

  it("twice: the fallback writes the step instead of it failing", async () => {
    writer(2);
    const res = await step();
    expect(res.status).toBe(200);
    expect((await res.json()).scene.lines).toHaveLength(2);
    expect(await lastFlags()).toMatchObject({ empty_text_retry: true, fell_back_to: FALLBACK_WRITER });
  });

  it("three times: the step fails, saying why", async () => {
    writer(3);
    const res = await step();
    expect(res.status).toBe(502);
    expect((await res.json()).message).toMatch(/no text \(finish_reason: length\)/);
  });

  it("the error says why there was no text", async () => {
    const fetchImpl = (async () => Response.json({ choices: [{ message: { content: "" }, finish_reason: "length" }] })) as typeof fetch;
    const m = openAICompatibleModel({ baseUrl: "https://llm.example/v1", apiKey: "placeholder", model: "z-ai/glm-4.6", fetchImpl });
    await expect(m.complete([{ role: "user", content: "hi" }])).rejects.toThrow("model returned no text (finish_reason: length)");
  });
});
