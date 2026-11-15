/**
 * The producer (lib/producer.ts): tomorrow's beat from the story state's tensions (deterministic, once per day, the
 * owner's skip), the wants it overwrites and the rules never clobber, the vote's twists and the dealt ballot when there
 * is no beat, what a Botchelor season allows, the daily lines, what came of a beat, and that none of it reaches the
 * engine. No paid calls.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as adminGet, POST as adminPost } from "@/app/api/admin/producer/route";
import { GET as storyGet } from "@/app/api/story/route";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { ensureHouseScene } from "@/lib/house-scenes";
import { shortName } from "@/lib/names";
import {
  beatFor,
  beatLines,
  beatOutcome,
  beatTwists,
  beatWants,
  checkLogline,
  clipStory,
  pickTension,
  producedDay,
  producerOn,
  producerView,
  runProducer,
  settleBeats,
  skipBeat,
  skipDay,
  stagedPair,
  storyToday,
  tensionKey,
  twistsFor,
  unskipBeat,
  type Stage,
} from "@/lib/producer";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { setSeasonFormatForTests } from "@/lib/season-format-store";
import { showSince } from "@/lib/show-since";
import { playVotedSituation, situationBoard, situationChoices, situationDeal, voteSituation } from "@/lib/situations";
import { ensureWants, hear, markUsed, setOpinion, tensions, wantFor, type Tension } from "@/lib/story-state";
import { buildTemplateDate } from "@/lib/watch";
import { BASE_URL, episodeJson, scriptedModel, scriptOutcome, startTestDb } from "./helpers";
import { promptModel } from "./prompt-model";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});

const CAST = HOUSE_CHARACTERS.slice(0, 4);
const [NELL, DEX, SABLE, JUNE] = CAST.map((c) => c.id);
const first = (id: string) => shortName(HOUSE_CHARACTERS.find((c) => c.id === id)?.name ?? id);
const nm = (id: string) => first(id);
// Thursday noon: a pass that was missed produces today; the 23:20 pass produces tomorrow.
const NOW = new Date("2026-11-12T12:00:00Z");
const NIGHT = new Date("2026-11-12T23:20:00Z");
const TODAY = "2026-11-12";
const TOMORROW = "2026-11-13";
const stage = (over: Partial<Stage> = {}): Stage => ({ cast: new Set(CAST.map((c) => c.id)), lead: null, venues: [], ...over });

beforeEach(async () => {
  await t.reset();
  await t.db.query("delete from story_beats");
  await t.db.query("delete from watch_parties");
  setSeasonCastForTests(CAST.map((c) => c.id));
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  setSeasonCastForTests(null);
  setSeasonFormatForTests(null);
});

/** Dex knows what Sable said about him (June repeated it to his face): the hottest tension, with its rows. */
async function dexKnowsWhatSableSaid() {
  const lie = await hear(t.db, { holder: JUNE, about: DEX, claim: "Dex owns a boat he says he doesn't.", toldBy: SABLE, source: "scene:p1", isTrue: false });
  const used = await markUsed(t.db, lie!.id, "ep-p1", { to: DEX });
  return { heard: lie!.id, knows: used.knows!.id };
}
/** Nell and June both want Dex. */
async function rivalsForDex() {
  await setOpinion(t.db, { holder: NELL, about: DEX, trust: 1, attraction: 2, take: "I keep thinking about him.", basis: "firsthand", source: "ep-r1" });
  await setOpinion(t.db, { holder: JUNE, about: DEX, trust: 1, attraction: 1, take: "He's funnier than he lets on.", basis: "firsthand", source: "ep-r2" });
}
const tension = (over: Partial<Tension>): Tension => ({ kind: "rivals", a: NELL, b: JUNE, about: DEX, weight: 4, line: "x", evidence: {}, ...over });

describe("the switch and the day", () => {
  it("PRODUCER is on unless it is 0, and needs the story state", () => {
    expect(producerOn({})).toBe(true);
    expect(producerOn({ PRODUCER: "0" })).toBe(false);
    expect(producerOn({ STORY_STATE: "0" })).toBe(false);
  });

  it("the 23:20 pass produces tomorrow; any earlier pass, today (a missed night is caught up)", () => {
    expect(producedDay(NIGHT)).toBe(TOMORROW);
    expect(producedDay(new Date("2026-11-12T22:20:00Z"))).toBe(TODAY);
    expect(producedDay(new Date("2026-11-13T00:20:00Z"))).toBe(TOMORROW);
  });
});

