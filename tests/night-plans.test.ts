/**
 * The date plan at night (lib/night-plans.ts): no format calls the director in front of line 1 with the switch on, and
 * the old order exactly with it off; a house date reads the plan the producer stored for it, and only when the date is
 * the one it was written for; generated_with.plan says which plan played; the plan can't carry one side's private want
 * to the other. No paid calls: a model that answers each prompt from the prompt alone.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setAfterglowEnabledForTests } from "@/lib/afterglow";
import { parsePlan, rulesPlan } from "@/lib/beats";
import { setChoicesAskedForTests } from "@/lib/choices";
import { setConversationEnabledForTests } from "@/lib/conversation";
import { fixedEngine } from "@/lib/engine";
import { buildEvalDate, EVAL_CASES } from "@/lib/eval";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { runGenerationJob, setInlineGenerationForTests } from "@/lib/jobs";
import { setModelForTests, type ChatMessage } from "@/lib/model";
import { claimNightPlan, datePlanAtNightOn, fitKey, nightPlanMessages, nightPlansOn, nightPlansView, setDatePlanAtNightForTests, writeNightPlan, writeNightPlans } from "@/lib/night-plans";
import { generateDate, type GenerateOptions } from "@/lib/pipeline";
import { beatFor, runProducer } from "@/lib/producer";
import { setReflectionEnabledForTests } from "@/lib/reflection";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { hear, markUsed, setWant } from "@/lib/story-state";
import { buildTemplateDate, createTemplateParty, lobbyDeal, refreshLobby } from "@/lib/watch";
import { api, HOUSE_PARTNER_ID, newUserCookie, planJson, scriptOutcome, startTestDb, validCharacter } from "./helpers";
import { promptModel } from "./prompt-model";

const CAST = HOUSE_CHARACTERS.slice(0, 4);
const [NELL, DEX, SABLE, JUNE] = CAST.map((c) => c.id);
// The 23:20 pass on the 12th writes the plans for the 13th's house dates; the 13th's first pass makes them.
const NIGHT = new Date("2026-11-12T23:20:00Z");
const MORNING = new Date("2026-11-13T00:20:00Z");
const DAY = "2026-11-13";

/** A plan nobody would mistake for the rules': each scene says where it came from. */
const nightPlan = (mark = "NIGHT") =>
  planJson({
    spine: `${mark}: a quiet evening that keeps circling back to one unasked question.`,
    acts: [0, 1, 2].map((i) => ({ scene: `${mark} scene ${i + 1}: they find a table by the window and take stock.`, a: "You ask the thing you came to ask.", b: "You answer in your own time." })),
  });
const userOf = (messages: ChatMessage[]) => messages.find((m) => m.role === "user")?.content ?? "";

describe("the switches", () => {
  afterEach(() => setDatePlanAtNightForTests(null));

  it("DATE_PLAN_AT_NIGHT is on unless it is 0; the night's writing is off unless PRODUCER_PLANS is 1, and needs the other two", () => {
    setDatePlanAtNightForTests(null);
    expect(datePlanAtNightOn({})).toBe(true);
    expect(datePlanAtNightOn({ DATE_PLAN_AT_NIGHT: "0" })).toBe(false);
    expect(nightPlansOn({})).toBe(false);
    expect(nightPlansOn({ PRODUCER_PLANS: "1" })).toBe(true);
    expect(nightPlansOn({ PRODUCER_PLANS: "1", PRODUCER: "0" })).toBe(false);
    expect(nightPlansOn({ PRODUCER_PLANS: "1", DATE_PLAN_AT_NIGHT: "0" })).toBe(false);
  });
});

