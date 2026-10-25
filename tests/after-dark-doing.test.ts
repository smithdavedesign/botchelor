import { describe, expect, it } from "vitest";
import { carryDoing, cleanDoing, DOING_MAX } from "@/lib/adult/doing";
import { parseSceneLines, type SceneLine } from "@/lib/adult/scenes";

// David, 2026-10-25: "let the writer choose what it says they're doing and update when they switch actions".
describe("what they're doing, in the writer's words", () => {
  it("keeps a few plain words, held to the lines, and nothing else", () => {
    expect(cleanDoing("Sizing up the smug couple.")).toBe("sizing up the smug couple");
    expect(cleanDoing("*slow dancing* in the kitchen")).toBe("slow dancing in the kitchen");
    for (const v of [null, 3, "", "none", "same", "N/A"]) expect(cleanDoing(v)).toBeNull();
    expect(cleanDoing("pretending she's sixteen")).toBeNull();
    const long = cleanDoing("arguing over who gets the very last slice of the enormous chocolate cake at the bar");
    expect(long!.length).toBeLessThanOrEqual(DOING_MAX);
    expect(long).not.toMatch(/\s\S{0,2}$/);
  });

  it("is read from each line the writer marks, and carried onto the lines after it", () => {
    const reply = JSON.stringify({
      lines: [
        { who: "a", action: "slides into the booth", text: "So.", doing: "sizing up the smug couple" },
        { who: "b", text: "So." },
        { who: "a", action: "grabs her hand", text: "Run.", doing: "escaping out the back" },
        { who: "b", text: "Right behind you." },
      ],
    });
    const parsed = parseSceneLines(reply, { a: "Lexi", b: "Juniper" });
    expect(parsed.map((l) => l.doing ?? null)).toEqual(["sizing up the smug couple", null, "escaping out the back", null]);
    expect(carryDoing(parsed, null).map((l) => l.doing)).toEqual(["sizing up the smug couple", "sizing up the smug couple", "escaping out the back", "escaping out the back"]);
    // A step that doesn't say carries on with the scene's last.
    const alone: SceneLine[] = [{ who: "a", text: "Hi." }];
    expect(carryDoing(alone, "slow dancing").map((l) => l.doing)).toEqual(["slow dancing"]);
  });
});

import { afterAll, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { GET as whyGet } from "@/app/api/admin/after-dark/why/route";
import { POST } from "@/app/api/admin/after-dark/route";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { roleplayById } from "@/lib/adult/roleplays";
import { sceneMessages } from "@/lib/adult/scenes";
import { claimAdmin } from "@/lib/admins";
import { loadCharacter } from "@/lib/character";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import type { ChatMessage } from "@/lib/model";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { setSetsFetchForTests } from "@/lib/sets";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

// David, 2026-10-25: Star × Rafe's "Captain and pilot" on a tandem skydive was never played, and the /why transcript
// didn't show the roleplay as a reason for anything.
describe("a roleplay the writer plays, and the transcript shows", () => {
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

  it("leads the pace-and-place rules with the roleplay, who plays whom, and the place inside it; the why cites it", async () => {
    const [a, b] = await Promise.all([loadCharacter(t.db, CAST_A), loadCharacter(t.db, CAST_B)]);
    const rp = roleplayById("starship")!;
    const text = sceneMessages(a, b, null, [], null, a!.id, {
      place: "A tandem skydive at 13,000 feet",
      set: "A tandem skydive at 13,000 feet",
      stage: 0,
      profile: { turnOns: { a: [], b: [] }, framing: null, scenario: null, roleplay: { rp, swap: false } },
    })
      .map((m) => m.content)
      .join("\n");
    const [x, y] = [a!.name, b!.name].map((n) => n.split(/\s+/)[0]);
    expect(text).toContain(`- This chapter is the roleplay the viewer chose: Captain and pilot. ${x} plays the captain, ${y} the pilot. Every line plays it`);
    expect(text).toContain("A tandem skydive at 13,000 feet becomes part of it");
    expect(text).toContain(`each "why" also says how the line plays it`);
    expect(text).toContain("in the roleplay's own terms");
  });

  it("/why shows the chapter's roleplay and which steps were written in it", async () => {
    const id = userIdOf(newUserCookie());
    await claimAdmin(t.db, id);
    const cookie = sessionCookies({ userId: id, authenticated: true })[0].split(";")[0];
    const post = (body: unknown) => POST(new Request(`${BASE_URL}/api/admin/after-dark`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ a: CAST_A, b: CAST_B, ...(body as object) }) }));
    setAdultModelForTests({
      complete: async (m: ChatMessage[]) =>
        /running recap|factual memory|what a private night left behind/.test(m[0].content)
          ? "{}"
          : JSON.stringify({ lines: [{ who: "a", text: "*checks the instruments* Steady, pilot.", why: "She plays the captain.", doing: "flying the night shift" }, { who: "b", text: "Aye, captain." }] }),
    } as never);
    expect((await post({ roleplay: { id: "starship", swap: false } })).status).toBe(200);
    expect((await post({})).status).toBe(200);
    const why = await (await whyGet(new Request(`${BASE_URL}/api/admin/after-dark/why?a=${CAST_A}&b=${CAST_B}`, { headers: { cookie } }))).json();
    expect(why.current.roleplay).toMatchObject({ id: "starship", title: "Captain and pilot", roles: expect.stringMatching(/plays the captain/) });
    expect(why.current.roleplay.premise).toMatch(/^Months into a deep-space voyage, \w+, the captain/);
    expect(why.current.steps.find((s: { kind: string }) => s.kind === "write").flags.roleplay).toEqual({ id: "starship", swap: false });
  });
});