describe("picking the beat", () => {
  it("takes the hottest tension, the same every time, and steps one that was just told behind one that wasn't", () => {
    const hot = tension({ kind: "knows_said", a: DEX, b: SABLE, about: DEX, weight: 8 });
    const rivals = tension({ weight: 5 });
    const list = [rivals, hot];
    expect(pickTension(list, TODAY)).toBe(hot);
    expect(pickTension([...list].reverse(), TODAY)).toBe(hot);
    expect(pickTension(list, TODAY, new Set([tensionKey(hot)]))).toBe(rivals);
    // Only stories already told are left: the hottest is told again rather than nothing.
    expect(pickTension(list, TODAY, new Set(list.map(tensionKey)))).toBe(hot);
    expect(pickTension([], TODAY)).toBeNull();
  });

  it("deals a tie from the day, not from the list's order", () => {
    const x = tension({ a: NELL, b: JUNE, about: DEX, weight: 4 });
    const y = tension({ a: SABLE, b: JUNE, about: NELL, weight: 4 });
    const days = ["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17"];
    const picks = days.map((d) => pickTension([x, y], d));
    expect(days.map((d) => pickTension([y, x], d))).toEqual(picks);
    expect(new Set(picks).size).toBe(2);
  });

  it("the two lines and the template logline name people and never say whether a claim is true", () => {
    const said = tension({ kind: "knows_said", a: DEX, b: SABLE, about: DEX, line: "Dex knows Sable said: “…” (it isn't true)." });
    const lines = beatLines(said, nm, false);
    expect(lines.previously).toBe(`Previously: ${first(DEX)} found out what ${first(SABLE)} has been saying.`);
    expect(lines.tonight).toBe(`Tonight: ${first(DEX)} wants an answer from ${first(SABLE)}.`);
    expect(lines.logline).toContain("Tonight, ");
    // Opposing claims list the true holder first; the public lines order by name, so the order gives nothing away.
    const one = beatLines(tension({ kind: "opposing_claims", a: NELL, b: JUNE, about: DEX }), nm, true);
    const other = beatLines(tension({ kind: "opposing_claims", a: JUNE, b: NELL, about: DEX }), nm, true);
    expect(one).toEqual(other);
    for (const l of [lines, one]) expect(`${l.previously} ${l.tonight} ${l.logline}`).not.toMatch(/true|lie|lying/i);
  });

  it("a model's logline is kept only when it is one checked line that names someone and says nothing about the truth", () => {
    const names = ["Dex", "Sable"];
    expect(checkLogline("Dex has questions for Sable, and Sable has run out of places to hide.", names)).toBe("Dex has questions for Sable, and Sable has run out of places to hide.");
    expect(checkLogline('"Dex has questions for Sable tonight, at last."', names)).toBe("Dex has questions for Sable tonight, at last.");
    expect(checkLogline("Sable's lie about Dex finally catches up with her.", names)).toBeNull();
    expect(checkLogline("Somebody has questions tonight, and somebody else is hiding.", names)).toBeNull();
    expect(checkLogline("Dex.", names)).toBeNull();
    expect(checkLogline(`Dex ${"really ".repeat(30)}wants an answer.`, names)).toBeNull();
    expect(checkLogline("Dex asks Sable.\n#botchelor", names)).toBeNull();
  });
});

describe("what a beat hands out", () => {
  it("wants for the two or three it is about, the cast only, the same words for both where the truth could show", () => {
    const cast = new Set(CAST.map((c) => c.id));
    const said = beatWants(tension({ kind: "knows_said", a: DEX, b: SABLE, about: DEX }), nm, cast);
    expect(said.map((w) => [w.holder, w.kind, w.about])).toEqual([[DEX, "settle_score", SABLE], [SABLE, "protect", DEX]]);
    const claims = beatWants(tension({ kind: "opposing_claims", a: NELL, b: JUNE, about: DEX }), nm, cast);
    expect(claims).toHaveLength(3);
    expect(claims[0].want).toBe(claims[1].want);
    // Someone off the cast holds no want.
    expect(beatWants(tension({ kind: "rivals", a: NELL, b: JUNE, about: "someone-else" }), nm, cast).map((w) => w.holder)).toEqual([NELL, JUNE]);
  });

  it("twists: who gets the date for rivals, whose story gets asked about for claims, where for two who should share a room", () => {
    const rivals = beatTwists(tension({}), nm, stage(), TODAY)!;
    expect(rivals.map((x) => x.pair)).toEqual([[DEX, JUNE], [DEX, NELL], [JUNE, NELL]]);
    expect(rivals.map((x) => x.id)).toEqual(["twist-1", "twist-2", "twist-3"]);
    const claims = beatTwists(tension({ kind: "opposing_claims" }), nm, stage(), TODAY)!;
    expect(claims.map((x) => x.want?.holder)).toEqual([JUNE, NELL]);
    expect(claims.every((x) => x.pair[1] === DEX)).toBe(true);
    const room = beatTwists(tension({ kind: "mutual_distrust", a: NELL, b: SABLE, about: null }), nm, stage(), TODAY)!;
    expect(room).toHaveLength(2);
    expect(room[0].venue).not.toBe(room[1].venue);
    expect(room.every((x) => x.pair[0] === NELL && x.pair[1] === SABLE)).toBe(true);
    // The same day deals the same places.
    expect(beatTwists(tension({ kind: "mutual_distrust", a: NELL, b: SABLE, about: null }), nm, stage(), TODAY)).toEqual(room);
  });

  it("a Botchelor season only ever stages the lead with a suitor still in", () => {
    const lead = stage({ lead: { lead: NELL, suitors: [DEX, JUNE] } });
    expect(stagedPair(DEX, NELL, lead)).toEqual([NELL, DEX]);
    expect(stagedPair(DEX, JUNE, lead)).toBeNull();
    expect(stagedPair(NELL, SABLE, lead)).toBeNull(); // Sable went home
    // Two suitors who both want the lead: the vote is who gets tonight's date with her, and never suitor with suitor.
    const rivals = beatTwists(tension({ a: DEX, b: JUNE, about: NELL }), nm, lead, TODAY)!;
    expect(rivals.map((x) => x.pair)).toEqual([[NELL, DEX], [NELL, JUNE]]);
    // Two suitors who should be put in a room can't be: no twists, so the dealt ballot stands.
    expect(beatTwists(tension({ kind: "knows_said", a: DEX, b: JUNE, about: DEX }), nm, lead, TODAY)).toBeNull();
  });
});

