import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as adminScenes } from "@/app/api/admin/scenes/route";
import { dateFacts, rulesPlan } from "@/lib/beats";
import { buildTurnMessages } from "@/lib/conversation";
import { fixedEngine, type SideOutcome } from "@/lib/engine";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { namedPlace, placeFor, venueFor } from "@/lib/places";
import { agreedPlan, type PlanText } from "@/lib/plans";
import { venueBackdrop } from "@/lib/portraits";
import { pairKey, type End } from "@/lib/relationships";
import { listSceneRequests, logSceneRequests, normalizeScene } from "@/lib/scenes";
import { assembleDate, buildDate, DEFAULT_DATE_REQUEST, type CharacterForDate } from "@/lib/simulation";
import { isPlaceholder, venue, venueName, venuePhrase } from "@/lib/venues";
import { api, BASE_URL, episodeJson, HOUSE_PARTNER_ID, newUserCookie, scriptedModel, scriptOutcome, startTestDb, userIdOf, validCharacter } from "./helpers";

// David, 2026-10-18: "if they are texting about an idea for a date we should use that for setting up the next date.
// right now it comes out randome it feels verses honoring their discussion in the texting."

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const NAMES: Record<End, string> = { lo: "Chud the crusher", hi: "Nell Abiodun" };
const lo = (text: string): PlanText => ({ who: "lo", text });
const hi = (text: string): PlanText => ({ who: "hi", text });

describe("placeFor: where a text proposes going, as a place on the show", () => {
  it.each([
    ["Coffee tomorrow?", "corner_cafe"],
    ["Meet me by the east wing and I'll show you how an engineer handles it.", "museum_night"],
    ["Come back to mine, I'll make pasta.", "home@Chud's place"],
    ["Dinner at your place?", "home@Nell's place"],
    ["Dinner next week? I'll cook.", "home@Chud's place"],
    // The show stays PG: a bedroom is a living room and a kitchen ("X's place").
    ["We could just hang out in my bedroom", "home@Chud's place"],
    ["How about the observatory?", "elsewhere@the observatory"],
    ["Let's watch the sunrise from the top of the hill", "elsewhere@the top of the hill"],
    // A named place wins over a word that only hints at one ("walk" was the botanic park).
    ["A walk to the old lighthouse after?", "elsewhere@the old lighthouse"],
    ["Want to catch a movie?", "elsewhere@the cinema"],
    ["Karaoke, and I'm picking the song", "karaoke_booth"],
  ])("%s → %s", (text, place) => {
    expect(placeFor(text, NAMES.lo, NAMES.hi)).toBe(place);
  });

  it("names nowhere for a vague place, a link or a handle", () => {
    expect(placeFor("Let's go to the place we talked about", NAMES.lo, NAMES.hi)).toBeNull();
    expect(namedPlace("meet me at the www.example.com/club")).toBeNull();
    expect(namedPlace("see you at the @nell bar")).toBeNull();
    expect(placeFor("How was your day?", NAMES.lo, NAMES.hi)).toBeNull();
  });

  it("keeps the old keyword order for plans (venueForPlan)", () => {
    expect(venueFor("a walk on the beach")).toBe("night_beach");
    expect(venueFor("dinner and karaoke")).toBe("karaoke_booth");
    expect(venueFor("surfing lessons, then tacos")).toBe("surf_lesson");
  });
});

