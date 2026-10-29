import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as assetGet } from "@/app/api/assets/[id]/route";
import { GET as adminGet, POST as adminPost } from "@/app/api/admin/season/route";
import { HIVE_VLM, setCheckFetchForTests } from "@/lib/adult/check";
import { setMediaFetchForTests } from "@/lib/adult/media";
import { saveAdultSettings } from "@/lib/adult/settings";
import { claimAdmin } from "@/lib/admins";
import { loadCharacter } from "@/lib/character";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import { ensureSeasonCast, refreshSeasonCast, resetStoredSeasonCastForTests, seasonCastCards, seasonCastIds, setSeasonCastForTests } from "@/lib/season-cast";
import { CANDIDATES, generateCandidates, listCandidates, NEWCOMERS, parseDraft, reviewCandidate, seasonGenerationDue } from "@/lib/season-gen";
import { getDirectorModel, type Model } from "@/lib/model";
import { BASE_URL, newUserCookie, scriptedModel, startTestDb, userIdOf } from "./helpers";

/** The model, scripted with these replies. */
const script = (outputs: string[]): Model => {
  scriptedModel(outputs);
  return getDirectorModel();
};

// Each month's newcomers (lib/season-gen.ts): written by the model, painted on Venice, checked by Hive, reviewed.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  setSeasonCastForTests(HOUSE_CHARACTERS.map((c) => c.id));
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  resetStoredSeasonCastForTests();
  vi.stubEnv("SESSION_SECRET", "a-test-session-secret-that-is-long-enough-0123456789");
});
afterEach(() => {
  vi.unstubAllEnvs();
  setMediaFetchForTests(null);
  setCheckFetchForTests(null);
});

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64");

function draft(name: string, overrides: Record<string, unknown> = {}) {
  return {
    name,
    age: 38,
    pronouns: "she/her",
    bio: "A ferry captain who narrates the weather to her passengers like a sports commentator. Has never once been seasick, and brags.",
    traits: ["bold", "chatty", "steady"],
    want: "Someone who laughs at her forecasts",
    dealbreaker: "People who clap when the boat lands",
    archetype: "The commentator",
    voice: "Fast, booming play-by-play: everything is a match, everyone is a player, and she scores the room out loud.",
    appearance: "salt in her hair, a captain's whistle she never blows",
    look: "a woman in her late thirties with deep brown skin, short grey-streaked locs and a broad grin, in a navy pea coat",
    hue: 210,
    signals: { warmth: 0.7, openness: 0.6, guardedness: 0.2, humor: 0.8 },
    soul: {
      values: "Showing up every day, rain or not.",
      insecurities: "That she talks so nobody notices she's lonely.",
      humor: "Commentary on everything, especially herself.",
      boundaries: "Don't touch the wheel.",
      romantic: "Wants someone to sit up front with her at dawn.",
      communication: "Loud first, honest second, tender eventually.",
    },
    kit: {
      occupation: "Ferry captain",
      hobbies: ["Weather", "Darts", "Karaoke"],
      prompts: [{ id: "win_me_over", answer: "Beat me at darts. Nobody has." }],
      lines: { hello: "And she's aboard! What a start!", dodge: "Ooh, a deflection from the visitor!", flirt: "That's a goal, folks.", upset: "Penalty. Penalty!" },
      tells: { nervous: "commentate faster", smitten: "go quiet", bored: "check the horizon", annoyed: "blow the whistle, finally" },
      never_says: ["I'm not a people person"],
    },
    ...overrides,
  };
}

/** Venice gives back a picture; Hive says everyone's an adult (or what a test passes). */
function fakeProviders(vlm = "ADULTS") {
  const venice: string[] = [];
  setMediaFetchForTests(async (input: RequestInfo | URL, init?: RequestInit) => {
    venice.push(String(JSON.parse(String(init?.body)).safe_mode));
    return Response.json({ images: [PNG] });
  });
  setCheckFetchForTests(async (input: RequestInfo | URL) =>
    Response.json(
      String(input) === HIVE_VLM
        ? { choices: [{ message: { content: vlm } }] }
        : { output: [{ classes: [{ class: "yes_child_present", value: 0.01 }, { class: "no_child_present", value: 0.99 }] }] },
    ),
  );
  return venice;
}

// Hive checks the portraits here (pg_via "hive"): with Venice's key saved, "auto" would send them to its check.
const keys = () => saveAdultSettings(t.db, { venice_key: "placeholder-venice", hive_key: "placeholder-hive", moderation: { pg_via: "hive" } });