describe("the nightly run", () => {
  it("stages the hottest tension for tomorrow with its evidence, once: a second pass changes nothing", async () => {
    const ev = await dexKnowsWhatSableSaid();
    await rivalsForDex();
    const run = await runProducer(t.db, NIGHT, { model: null });
    expect(run).toMatchObject({ day: TOMORROW, beat: "same_room", tension: "knows_said", who: [DEX, SABLE], logline_by: "template" });
    const beat = (await beatFor(t.db, TOMORROW))!;
    expect(beat).toMatchObject({ kind: "same_room", status: "staged", scene: "confrontation", who: [DEX, SABLE], about: DEX });
    expect(beat.evidence).toEqual({ knows: [ev.knows], heard: [ev.heard] });
    expect(beat.previously).toBe(`Previously: ${first(DEX)} found out what ${first(SABLE)} has been saying.`);
    expect(beat.tonight).toMatch(/^Tonight: .*you pick where/);
    expect(beat.choices).toHaveLength(2);
    // The owner's line may say the claim is untrue; nothing a viewer sees does.
    expect(beat.why).toContain("it isn't true");
    expect(`${beat.logline} ${beat.previously} ${beat.tonight} ${JSON.stringify(beat.choices)}`).not.toMatch(/true|lie\b/i);
    // Today has no beat: the run was for tomorrow.
    expect(await beatFor(t.db, TODAY)).toBeNull();

    const before = (await t.db.query(`select * from story_beats order by day`)).rows;
    expect(await runProducer(t.db, NIGHT, { model: null })).toEqual({ day: TOMORROW, skipped: "already" });
    expect(await runProducer(t.db, new Date("2026-11-13T00:20:00Z"), { model: null })).toEqual({ day: TOMORROW, skipped: "already" });
    expect((await t.db.query(`select * from story_beats order by day`)).rows).toEqual(before);
  });

  it("the same state gives the same beat on a fresh run", async () => {
    await dexKnowsWhatSableSaid();
    await rivalsForDex();
    await runProducer(t.db, NIGHT, { model: null });
    const one = await beatFor(t.db, TOMORROW);
    await t.db.query("delete from story_beats");
    await t.db.query("delete from character_wants");
    await runProducer(t.db, NIGHT, { model: null });
    expect(await beatFor(t.db, TOMORROW)).toEqual(one);
  });

  it("doesn't tell the same story three nights running: yesterday's tension steps behind the next one", async () => {
    await dexKnowsWhatSableSaid();
    await rivalsForDex();
    expect(await runProducer(t.db, NOW, { model: null })).toMatchObject({ day: TODAY, tension: "knows_said" });
    expect(await runProducer(t.db, NIGHT, { model: null })).toMatchObject({ day: TOMORROW, tension: "rivals", beat: "rival_date" });
  });

  it("overwrites the wants of the people it is about, and the rules never write over them", async () => {
    await dexKnowsWhatSableSaid();
    await ensureWants(t.db, NOW);
    expect((await wantFor(t.db, DEX, NOW))!.set_by).toBe("rules");
    await runProducer(t.db, NOW, { model: null });
    const dex = (await wantFor(t.db, DEX, NOW))!;
    expect(dex).toMatchObject({ set_by: "producer", kind: "settle_score", about_id: SABLE, want: `Find out whether ${first(SABLE)} really said it, and hear it from ${first(SABLE)}.` });
    expect((await wantFor(t.db, SABLE, NOW))!).toMatchObject({ set_by: "producer", kind: "protect", about_id: DEX });
    // The hourly upkeep's rules pass leaves the producer's wants alone, and still looks after everyone else.
    await ensureWants(t.db, NOW);
    expect((await wantFor(t.db, DEX, NOW))!).toEqual(dex);
    expect((await wantFor(t.db, NELL, NOW))!.set_by).toBe("rules");
    expect((await beatFor(t.db, TODAY))!.wants.map((w) => w.holder)).toEqual([DEX, SABLE]);
  });

  it("uses the model's logline when it passes, and the template when it doesn't or the call fails", async () => {
    await dexKnowsWhatSableSaid();
    const good = promptModel({ logline: () => `${first(DEX)} has one question for ${first(SABLE)}, and no patience left.` });
    expect(await runProducer(t.db, NOW, { model: good })).toMatchObject({ logline_by: "model" });
    expect((await beatFor(t.db, TODAY))!.logline).toBe(`${first(DEX)} has one question for ${first(SABLE)}, and no patience left.`);
    // The writer is given names and the two lines: never the claim's truth.
    const asked = good.seen.find((x) => x.kind === "logline")!.messages.map((m) => m.content).join(" ");
    expect(asked).not.toMatch(/isn't true|not true|is_true/);

    await t.db.query("delete from story_beats");
    const bad = promptModel({ logline: () => `${first(SABLE)}'s lie about ${first(DEX)} catches up with her.` });
    expect(await runProducer(t.db, NOW, { model: bad })).toMatchObject({ logline_by: "template" });
    await t.db.query("delete from story_beats");
    expect(await runProducer(t.db, NOW, { model: promptModel({ logline: () => new Error("down") }) })).toMatchObject({ logline_by: "template" });
  });

  it("a quiet house has no beat, and the row keeps the next pass from asking again", async () => {
    expect(await runProducer(t.db, NOW, { model: null })).toEqual({ day: TODAY, beat: null, reason: "no_tension" });
    expect(await beatFor(t.db, TODAY)).toBeNull();
    expect(await twistsFor(t.db, TODAY)).toBeNull();
    expect(await runProducer(t.db, NOW, { model: null })).toEqual({ day: TODAY, skipped: "already" });
  });

  it("PRODUCER=0 writes nothing and reads nothing", async () => {
    await dexKnowsWhatSableSaid();
    await runProducer(t.db, NOW, { model: null });
    vi.stubEnv("PRODUCER", "0");
    expect(await runProducer(t.db, NIGHT, { model: null })).toEqual({ day: TOMORROW, skipped: "off" });
    expect((await t.db.query(`select 1 from story_beats`)).rows).toHaveLength(1);
    expect(await beatFor(t.db, TODAY)).toBeNull();
    expect(await storyToday(t.db, NOW)).toBeNull();
    expect((await situationBoard(t.db, "u1", NOW))!.headline).toBeNull();
  });
});

describe("the owner's skip", () => {
  it("skip tomorrow's beat: the night's run leaves the day alone, with no beat, wants or twists", async () => {
    await dexKnowsWhatSableSaid();
    expect(skipDay(NOW)).toBe(TOMORROW);
    await skipBeat(t.db, TOMORROW);
    expect(await runProducer(t.db, NIGHT, { model: null })).toEqual({ day: TOMORROW, skipped: "owner" });
    expect(await beatFor(t.db, TOMORROW)).toBeNull();
    expect(await twistsFor(t.db, TOMORROW)).toBeNull();
    expect(await wantFor(t.db, DEX, new Date("2026-11-13T12:00:00Z"))).toBeNull();
    // Taken back before the run, the day is free again.
    await unskipBeat(t.db, TOMORROW);
    expect(await runProducer(t.db, NIGHT, { model: null })).toMatchObject({ day: TOMORROW, beat: "same_room" });
  });

  it("skipping after the run withdraws the staged beat and its twists; undo stages it again", async () => {
    await dexKnowsWhatSableSaid();
    await runProducer(t.db, NIGHT, { model: null });
    await skipBeat(t.db, TOMORROW);
    expect(await beatFor(t.db, TOMORROW)).toBeNull();
    expect((await producerView(t.db, NOW)).next_skipped).toBe(true);
    await unskipBeat(t.db, TOMORROW);
    expect((await beatFor(t.db, TOMORROW))!.status).toBe("staged");
  });

  it("/api/admin/producer needs the admin, shows the week with its evidence, and takes the skip", async () => {
    const PW = ["pw", "for", "producer", "tests"].join("-");
    vi.stubEnv("FRONTIER_PASSWORD", PW);
    const headers = { "content-type": "application/json", "x-frontier-key": PW };
    await dexKnowsWhatSableSaid();
    await runProducer(t.db, NOW, { model: null });
    expect((await adminGet(new Request(`${BASE_URL}/api/admin/producer`))).status).toBe(401);
    expect((await adminPost(new Request(`${BASE_URL}/api/admin/producer`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "skip" }) }))).status).toBe(401);
    const view = await (await adminGet(new Request(`${BASE_URL}/api/admin/producer`, { headers }))).json();
    expect(view.beats[0]).toMatchObject({ day: TODAY, status: "staged", tension: "knows_said" });
    expect(view.beats[0].who.map((w: { name: string }) => w.name)).toEqual([first(DEX), first(SABLE)]);
    // The owner sees the claim and whether it is true.
    expect(view.beats[0].evidence.join(" ")).toContain("Dex owns a boat he says he doesn't.");
    expect(view.beats[0].evidence.join(" ")).toContain("not true");
    expect(view.switches).toMatchObject({ producer: true });
    const skipped = await (await adminPost(new Request(`${BASE_URL}/api/admin/producer`, { method: "POST", headers, body: JSON.stringify({ action: "skip" }) }))).json();
    expect(skipped).toMatchObject({ next_day: TOMORROW, next_skipped: true });
    const back = await (await adminPost(new Request(`${BASE_URL}/api/admin/producer`, { method: "POST", headers, body: JSON.stringify({ action: "unskip" }) }))).json();
    expect(back.next_skipped).toBe(false);
  });
});

