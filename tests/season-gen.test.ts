import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as assetGet } from "@/app/api/assets/[id]/route";
import { GET as adminGet, POST as adminPost } from "@/app/api/admin/season/route";
import { HIVE_VLM, setCheckFetchForTests } from "@/lib/adult/check";
import { setMediaFetchForTests } from "@/lib/adult/media";
import { saveAdultSettings } from "@/lib/adult/settings";
import { claimAdmin } from "@/lib/admins";
import { loadCharacter } from "@/lib/character";
import { ALL_HOUSE_CHARACTERS, HOUSE_CHARACTERS } from "@/lib/house";
import { sessionCookies } from "@/lib/http";
import { ensureSeasonCast, refreshSeasonCast, resetStoredSeasonCastForTests, seasonCastCards, seasonCastIds, setSeasonCastForTests } from "@/lib/season-cast";
import {
  CANDIDATES,
  draftMessages,
  generateCandidates,
  listCandidates,
  NEWCOMERS,
  newcomerPronouns,
  pairPlan,
  parseDraft,
  makePortrait,
  reviewCandidate,
  seasonGenerationDue,
} from "@/lib/season-gen";
import { SHEET_WORDS_MAX, SHEET_WORDS_MIN } from "@/lib/sheet-words";
import { linksOf } from "@/lib/character-links";
import { getDirectorModel, type Model } from "@/lib/model";
import { characterPortrait } from "@/lib/portraits";
import { showStyleSql } from "@/lib/portrait-sql";
import { artStyleSql, HOUSE_LOOK_VERSION, HOUSE_LOOK_WORDS } from "@/lib/art-style";
import { api, BASE_URL, newUserCookie, scriptedModel, startTestDb, userIdOf, validCharacter } from "./helpers";

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
  it("asks for a whole profile in the census's sweet spot, with the first date they'd pick and a longer bio", () => {
    const user = String(draftMessages([])[1]!.content);
    expect(user).toContain(`${SHEET_WORDS_MIN} to ${SHEET_WORDS_MAX} words`);
    expect(user).toMatch(/"ideal_first_date"/);
    expect(user).toMatch(/three of them/);
    const bio =
      "A ferry captain who narrates the weather to her passengers like a sports commentator. Has never once been seasick, and brags. " +
      "She keeps a scorebook of every storm she has sailed through. Her deckhands bet on her forecasts and lose.";
    expect(bio.length).toBeGreaterThan(200);
    const extra = { ideal_first_date: "A dawn crossing with thermos coffee and a running commentary on the gulls.", hidden_talent: "Splices rope blindfolded", pet_peeve: "Umbrellas on deck", green_flag: "Laughs at her own bad forecasts" };
    const parsed = parseDraft(JSON.stringify(draft("Odessa Brine", { bio, kit: { ...draft("x").kit, ...extra } })), []);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.draft.kit).toMatchObject(extra);
  });

  it("takes a full draft, and refuses a minor, a real person, a taken name or bad JSON", () => {
    expect(parseDraft(JSON.stringify(draft("Odessa Brine")), ["Rafe Calloway"]).ok).toBe(true);
    expect(parseDraft(JSON.stringify(draft("Odessa Brine", { bio: "She's 17 and runs the ferry with her dad. Loves the sea more than anything." })), [])).toMatchObject({ ok: false, reason: expect.stringMatching(/minor/) });
    expect(parseDraft(JSON.stringify(draft("Odessa Brine", { want: "To meet Taylor Swift" })), [])).toMatchObject({ ok: false, reason: expect.stringMatching(/real_person/) });
    expect(parseDraft(JSON.stringify(draft("Rafe Moss")), ["Rafe Calloway"])).toMatchObject({ ok: false, reason: expect.stringMatching(/name taken/) });
    // Originals only (lib/franchises.ts): a franchise's character named anywhere in the draft, its kit included, is drafted
    // again; a fan's title in a hobby isn't a copy.
    const hobbies = (h: string[]) => JSON.stringify(draft("Odessa Brine", { kit: { ...draft("x").kit, hobbies: h } }));
    expect(parseDraft(hobbies(["Weather", "Cosplaying Raiden Shogun", "Darts"]), [])).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/^The show keeps to original characters: the profile says "Raiden Shogun", which reads like Genshin Impact\./),
    });
    expect(parseDraft(hobbies(["Weather", "Pokémon cards", "Darts"]), []).ok).toBe(true);
    expect(parseDraft(JSON.stringify(draft("Odessa Brine", { age: 19 })), [])).toMatchObject({ ok: false });
    expect(parseDraft("not json at all", [])).toEqual({ ok: false, reason: "not JSON" });
  });

  it("stores the sheet, kit, soul and look; paints a PG portrait (safe mode) that's served while they're a candidate", async () => {
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
    expect(first).toMatchObject({ status: "pending", portrait_status: "approved", check_note: "passed", archetype: "The commentator" });
    const served = () => assetGet(new Request(`${BASE_URL}/api/assets/${first.portrait_asset}`), { params: Promise.resolve({ id: first.portrait_asset! }) });
    // Their public page and the ballot show it before the review (2026-11-21: Bramwell Vance showed initials).
    expect((await served()).status).toBe(200);
    await reviewCandidate(t.db, "house-odessa", "approved");
    expect((await served()).status).toBe(200);
    // Topping up again writes nothing: there are already three.
    expect((await generateCandidates(t.db, "2026-11-01", script([]))).made).toEqual([]);
  });

  it("drafts the newcomers as a linked pair: the first knows someone returning, the rest are the first's rival, ex, fake partner or best friend", async () => {
    await keys();
    fakeProviders();
    const cast = HOUSE_CHARACTERS.slice(0, 4).map((c) => c.id);
    setSeasonCastForTests(cast);
    const plan = await pairPlan(t.db, "2026-12-01");
    expect(plan.returning).toMatchObject({ id: expect.stringMatching(/^house-/) });
    expect(plan.returning!.kind).not.toBe(plan.kind);
    const returning = HOUSE_CHARACTERS.find((h) => h.id === plan.returning!.id)!;
    const { calls } = scriptedModel([
      JSON.stringify(draft("Odessa Brine", { pronouns: plan.pronouns[0], link_story: `She and ${returning.name.split(" ")[0]} go back to the ferry strike of last winter.` })),
      JSON.stringify(draft("Bram Tolliver", { pronouns: plan.pronouns[1], link_story: "They share a dock, a grudge and a very loud foghorn." })),
      // A draft that leaves link_story out still gets its link, in the kind's own words.
      JSON.stringify(draft("Wynn Arbor", { pronouns: plan.pronouns[1] })),
    ]);
    const r = await generateCandidates(t.db, "2026-12-01", getDirectorModel());
    expect(r).toEqual({ made: ["house-odessa", "house-bram", "house-wynn"], errors: [] });

    // Each draft was asked for its pronouns, and who it already knows.
    const system = (i: number) => calls[i][0].content;
    expect(system(0)).toContain(`This contestant uses ${plan.pronouns[0]}.`);
    expect(system(0)).toContain(`They arrive with history. ${returning.name} (`);
    expect(calls[0][1].content).toContain('and "link_story" (one line');
    expect(system(1)).toContain(`This contestant uses ${plan.pronouns[1]}.`);
    expect(system(1)).toContain("They arrive with history. Odessa Brine (The commentator: A ferry captain");
    expect(system(2)).toContain("They arrive with history. Odessa Brine (");

    const links = await linksOf(t.db, ["house-odessa"]);
    const of = (other: string) => links.find((l) => l.lo === other || l.hi === other);
    expect(of(returning.id)).toMatchObject({ kind: plan.returning!.kind, story: expect.stringMatching(/ferry strike/), source: "season_gen" });
    expect(of("house-bram")).toMatchObject({ kind: plan.kind, story: "They share a dock, a grudge and a very loud foghorn." });
    expect(of("house-wynn")).toMatchObject({ kind: plan.kind, story: expect.stringMatching(/\.$/) });
    expect(links).toHaveLength(3);

    // Next season's pair isn't this one's kind again.
    const next = await pairPlan(t.db, "2027-01-01");
    expect(next.kind).not.toBe(plan.kind);
  });

  it("balances the newcomers against the survivors: one of each, unless the survivors lean one way", () => {
    expect(newcomerPronouns(["she/her", "he/him"])).toEqual(["she/her", "he/him"]);
    expect(newcomerPronouns(["she/her", "she/her"])).toEqual(["he/him", "he/him"]);
    expect(newcomerPronouns(["he/him", "he/him"])).toEqual(["she/her", "she/her"]);
    expect(newcomerPronouns(["they/them", "she/her"])).toEqual(["he/him", "she/her"]);
    expect(newcomerPronouns([])).toEqual(["she/her", "he/him"]);
  });

  it("redraws a newcomer in the house look from their photograph: the show's face, while After Dark keeps the photograph", async () => {
    await keys();
    fakeProviders();
    // A real picture this time: the redraw shrinks the photograph to send it as image 0.
    const photo = (await sharp({ create: { width: 48, height: 64, channels: 3, background: { r: 120, g: 80, b: 60 } } }).png().toBuffer()).toString("base64");
    setMediaFetchForTests(async () => Response.json({ images: [photo] }));
    // The Worker's pictures have no filter of their own, so their check asks the explicit question too (general_nsfw).
    setCheckFetchForTests(async (input: RequestInfo | URL) =>
      Response.json(
        String(input) === HIVE_VLM
          ? { choices: [{ message: { content: "ADULTS" } }] }
          : { output: [{ classes: [{ class: "yes_child_present", value: 0.01 }, { class: "no_child_present", value: 0.99 }, { class: "general_nsfw", value: 0.01 }] }] },
      ),
    );
    vi.stubEnv("WORKERS_AI_URL", "https://images.worker.test");
    vi.stubEnv("WORKERS_AI_KEY", "a-test-gate-key-0123456789");
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== "https://images.worker.test/draw") return new Response("?", { status: 500 });
      asked.push(String((init!.body as FormData).get("prompt")));
      return Response.json({ image: photo, model: "@cf/black-forest-labs/flux-2-klein-4b", neurons: 109.6, used: 109.6, limit: 9000 });
    });
    try {
      const r = await generateCandidates(t.db, "2026-11-01", script([JSON.stringify(draft("Odessa Brine"))]), 1);
      expect(r.errors).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain(HOUSE_LOOK_WORDS);
    expect(asked[0]).toMatch(/grey-streaked locs/);
    expect(asked[0]).toMatch(/Keep their skin exactly as light or dark as in image 0/);

    const assets = async () =>
      (await t.db.query<{ id: string; prompt_version: string; review_status: string }>(`select id, prompt_version, review_status from character_assets where character_id = 'house-odessa' order by created_at`)).rows;
    const [shot, look] = await assets();
    expect([shot.prompt_version, look.prompt_version]).toEqual(["season-gen-v1", HOUSE_LOOK_VERSION]);
    // Both are shown while they're a candidate (their page and the ballot have a face); the house look is the one used.
    const [c] = await listCandidates(t.db, "2026-11-01");
    expect(c.portrait_asset).toBe(look.id);
    expect((await assets()).map((a) => a.review_status)).toEqual(["approved", "approved"]);
    await reviewCandidate(t.db, "house-odessa", "approved");
    expect((await assets()).map((a) => a.review_status)).toEqual(["approved", "approved"]);

    const style = async (sql: string) => (await t.db.query<{ s: string }>(`select ${sql} as s from characters c where c.id = 'house-odessa'`)).rows[0].s;
    expect(await style(showStyleSql("c"))).toBe("semi_real");
    // After Dark's gate reads their own style, which stays a photograph's.
    expect(await style(artStyleSql("c"))).toBe("realistic");
  });

  it("keeps the photograph as a newcomer's face when the free pictures are off", async () => {
    await keys();
    fakeProviders();
    await generateCandidates(t.db, "2026-11-01", script([JSON.stringify(draft("Odessa Brine"))]), 1);
    const [c] = await listCandidates(t.db, "2026-11-01");
    const rows = (await t.db.query<{ id: string; prompt_version: string }>(`select id, prompt_version from character_assets where character_id = 'house-odessa'`)).rows;
    expect(rows).toEqual([{ id: c.portrait_asset, prompt_version: "season-gen-v1" }]);
    await reviewCandidate(t.db, "house-odessa", "approved");
    expect((await t.db.query<{ s: string }>(`select ${showStyleSql("c")} as s from characters c where c.id = 'house-odessa'`)).rows[0].s).toBe("realistic");
  });

  it("takes a candidate's face down when they're rejected, and doesn't serve a rejected one's redraw", async () => {
    await keys();
    fakeProviders();
    await generateCandidates(t.db, "2026-11-01", script([JSON.stringify(draft("Odessa Brine"))]), 1);
    const statuses = async () => (await t.db.query<{ review_status: string }>(`select review_status from character_assets where character_id = 'house-odessa' order by created_at`)).rows.map((r) => r.review_status);
    expect(await statuses()).toEqual(["approved"]);
    await reviewCandidate(t.db, "house-odessa", "rejected");
    expect(await statuses()).toEqual(["rejected"]);
    expect(await makePortrait(t.db, "house-odessa")).toBe("made");
    expect(await statuses()).toEqual(["rejected", "pending"]);
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

  it("redraws a house cast member's portrait and makes it their face; a person's character's waits (2026-11-07 audit, item 15)", async () => {
    await keys();
    const venice = fakeProviders();
    const owner = newUserCookie();
    await claimAdmin(t.db, userIdOf(owner));
    const cookie = sessionCookies({ userId: userIdOf(owner), authenticated: true })[0].split(";")[0];
    const redraw = async (id: string) =>
      (
        await (
          await adminPost(new Request(`${BASE_URL}/api/admin/season`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ action: "portrait", character_id: id }) }))
        ).json()
      ).note as string;
    const newest = async (id: string) =>
      (
        await t.db.query<{ id: string; review_status: string; prompt: string }>(
          `select id, review_status, prompt from character_assets where character_id = $1 and kind = 'portrait' order by created_at desc limit 1`,
          [id],
        )
      ).rows[0];
    const served = (assetId: string) => assetGet(new Request(`${BASE_URL}/api/assets/${assetId}`), { params: Promise.resolve({ id: assetId }) });

    // Nell is drawn from her committed file (lib/portraits.ts), which wins over the ledger until the redraw is committed.
    expect(await redraw("house-nell")).toBe(`made and approved: the show draws them from ${characterPortrait("house-nell")} until this one is committed there (lib/portraits.ts)`);
    expect(venice).toEqual(["true"]);
    const nell = await newest("house-nell");
    expect(nell.review_status).toBe("approved");
    expect((await served(nell.id)).status).toBe(200);
    // Drawn from her whole house look, who she is and what she wears, not After Dark's trimmed one (2026-11-08).
    const look = ALL_HOUSE_CHARACTERS.find((h) => h.id === "house-nell")!.look;
    expect(look).toMatch(/^a woman .*, in a plain navy zip-up work jacket$/);
    expect(nell.prompt).toContain(`from the chest up of ${look}.`);

    const mine = await (await api.createCharacter(validCharacter({ name: "Pell Ardent" }), newUserCookie())).json();
    expect(await redraw(mine.id)).toBe("made");
    const theirs = await newest(mine.id);
    expect(theirs.review_status).toBe("pending");
    expect((await served(theirs.id)).status).toBe(404);
  });
});
