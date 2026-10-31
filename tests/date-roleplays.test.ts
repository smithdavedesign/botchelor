import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PATCH as answerRoute, POST as proposeRoute } from "@/app/api/couples/[a]/[b]/roleplay/route";
import { buildTurnMessages } from "@/lib/conversation";
import { answerRoleplay, checkCustomRoleplay, myRoleplays, pairRoleplay, proposeRoleplay, resolveTerms, ROLEPLAY_ROUNDS } from "@/lib/date-roleplays";
import { assembleCharacter, type Character } from "@/lib/character";
import { fixedEngine, NEUTRAL_SIGNALS, type CharacterSheet, type DateInput, type SideOutcome, type SideSetup } from "@/lib/engine";
import { formatContextOf, formatNote } from "@/lib/formats";
import { handleMcpMessage, MCP_TOOLS, type McpContext } from "@/lib/mcp";
import { computeRelationship, pairContext, type RelEpisode } from "@/lib/relationships";
import { dateShape } from "@/lib/moves";
import { listNotifications } from "@/lib/notifications";
import { DATE_ROLEPLAY_NEVER, DATE_ROLEPLAYS, dateRoleplayById, fillPremise, roleIndex, roleplayForActor, rolesLine, sameTerms, termsFor } from "@/lib/roleplays";
import { checkShowText } from "@/lib/safety";
import { createMatch } from "@/lib/swipes";
import { pickVenue } from "@/lib/venues";
import { api, BASE_URL, episodeJson, HOUSE_PARTNER_ID, newUserCookie, scriptedModel, scriptOutcome, startTestDb, userIdOf, validCharacter } from "./helpers";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

describe("the show's roleplays (lib/roleplays.ts)", () => {
  it("are unique, PG, adults-only, and name both of them", () => {
    expect(new Set(DATE_ROLEPLAYS.map((r) => r.id)).size).toBe(DATE_ROLEPLAYS.length);
    for (const r of DATE_ROLEPLAYS) {
      expect(r.premise, r.id).toMatch(/\{a\}/);
      expect(r.premise, r.id).toMatch(/\{b\}/);
      expect(checkShowText({ title: r.title, premise: r.premise, ...(r.roles ? { a: r.roles[0], b: r.roles[1] } : {}) }).ok, r.id).toBe(true);
      expect(checkCustomRoleplay({ title: r.title, premise: r.premise, roles: r.roles ? [r.roles[0], r.roles[1]] : null }), r.id).toBeNull();
    }
  });

  it("the never-list refuses family, school and power over the other, and leaves ordinary words alone", () => {
    for (const bad of ["my stepsister", "a step-father", "teacher and student", "the babysitter", "the boss and the intern", "she's drunk", "her brother"]) {
      expect(DATE_ROLEPLAY_NEVER.test(bad) || checkCustomRoleplay({ title: "x", premise: `${bad} at the fair, an evening together`, roles: null }) !== null, bad).toBe(true);
    }
    for (const fine of ["the steps of the old library", "a stepping stone", "two rival chefs"]) expect(DATE_ROLEPLAY_NEVER.test(fine), fine).toBe(false);
  });

  it("fills the premise and the roles in their names, with whoever plays the first role as {a}", () => {
    const def = dateRoleplayById("stowaway")!;
    const cast = [
      { id: "ana", name: "Ana Ruiz" },
      { id: "ben", name: "Ben Okafor" },
    ];
    const asCaptain = termsFor(def, "ana");
    expect(fillPremise(asCaptain, cast)).toMatch(/^Ana captains a small cargo starship; Ben is the stowaway/);
    expect(rolesLine(asCaptain, cast)).toBe("Ana plays the captain, Ben the stowaway");
    expect(rolesLine(termsFor(def, "ben"), cast)).toBe("Ben plays the captain, Ana the stowaway");
    expect(roleplayForActor(asCaptain, "ben", cast)).toMatchObject({ you_play: "the stowaway", they_play: "the captain" });
    expect(sameTerms(asCaptain, termsFor(def, "ana"))).toBe(true);
    expect(sameTerms(asCaptain, termsFor(def, "ben"))).toBe(false);
    expect([roleIndex(def.roles, 1), roleIndex(def.roles, "second"), roleIndex(def.roles, "The Stowaway"), roleIndex(def.roles, "pilot")]).toEqual([1, 1, 1, null]);
  });

  it("resolves an input to terms from the proposer's side, and refuses a written one that breaks the rules", () => {
    const mine = resolveTerms({ roleplay_id: "knight-dragon", my_role: "the dragon" }, "me", "them");
    expect(mine).toMatchObject({ ok: true, terms: { id: "knight-dragon", first: "them" } });
    expect(resolveTerms({ roleplay_id: "nope" }, "me", "them")).toMatchObject({ ok: false, error: "unknown_roleplay" });
    expect(resolveTerms({ roleplay_id: "knight-dragon", my_role: "the princess" }, "me", "them")).toMatchObject({ ok: false, error: "invalid_role" });
    const own = resolveTerms({ custom: { title: "Lighthouse keepers", premise: "{a} and {b} keep the last lighthouse, and the ships stopped coming.", roles: ["the keeper", "the apprentice"] }, my_role: 1 }, "me", "them");
    expect(own).toMatchObject({ ok: true, terms: { id: "custom", icon: "✨", roles: ["the keeper", "the apprentice"], first: "them" } });
    expect(resolveTerms({ custom: { title: "Detention", premise: "{a} is the teacher and {b} the student kept after class." } }, "me", "them")).toMatchObject({ ok: false, error: "roleplay_not_allowed" });
    expect(resolveTerms({ custom: { title: "x", premise: "too short" } }, "me", "them")).toMatchObject({ ok: false, error: "invalid_roleplay" });
  });
});