describe("tonight's vote", () => {
  it("with no beat, the ballot is the dealt roleplays exactly as before", async () => {
    await runProducer(t.db, NOW, { model: null });
    const board = (await situationBoard(t.db, "u1", NOW))!;
    expect(board.headline).toBeNull();
    expect(board.choices.map((c) => c.id)).toEqual(situationChoices(TODAY).map((c) => c.id));
    expect(await voteSituation(t.db, "u1", situationChoices(TODAY)[0].id, NOW)).toMatchObject({ ok: true });
    expect(await voteSituation(t.db, "u1", "twist-1", NOW)).toMatchObject({ ok: false, error: "not_on_the_ballot" });
  });

  it("with a beat, the ballot is its twists: the vote picks a situation, and only one on today's ballot counts", async () => {
    await rivalsForDex();
    await runProducer(t.db, NOW, { model: null });
    const board = (await situationBoard(t.db, "u1", NOW))!;
    expect(board.headline).toBe(`You pick who gets the date with ${first(DEX)}.`);
    expect(board.choices.map((c) => c.id)).toEqual(["twist-1", "twist-2", "twist-3"]);
    expect(board.choices[0].title).toBe(`${first(JUNE)} gets the date`);
    expect(await voteSituation(t.db, "u1", "twist-2", NOW)).toEqual({ ok: true, pick: "twist-2" });
    expect(await voteSituation(t.db, "u1", situationChoices(TODAY)[0].id, NOW)).toMatchObject({ ok: false, error: "not_on_the_ballot" });
    // No choice is an ending or anyone's odds: a twist is two people, a place or a question to ask.
    const twists = (await twistsFor(t.db, TODAY))!;
    for (const tw of twists) expect(Object.keys(tw).sort()).toEqual(["icon", "id", "pair", "premise", "title", "venue", "want"]);
  });

  it("the winning twist's two get the house's date, at its place; nobody voting makes no date", async () => {
    await setOpinion(t.db, { holder: NELL, about: SABLE, trust: -2, attraction: -1, take: "I don't believe a word.", basis: "firsthand", source: "ep-d1" });
    await setOpinion(t.db, { holder: SABLE, about: NELL, trust: -1, attraction: 0, take: "She decided about me early.", basis: "firsthand", source: "ep-d2" });
    await runProducer(t.db, NOW, { model: null });
    const twists = (await twistsFor(t.db, TODAY))!;
    expect(twists).toHaveLength(2);
    const next = new Date("2026-11-13T00:20:00Z");
    expect(await playVotedSituation(t.db, next)).toEqual({ played: false, day: TODAY, reason: "no_votes" });

    await voteSituation(t.db, "fan-a", "twist-2", NOW);
    await voteSituation(t.db, "fan-b", "twist-2", NOW);
    await voteSituation(t.db, "fan-c", "twist-1", NOW);
    const deal = await situationDeal(t.db, TODAY);
    expect(deal).toMatchObject({ ok: true, pair: twists[1].pair, winner: null, opts: { roleplay: null, venuePool: [twists[1].venue] } });
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const played = await playVotedSituation(t.db, next);
    if (!played.played) throw new Error(`not played: ${played.reason}`);
    expect(played.pick).toBe("twist-2");
    const ep = (await t.db.query<{ a: string; b: string; venue: string; roleplay: unknown }>(`select e.character_a as a, e.character_b as b, e.setup->>'venue' as venue, e.setup->'roleplay' as roleplay from watch_parties w join episodes e on e.id = w.episode_id where w.id = $1`, [played.party_id])).rows[0];
    expect([ep.a, ep.b]).toEqual(twists[1].pair);
    expect(ep.venue).toBe(twists[1].venue);
    expect(ep.roleplay).toBeNull();
    // The night keeps what won, so the next day's card and "Since you were here" can say it.
    const tomorrow = (await situationBoard(t.db, "fan-a", next))!;
    expect(tomorrow.last).toMatchObject({ title: twists[1].title, votes: 2, total: 3, won: true });
    const notes = (await t.db.query<{ title: string }>(`select title from notifications where kind = 'situation_on' and user_id = 'fan-a'`)).rows;
    expect(notes[0].title).toBe(`Your pick won: ${twists[1].title}`);
  });

  it("a beat picked on a day that already has votes leaves that day's ballot alone", async () => {
    await rivalsForDex();
    // A viewer voted on the dealt ballot this morning; the night's pass was missed and is caught up at noon.
    const dealt = situationChoices(TODAY)[0].id;
    await voteSituation(t.db, "early-bird", dealt, new Date("2026-11-12T08:00:00Z"));
    expect(await runProducer(t.db, NOW, { model: null })).toMatchObject({ day: TODAY, beat: "rival_date", twists: 0 });
    const beat = (await beatFor(t.db, TODAY))!;
    expect(beat.choices).toBeNull();
    expect(beat.tonight).toBe("Tonight: neither of them is backing down.");
    const board = (await situationBoard(t.db, "early-bird", NOW))!;
    expect(board.headline).toBeNull();
    expect(board.my_pick).toBe(dealt);
    // The night's pass for tomorrow is ahead of every vote, so tomorrow's ballot is the twists.
    await t.db.query("delete from story_beats");
    expect(await runProducer(t.db, NIGHT, { model: null })).toMatchObject({ day: TOMORROW, twists: 3 });
  });

  it("a twist about whose story gets asked hands the one who asks that want when it wins", async () => {
    await hear(t.db, { holder: NELL, about: DEX, claim: "Dex has never owned a boat.", toldBy: SABLE, source: "scene:o1", isTrue: true });
    await hear(t.db, { holder: JUNE, about: DEX, claim: "Dex owns a boat he says he doesn't.", toldBy: SABLE, source: "scene:o2", isTrue: false });
    expect(await runProducer(t.db, NOW, { model: null })).toMatchObject({ tension: "opposing_claims", beat: "surface_claim" });
    const twists = (await twistsFor(t.db, TODAY))!;
    const asks = twists.find((x) => x.want?.holder === JUNE)!;
    await voteSituation(t.db, "fan-a", asks.id, NOW);
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const next = new Date("2026-11-13T00:20:00Z");
    expect((await playVotedSituation(t.db, next)).played).toBe(true);
    expect((await wantFor(t.db, JUNE, next))!).toMatchObject({ set_by: "producer", about_id: DEX, want: `Ask ${first(DEX)} about what you heard, and watch how ${first(DEX)} takes it.` });
  });

  it("on a Botchelor season the twists stay inside the format, and a suitor sent home before the date makes no date", async () => {
    setSeasonFormatForTests("botchelor");
    setSeasonCastForTests([NELL], [DEX, JUNE], NELL);
    // Both suitors want the lead (the rules' own want for a suitor still in).
    await ensureWants(t.db, NOW);
    const list = await tensions(t.db, "2026-11-01", { now: NOW });
    expect(list[0]).toMatchObject({ kind: "rivals", about: NELL });
    await runProducer(t.db, NOW, { model: null });
    const twists = (await twistsFor(t.db, TODAY))!;
    expect(twists.map((x) => x.pair)).toEqual([[NELL, DEX], [NELL, JUNE]]);
    await voteSituation(t.db, "fan-a", "twist-2", NOW);
    // June goes home before the vote closes: the house books nothing it isn't allowed to.
    setSeasonCastForTests([NELL], [DEX], NELL);
    expect(await situationDeal(t.db, TODAY)).toEqual({ ok: false, reason: "no_cast" });
  });
});