describe("generateDate: which plan a date plays from", () => {
  const classic = EVAL_CASES.find((x) => x.format === "classic") ?? EVAL_CASES[0];
  const options = (over: Partial<GenerateOptions> = {}): GenerateOptions => ({ formatId: classic.format, formatCtx: {}, conversation: true, afterglow: false, reflection: false, ...over });
  const date = () => {
    const built = buildEvalDate(classic);
    return { built, decided: fixedEngine({ ending: "friends" }).decide(built.input, built.seed) };
  };

  it('"rules": no director call, the first call is line 1, and the date plays from the rules plan', async () => {
    const { built, decided } = date();
    const model = promptModel();
    const gen = await generateDate({ actor: model, director: model }, built, decided, options({ plan: "rules" }));
    expect(model.count("plan")).toBe(0);
    expect(model.seen[0].kind).toBe("line");
    expect(gen.plan?.source).toBe("rules");
    expect(gen.plan).toEqual(rulesPlan(built.input, decided, built.characters, built.setup.producer, built.setup.venue));
  });

  it("a stored plan: no director call, and the actors are handed its beats", async () => {
    const { built, decided } = date();
    const stored = parsePlan(nightPlan(), built.input, decided, built.characters, built.setup.producer, built.setup.venue, { source: "producer" })!;
    expect(stored.source).toBe("producer");
    const model = promptModel();
    const gen = await generateDate({ actor: model, director: model }, built, decided, options({ plan: stored }));
    expect(model.count("plan")).toBe(0);
    expect(model.seen[0].kind).toBe("line");
    expect(gen.plan?.source).toBe("producer");
    expect(userOf(model.seen[0].messages)).toContain("NIGHT scene 1");
    // The ending the date is written to is the one the engine decided: the plan had no say in it.
    expect(gen.outcome).toEqual(decided);
  });

  it("left out, the director is asked first, exactly as before", async () => {
    const { built, decided } = date();
    const model = promptModel();
    const gen = await generateDate({ actor: model, director: model }, built, decided, options());
    expect(model.seen[0].kind).toBe("plan");
    expect(gen.plan?.source).toBe("director");
  });

  it("the same lines and the same ending whether the plan is the rules' or the night's (the model answers from the lines so far)", async () => {
    const { built, decided } = date();
    const stored = parsePlan(nightPlan(), built.input, decided, built.characters, built.setup.producer, built.setup.venue, { source: "producer" })!;
    const one = await generateDate({ actor: promptModel(), director: promptModel() }, built, decided, options({ plan: "rules" }));
    const two = await generateDate({ actor: promptModel(), director: promptModel() }, built, decided, options({ plan: stored }));
    expect(two.transcript.map((l) => l.dialogue)).toEqual(one.transcript.map((l) => l.dialogue));
    expect(two.outcome.ending).toBe(one.outcome.ending);
  });
});

