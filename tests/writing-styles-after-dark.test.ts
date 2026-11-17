// The narrated style in After Dark, end to end (lib/adult/scenes.ts writeScene, lib/adult/narrate-scene.ts): a step's new
// lines come back with their prose, the prose is kept with the night, the step counts once like any other, and what
// narrating cost is on the step's log. On the script nothing changes.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/admin/after-dark/route";
import { POST as storyPost } from "@/app/api/admin/after-dark/story/route";
import { POST as stylePost } from "@/app/api/admin/after-dark/writing-style/route";
import { adultStyleFor } from "@/lib/adult/narrate-scene";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { claimAdmin } from "@/lib/admins";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import type { ChatMessage } from "@/lib/model";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { setSetsFetchForTests } from "@/lib/sets";
import { setStyle } from "@/lib/writing-style";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

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
const signedIn = (userId: string) => sessionCookies({ userId, authenticated: true })[0].split(";")[0];
const post = (body: unknown, cookie: string) =>
  POST(new Request(`${BASE_URL}/api/admin/after-dark`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));
const story = (body: unknown, cookie: string) =>
  storyPost(new Request(`${BASE_URL}/api/admin/after-dark/story`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }));
async function admin() {
  const id = userIdOf(newUserCookie());
  await claimAdmin(t.db, id);
  return { id, cookie: signedIn(id) };
}

const LINES = { lines: [{ who: "a", action: "smiles", text: "Fancy seeing you here tonight.", why: "the moment" }, { who: "b", action: "", text: "I could say the same about you.", why: "the moment" }], place: "the bar", stage: 1 };
const isNarrator = (m: ChatMessage[]) => m[0].content.startsWith("You are the narrator of a story told in dialogue");
const isStory = (m: ChatMessage[]) => m[0].content.startsWith("You turn a transcript");

/** The writer answers with LINES, the narrator with `beats`, the storyteller with a story; every call is counted. */
function models(beats: unknown) {
  const seen = { narrator: 0, story: 0, other: 0 };
  setAdultModelForTests({
    complete: async (m) => {
      if (isNarrator(m)) return seen.narrator++, JSON.stringify(beats);
      if (isStory(m)) return seen.story++, JSON.stringify({ title: "The bar", paragraphs: ["She found him at the bar.", "He had been waiting."] });
      return seen.other++, JSON.stringify(LINES);
    },
  });
  return seen;
}
const writes = async (id: string) => (await t.db.query<{ writes: number }>(`select writes from adult_usage where owner_id = $1`, [id])).rows[0]?.writes ?? 0;

describe("a narrated After Dark step", () => {
  it("comes back with its prose, keeps it with the night, counts one step like any other and logs what narrating did", async () => {
    const { id, cookie } = await admin();
    await setStyle(t.db, id, "adult", "narrated");
    const seen = models({ beats: [{ n: 1, before: "She leaned on the bar and let him see her looking.", after: "" }, { n: 2, before: "", after: "He turned his glass a quarter turn." }] });
    const res = await post({ a: CAST_A, b: CAST_B }, cookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scene.lines.map((l: { beat?: unknown }) => l.beat)).toEqual([
      { before: "She leaned on the bar and let him see her looking.", after: "" },
      { before: "", after: "He turned his glass a quarter turn." },
    ]);
    // The words themselves are as the writer wrote them.
    expect(body.scene.lines[0].text).toContain("Fancy seeing you here tonight.");
    expect(seen.narrator).toBe(1);
    const stored = (await t.db.query<{ lines: { beat?: { before: string } }[] }>(`select lines from adult_scenes where owner_id = $1`, [id])).rows[0];
    expect(stored.lines[0].beat?.before).toBe("She leaned on the bar and let him see her looking.");
    // One scene step: narration comes with the subscription (lib/writing-style.ts).
    expect(await writes(id)).toBe(1);
    // The step's log says what narrating did (the update is fire-and-forget: give it a turn).
    await new Promise((r) => setTimeout(r, 20));
    const flags = (await t.db.query<{ flags: { narration?: { beats: number; of: number } } }>(`select flags from adult_steps where owner_id = $1 and kind = 'write'`, [id])).rows[0].flags;
    expect(flags.narration).toMatchObject({ beats: 2, of: 2, failed: false });
  });

  it("drops prose that brings in family or anyone young, and that line stays a script line", async () => {
    const { id, cookie } = await admin();
    await setStyle(t.db, id, "adult", "narrated");
    models({ beats: [{ n: 1, before: "She smiled the way her sister always did.", after: "" }, { n: 2, before: "He set his glass down.", after: "" }] });
    const body = await (await post({ a: CAST_A, b: CAST_B }, cookie)).json();
    expect(body.scene.lines.map((l: { beat?: unknown }) => l.beat ?? null)).toEqual([null, { before: "He set his glass down.", after: "" }]);
  });

  it("on the script: no narrator call, no prose, one step", async () => {
    const { id, cookie } = await admin();
    const seen = models({ beats: [] });
    const body = await (await post({ a: CAST_A, b: CAST_B }, cookie)).json();
    expect(body.scene.lines.every((l: { beat?: unknown }) => l.beat === undefined)).toBe(true);
    expect(seen.narrator).toBe(0);
    expect(await writes(id)).toBe(1);
  });

  it("tonight's chapter told as a story: made once, kept, and read again without another call", async () => {
    const { cookie } = await admin();
    const seen = models({ beats: [] });
    await post({ a: CAST_A, b: CAST_B }, cookie);
    const first = await (await story({ a: CAST_A, b: CAST_B, chapter: "now" }, cookie)).json();
    expect(first).toMatchObject({ made: true, story: { title: "The bar", paragraphs: ["She found him at the bar.", "He had been waiting."] } });
    const again = await (await story({ a: CAST_A, b: CAST_B, chapter: "now" }, cookie)).json();
    expect(again.made).toBe(false);
    expect(seen.story).toBe(1);
  });

  it("After Dark has its own style route: an admin picks narrated there, and anyone it's closed to gets 404", async () => {
    const { id, cookie } = await admin();
    const set = (c: string, style: string) =>
      stylePost(new Request(`${BASE_URL}/api/admin/after-dark/writing-style`, { method: "POST", headers: { "content-type": "application/json", cookie: c }, body: JSON.stringify({ style }) }));
    const ok = await set(cookie, "narrated");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ styles: { show: "script", adult: "narrated" } });
    expect(await adultStyleFor(t.db, id)).toBe("narrated");
    expect((await set(newUserCookie(), "narrated")).status).toBe(404);
  });

  it("the story route is the same 404 for anyone After Dark isn't open to", async () => {
    expect((await story({ a: CAST_A, b: CAST_B, chapter: "now" }, newUserCookie())).status).toBe(404);
  });
});