describe("the daily lines", () => {
  it("storyToday gives today's two lines; the show's news card carries them along", async () => {
    await dexKnowsWhatSableSaid();
    expect(await storyToday(t.db, NOW)).toBeNull();
    await runProducer(t.db, NOW, { model: null });
    const story = (await storyToday(t.db, NOW))!;
    expect(story).toMatchObject({ day: TODAY, vote: true });
    expect(story.previously).toMatch(/^Previously: /);
    expect(story.tonight).toMatch(/^Tonight: /);
    // Since you were here: it rides along with real news, and never summons the card by itself.
    await t.db.query(`insert into owner_activity (user_id, last_seen, prev_seen) values ('fan-1', $1, $2)`, [NOW.toISOString(), new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString()]);
    expect(await showSince(t.db, "fan-1", NOW)).toBeNull();
    await t.db.query(
      `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, revealed_at, visibility)
       values ('pr-ep-1', 'system', $1, $2, 'a bar', '[]'::jsonb, '[]'::jsonb, 'T', 'F', 'friends', $3, 'public')`,
      [NELL, JUNE, new Date(NOW.getTime() - 60 * 60 * 1000).toISOString()],
    );
    expect((await showSince(t.db, "fan-1", NOW))!.story).toEqual({ previously: story.previously, tonight: story.tonight, vote: true });
  });

  it("the clip pipeline is offered the aired public dates the recent beats are about, with their logline", async () => {
    await dexKnowsWhatSableSaid();
    await runProducer(t.db, NOW, { model: null });
    const beat = (await beatFor(t.db, TODAY))!;
    const insert = (id: string, a: string, b: string, revealed: string | null, visibility = "public") =>
      t.db.query(
        `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, revealed_at, visibility, created_at)
         values ($1, 'system', $2, $3, 'a bar', '[]'::jsonb, '[]'::jsonb, 'T', 'F', 'disaster', $4, $5, $6)`,
        [id, a, b, revealed, visibility, new Date("2026-11-12T13:00:00Z").toISOString()],
      );
    await insert("pr-about", DEX, SABLE, new Date("2026-11-12T14:00:00Z").toISOString());
    await insert("pr-unaired", SABLE, DEX, null);
    await insert("pr-private", DEX, SABLE, new Date("2026-11-12T14:00:00Z").toISOString(), "private");
    await insert("pr-others", NELL, JUNE, new Date("2026-11-12T14:00:00Z").toISOString());
    const at = new Date("2026-11-12T15:00:00Z");
    const story = await clipStory(t.db, at);
    expect(story).toMatchObject({ day: TODAY, logline: beat.logline, previously: beat.previously, tonight: beat.tonight });
    expect(story.episodes).toEqual([{ id: "pr-about", day: TODAY, logline: beat.logline }]);
    vi.setSystemTime(at);
    expect(await (await storyGet(new Request(`${BASE_URL}/api/story`))).json()).toEqual(story);
    // A day with no beat is an empty answer, not an error.
    await t.db.query("delete from story_beats");
    expect(await clipStory(t.db, at)).toEqual({ day: null, logline: null, previously: null, tonight: null, episodes: [] });
  });
});

