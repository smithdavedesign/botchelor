import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/admin/after-dark/route";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { setWriter } from "@/lib/adult/writer";
import { FALLBACK_WRITER } from "@/lib/adult/writer-config";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import { ModelError, type ChatMessage } from "@/lib/model";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { setSetsFetchForTests } from "@/lib/sets";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// The audit, 2026-10-31: GLM-4.6 hit an OpenRouter 429 mid-scene and the step died 502 — the fallback only covered an
// empty reply, not a rate-limit / 5xx / timeout. Now those go to the fast writer too, so the step doesn't fail.
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

/** A writer that throws `err` the first `fails` write calls, then writes lines (the fallback reuses the same mock). */
function writer(fails: number, err: () => Error) {
  let n = 0;
  setAdultModelForTests({
    complete: async (m: ChatMessage[]) => {
      if (/running recap|factual memory|what a private night left behind/.test(m[0].content)) return "{}";
      if (n++ < fails) throw err();
      return LINES;
    },
  } as never);
}
async function step() {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  await setWriter(t.db, id, "z-ai/glm-4.6");
  const cookie = sessionCookies({ userId: id, authenticated: true })[0].split(";")[0];
  return POST(new Request(`${BASE_URL}/api/admin/after-dark`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ a: CAST_A, b: CAST_B }) }));
}
const lastFlags = async () => (await t.db.query<{ flags: Record<string, unknown> }>(`select flags from adult_steps where kind = 'write' order by created_at desc limit 1`)).rows[0].flags;

describe("a writer that is rate-limited or down", () => {
  it("falls straight to the fast writer on a 429, and the step succeeds", async () => {
    writer(1, () => new ModelError("model returned HTTP 429 (rate limited)", 429));
    const res = await step();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scene.lines).toHaveLength(2);
    const flags = await lastFlags();
    expect(flags.fell_back_to).toBe(FALLBACK_WRITER);
    expect(flags.fell_back_limit).toBe("rate");
    // Not an empty-reply retry: it never got an empty reply.
    expect(flags.empty_text_retry).toBeUndefined();
  });

  it("falls back on a 5xx too", async () => {
    writer(1, () => new ModelError("model returned HTTP 503 (service unavailable)", 503));
    const res = await step();
    expect(res.status).toBe(200);
    const flags = await lastFlags();
    expect(flags.fell_back_to).toBe(FALLBACK_WRITER);
    expect(flags.fell_back_limit).toBe("down");
  });

  it("still fails the step (502) when the fast writer is down too", async () => {
    // Every call throws a 429, including the fallback's: nothing to fall back to, so the step fails rather than hang.
    writer(99, () => new ModelError("model returned HTTP 429 (rate limited)", 429));
    const res = await step();
    expect(res.status).toBe(502);
  });
});
