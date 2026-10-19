import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/admin/after-dark/route";
import { adultModeEnabled, setAdultModelForTests } from "@/lib/adult/mode";
import { parseSceneLines } from "@/lib/adult/scenes";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import { checkAdultText } from "@/lib/safety";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { api, BASE_URL, newUserCookie, startTestDb, userIdOf, validCharacter } from "./helpers";

// After dark (lib/adult): admin only, local only, this season's cast only, and nothing it writes reaches the show.
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

const [CAST_A, CAST_B] = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id];
const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
const post = (body: unknown, cookie?: string) =>
  POST(new Request(`${BASE_URL}/api/admin/after-dark`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }));
const get = (a: string, b: string, cookie?: string) => GET(new Request(`${BASE_URL}/api/admin/after-dark?a=${a}&b=${b}`, { headers: cookie ? { cookie } : {} }));
const scripted = (reply: string) => setAdultModelForTests({ complete: async () => reply });

async function admin() {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  return { id, cookie: signedIn(id) };
}

describe("the gate", () => {
  it("is off without ADULT_MODE=1, and always off on Vercel", () => {
    expect(adultModeEnabled({ ADULT_MODE: "1" })).toBe(true);
    expect(adultModeEnabled({})).toBe(false);
    expect(adultModeEnabled({ ADULT_MODE: "1", VERCEL: "1" })).toBe(false);
    expect(adultModeEnabled({ ADULT_MODE: "1", VERCEL_ENV: "production" })).toBe(false);
  });

  it("is not found for a stranger, a non-admin, an old unsigned cookie, and the admin when it's on Vercel", async () => {
    const { id, cookie } = await admin();
    expect((await get(CAST_A, CAST_B)).status).toBe(404);
    expect((await get(CAST_A, CAST_B, signedIn(userIdOf(newUserCookie())))).status).toBe(404);
    expect((await get(CAST_A, CAST_B, `bz_uid=${id}`)).status).toBe(404);
    expect((await get(CAST_A, CAST_B, cookie)).status).toBe(200);
    vi.stubEnv("VERCEL", "1");
    expect((await get(CAST_A, CAST_B, cookie)).status).toBe(404);
  });

  it("is this season's cast only: anyone's own character, or a character with itself, is not found", async () => {
    const { cookie } = await admin();
    const own = await (await api.createCharacter(validCharacter({ name: "Chud Crusher" }), newUserCookie())).json();
    expect((await get(CAST_A, own.id, cookie)).status).toBe(404);
    expect((await get(CAST_A, CAST_A, cookie)).status).toBe(404);
  });
});

describe("the two lines that never move", () => {
  it("adult content between adults passes; a minor or a real person never does", () => {
    expect(checkAdultText({ line: "She pulls him onto the bed and they stop talking for a while." }).ok).toBe(true);
    expect(checkAdultText({ line: "She looks like a schoolgirl" })).toMatchObject({ ok: false, reason: "minor" });
    expect(checkAdultText({ line: "back when she was fifteen" })).toMatchObject({ ok: false, reason: "minor" });
    expect(checkAdultText({ line: "She was fifteen when she first did this." })).toMatchObject({ ok: false, reason: "minor" });
    expect(checkAdultText({ line: "he turned 17 last spring" })).toMatchObject({ ok: false, reason: "minor" });
    expect(checkAdultText({ line: "He looks just like Taylor Swift" })).toMatchObject({ ok: false, reason: "real_person" });
    // Times and amounts are not ages.
    expect(checkAdultText({ line: "She was ten minutes late and it was eleven o'clock." }).ok).toBe(true);
    expect(checkAdultText({ line: "They were twelve feet from the door." }).ok).toBe(true);
  });
});

describe("a scene", () => {
  it("writes the next lines on the after-dark model, drops any that cross a line, and keeps them out of the show", async () => {
    const { cookie } = await admin();
    scripted(
      JSON.stringify({
        lines: [
          { who: "a", text: "Your place or mine?" },
          { who: "b", text: "Mine. It's closer." },
          { who: "a", text: "She was fifteen when she first did this." },
        ],
      }),
    );
    const res = await post({ a: CAST_A, b: CAST_B, direction: "they share a cab home" }, cookie);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ added: 2, held: 1 });
    expect(body.scene.lines.map((l: { text: string }) => l.text)).toEqual(["Your place or mine?", "Mine. It's closer."]);
    // Nothing of it in any date, any texts, the characters' memory, or the feed.
    const everywhere = await t.db.query<{ t: string }>(
      `select coalesce((select string_agg(transcript::text, ' ') from episodes), '') ||
              coalesce((select string_agg(text, ' ') from couple_texts), '') ||
              coalesce((select string_agg(m::text, ' ') from character_memory m), '') as t`,
    );
    expect(everywhere.rows[0].t).not.toContain("Your place or mine");
    expect(JSON.stringify(await (await api.feed()).json())).not.toContain("Your place or mine");
  });

  it("refuses a steer that crosses a line, and starts over on request", async () => {
    const { cookie } = await admin();
    scripted(JSON.stringify({ lines: [{ who: "a", text: "Hello." }] }));
    expect((await post({ a: CAST_A, b: CAST_B, direction: "make her sixteen" }, cookie)).status).toBe(422);
    await post({ a: CAST_A, b: CAST_B }, cookie);
    const reset = await (await post({ a: CAST_A, b: CAST_B, reset: true }, cookie)).json();
    expect(reset.scene.lines).toEqual([]);
  });

  it("reads the shapes small local models reply in", () => {
    const names = { a: "Ada Lumen", b: "Bo Quill" };
    const want = [
      { who: "a", text: "Hi." },
      { who: "b", text: "Hello there." },
    ];
    expect(parseSceneLines(JSON.stringify({ lines: [{ who: "a", text: "Hi." }, { who: "b", text: "Hello there." }] }), names)).toEqual(want);
    expect(parseSceneLines('{\n"Ada": "Hi.",\n"Bo": "Hello there."\n}', names)).toEqual(want);
    expect(parseSceneLines("Ada: Hi.\nBo: Hello there.\n(narration)", names)).toEqual(want);
  });
});