describe("what came of it", () => {
  it("two nights on, a beat is settled from the rows: the vote's date, dates between its people, claims that came up", async () => {
    const ev = await dexKnowsWhatSableSaid();
    await runProducer(t.db, NOW, { model: null });
    const beat = (await beatFor(t.db, TODAY))!;
    expect(await beatOutcome(t.db, beat)).toEqual({ vote: null, dates: [], claims_used: 0, settled: 0 });
    // Its night isn't over the next night...
    expect(await settleBeats(t.db, TOMORROW)).toBe(0);
    // ...and nothing came of it: missed.
    expect(await settleBeats(t.db, "2026-11-14")).toBe(1);
    expect((await beatFor(t.db, TODAY))!.status).toBe("missed");

    // Another beat, and this time the two of them went on a date that aired, and the fact was settled.
    await t.db.query("delete from story_beats");
    await runProducer(t.db, NOW, { model: null });
    await t.db.query(
      `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, revealed_at, visibility, created_at, status)
       values ('pr-came', 'system', $1, $2, 'a bar', '[]'::jsonb, '[]'::jsonb, 'T', 'F', 'disaster', $3, 'public', $3, 'ready')`,
      [DEX, SABLE, new Date("2026-11-13T01:00:00Z").toISOString()],
    );
    await t.db.query(`update character_knows_said set settled_at = $2, settled_in = 'pr-came' where id = $1`, [ev.knows, new Date("2026-11-13T02:00:00Z").toISOString()]);
    await runProducer(t.db, new Date("2026-11-14T23:20:00Z"), { model: null });
    const settled = (await t.db.query<{ status: string; outcome: { dates: { episode_id: string; aired: boolean; ending: string }[]; settled: number } }>(`select status, outcome from story_beats where day = $1`, [TODAY])).rows[0];
    expect(settled.status).toBe("played");
    expect(settled.outcome.dates).toEqual([{ episode_id: "pr-came", a: DEX, b: SABLE, aired: true, ending: "disaster" }]);
    expect(settled.outcome.settled).toBe(1);
    const view = await producerView(t.db, new Date("2026-11-15T12:00:00Z"));
    expect(view.beats.find((b) => b.day === TODAY)!.came).toContain('aired and ended "disaster"');
  });

  it("an unaired date's ending never reaches the outcome", async () => {
    await dexKnowsWhatSableSaid();
    await runProducer(t.db, NOW, { model: null });
    await t.db.query(
      `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, revealed_at, visibility, created_at, status)
       values ('pr-wait', 'system', $1, $2, 'a bar', '[]'::jsonb, '[]'::jsonb, 'T', 'F', 'disaster', null, 'public', $3, 'ready')`,
      [DEX, SABLE, new Date("2026-11-12T13:00:00Z").toISOString()],
    );
    const o = await beatOutcome(t.db, (await beatFor(t.db, TODAY))!);
    expect(o.dates).toEqual([{ episode_id: "pr-wait", a: DEX, b: SABLE, aired: false, ending: null }]);
  });
});