describe("agreedPlan: a proposal and the other's yes", () => {
  it("Chud × Nell's east wing is the museum", () => {
    const plan = agreedPlan(
      [lo("Meet me by the east wing and I'll show you how an engineer handles it."), hi("The east wing entrance is secure. Bring your engineering degree.")],
      NAMES,
    );
    expect(plan).toEqual({
      texts: [lo("Meet me by the east wing and I'll show you how an engineer handles it."), hi("The east wing entrance is secure. Bring your engineering degree.")],
      place: "museum_night",
    });
  });

  it("hears \"I'll bring…\" as a plan: the second-date test's coffee (its first date at the café made it flake)", () => {
    const plan = agreedPlan(
      [lo("Morning. Still thinking about the sugar packets."), hi("Coffee works. Bring the anthology story and I'll bring dried apricots."), lo("You're on."), hi("Tuesday then.")],
      NAMES,
    );
    expect(plan?.place).toBe("corner_cafe");
    expect(plan?.texts.map((t) => t.text)).toEqual(["Coffee works. Bring the anthology story and I'll bring dried apricots.", "You're on."]);
  });

  it("takes the counter-proposal the other said yes to", () => {
    expect(agreedPlan([lo("Karaoke?"), hi("How about the observatory?"), lo("Deal.")], NAMES)?.place).toBe("elsewhere@the observatory");
  });

  it("isn't fooled by a refusal, a goodbye, small talk or a yes to yourself", () => {
    expect(agreedPlan([lo("Let's not."), hi("See you around.")], NAMES)).toBeNull();
    expect(agreedPlan([lo("How was your day?"), hi("Good! Yours?")], NAMES)).toBeNull();
    expect(agreedPlan([lo("Karaoke tomorrow?"), hi("I'd love to, but I can't this week.")], NAMES)).toBeNull();
    expect(agreedPlan([lo("Karaoke tomorrow?"), lo("Yes, I'm sure, I'll book it.")], NAMES)).toBeNull();
    expect(agreedPlan([lo("Karaoke tomorrow?"), hi("Sure, but how about the observatory instead?")], NAMES)).toBeNull();
  });

  it("skips a yes to somewhere unnamed for the older plan that named a place", () => {
    const plan = agreedPlan([lo("Next time, the observatory?"), hi("You're on."), hi("Want to hang out again soon?"), lo("Yes!")], NAMES);
    expect(plan?.place).toBe("elsewhere@the observatory");
    expect(plan?.texts.map((t) => t.text)).toEqual(["Next time, the observatory?", "You're on."]);
  });

  it("uses the newest plan when they changed their minds", () => {
    expect(agreedPlan([lo("Coffee?"), hi("Yes"), hi("Actually, how about the bowling alley instead?"), lo("Even better, deal")], NAMES)?.place).toBe("bowling_alley");
  });
});