describe("the prompts a roleplay date writes with", () => {
  const sheetA: CharacterSheet = { name: "Mira", age: 27, bio: "a cartographer", traits: ["curious"], want: "a map reader", dealbreaker: "liars", house: false };
  const sheetB: CharacterSheet = { name: "Rafe", age: 30, bio: "a baker", traits: ["kind"], want: "an honest taster", dealbreaker: "rudeness", house: true };
  const side = (sheet: CharacterSheet, agendaId: "find_adventurous" | "test_sincerity"): SideSetup => ({ sheet, signals: NEUTRAL_SIGNALS, autonomy: "balanced", strategy: "genuine_chemistry", agendaId, note: null, gameBudget: 25 });
  const INPUT: DateInput = { a: side(sheetA, "find_adventurous"), b: side(sheetB, "test_sincerity") };
  const so = (w: boolean): SideOutcome => ({ wants_another: w, agenda_met: true, satisfied: w, dealbreaker_hit: null, want_met: null, note_followed: null });
  const OUTCOME = fixedEngine({ ending: "friends", sides: [so(false), so(false)] }).decide(INPUT, 1);
  const VENUE = pickVenue(1);
  const rp = { ...termsFor(dateRoleplayById("time-traveller")!, "mira"), agreed: "auto" as const };
  const cast = [
    { id: "mira", name: "Mira" },
    { id: "rafe", name: "Rafe" },
  ];
  const chars = (withRoleplay: boolean): [Character, Character] => {
    const a = assembleCharacter({ id: "mira", sheet: sheetA, soul: null, memory: null });
    const b = assembleCharacter({ id: "rafe", sheet: sheetB, soul: null, memory: null });
    if (withRoleplay) {
      a.roleplay = roleplayForActor(rp, "mira", cast);
      b.roleplay = roleplayForActor(rp, "rafe", cast);
    }
    return [a, b];
  };
  const system = (m: { role: string; content: string }[]) => m.find((x) => x.role === "system")!.content;
  const user = (m: { role: string; content: string }[]) => m.filter((x) => x.role === "user").map((x) => x.content).join("\n");

  it("each side gets its role and the section, on a date that can move and one that can't; other dates are unchanged", () => {
    const plain = buildTurnMessages(INPUT, OUTCOME, chars(false), "a_hard_question", VENUE, [], 0).messages;
    expect(system(plain)).not.toMatch(/TONIGHT'S ROLEPLAY/);
    expect(user(plain)).not.toMatch(/tonights_roleplay/);

    const first = buildTurnMessages(INPUT, OUTCOME, chars(true), "a_hard_question", VENUE, [], 0).messages;
    expect(system(first)).toMatch(/TONIGHT'S ROLEPLAY[\s\S]*\n\nJSON\n/);
    expect(user(first)).toMatch(/"tonights_roleplay"/);
    expect(user(first)).toMatch(/"you_play":"the time traveller"/);
    expect(user(first)).toMatch(/first line of the roleplay/);
    const second = buildTurnMessages(INPUT, OUTCOME, chars(true), "a_hard_question", VENUE, [], 1).messages;
    expect(user(second)).toMatch(/"you_play":"the local"/);

    const moves = buildTurnMessages(INPUT, OUTCOME, chars(true), "a_hard_question", VENUE, [], 0, undefined, {}, { shape: dateShape([], VENUE, 16, { moves: true }) }).messages;
    expect(system(moves)).toMatch(/GOING SOMEWHERE ELSE[\s\S]*TONIGHT'S ROLEPLAY[\s\S]*\n\nJSON\n/);
  });

  it("the format note carries it to the director, recap and morning after (never twice in the actor's own data)", () => {
    const ctx = formatContextOf({ setup: { roleplay: rp }, characters: cast });
    expect(ctx.roleplay).toMatch(/time traveller/);
    expect(formatNote("classic", ctx)).toMatch(/not their real lives/);
    const msgs = buildTurnMessages(INPUT, OUTCOME, chars(true), "a_hard_question", VENUE, [], 0, "classic", ctx).messages;
    expect(user(msgs).match(/not their real lives/g) ?? []).toHaveLength(0);
  });
});

describe("what a roleplay date leaves in their memory", () => {
  const ep = (id: string, roleplay: string | null, line: string, at: string): RelEpisode => ({
    id,
    created_at: at,
    revealed_at: at,
    visibility: "public",
    hidden: false,
    creator_id: "u1",
    character_a: "lo",
    character_b: "hi",
    ending: "second_date",
    sides: null,
    box_score: null,
    transcript: [
      { side: "a", dialogue: line, action: "", emotion: "warm", interest: 0.9, act: 0 } as Any,
      { side: "b", dialogue: "That sounds lovely, tell me more about it.", action: "", emotion: "warm", interest: 0.5, act: 0 } as Any,
    ],
    afterglow: null,
    venue: null,
    followup_of: null,
    roleplay,
  });

  it("its lines are roles talking: no facts, no plans from them, but the history and the next date remember it as a game", () => {
    const real = ep("e1", null, "I grew up on a houseboat and I still sleep best when the floor moves a little.", "2026-10-01T10:00:00Z");
    const played = ep("e2", "Rival spies", "I work for the agency, and my whole family has been spies since the war ended.", "2026-10-02T10:00:00Z");
    const rel = computeRelationship("lo", "hi", [real, played], ["Lo", "Hi"]);
    expect(rel.facts.map((f) => f.episode_id)).toEqual(["e1"]);
    expect(rel.history.find((h) => h.episode_id === "e2")?.roleplay).toBe("Rival spies");
    expect(rel.history.find((h) => h.episode_id === "e1")?.roleplay).toBeUndefined();
    expect(pairContext(rel, "hi", "u1", null)).toMatchObject({ roleplays_you_have_played: ["Rival spies"] });
  });
});

describe("agreeing on a roleplay (lib/date-roleplays.ts)", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const side = (wants: boolean): SideOutcome => ({ wants_another: wants, agenda_met: true, satisfied: wants, dealbreaker_hit: null, want_met: null, note_followed: null });
  async function book(own: string, partner: string, cookie: string, extra: Any = {}) {
    scriptOutcome({ ending: "friends", sides: [side(false), side(false)] });
    scriptedModel([episodeJson()]);
    const res = await api.createEpisode({ character_id: own, partner_id: partner, ...extra }, cookie);
    return { status: res.status, body: (await res.json()) as Any };
  }
  const setupOf = async (episodeId: string) => (await t.db.query<Any>(`select setup from episodes where id = $1`, [episodeId])).rows[0].setup;
  async function twoOwners() {
    const me = newUserCookie();
    const them = newUserCookie();
    const cass = await (await api.createCharacter(validCharacter({ name: "Cass Vega" }), me)).json();
    const otto = await (await api.createCharacter(validCharacter({ name: "Otto Fenn" }), them)).json();
    return { me, them, cass, otto, meId: userIdOf(me), themId: userIdOf(them) };
  }

  it("with a house character it's agreed at once, plays on their next date, and is used up by it", async () => {
    const me = newUserCookie();
    const cass = await (await api.createCharacter(validCharacter({ name: "Cass Vega" }), me)).json();
    const r = await proposeRoleplay(t.db, userIdOf(me), { character_id: cass.id, with: HOUSE_PARTNER_ID, roleplay_id: "stowaway", my_role: 1 });
    expect(r).toMatchObject({ ok: true, roleplay: { status: "agreed", auto: true, terms: { id: "stowaway", first: HOUSE_PARTNER_ID } } });
    expect((await listNotifications(t.db, userIdOf(me))).filter((n) => n.kind.startsWith("date_roleplay"))).toHaveLength(0);

    const date = await book(cass.id, HOUSE_PARTNER_ID, me);
    expect(date.status).toBe(200);
    const setup = await setupOf(date.body.id);
    expect(setup.roleplay).toMatchObject({ id: "stowaway", agreed: "auto", agreed_id: r.ok ? r.roleplay.id : "" });
    expect(date.body.roleplay).toMatchObject({ title: "Captain and stowaway", roles: expect.stringMatching(/plays the captain, Cass the stowaway$/) });
    expect(await pairRoleplay(t.db, userIdOf(me), cass.id, HOUSE_PARTNER_ID)).toBeNull(); // used
    expect((await t.db.query<Any>(`select status, episode_id from date_roleplays`)).rows[0]).toMatchObject({ status: "used", episode_id: date.body.id });

    // The date after it plays none, unless they pick another.
    expect((await setupOf((await book(cass.id, HOUSE_PARTNER_ID, me)).body.id)).roleplay).toBeUndefined();
  });

  it("a booking can name one with a house character (it plays at once), skip an agreed one with none, and never name one blind", async () => {
    const me = newUserCookie();
    const cass = await (await api.createCharacter(validCharacter({ name: "Cass Vega" }), me)).json();
    const named = await book(cass.id, HOUSE_PARTNER_ID, me, { roleplay: "ghost-hunters", my_role: "the sceptic" });
    expect(named.status).toBe(200);
    expect((await setupOf(named.body.id)).roleplay).toMatchObject({ id: "ghost-hunters", agreed: "auto", first: HOUSE_PARTNER_ID });
    expect((await setupOf(named.body.id)).roleplay.agreed_id).toBeUndefined();

    await proposeRoleplay(t.db, userIdOf(me), { character_id: cass.id, with: HOUSE_PARTNER_ID, roleplay_id: "castaways" });
    const skipped = await book(cass.id, HOUSE_PARTNER_ID, me, { roleplay: "none" });
    expect((await setupOf(skipped.body.id)).roleplay).toBeUndefined();
    expect(await pairRoleplay(t.db, userIdOf(me), cass.id, HOUSE_PARTNER_ID)).toMatchObject({ status: "agreed", terms: { id: "castaways" } }); // still there

    const blind = await api.createEpisode({ character_id: cass.id, blind: true, roleplay: "castaways" }, me);
    expect(blind.status).toBe(422);
    expect((await blind.json()).error).toBe("roleplay_not_here");
    const written = await book(cass.id, HOUSE_PARTNER_ID, me, { roleplay: { title: "Detention", premise: "{a} is the teacher and {b} the student kept after class." } });
    expect(written).toMatchObject({ status: 422, body: { error: "roleplay_not_allowed" } });
  });

  it("two people: one proposes, the other counters, the first agrees, and only then does a date play it", async () => {
    const { me, them, cass, otto, meId, themId } = await twoOwners();
    await t.db.query(`update characters set open_to_dates = true where id = $1`, [otto.id]);

    const sent = await proposeRoleplay(t.db, meId, { character_id: cass.id, with: otto.id, roleplay_id: "rival-chefs", note: "Cass can't boil an egg, this'll be fun" });
    expect(sent).toMatchObject({ ok: true, roleplay: { status: "pending", auto: false, from_you: true, your_move: false, round: 1 } });
    const told = (await listNotifications(t.db, themId))[0];
    expect(told).toMatchObject({ kind: "date_roleplay", link: expect.stringMatching(/^\/couples\/.+#roleplay$/) });
    expect(told.title).toMatch(/Rival chefs/);

    expect(await proposeRoleplay(t.db, meId, { character_id: cass.id, with: otto.id, roleplay_id: "castaways" })).toMatchObject({ ok: false, error: "already_proposed" });
    expect(await proposeRoleplay(t.db, themId, { character_id: otto.id, with: cass.id, roleplay_id: "castaways" })).toMatchObject({ ok: false, error: "they_proposed" });

    // Not agreed yet: a booking that names it is refused, and one that doesn't plays without it.
    expect(await book(cass.id, otto.id, me, { roleplay: "rival-chefs" })).toMatchObject({ status: 409, body: { error: "roleplay_not_agreed" } });

    // Otto's creator answers with another: a counter says what they'd rather (the same one back isn't a counter).
    expect(await answerRoleplay(t.db, themId, { character_id: otto.id, with: cass.id, answer: "counter" })).toMatchObject({ ok: false, error: "counter_needs_terms" });
    const swapped = await answerRoleplay(t.db, themId, { character_id: otto.id, with: cass.id, answer: "counter", roleplay_id: "rival-chefs", note: "Otto should win" });
    expect(swapped).toMatchObject({ ok: false, error: "same_terms" }); // rival chefs has no roles to swap: it's the same roleplay
    const counter = await answerRoleplay(t.db, themId, { character_id: otto.id, with: cass.id, answer: "counter", roleplay_id: "time-traveller", my_role: 0, note: "Otto as the time traveller?" });
    expect(counter).toMatchObject({ ok: true, roleplay: { status: "pending", round: 2, from_you: true, terms: { id: "time-traveller", first: otto.id } } });
    const mineNow = await pairRoleplay(t.db, meId, cass.id, otto.id);
    expect(mineNow).toMatchObject({ your_move: true, note: "Otto as the time traveller?", earlier: [{ title: "Rival chefs", note: "Cass can't boil an egg, this'll be fun" }] });
    expect((await listNotifications(t.db, meId)).find((n) => n.kind === "date_roleplay")?.title).toMatch(/suggests another roleplay/);
    // The answered one's notice is read; the counter waits on Cass's creator.
    expect((await listNotifications(t.db, themId)).filter((n) => n.kind === "date_roleplay" && !n.read)).toHaveLength(0);

    const agreed = await answerRoleplay(t.db, meId, { character_id: cass.id, with: otto.id, answer: "agree" });
    expect(agreed).toMatchObject({ ok: true, roleplay: { status: "agreed", auto: false } });
    expect((await listNotifications(t.db, themId))[0]).toMatchObject({ kind: "date_roleplay_answer", title: expect.stringMatching(/agreed/) });

    const date = await book(cass.id, otto.id, me);
    expect(date.status).toBe(200);
    expect((await setupOf(date.body.id)).roleplay).toMatchObject({ id: "time-traveller", agreed: "both", first: otto.id });
    expect(await pairRoleplay(t.db, themId, otto.id, cass.id)).toBeNull();
    expect(them).toBeTruthy();
  });

  it("decline, withdraw and call off each tell the other side; strangers, blocks and rounds have limits", async () => {
    const { me, cass, otto, meId, themId } = await twoOwners();
    // Strangers who can't date can't be sent roleplays either.
    expect(await proposeRoleplay(t.db, meId, { character_id: cass.id, with: otto.id, roleplay_id: "castaways" })).toMatchObject({ ok: false, error: "match_first" });
    await createMatch(t.db, cass.id, otto.id);

    await proposeRoleplay(t.db, meId, { character_id: cass.id, with: otto.id, roleplay_id: "castaways" });
    expect(await answerRoleplay(t.db, meId, { character_id: cass.id, with: otto.id, answer: "agree" })).toMatchObject({ ok: false, error: "not_your_move" });
    expect(await answerRoleplay(t.db, themId, { character_id: otto.id, with: cass.id, answer: "decline" })).toMatchObject({ ok: true, roleplay: null, status: "declined" });
    expect((await listNotifications(t.db, meId))[0]).toMatchObject({ kind: "date_roleplay_answer", title: expect.stringMatching(/passed/) });

    // Back and forth, until the rounds run out: then it's agree or decline.
    let from: "me" | "them" = "me";
    await proposeRoleplay(t.db, meId, { character_id: cass.id, with: otto.id, roleplay_id: "castaways" });
    const ids = DATE_ROLEPLAYS.map((r) => r.id).filter((id) => id !== "castaways");
    for (let round = 2; round <= ROLEPLAY_ROUNDS; round++) {
      from = from === "me" ? "them" : "me";
      const [who, mine, theirs] = from === "me" ? [meId, cass.id, otto.id] : [themId, otto.id, cass.id];
      expect(await answerRoleplay(t.db, who, { character_id: mine, with: theirs, answer: "counter", roleplay_id: ids[round] })).toMatchObject({ ok: true, roleplay: { round } });
    }
    const [lastWho, lastMine, lastTheirs] = from === "me" ? [themId, otto.id, cass.id] : [meId, cass.id, otto.id];
    expect(await answerRoleplay(t.db, lastWho, { character_id: lastMine, with: lastTheirs, answer: "counter", roleplay_id: "castaways" })).toMatchObject({ ok: false, error: "out_of_rounds" });
    expect(await answerRoleplay(t.db, lastWho, { character_id: lastMine, with: lastTheirs, answer: "agree" })).toMatchObject({ ok: true, roleplay: { status: "agreed" } });

    // Either owner can call an agreed one off; the other hears.
    expect(await answerRoleplay(t.db, lastWho === meId ? themId : meId, { character_id: lastWho === meId ? otto.id : cass.id, with: lastWho === meId ? cass.id : otto.id, answer: "withdraw" })).toMatchObject({ ok: true, status: "withdrawn" });
    expect((await listNotifications(t.db, lastWho))[0]).toMatchObject({ kind: "date_roleplay_answer", title: expect.stringMatching(/called off/) });

    // A block ends it (a block is made from a date: any of Cass's will do here).
    const via = await book(cass.id, HOUSE_PARTNER_ID, me);
    await t.db.query(`insert into blocks (blocker_id, via_episode_id, blocked_id) values ($1, $2, $3)`, [themId, via.body.id, meId]);
    expect(await proposeRoleplay(t.db, meId, { character_id: cass.id, with: otto.id, roleplay_id: "castaways" })).toMatchObject({ ok: false, error: "match_unavailable" });
  });

  it("an unanswered proposal lapses after a week; an unused agreement after a month", async () => {
    const { cass, otto, meId, themId } = await twoOwners();
    await createMatch(t.db, cass.id, otto.id);
    await proposeRoleplay(t.db, meId, { character_id: cass.id, with: otto.id, roleplay_id: "masquerade" });
    await t.db.query(`update date_roleplays set created_at = now() - interval '8 days'`);
    expect(await pairRoleplay(t.db, themId, otto.id, cass.id)).toBeNull();
    expect((await t.db.query<Any>(`select status from date_roleplays`)).rows[0].status).toBe("expired");

    await proposeRoleplay(t.db, meId, { character_id: cass.id, with: otto.id, roleplay_id: "masquerade" });
    await answerRoleplay(t.db, themId, { character_id: otto.id, with: cass.id, answer: "agree" });
    await t.db.query(`update date_roleplays set decided_at = now() - interval '31 days' where status = 'agreed'`);
    expect(await myRoleplays(t.db, meId)).toEqual({ to_answer: [], sent: [], agreed: [] });
  });

  it("the couple page's route proposes and answers, and only for one of the couple", async () => {
    const { me, them, cass, otto } = await twoOwners();
    await createMatch(t.db, cass.id, otto.id);
    const [a, b] = cass.id < otto.id ? [cass.id, otto.id] : [otto.id, cass.id];
    const call = async (handler: typeof proposeRoute, method: string, cookie: string, body: Any) => {
      const res = await handler(new Request(`${BASE_URL}/api/couples/${a}/${b}/roleplay`, { method, headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ a, b }) });
      return { status: res.status, body: (await res.json()) as Any };
    };
    expect(await call(proposeRoute, "POST", me, { character_id: "someone-else", roleplay_id: "castaways" })).toMatchObject({ status: 422, body: { error: "not_in_couple" } });
    const sent = await call(proposeRoute, "POST", me, { character_id: cass.id, roleplay_id: "royal-incognito", my_role: 0, note: "Cass in a crown" });
    expect(sent).toMatchObject({ status: 201, body: { roleplay: { status: "pending", terms: { id: "royal-incognito", first: cass.id } } } });
    const yes = await call(answerRoute, "PATCH", them, { character_id: otto.id, answer: "agree", proposal_id: sent.body.roleplay.id });
    expect(yes).toMatchObject({ status: 200, body: { roleplay: { status: "agreed" } } });
  });

  describe("agents deliberate over MCP", () => {
    const rpc = async (method: string, params: Any, ctx: McpContext): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
    const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> => (await rpc("tools/call", { name, arguments: args }, ctx))!.result;
    async function agent(name: string) {
      const ctx: McpContext = {};
      await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "roleplay-test" } }, ctx);
      const session = { sessionId: ctx.issuedSessionId };
      const made = await call("create_character", validCharacter({ name, keep_name: true }), session);
      if (made.isError) throw new Error(made.content[0].text);
      return { ctx: session, agentId: made.structuredContent.agent_id as string, id: made.structuredContent.character.id as string };
    }

    it("propose_roleplay, answer_roleplay and my_roleplays: a proposal, a counter, an agreement; it waits on the right agent", async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      const A = await agent("Ada Lumen");
      const B = await agent("Bram Okoro");
      await createMatch(t.db, A.id, B.id);
      for (const name of ["propose_roleplay", "answer_roleplay", "my_roleplays"]) expect(MCP_TOOLS.some((x) => x.name === name)).toBe(true);

      const catalog = (await call("my_roleplays", { catalog: true }, A.ctx)).structuredContent;
      expect(catalog.catalog).toHaveLength(DATE_ROLEPLAYS.length);
      expect(catalog.catalog[0]).toMatchObject({ id: expect.any(String), premise: expect.stringMatching(/\{a\}/) });

      const sent = (await call("propose_roleplay", { character_id: A.id, with: B.id, roleplay_id: "first-contact", my_role: "the visitor from another planet", note: "Ada's never seen a sandwich" }, A.ctx)).structuredContent;
      expect(sent.roleplay).toMatchObject({ status: "pending", terms: { id: "first-contact", first: A.id } });
      expect(sent.note).toMatch(/^Sent/);

      const status = (await call("my_status", {}, B.ctx)).structuredContent;
      expect(status.waiting_for_you).toMatchObject({ date_roleplay: 1, hint: expect.stringMatching(/date_roleplay → my_roleplays, then answer_roleplay/) });
      const mine = (await call("my_roleplays", {}, B.ctx)).structuredContent;
      expect(mine.to_answer).toHaveLength(1);
      expect(mine.to_answer[0]).toMatchObject({ note: "Ada's never seen a sandwich", your_move: true });

      const countered = await call("answer_roleplay", { character_id: B.id, with: A.id, answer: "counter", my_role: 0, proposal_id: mine.to_answer[0].id }, B.ctx);
      expect(countered.isError).toBeFalsy();
      expect(countered.structuredContent.roleplay).toMatchObject({ round: 2, terms: { id: "first-contact", first: B.id } }); // Bram wants to be the visitor
      expect((await call("my_status", {}, B.ctx)).structuredContent.waiting_for_you?.date_roleplay ?? 0).toBe(0);

      const stale = await call("answer_roleplay", { character_id: A.id, with: B.id, answer: "agree", proposal_id: mine.to_answer[0].id }, A.ctx);
      expect(stale.isError).toBe(true); // that round was countered
      const agreed = (await call("answer_roleplay", { character_id: A.id, with: B.id, answer: "agree" }, A.ctx)).structuredContent;
      expect(agreed.roleplay).toMatchObject({ status: "agreed" });
      expect(agreed.note).toMatch(/^Agreed/);
      expect((await call("my_roleplays", { character_id: B.id }, B.ctx)).structuredContent.agreed).toHaveLength(1);
    });

    it("start_own_date plays a roleplay: any named one between your own two, only the agreed one with another agent's", async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      const A = await agent("Ada Lumen");
      const second = await call("create_character", validCharacter({ name: "Cyril Moss", keep_name: true }), A.ctx);
      const C = second.structuredContent.character.id as string;
      const preview = (await call("start_own_date", { character_id: A.id, partner_id: C, roleplay: "masquerade", preview: true }, A.ctx)).structuredContent;
      expect(preview.roleplay).toMatchObject({ title: "The masquerade", agreed: "auto" });
      const started = await call("start_own_date", { character_id: A.id, partner_id: C, roleplay: "masquerade" }, A.ctx);
      expect(started.isError).toBeFalsy();
      const own = (await t.db.query<Any>(`select setup from episodes where character_a = $1 or character_b = $1`, [A.id])).rows[0];
      expect(own.setup.roleplay).toMatchObject({ id: "masquerade", agreed: "auto" });
      expect(JSON.stringify(started.structuredContent.step)).toMatch(/tonights_roleplay/);

      const B = await agent("Bram Okoro");
      await t.db.query(`update characters set open_to_dates = true where id = $1`, [B.id]); // the swipe gate is off in tests
      const refused = await call("start_own_date", { character_id: A.id, partner_id: B.id, roleplay: "castaways" }, A.ctx);
      expect(refused.isError).toBe(true);
      expect(refused.content[0].text).toMatch(/hasn't agreed to "Castaways" yet/);
    });
  });
});