describe("with a database", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    await t.db.query("delete from watch_parties");
    await t.db.query("delete from date_plans");
    await t.db.query("delete from story_beats");
    setSeasonCastForTests(CAST.map((c) => c.id));
    setConversationEnabledForTests(true);
    setDatePlanAtNightForTests(null);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    setSeasonCastForTests(null);
    setConversationEnabledForTests(false);
    setAfterglowEnabledForTests(false);
    setReflectionEnabledForTests(false);
    setChoicesAskedForTests(false);
    setInlineGenerationForTests(true);
    setDatePlanAtNightForTests(false);
    setModelForTests(null);
  });

  describe("a booked date (the job)", () => {
    async function book(format: "speed_date" | "classic" | "meet_the_parents", model: ReturnType<typeof promptModel>) {
      setInlineGenerationForTests(false);
      const creator = newUserCookie();
      const char = await (await api.createCharacter(validCharacter(), creator)).json();
      scriptOutcome({ ending: "friends" });
      setModelForTests(model);
      const res = await api.createEpisode({ character_id: char.id, partner_id: HOUSE_PARTNER_ID, format }, creator);
      expect(res.status).toBe(200);
      return (await res.json()) as { id: string };
    }
    const rowOf = async (id: string) =>
      (await t.db.query<{ status: string; generated_with: { plan: string | null; timing: Record<string, number | boolean | null> } }>(`select status, generated_with from episodes where id = $1`, [id])).rows[0];

    it("no format calls the director in front of line 1 (with no plans written, the default): classic, speed date and a twist format all start on the rules plan", async () => {
      for (const format of ["classic", "speed_date", "meet_the_parents"] as const) {
        const model = promptModel();
        const ep = await book(format, model);
        await runGenerationJob(t.db, ep.id);
        expect(model.count("plan"), format).toBe(0);
        expect(model.seen.find((x) => x.kind !== "hot_takes")!.kind, format).toBe("line");
        const row = await rowOf(ep.id);
        expect(row.status, format).toBe("ready");
        expect(row.generated_with.plan, format).toBe("rules");
        // The timing record from the fast first date is still written, and still says which dates wrote side by side.
        expect(row.generated_with.timing.fast, format).toBe(format === "speed_date");
        expect(typeof row.generated_with.timing.first_line_ms, format).toBe("number");
      }
    });

    it("DATE_PLAN_AT_NIGHT=0 restores the old order: the classic asks the director first, the speed date still doesn't", async () => {
      vi.stubEnv("DATE_PLAN_AT_NIGHT", "0");
      const slow = promptModel();
      const classic = await book("classic", slow);
      await runGenerationJob(t.db, classic.id);
      expect(slow.seen[0].kind).toBe("plan");
      expect((await rowOf(classic.id)).generated_with).toMatchObject({ plan: "director", timing: { fast: false } });
      const quick = promptModel();
      const speed = await book("speed_date", quick);
      await runGenerationJob(t.db, speed.id);
      expect(quick.count("plan")).toBe(0);
      expect((await rowOf(speed.id)).generated_with).toMatchObject({ plan: "rules", timing: { fast: true } });
    });
  });

  describe("the house's date and the plan written for it", () => {
    const episodeOf = async (partyId: string) =>
      (await t.db.query<{ id: string; a: string; b: string; plan: string | null }>(`select e.id, e.character_a as a, e.character_b as b, e.generated_with->>'plan' as plan from watch_parties w join episodes e on e.id = w.episode_id where w.id = $1`, [partyId])).rows[0];
    // The night's writing is off by default: these turn it on.
    beforeEach(() => vi.stubEnv("PRODUCER_PLANS", "1"));
    const plans = async () =>
      (await t.db.query<{ slot: string; a_id: string; b_id: string; episode_id: string; plan: { source: string; acts: { scene: string }[] } | null; used: boolean; fit: boolean | null; model: string | null }>(
        `select slot, a_id, b_id, episode_id, plan, (used_at is not null) as used, fit, model from date_plans order by slot`,
      )).rows;

    it("at night the producer writes tomorrow's lobby date's plan under a reserved id; the date takes the id and plays from it", async () => {
      vi.useFakeTimers({ now: NIGHT, toFake: ["Date"] });
      const deal = (await lobbyDeal(t.db, new Date(`${DAY}T12:00:00Z`), 0))!;
      const writer = promptModel({ plan: () => nightPlan() });
      const run = await writeNightPlans(t.db, NIGHT, { model: writer });
      expect(run).toMatchObject({ day: DAY, written: [{ slot: "lobby", a: deal.a, b: deal.b, ok: true }] });
      expect(writer.count("plan")).toBe(1);
      const [stored] = await plans();
      expect(stored).toMatchObject({ slot: "lobby", a_id: deal.a, b_id: deal.b, used: false, fit: null });
      expect(stored.plan).toMatchObject({ source: "producer" });
      // A second pass that night, and the next morning's, write nothing more.
      expect(await writeNightPlans(t.db, NIGHT, { model: writer })).toEqual({ day: DAY, skipped: "nothing_due" });
      expect(writer.count("plan")).toBe(1);

      // The morning's lobby pass makes the date: no director call, the stored scenes in the actors' prompts.
      vi.setSystemTime(MORNING);
      const model = promptModel();
      setModelForTests(model);
      const made = await refreshLobby(t.db, MORNING);
      expect(made.created).toBeTruthy();
      const ep = await episodeOf(made.created!);
      expect(ep).toMatchObject({ id: stored.episode_id, a: deal.a, b: deal.b, plan: "producer" });
      expect(model.count("plan")).toBe(0);
      expect(userOf(model.seen.find((x) => x.kind === "line")!.messages)).toContain("NIGHT scene 1");
      expect((await plans())[0]).toMatchObject({ used: true, fit: true });
      // The owner's view says a plan was written and used, and never shows its words.
      const view = await nightPlansView(t.db);
      expect(view[0]).toMatchObject({ day: DAY, slot: "lobby", written: true, used: true, fit: true });
      expect(JSON.stringify(view)).not.toContain("NIGHT scene");
    });

    it("the engine decides the date at date time exactly as it would have without a plan", async () => {
      vi.useFakeTimers({ now: NIGHT, toFake: ["Date"] });
      const deal = (await lobbyDeal(t.db, new Date(`${DAY}T12:00:00Z`), 0))!;
      await writeNightPlans(t.db, NIGHT, { model: promptModel({ plan: () => nightPlan() }) });
      const [stored] = await plans();
      const alone = (await buildTemplateDate(t.db, stored.episode_id, deal.a, deal.b, deal.thumbs))!;
      vi.setSystemTime(MORNING);
      setModelForTests(promptModel());
      const made = await refreshLobby(t.db, MORNING);
      const row = (await t.db.query<{ ending: string; seed: string; drama_answer: string }>(`select e.ending, e.seed::text as seed, e.drama_answer from watch_parties w join episodes e on e.id = w.episode_id where w.id = $1`, [made.created])).rows[0];
      expect(row).toEqual({ ending: alone.decided.ending, seed: String(alone.built.seed), drama_answer: alone.decided.drama_answer });
    });

    it("a date that turned out differently from the one planned plays from the rules plan", async () => {
      vi.useFakeTimers({ now: NIGHT, toFake: ["Date"] });
      const deal = (await lobbyDeal(t.db, new Date(`${DAY}T12:00:00Z`), 0))!;
      await writeNightPlans(t.db, NIGHT, { model: promptModel({ plan: () => nightPlan() }) });
      vi.setSystemTime(MORNING);
      const model = promptModel();
      setModelForTests(model);
      // The same two, but a dare was added to the night: another date than the one the plan was written for.
      const made = await createTemplateParty(t.db, deal.a, deal.b, { ...deal.thumbs, dare: "Order for both of you without asking." });
      if (!made?.ok) throw new Error("no room");
      expect((await episodeOf(made.id)).plan).toBe("rules");
      expect(model.count("plan")).toBe(0);
      expect(userOf(model.seen.find((x) => x.kind === "line")!.messages)).not.toContain("NIGHT scene");
      expect((await plans())[0]).toMatchObject({ used: true, fit: false });
    });

    it("another pair, another day, or the pair the other way round never takes a plan; a plan is used once", async () => {
      vi.useFakeTimers({ now: NIGHT, toFake: ["Date"] });
      const deal = (await lobbyDeal(t.db, new Date(`${DAY}T12:00:00Z`), 0))!;
      await writeNightPlans(t.db, NIGHT, { model: promptModel({ plan: () => nightPlan() }) });
      const other = CAST.map((c) => c.id).find((id) => id !== deal.a && id !== deal.b)!;
      expect(await claimNightPlan(t.db, deal.a, other, MORNING)).toBeNull();
      expect(await claimNightPlan(t.db, deal.b, deal.a, MORNING)).toBeNull();
      expect(await claimNightPlan(t.db, deal.a, deal.b, NIGHT)).toBeNull(); // still the 12th: the plan is for the 13th
      expect(await claimNightPlan(t.db, deal.a, deal.b, MORNING)).not.toBeNull();
      expect(await claimNightPlan(t.db, deal.a, deal.b, MORNING)).toBeNull();
    });

    it("a model that writes no valid plan leaves a row with none, and the date plays from the rules plan", async () => {
      vi.useFakeTimers({ now: NIGHT, toFake: ["Date"] });
      const writer = promptModel({ plan: () => "{}" });
      const run = await writeNightPlans(t.db, NIGHT, { model: writer });
      expect(run).toMatchObject({ written: [{ slot: "lobby", ok: false }] });
      expect(writer.count("plan")).toBe(2); // one try and one more: nobody is waiting
      expect((await plans())[0].plan).toBeNull();
      vi.setSystemTime(MORNING);
      const model = promptModel();
      setModelForTests(model);
      const made = await refreshLobby(t.db, MORNING);
      expect((await episodeOf(made.created!)).plan).toBe("rules");
      expect(model.count("plan")).toBe(0);
    });

    it("without PRODUCER_PLANS=1, or with DATE_PLAN_AT_NIGHT=0, nothing is written; off, the house date asks the director first as before", async () => {
      vi.useFakeTimers({ now: NIGHT, toFake: ["Date"] });
      vi.unstubAllEnvs();
      const writer = promptModel({ plan: () => nightPlan() });
      expect(await writeNightPlans(t.db, NIGHT, { model: writer })).toEqual({ day: DAY, skipped: "off" });
      expect(writer.count("plan")).toBe(0);
      vi.stubEnv("PRODUCER_PLANS", "1");
      await writeNightPlans(t.db, NIGHT, { model: writer });
      vi.stubEnv("DATE_PLAN_AT_NIGHT", "0");
      expect(await writeNightPlans(t.db, new Date("2026-11-13T23:20:00Z"), { model: writer })).toMatchObject({ skipped: "off" });
      vi.setSystemTime(MORNING);
      const model = promptModel();
      setModelForTests(model);
      const made = await refreshLobby(t.db, MORNING);
      const ep = await episodeOf(made.created!);
      expect(model.seen.find((x) => x.kind !== "hot_takes")!.kind).toBe("plan");
      expect(ep.plan).toBe("director");
      // The stored plan was not read: its row is untouched and the date has an id of its own.
      const [stored] = await plans();
      expect(stored.used).toBe(false);
      expect(ep.id).not.toBe(stored.episode_id);
    });

    it("the date the vote is staging gets a plan the night before, from the votes as they stand", async () => {
      vi.useFakeTimers({ now: new Date("2026-11-12T12:00:00Z"), toFake: ["Date"] });
      const { situationChoices, situationDeal, voteSituation, playVotedSituation } = await import("@/lib/situations");
      await voteSituation(t.db, "fan-a", situationChoices("2026-11-12")[1].id, new Date("2026-11-12T12:00:00Z"));
      const deal = await situationDeal(t.db, "2026-11-12");
      if (!deal.ok) throw new Error("no deal");
      vi.setSystemTime(NIGHT);
      const run = await writeNightPlans(t.db, NIGHT, { model: promptModel({ plan: () => nightPlan("VOTED") }) });
      // One plan a night: the voted date's. The lobby only makes a room that day once somebody has started this one.
      expect(run).toEqual({ day: DAY, written: [expect.objectContaining({ slot: "situation", a: deal.first, b: deal.second, ok: true })] });
      vi.setSystemTime(MORNING);
      const model = promptModel();
      setModelForTests(model);
      const played = await playVotedSituation(t.db, MORNING);
      if (!played.played) throw new Error(`not played: ${played.reason}`);
      const ep = await episodeOf(played.party_id);
      expect(ep.plan).toBe("producer");
      expect(userOf(model.seen.find((x) => x.kind === "line")!.messages)).toContain("VOTED scene 1");
    });
  });

  describe("the night director's prompt and its checks", () => {
    it("carries the day's beat and each side's own story, and says the plan never changes the ending", async () => {
      vi.useFakeTimers({ now: new Date("2026-11-12T12:00:00Z"), toFake: ["Date"] });
      const lie = await hear(t.db, { holder: JUNE, about: DEX, claim: "Dex owns a boat he says he doesn't.", toldBy: SABLE, source: "scene:n1", isTrue: false });
      await markUsed(t.db, lie!.id, "ep-n1", { to: DEX });
      await hear(t.db, { holder: DEX, about: SABLE, claim: "Sable left her last date at the table.", toldBy: NELL, source: "scene:n2", isTrue: true });
      await runProducer(t.db, new Date("2026-11-12T12:00:00Z"), { model: null });
      const beat = (await beatFor(t.db, "2026-11-12"))!;
      const date = (await buildTemplateDate(t.db, "00000000-0000-4000-8000-000000000077", DEX, SABLE))!;
      const [system, user] = nightPlanMessages(date.built, date.decided, beat).map((m) => m.content);
      expect(system).toContain("You are the story editor");
      expect(system).toContain("None of it changes the ending");
      const data = JSON.parse(user.slice(user.indexOf("\n") + 1)) as { story: { going_around: string; character_a: { has_heard?: string[]; wants_this_week?: string }; character_b: { wants_this_week?: string } }; facts: string[] };
      expect(data.story.going_around).toBe(beat.previously.replace("Previously: ", ""));
      expect(data.story.character_a.has_heard?.[0]).toContain("Sable left her last date at the table.");
      expect(data.story.character_a.wants_this_week).toContain("really said it");
      expect(data.story.character_b.wants_this_week).toContain("stand by it");
      // The engine's facts are the same ones the director always got, and nothing says whether a claim is true.
      expect(data.facts[0]).toMatch(/^It ends: /);
      expect(user).not.toMatch(/is_true|isn't true|not true/);
    });

    it("a beat that carries the other side's want for the week is replaced by that side's rules beats", async () => {
      vi.useFakeTimers({ now: new Date("2026-11-12T12:00:00Z"), toFake: ["Date"] });
      await setWant(t.db, { holder: DEX, want: "Find out who started the lighthouse rumour before Friday.", kind: "prove", about: SABLE, setBy: "producer" });
      const date = (await buildTemplateDate(t.db, "00000000-0000-4000-8000-000000000078", DEX, SABLE))!;
      const rules = rulesPlan(date.built.input, date.decided, date.built.characters, date.built.setup.producer, date.built.setup.venue);
      const leaky = planJson({
        acts: [0, 1, 2].map((i) => ({ scene: `Scene ${i + 1} at the venue.`, a: "You ask what you came to ask.", b: i === 1 ? "You know they want to find out who started the lighthouse rumour, so you get ahead of it." : "You take your time." })),
      });
      const plan = (await writeNightPlan(promptModel({ plan: () => leaky }), date.built, date.decided, null))!;
      expect(plan.source).toBe("producer");
      expect(plan.acts.map((x) => x.b)).toEqual(rules.acts.map((x) => x.b));
      expect(plan.acts[0].a).toBe("You ask what you came to ask.");
    });

    it("a scene that spells out what one of them heard is replaced by that act's rules scene; the rest of the plan stands", async () => {
      vi.useFakeTimers({ now: new Date("2026-11-12T12:00:00Z"), toFake: ["Date"] });
      await hear(t.db, { holder: DEX, about: SABLE, claim: "Sable left her last date at the table.", toldBy: NELL, source: "scene:n3", isTrue: true });
      const date = (await buildTemplateDate(t.db, "00000000-0000-4000-8000-000000000080", DEX, SABLE))!;
      const rules = rulesPlan(date.built.input, date.decided, date.built.characters, date.built.setup.producer, date.built.setup.venue);
      const telling = planJson({
        acts: [0, 1, 2].map((i) => ({ scene: i === 1 ? "Dex brings up that Sable left her last date at the table, and the room goes quiet." : `Scene ${i + 1} by the window.`, a: "You bring up what you heard, in your own words.", b: "You take your time." })),
      });
      const plan = (await writeNightPlan(promptModel({ plan: () => telling }), date.built, date.decided, null))!;
      expect(plan.acts.map((x) => x.scene)).toEqual(["Scene 1 by the window.", rules.acts[1].scene, "Scene 3 by the window."]);
      expect(plan.acts[1].a).toBe("You bring up what you heard, in your own words.");
    });

    it("the fit key moves with the pair's order, the place and the engine's decision, and holds still otherwise", async () => {
      const a = (await buildTemplateDate(t.db, "00000000-0000-4000-8000-000000000079", DEX, SABLE))!;
      const again = (await buildTemplateDate(t.db, "00000000-0000-4000-8000-000000000079", DEX, SABLE))!;
      expect(fitKey(again.built, again.decided)).toBe(fitKey(a.built, a.decided));
      const flipped = (await buildTemplateDate(t.db, "00000000-0000-4000-8000-000000000079", SABLE, DEX))!;
      expect(fitKey(flipped.built, flipped.decided)).not.toBe(fitKey(a.built, a.decided));
      const other = { ...a.decided, ending: a.decided.ending === "friends" ? ("disaster" as const) : ("friends" as const) };
      expect(fitKey(a.built, other)).not.toBe(fitKey(a.built, a.decided));
      const moved = { ...a.built, setup: { ...a.built.setup, venue: a.built.setup.venue === "rooftop_bar" ? ("jazz_bar" as const) : ("rooftop_bar" as const) } };
      expect(fitKey(moved, a.decided)).not.toBe(fitKey(a.built, a.decided));
    });
  });
});