describe("places of their own", () => {
  it("read as venues: a name of their own, a generic set, and only the placeholder is a scene request", () => {
    expect(venue("elsewhere@the observatory")).toMatchObject({ id: "elsewhere", name: "The observatory", prompt: "the observatory" });
    expect(venue("home@Chud's place").prompt).toMatch(/^Chud's place: the living room and the kitchen/);
    expect(venueName("home@Chud's place")).toBe("Chud's place");
    expect(venuePhrase("home@Chud's place")).toBe("Chud's place");
    expect(venuePhrase("rooftop_bar")).toBe("a rooftop bar at golden hour");
    expect(isPlaceholder("elsewhere@the observatory")).toBe(true);
    expect(isPlaceholder("home@Chud's place")).toBe(false);
    expect(venueBackdrop("elsewhere@the observatory")).toBeNull();
    expect(venueBackdrop("museum_night")).toMatch(/venue-museum_night/);
    expect(normalizeScene("The Observatory!")).toBe("observatory");
  });
});

describe("a date they planned by text, in the prompts", () => {
  const sheet = (name: string, bio: string) => ({ name, age: 33, bio, traits: ["playful", "bold", "warm"], want: "someone who laughs easily", dealbreaker: "liars", house: false });
  const a: CharacterForDate = { id: "chud", sheet: sheet("Chud the crusher", "An engineer who wings every instruction manual.") };
  const b: CharacterForDate = { id: "nell", sheet: sheet("Nell Abiodun", "A museum conservator who measures everything twice.") };
  const plan = { texts: [{ who: "lo" as End, text: "We should go to the observatory sometime." }, { who: "hi" as End, text: "Yes! I'd love that." }], place: "elsewhere@the observatory" as const };
  const built = assembleDate({ episodeId: "e1", a, b, req: DEFAULT_DATE_REQUEST, seed: 7, soulA: null, soulB: null, memoryA: null, memoryB: null, history: undefined, agreedPlan: plan });
  const outcome = fixedEngine({ ending: "second_date" }).decide(built.input, built.seed);
  const data = (turn: number) => JSON.parse(buildTurnMessages(built.input, outcome, built.characters, built.setup.producer, built.setup.venue, [], turn).messages[1].content.replace(/^[^\n]*\n/, ""));

  it("happens where they planned it, with the plan snapshotted on the setup", () => {
    expect(built.setup.venue).toBe("elsewhere@the observatory");
    expect(built.setup.agreed_plan).toEqual(plan);
    // "chud" < "nell", so Chud is the lo end: he proposed it.
    expect(built.characters[0].tonightsPlan).toEqual(["You: “We should go to the observatory sometime.”", "They: “Yes! I'd love that.”"]);
    expect(built.characters[1].tonightsPlan).toEqual(["They: “We should go to the observatory sometime.”", "You: “Yes! I'd love that.”"]);
  });

  it("tells each side it's the plan, and stays a first date", () => {
    const first = data(0);
    expect(first.where).toBe("the observatory");
    expect(first.tonight_is_the_plan_you_made).toEqual(built.characters[0].tonightsPlan);
    expect(first.what_you_remember_about_them).toBeUndefined();
    expect(first.note).toMatch(/first line of your first date: the plan the two of you made in your texts/);
    const facts = dateFacts(built.input, outcome, built.characters).join("\n");
    expect(facts).toMatch(/Tonight is their first date, and it's the plan they made in their texts: Chud the crusher: “We should go/);
    expect(facts).not.toMatch(/have met before/);
    const rules = rulesPlan(built.input, outcome, built.characters, built.setup.producer, built.setup.venue);
    expect(rules.spine).toMatch(/a first date/);
    expect(rules.acts[0].scene).toMatch(/^They meet at the observatory, the date they planned in their texts/);
  });
});

/* ------------------------------------------------ booking, with a database ------------------------------------------------ */

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
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const side = (wants: boolean): SideOutcome => ({ wants_another: wants, agenda_met: true, satisfied: wants, dealbreaker_hit: null, want_met: null, note_followed: null });
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();
const HOUSE = HOUSE_CHARACTERS[0];

async function owner() {
  const creator = newUserCookie();
  const character = await (await api.createCharacter(validCharacter(), creator)).json();
  const [l] = pairKey(character.id, HOUSE_PARTNER_ID);
  const me: End = character.id === l ? "lo" : "hi";
  return { creator, userId: userIdOf(creator), character, me, them: (me === "lo" ? "hi" : "lo") as End };
}

/** A text between them, `n` minutes ago (or at `at`). */
async function text(x: string, y: string, who: End, body: string, at: string) {
  const [l, h] = pairKey(x, y);
  const seq = (await t.db.query<{ n: number }>(`select count(*)::int as n from couple_texts where character_lo = $1 and character_hi = $2`, [l, h])).rows[0].n + 1;
  await t.db.query(`insert into couple_texts (character_lo, character_hi, day, seq, who, text, created_at) values ($1, $2, $3, $4, $5, $6, $7)`, [l, h, at.slice(0, 10), seq, who, body, at]);
}

async function book(creator: string, characterId: string) {
  scriptOutcome({ ending: "second_date", sides: [side(true), side(true)] });
  scriptedModel([episodeJson()]);
  const res = await api.createEpisode({ character_id: characterId, partner_id: HOUSE_PARTNER_ID }, creator);
  expect(res.status).toBe(200);
  const episode = await res.json();
  return { id: episode.id as string, setup: (await t.db.query<Any>(`select setup from episodes where id = $1`, [episode.id])).rows[0].setup };
}

describe("booking honours the plan they agreed to by text", () => {
  it("a match chat's plan sets up their first date there, and the new place is logged as a scene request once", async () => {
    const { creator, character, me, them } = await owner();
    await text(character.id, HOUSE_PARTNER_ID, me, "We should go to the observatory sometime.", daysAgo(0.2));
    await text(character.id, HOUSE_PARTNER_ID, them, "Yes! I'd love that.", daysAgo(0.1));
    const date = await book(creator, character.id);
    expect(date.setup.venue).toBe("elsewhere@the observatory");
    expect(date.setup.agreed_plan.texts.map((x: PlanText) => x.text)).toEqual(["We should go to the observatory sometime.", "Yes! I'd love that."]);
    // The date finished (generation runs inline in tests), so the observatory is a scene request: once, however often it's logged.
    expect(await t.count("scene_requests")).toBe(1);
    await logSceneRequests(t.db, date.id, date.setup);
    expect(await listSceneRequests(t.db)).toEqual([expect.objectContaining({ label: "the observatory", normalized: "observatory", requests: 1, plans: 1, moves: 0, episode_id: date.id })]);
  });

  it("honours an agreement made on the date itself, anywhere in the conversation (Chud × Sable, 2026-10-18)", async () => {
    // Episode 5c1aac6c: they agreed in act one to go back to Chud's place ("back to my place" / "Deal!"), but the next
    // date was dealt goat yoga at random. The agreement is in the transcript, not the texts.
    const { creator, character } = await owner();
    const first = await book(creator, character.id);
    const L = (side: "a" | "b", act: number, dialogue: string) => ({ side, act, dialogue, action: "", emotion: "warm", interest: 0.7 });
    await t.db.query(`update episodes set created_at = $2, afterglow = '[]'::jsonb, transcript = $3::jsonb where id = $1`, [
      first.id,
      daysAgo(1),
      JSON.stringify([
        L("a", 0, "Race you to that fence!"),
        L("b", 0, "You're on, slowpoke!"),
        L("a", 0, "Let's take this back to my place after we win."),
        L("b", 0, "Your place?! Deal, but only if you cook from the floor."),
        L("a", 1, "Floor cooking it is."),
        L("b", 2, "I own forty-one hats and zero dining tables. Let's go change that."),
      ]),
    ]);
    const next = await book(creator, character.id);
    // The next date opens at one of their places, not a random venue.
    expect(next.setup.venue).toMatch(/^home@/);
    expect(next.setup.agreed_plan.texts.map((x: PlanText) => x.text)).toEqual(["Let's take this back to my place after we win.", "Your place?! Deal, but only if you cook from the floor."]);
  });

  it("a plan from their morning after sets up the next date, even when it isn't a second date", async () => {
    const { creator, character } = await owner();
    const first = await book(creator, character.id);
    await t.db.query(`update episodes set created_at = $2, afterglow = $3::jsonb where id = $1`, [
      first.id,
      daysAgo(1),
      JSON.stringify([{ side: "a", text: "Last night was fun. Next time, the bowling alley?" }, { side: "b", text: "You're on." }]),
    ]);
    const next = await book(creator, character.id);
    expect(next.setup.venue).toBe("bowling_alley");
    expect(next.setup.agreed_plan.place).toBe("bowling_alley");
  });

  it("a date with no morning after (an agent's own) still plans out loud: its closing lines count", async () => {
    const { creator, character } = await owner();
    const first = await book(creator, character.id);
    const line = (s: "a" | "b", dialogue: string) => ({ side: s, act: 2, dialogue, action: "", emotion: "warm", interest: 0.7 });
    await t.db.query(`update episodes set created_at = $2, afterglow = '[]'::jsonb, transcript = $3::jsonb where id = $1`, [
      first.id,
      daysAgo(1),
      JSON.stringify([line("a", "This was nice."), line("b", "It was."), line("a", "Next time, the lighthouse?"), line("b", "Deal.")]),
    ]);
    expect((await book(creator, character.id)).setup.venue).toBe("elsewhere@the lighthouse");
  });

  it("a plan made before their last date was that date: the next one isn't set up by it", async () => {
    const { creator, character, me, them } = await owner();
    await text(character.id, HOUSE_PARTNER_ID, me, "Karaoke this weekend?", daysAgo(3));
    await text(character.id, HOUSE_PARTNER_ID, them, "Count me in.", daysAgo(2.9));
    const first = await book(creator, character.id);
    expect(first.setup.venue).toBe("karaoke_booth");
    await t.db.query(`update episodes set created_at = $2 where id = $1`, [first.id, daysAgo(2)]);
    expect((await book(creator, character.id)).setup.agreed_plan).toBeUndefined();
  });

  it("a rebuild never reads the texts again: the stored plan, or none", async () => {
    const { userId, character, me, them } = await owner();
    await text(character.id, HOUSE_PARTNER_ID, me, "How about the observatory?", daysAgo(0.2));
    await text(character.id, HOUSE_PARTNER_ID, them, "I'm in.", daysAgo(0.1));
    const forDate = (c: { id: string; name: string; age: number; bio: string; traits: readonly string[]; want: string; dealbreaker: string }, house: boolean): CharacterForDate => ({
      id: c.id,
      sheet: { name: c.name, age: c.age, bio: c.bio, traits: [...c.traits], want: c.want, dealbreaker: c.dealbreaker, house },
    });
    const [mine, theirs] = [forDate(character, false), forDate(HOUSE, true)];
    const fresh = await buildDate(t.db, "e-fresh", mine, theirs, DEFAULT_DATE_REQUEST, 3, undefined, { creatorId: userId });
    expect(fresh.setup.agreed_plan?.place).toBe("elsewhere@the observatory");
    const legacy = await buildDate(t.db, "e-legacy", mine, theirs, DEFAULT_DATE_REQUEST, 3, undefined, { creatorId: userId, agreedPlan: null });
    expect(legacy.setup.agreed_plan).toBeUndefined();
    expect(legacy.characters[0].tonightsPlan).toBeUndefined();
    expect(legacy.setup.venue).not.toBe("elsewhere@the observatory");
  });

  it("an agent's own date keeps the plan it was booked with, and a date from before plans never gains one", async () => {
    scriptOutcome({ ending: "second_date" });
    const ctx: McpContext = {};
    const call = async (name: string, args: Record<string, unknown>): Promise<Any> =>
      (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx))!.result;
    await handleMcpMessage({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "texted-plans-test" } } }, ctx);
    Object.assign(ctx, { sessionId: ctx.issuedSessionId });
    const x = (await call("create_character", validCharacter({ name: "Ada Lumen" }))).structuredContent.character.id as string;
    const y = (await call("create_character", validCharacter({ name: "Bo Quill" }))).structuredContent.character.id as string;
    const [l] = pairKey(x, y);
    const end = (id: string): End => (id === l ? "lo" : "hi");
    await text(x, y, end(x), "Let's go to the planetarium.", daysAgo(0.2));
    await text(x, y, end(y), "Sounds perfect.", daysAgo(0.1));
    // After the first step, an agent's steps are compact (no system prompt): the data is the user message.
    const data = (step: Any) => JSON.parse(step.messages.find((m: Any) => m.role === "user").content.replace(/^[^\n]*\n/, ""));
    const started = (await call("start_own_date", { character_id: x, partner_id: y })).structuredContent.step;
    expect(data(started)).toMatchObject({ where: "the planetarium", tonight_is_the_plan_you_made: [expect.stringContaining("planetarium"), expect.any(String)] });

    // A new plan texted mid-date is in their texts, but tonight is still the plan it was booked with.
    await text(x, y, end(x), "Next time, the aquarium?", daysAgo(0.01));
    await text(x, y, end(y), "Absolutely.", daysAgo(0.005));
    const next = (await call("submit_own_date_step", { episode_id: started.episode_id, output: { dialogue: "So, the planetarium. Do you know any constellations?", action: "", emotion: "curious", interest_signal: 0.6 } })).structuredContent.step;
    expect(next.stage).toBe("turn");
    expect(data(next).where).toBe("the planetarium");
    expect(JSON.stringify(data(next).tonight_is_the_plan_you_made)).not.toContain("aquarium");

    // A date stored before plans existed has none to snapshot: its next step doesn't read the texts for one.
    await t.db.query(`update episodes set setup = setup - 'agreed_plan' where id = $1`, [started.episode_id]);
    const legacy = (await call("get_own_date_step", { episode_id: started.episode_id })).structuredContent.step;
    expect(data(legacy).tonight_is_the_plan_you_made).toBeUndefined();
  });
});

describe("GET /api/admin/scenes", () => {
  it("is owner-only, and lists the scenes people asked for", async () => {
    vi.stubEnv("FRONTIER_PASSWORD", ["scene", "pass"].join("-"));
    expect((await adminScenes(new Request(`${BASE_URL}/api/admin/scenes`))).status).toBe(403);
    const { creator, character, me, them } = await owner();
    await text(character.id, HOUSE_PARTNER_ID, me, "How about the aquarium?", daysAgo(0.2));
    await text(character.id, HOUSE_PARTNER_ID, them, "Yes please.", daysAgo(0.1));
    await book(creator, character.id);
    const res = await adminScenes(new Request(`${BASE_URL}/api/admin/scenes`, { headers: { "x-frontier-key": "scene-pass" } }));
    expect(res.status).toBe(200);
    expect((await res.json()).scenes).toEqual([expect.objectContaining({ label: "the aquarium", requests: 1 })]);
  });
});