describe("the house's scene and the day's beat", () => {
  it("seats the beat's two people first; a skipped day or PRODUCER=0 leaves the room to the state's own tensions", async () => {
    const EXTRA = HOUSE_CHARACTERS[4].id;
    setSeasonCastForTests([...CAST.map((c) => c.id), EXTRA]);
    // Nell and June's date aired this afternoon: Dex, Sable and one more are left to talk about it.
    await t.db.query(
      `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, revealed_at, visibility, setup, transcript)
       values ('pr-house', 'system', $1, $2, 'a bar', '[]'::jsonb, '[]'::jsonb, 'T', 'F', 'friends', $3, 'public', '{"venue":"rooftop_bar"}'::jsonb, '[]'::jsonb)`,
      [NELL, JUNE, new Date("2026-11-12T16:00:00Z").toISOString()],
    );
    // The day's beat is about Dex and the extra one (the state itself holds no tension, so nothing else would seat them).
    await t.db.query(
      `insert into story_beats (day, season_id, kind, status, tension, who, about, logline, previously, tonight)
       values ($1, '2026-11-01', 'same_room', 'staged', 'mutual_distrust', $2::jsonb, null, 'x', 'Previously: x', 'Tonight: x')`,
      [TODAY, JSON.stringify([DEX, EXTRA])],
    );
    const evening = new Date("2026-11-12T18:20:00Z");
    const scene = async () => (await t.db.query<{ cast_ids: string[]; tension: { kind: string; a: string; b: string } | null; source: string }>(`select cast_ids, tension, source from house_scenes where day = $1`, [TODAY])).rows[0];
    const again = async () => {
      await t.db.query("delete from house_scenes");
      await t.db.query("delete from character_heard");
    };
    expect(await ensureHouseScene(t.db, evening)).toMatchObject({ source: "template" });
    expect((await scene()).tension).toEqual({ kind: "mutual_distrust", a: DEX, b: EXTRA, about: null });
    expect((await scene()).cast_ids.slice(0, 2)).toEqual([DEX, EXTRA]);

    await again();
    await skipBeat(t.db, TODAY);
    await ensureHouseScene(t.db, evening);
    expect((await scene()).tension).toBeNull();

    await again();
    await unskipBeat(t.db, TODAY);
    vi.stubEnv("PRODUCER", "0");
    await ensureHouseScene(t.db, evening);
    expect((await scene()).tension).toBeNull();
  });
});

describe("never the engine", () => {
  it("a beat, its wants and its twists leave a date's engine input and decision exactly as they were", async () => {
    await dexKnowsWhatSableSaid();
    await rivalsForDex();
    const id = "00000000-0000-4000-8000-000000000042";
    const before = (await buildTemplateDate(t.db, id, DEX, SABLE))!;
    await runProducer(t.db, NOW, { model: null });
    expect((await wantFor(t.db, DEX, NOW))!.set_by).toBe("producer");
    const after = (await buildTemplateDate(t.db, id, DEX, SABLE))!;
    expect(after.built.input).toEqual(before.built.input);
    expect(after.decided).toEqual(before.decided);
    expect(after.built.setup).toEqual(before.built.setup);
    // What changed is only what the character carries into its own prompt: this week's want.
    expect(after.built.characters[0].story?.want?.set_by).toBe("producer");
  });
});