describe("writing a candidate", () => {
  it("takes a full draft, and refuses a minor, a real person, a taken name or bad JSON", () => {
    expect(parseDraft(JSON.stringify(draft("Odessa Brine")), ["Rafe Calloway"]).ok).toBe(true);
    expect(parseDraft(JSON.stringify(draft("Odessa Brine", { bio: "She's 17 and runs the ferry with her dad. Loves the sea more than anything." })), [])).toMatchObject({ ok: false, reason: expect.stringMatching(/minor/) });
    expect(parseDraft(JSON.stringify(draft("Odessa Brine", { want: "To meet Taylor Swift" })), [])).toMatchObject({ ok: false, reason: expect.stringMatching(/real_person/) });
    expect(parseDraft(JSON.stringify(draft("Rafe Moss")), ["Rafe Calloway"])).toMatchObject({ ok: false, reason: expect.stringMatching(/name taken/) });
    expect(parseDraft(JSON.stringify(draft("Odessa Brine", { age: 19 })), [])).toMatchObject({ ok: false });
    expect(parseDraft("not json at all", [])).toEqual({ ok: false, reason: "not JSON" });
  });

  it("stores the sheet, kit, soul and look; paints a PG portrait (safe mode) that's served only once approved", async () => {
    await keys();
    const venice = fakeProviders();
    const model = script([JSON.stringify(draft("Odessa Brine")), JSON.stringify(draft("Bram Tolliver", { pronouns: "he/him" })), JSON.stringify(draft("Wynn Arbor"))]);
    const r = await generateCandidates(t.db, "2026-11-01", model);
    expect(r).toEqual({ made: ["house-odessa", "house-bram", "house-wynn"], errors: [] });
    expect(venice).toEqual(["true", "true", "true"]);

    const c = (await loadCharacter(t.db, "house-odessa"))!;
    expect(c).toMatchObject({ house: true, ownerId: null, name: "Odessa Brine", pronouns: "she/her", look: { physical: expect.stringMatching(/grey-streaked locs/) } });
    expect(c.extras?.lines?.hello).toBe("And she's aboard! What a start!");
    expect(c.soul?.values).toMatch(/Showing up/);
    expect(c.baseSignals.humor).toBeGreaterThan(0.5);

    const [first] = await listCandidates(t.db, "2026-11-01");
    expect(first).toMatchObject({ status: "pending", portrait_status: "pending", check_note: "passed", archetype: "The commentator" });
    const served = () => assetGet(new Request(`${BASE_URL}/api/assets/${first.portrait_asset}`), { params: Promise.resolve({ id: first.portrait_asset! }) });
    expect((await served()).status).toBe(404);
    await reviewCandidate(t.db, "house-odessa", "approved");
    expect((await served()).status).toBe(200);
    // Topping up again writes nothing: there are already three.
    expect((await generateCandidates(t.db, "2026-11-01", script([]))).made).toEqual([]);
  });

  it("discards a portrait the check refuses, and keeps the candidate without one", async () => {
    await keys();
    fakeProviders("MINOR");
    await generateCandidates(t.db, "2026-11-01", script([JSON.stringify(draft("Odessa Brine"))]), 1);
    const [c] = await listCandidates(t.db, "2026-11-01");
    expect(c).toMatchObject({ portrait_asset: null, check_note: expect.stringMatching(/discarded: .*MINOR/) });
    expect(await t.count("character_assets")).toBe(0);
  });

  it("runs from the 20th only", async () => {
    expect(await seasonGenerationDue(t.db, new Date("2026-11-19T12:00:00Z"), script([]))).toBeNull();
    const due = await seasonGenerationDue(t.db, new Date("2026-11-20T12:00:00Z"), script([]));
    expect(due?.season).toBe("2026-12-01");
  });
});

describe("rotating them in on the 1st", () => {
  beforeAll(() => setSeasonCastForTests(null));

  it("takes the approved newcomers, then unreviewed ones whose portrait passed; they're bookable and on the cards", async () => {
    await keys();
    fakeProviders();
    await generateCandidates(t.db, "2026-11-01", script([JSON.stringify(draft("Odessa Brine")), JSON.stringify(draft("Bram Tolliver")), JSON.stringify(draft("Wynn Arbor"))]));
    await reviewCandidate(t.db, "house-wynn", "approved");
    await reviewCandidate(t.db, "house-bram", "rejected");
    await ensureSeasonCast(t.db, new Date("2026-10-25T00:00:00Z"), {});
    const nov = new Date("2026-11-01T09:00:00Z");
    const cast = await ensureSeasonCast(t.db, nov, {});
    expect(cast.filter((c) => c.source === "new").map((c) => c.character_id)).toEqual(["house-wynn", "house-odessa"]);
    expect(cast).toHaveLength(NEWCOMERS + 2);
    expect((await listCandidates(t.db, "2026-11-01")).map((c) => [c.character_id, c.status])).toEqual([
      ["house-odessa", "approved"],
      ["house-bram", "rejected"],
      ["house-wynn", "approved"],
    ]);
    await refreshSeasonCast(t.db, nov);
    expect(seasonCastIds(nov, {})).toContain("house-wynn");
    expect((await seasonCastCards(t.db, nov)).find((c) => c.id === "house-wynn")).toMatchObject({ name: "Wynn Arbor", archetype: "The commentator" });
  });
});

describe("the admin review queue", () => {
  it("lists next month's candidates with portraits to an admin, and approves, rejects and writes more", async () => {
    await keys();
    fakeProviders();
    const owner = newUserCookie();
    await claimAdmin(t.db, userIdOf(owner));
    const cookie = sessionCookies({ userId: userIdOf(owner), authenticated: true })[0].split(";")[0];
    const req = (body?: unknown, c = cookie) =>
      new Request(`${BASE_URL}/api/admin/season`, body ? { method: "POST", headers: { "content-type": "application/json", cookie: c }, body: JSON.stringify(body) } : { headers: { cookie: c } });
    expect((await adminGet(req(undefined, newUserCookie()))).status).toBe(403);
    scriptedModel(Array.from({ length: CANDIDATES }, (_, i) => JSON.stringify(draft(["Odessa Brine", "Bram Tolliver", "Wynn Arbor"][i]))));
    const written = await (await adminPost(req({ action: "generate" }))).json();
    expect(written.next_season.candidates).toHaveLength(CANDIDATES);
    expect(written.next_season.candidates[0].portrait).toMatch(/^data:image\/png;base64,/);
    const id = written.next_season.candidates[0].character_id;
    const approved = await (await adminPost(req({ action: "approve", character_id: id }))).json();
    expect(approved.next_season.candidates[0].status).toBe("approved");
  });
});
