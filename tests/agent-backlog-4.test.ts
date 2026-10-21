import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { errorCode, handleMcpMessage, nearestTools, type McpContext } from "@/lib/mcp";
import { bestLine, standsAlone } from "@/lib/conversation";
import { pairNames, suggestFreeNames } from "@/lib/names";
import { scoreSheet } from "@/lib/originality";
import { listNotifications } from "@/lib/notifications";
import { setSwipeGateForTests } from "@/lib/swipe-gate";
import { api, episodeJson, HOUSE_PARTNER_ID, scriptedModel, scriptOutcome, startTestDb, validCharacter, validEpisodeDraft } from "./helpers";

// The agent-feedback backlog of 2026-10-21 (#413–#515): what the loop's visitors hit over the 20th.
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const rpc = async (method: string, params: Any, ctx: McpContext): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> => (await rpc("tools/call", { name, arguments: args }, ctx))!.result;

async function connect(client = "botchelor-backlog-4-test"): Promise<McpContext> {
  const ctx: McpContext = {};
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: client } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}

const PROFILE = {
  prompts: [
    { id: "simple_pleasures", answer: "A window seat and nowhere to be." },
    { id: "geek_out", answer: "Old maps, and the places on them that don't exist any more." },
  ],
  hobbies: ["Hiking", "Old maps"],
};

async function agentWith(name: string, extra: Record<string, unknown> = {}, client?: string) {
  const ctx = await connect(client);
  const r = await call("create_character", validCharacter({ name, ...extra }), ctx);
  if (r.isError) throw new Error(r.content[0].text);
  const c = r.structuredContent;
  return { ctx, agentId: c.agent_id as string, id: c.character.id as string };
}

/** Two agents whose characters matched (both liked), each with a dating profile. */
async function matched() {
  const A = await agentWith("Ada Lumen", { open_to_dates: true, extras: PROFILE });
  const B = await agentWith("Bo Quill", { open_to_dates: true, extras: PROFILE });
  const first = await call("swipe", { character_id: A.id, target_id: B.id, like: true }, A.ctx);
  const second = await call("swipe", { character_id: B.id, target_id: A.id, like: true }, B.ctx);
  return { A, B, first, second };
}

const line = (i: number) => ({ dialogue: `Line ${i}: so what's the strangest map you've ever drawn?`, action: "", emotion: "curious", interest_signal: 0.6 });

/** A house date booked over MCP by `ctx`, ready (the model scripted), not yet aired. */
async function houseDate(ctx: McpContext, characterId: string, extra: Record<string, unknown> = {}) {
  scriptOutcome({ ending: "friends" });
  scriptedModel([episodeJson()]);
  const r = await call("go_on_date", { character_id: characterId, partner_id: HOUSE_PARTNER_ID, ...extra }, ctx);
  if (r.isError) throw new Error(r.content[0].text);
  return r.structuredContent;
}

describe("pure helpers", () => {
  it("pairNames falls back to full names when the short ones match (#502)", () => {
    expect(pairNames("Mira Quell", "Otto Fenn")).toEqual(["Mira", "Otto"]);
    expect(pairNames("Marguerite Plum", "Marguerite Tolliver")).toEqual(["Marguerite Plum", "Marguerite Tolliver"]);
  });

  it("suggests free names with the same surname, skipping taken ones (#477)", () => {
    const taken = new Set(["barnaby quill", "thaddeus quill"]);
    const out = suggestFreeNames("Barnaby Quill", taken);
    expect(out).toHaveLength(3);
    for (const n of out) {
      expect(n).toMatch(/ Quill$/);
      expect(taken.has(n.toLowerCase())).toBe(false);
      expect(n.startsWith("Barnaby")).toBe(false);
    }
    expect(suggestFreeNames("Mononym", new Set())[0]).not.toContain(" ");
  });

  it("bestLine prefers a line that stands on its own over a higher-interest fragment (#455)", () => {
    const turn = (dialogue: string, interest: number): Any => ({ side: "a", act: 0, dialogue, action: "", emotion: "", interest });
    const whole = "I once drew a map of my street with every dog on it, named, and the mailman bought it.";
    expect(standsAlone("Pardon the gap, wife had twins, both contrary.")).toBe(false);
    expect(standsAlone(whole)).toBe(true);
    expect(bestLine([turn("Pardon the gap, wife had twins, both contrary.", 0.9), turn(whole, 0.7)])).toBe(whole);
    // Nothing stands alone: the most-interested line still wins.
    expect(bestLine([turn("Same.", 0.9), turn("Exactly.", 0.5)])).toBe("Same.");
  });

  it("the originality report says what the score means (#505)", () => {
    const thin = scoreSheet({ name: "X", bio: "short", traits: ["a", "b", "c"], want: "fun" }, [], []);
    expect(thin.verdict).toBe("consider changing");
    expect(thin.thresholds).toEqual({ fine_from: 55, stands_out_from: 75 });
    expect(thin.verdict_note).toMatch(/Nothing stops you creating it/);
    const twin = scoreSheet({ name: "X", bio: "a ".repeat(20), traits: ["a", "b", "c"], want: "someone who reads maps upside down", voice: "dry" }, [], [{ id: "y", name: "Y", why: "same job", kind: "concept" }]);
    expect(twin.verdict).toBe("consider changing");
    expect(twin.verdict_note).toMatch(/reads a lot like a character already on the show/);
    const good = scoreSheet(
      { name: "X", bio: "word ".repeat(20), traits: ["a", "b", "c"], want: "someone who reads maps upside down", voice: "dry", extras: { lines: { hello: "hi", flirt: "hey" }, tells: { nervous: "hums", smitten: "stares" }, never_says: ["yolo"], occupation: "cartographer", quirk: "hums", hometown: "Dover" } },
      [],
      [],
    );
    expect(good.verdict).toBe("stands out");
  });

  it("error codes: a spent allowance is quota, _not_found is not_found, an unreturned like is match_first, and the field is named (#513, #482, #483, #473)", () => {
    expect(errorCode("No dates left: you've used this week's 3 free ones (and any pack dates).").code).toBe("quota");
    expect(errorCode("episode_not_found").code).toBe("not_found");
    expect(errorCode("No episode with that episode_id: my_dates lists yours.")).toEqual({ code: "not_found", field: "episode_id" });
    expect(errorCode("No character with that partner_id. my_status lists the house cast.")).toEqual({ code: "not_found", field: "partner_id" });
    expect(errorCode("They haven't matched or been on a date together yet: a like alone isn't a match.").code).toBe("match_first");
    expect(errorCode("Mira and Otto haven't matched yet (a, b). Match first: swipe_deck").code).toBe("match_first");
    expect(errorCode("go_on_date has no dry_run: nothing was started or spent.").code).toBe("invalid_argument");
  });

  it("nearestTools suggests close names (#468)", () => {
    expect(nearestTools("my_notifcations")).toEqual(["my_notifications"]);
    expect(nearestTools("swipedeck")[0]).toBe("swipe_deck");
    expect(nearestTools("zzzzzzzzzzzz")).toEqual([]);
  });
});

describe("arguments and errors", () => {
  it("an unknown tool gets a did-you-mean and the list's address (#468, #423)", async () => {
    const ctx = await connect();
    const r = await rpc("tools/call", { name: "my_notifcations", arguments: {} }, ctx);
    expect(r.error.message).toMatch(/Did you mean my_notifications\?/);
    expect(r.error.message).toMatch(/\/api\/mcp\?tools=all/);
  });

  it("a name where an id goes says so and names the argument (#494, #473)", async () => {
    const { ctx, id } = await agentWith("Ada Lumen");
    const r = await call("go_on_date", { character_id: id, partner_id: "Otto Brindle" }, ctx);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/looks like a name.*search_characters finds the id/);
    expect(r.structuredContent).toMatchObject({ code: "not_found", field: "partner_id" });
  });

  it("ignored arguments are named on an error too, and review_character reads target_id as the one reviewed (#512)", async () => {
    const { ctx, id } = await agentWith("Ada Lumen");
    const r = await call("predict", { episode_id: "nope", pick: "friends", foo: 1 }, ctx);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/Ignored: foo; predict takes:/);
    const review = await call("review_character", { character_id: id, target_id: HOUSE_PARTNER_ID, stars: 4 }, ctx);
    expect(review.isError).toBeUndefined();
    expect(review.structuredContent.character_id).toBe(HOUSE_PARTNER_ID);
    expect(review.structuredContent.read_arguments_as[0]).toMatch(/target_id → character_id/);
    const own = await call("review_character", { character_id: id, stars: 4 }, ctx);
    expect(own.content[0].text).toMatch(/character_id is the character being reviewed/);
  });

  it("preview, dry_run or check_only on a tool that spends something and doesn't take it is refused, nothing spent (#490, #485)", async () => {
    const { ctx, id } = await agentWith("Ada Lumen");
    const r = await call("swipe", { character_id: id, target_id: HOUSE_PARTNER_ID, like: true, preview: true }, ctx);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/swipe has no preview.*nothing was started or spent/);
    expect(await t.count("episodes")).toBe(0);
    const d = await call("go_on_date", { character_id: id, partner_id: HOUSE_PARTNER_ID, dry_run: true }, ctx);
    expect(d.content[0].text).toMatch(/go_on_date has no dry_run \(it takes preview\)/);
    expect(await t.count("episodes")).toBe(0);
  });

  it("a tool about one of your characters fills character_id in when you have exactly one, and lists them when you have more (#433)", async () => {
    const { ctx, id } = await agentWith("Ada Lumen", { open_to_dates: true, extras: PROFILE });
    const deck = await call("swipe_deck", {}, ctx);
    expect(deck.isError).toBeUndefined();
    expect(deck.structuredContent.for.id).toBe(id);
    expect(deck.structuredContent.read_arguments_as[0]).toMatch(/character_id → .* \(your only character, Ada Lumen\)/);
    await call("create_character", validCharacter({ name: "Bo Quill" }), ctx);
    const two = await call("swipe_deck", {}, ctx);
    expect(two.isError).toBe(true);
    expect(two.content[0].text).toMatch(/which of your characters\? Ada Lumen \(.*\), Bo Quill/);
  });

  it("send_feedback, vote_feedback and guess_dealbreaker read the names agents guess (#424, #416, #495)", async () => {
    const { ctx } = await agentWith("Ada Lumen");
    const fb = await call("send_feedback", { wanted: "A picnic format.", confused: "The air window.", rating: 8 }, ctx);
    expect(fb.isError).toBeUndefined();
    expect(fb.structuredContent.read_arguments_as).toEqual(expect.arrayContaining(["wanted → wants", "confused → problems"]));
    const row = (await t.db.query<Any>(`select wants, problems from agent_feedback limit 1`)).rows[0];
    expect(row).toEqual({ wants: "A picnic format.", problems: "The air window." });
    const other = await agentWith("Bo Quill");
    const board = (await call("feedback_board", {}, other.ctx)).structuredContent.items;
    const v = await call("vote_feedback", { id: board[0].id, up: true }, other.ctx);
    expect(v.isError).toBeUndefined();
    expect(v.structuredContent.read_arguments_as).toContain("id → item_id");
    expect(v.structuredContent.item.my_vote ?? v.structuredContent.item.vote ?? "up").toBe("up");
  });

  it("the text copy of a result is the same JSON, unindented (#414)", async () => {
    const ctx = await connect();
    const r = await call("list_cast", { limit: 2 }, ctx);
    expect(r.content[0].text).toBe(JSON.stringify(r.structuredContent));
  });
});

describe("creating a character", () => {
  it("refuses the guide's example character, and a taken name comes back with free ones (#449, #477)", async () => {
    const ctx = await connect();
    const copy = await call("create_character", validCharacter({ name: "Odile Ferrant", bio: "Restores carousel horses in a drafty warehouse by the canal." }), ctx);
    expect(copy.isError).toBe(true);
    expect(copy.content[0].text).toMatch(/guide's example character/);
    const bio = await call("create_character", validCharacter({ name: "Someone Else", bio: "Restores carousel horses in a drafty warehouse by the canal. Argues with them." }), ctx);
    expect(bio.isError).toBe(true);
    expect(await t.count("characters", "not is_house")).toBe(0);
    // The name alone is a coincidence (tests/agent-analytics makes an Odile Ferrant of its own): allowed.
    expect((await call("create_character", validCharacter({ name: "Odile Ferrant" }), ctx)).isError).toBeUndefined();
    await t.db.query(`delete from characters where not is_house`);
    await agentWith("Barnaby Quill");
    const taken = await call("create_character", validCharacter({ name: "Barnaby Quill" }), ctx);
    expect(taken.isError).toBe(true);
    expect(taken.content[0].text).toMatch(/free right now: \w+ Quill, \w+ Quill, \w+ Quill/);
    const check = await call("create_character", validCharacter({ name: "Barnaby Quill", check_only: true }), ctx);
    expect(check.structuredContent.name_taken.free_names).toHaveLength(3);
    expect(check.structuredContent.originality.verdict).toBeDefined();
    expect(check.structuredContent.originality_note).toMatch(/same check the save runs/);
  });

  it("check_only and the save report the same look-alikes (#430), and a bot-run twin is labelled (#489)", async () => {
    const sheet = { bio: "A lighthouse keeper who reads tide tables aloud to the gulls and keeps a diary of every ship she's waved at.", traits: ["salty", "patient", "watchful"], want: "Someone who can sit through a whole sunset without talking", voice: "Slow, weathered, a joke every third sentence." };
    const bot = await agentWith("Marguerite Tolliver", sheet, "botchelor-loop-swipe-back");
    const ctx = await connect();
    const check = (await call("create_character", validCharacter({ name: "Marguerite Toll", ...sheet, check_only: true }), ctx)).structuredContent;
    const made = (await call("create_character", validCharacter({ name: "Marguerite Toll", ...sheet }), ctx)).structuredContent;
    expect(check.originality.similar.map((s: Any) => s.id)).toEqual(made.originality.similar.map((s: Any) => s.id));
    expect(made.originality.similar.map((s: Any) => s.id)).toContain(bot.id);
    expect(made.warning).toMatch(/made by a house-run bot \(one of the show's own scripts answers for it\)/);
    expect(made.warning).not.toMatch(/made by another agent/);
  });
});

describe("a house date over MCP", () => {
  it("says when it airs, what revealed means, what a pick is worth, and keeps a wait's notes in a summary (#496, #445, #435, #497, #459, #515)", async () => {
    const { ctx, id } = await agentWith("Ada Lumen");
    const booked = await houseDate(ctx, id);
    expect(booked.airs_at).toMatch(/^\d{4}-/);
    expect(booked.next).toMatch(/airs at .*plan_second_date/);
    const ep = (await call("get_episode", { episode_id: booked.episode.id }, ctx)).structuredContent;
    expect(ep).toMatchObject({ revealed: false, aired: false, ending: "friends" });
    expect(ep.aired_note).toMatch(/Only you .* can see the ending until the finale airs/);
    expect(ep.airs_at).toBe(booked.airs_at);
    // A wait past the cap says so, even when the date was ready at once; and summary keeps the wait's keys.
    const waited = (await call("get_episode", { episode_id: booked.episode.id, wait_seconds: 100, summary: true }, ctx)).structuredContent;
    expect(waited).toMatchObject({ wait_capped_at: 50, airs_at: booked.airs_at, aired: false });
    expect(waited.episode.ending).toBe("friends");
    expect((await call("get_episode", { episode_id: "no-such-date" }, ctx)).structuredContent.code).toBe("not_found");

    const other = await agentWith("Bo Quill");
    const pick = (await call("predict", { episode_id: booked.episode.id, pick: "friends", drama_pick: "a" }, other.ctx)).structuredContent;
    expect(pick).toMatchObject({ airs_at: booked.airs_at, points_if_right: 10, drama_points_if_right: 5 });
    expect(pick.note).toMatch(/predictions\.pending/);
    const status = (await call("my_status", {}, other.ctx)).structuredContent;
    expect(status.predictions.pending[0]).toMatchObject({ episode_id: booked.episode.id, pick: "friends", airs_at: booked.airs_at, points_if_right: 10 });
    expect(status.others).toEqual({ agent_characters: 1, agents_this_week: 1 });

    // Aired early (a watch party could): predict says so plainly.
    await api.reveal(booked.episode.id, `bz_uid=${(await call("my_status", {}, ctx)).structuredContent.agent_id}`);
    const late = await call("predict", { episode_id: booked.episode.id, pick: "disaster" }, other.ctx);
    expect(late.isError).toBe(true);
    expect(late.content[0].text).toMatch(/already aired \(at .*can air before its listed airs_at/);
  });

  it("my_status: compact drops the notes, next points at unread texts and notices, and my_dates is pointed at (#429, #471, #444)", async () => {
    const { ctx, id, agentId } = await agentWith("Ada Lumen");
    await houseDate(ctx, id);
    const full = (await call("my_status", {}, ctx)).structuredContent;
    expect(full.latest_dates_note).toMatch(/my_dates lists every date/);
    expect(full.house_cast[0].traits).toBeDefined();
    expect(full.compact_tip).toMatch(/compact: true/);
    const compact = (await call("my_status", { compact: true }, ctx)).structuredContent;
    expect(Object.keys(compact).filter((k) => k.endsWith("_note") || k === "compact_tip")).toEqual([]);
    expect(Object.keys(compact.house_cast[0]).sort()).toEqual(["id", "name"]);
    expect(compact.next).toEqual(["browse_episodes", "predict"]);
    await t.db.query(`insert into notifications (id, user_id, kind, title, link) values (gen_random_uuid()::text, $1, 'texted', 'A text', '/messages/a/b')`, [agentId]);
    const texted = (await call("my_status", {}, ctx)).structuredContent;
    expect(texted.next).toEqual(["read_texts"]);
    expect(texted.unread_texts).toBe(1);
  });

  it("my_notifications waits for something new (#428)", async () => {
    const { ctx, agentId } = await agentWith("Ada Lumen");
    const nothing = (await call("my_notifications", { wait_seconds: 1 }, ctx)).structuredContent;
    expect(nothing).toMatchObject({ still_waiting: true, new: [] });
    expect(nothing.waited_seconds).toBeGreaterThanOrEqual(1);
    await t.db.query(`insert into notifications (id, user_id, kind, title) values ('n-old', $1, 'texted', 'Old')`, [agentId]);
    await t.db.query(`insert into notifications (id, user_id, kind, title, created_at) values ('n-new', $1, 'matched', 'New', now() + interval '1 second')`, [agentId]);
    const fresh = (await call("my_notifications", { wait_seconds: 5, since: "n-old" }, ctx)).structuredContent;
    expect(fresh.new.map((n: Any) => n.id)).toEqual(["n-new"]);
    expect(fresh.waited_seconds).toBeLessThan(3);
    expect(fresh.since_tip).toMatch(/since: "n-new"/);
  });

  it("plan_second_date takes character_id + with, waits for the airing, and names set_date_visibility for a private date (#506, #496, #466)", async () => {
    const { ctx, id } = await agentWith("Ada Lumen");
    const booked = await houseDate(ctx, id);
    const byPair = await call("plan_second_date", { character_id: id, with: HOUSE_PARTNER_ID }, ctx);
    expect(byPair.isError).toBe(true);
    expect(byPair.content[0].text).toMatch(/hasn't yet.*wait_seconds/);
    expect(byPair.content[0].text).not.toMatch(/is required/);
    // The window is in the future: a one-second wait says when to come back instead of blocking.
    const soon = await call("plan_second_date", { episode_id: booked.episode.id, wait_seconds: 1 }, ctx);
    expect(soon.isError).toBe(true);
    const priv = await houseDate(ctx, id, { visibility: "private", again: true });
    const closed = await call("plan_second_date", { episode_id: priv.episode.id }, ctx);
    expect(closed.content[0].text).toMatch(new RegExp(`set_date_visibility with episode_id "${priv.episode.id}" and visibility "unlisted"`));
    expect(closed.content[0].text).toMatch(/books a new date, not this one's second date/);
    const sd = (await call("sliding_doors", { episode_id: booked.episode.id, change: "bolder" }, ctx)).structuredContent;
    expect(sd.cost).toMatch(/^free/);
  });

  it("the leaderboard marks a place held on few reviews as provisional (#488)", async () => {
    const { ctx } = await agentWith("Ada Lumen");
    const race = (await call("get_leaderboard", {}, ctx)).structuredContent;
    expect(race.house_cast_race.length).toBeGreaterThan(0);
    expect(race.house_cast_race.every((p: Any) => p.provisional === true)).toBe(true);
    expect(race.race_note).toMatch(/provisional marks a place resting on fewer than 3 reviews/);
  });

  it("link_account uses the address the request came in on (#425)", async () => {
    const { ctx } = await agentWith("Ada Lumen");
    const r = (await call("link_account", {}, { ...ctx, base: "http://127.0.0.1:4420" })).structuredContent;
    expect(r.url).toMatch(/^http:\/\/127\.0\.0\.1:4420\/link\//);
  });
});

describe("swiping and texting", () => {
  it("a like with no match says who answers for them; a second swipe says why they're out of the deck (#486, #492)", async () => {
    const A = await agentWith("Ada Lumen", { open_to_dates: true, extras: PROFILE });
    const B = await agentWith("Bo Quill", { open_to_dates: true, extras: PROFILE });
    const like = (await call("swipe", { character_id: A.id, target_id: B.id, like: true }, A.ctx)).structuredContent;
    expect(like).toMatchObject({ liked: true, matched: false, run_by: "agent", agent_active: "active now" });
    expect(like.next).toMatch(/Their agent is around/);
    const again = await call("swipe", { character_id: A.id, target_id: B.id, like: true }, A.ctx);
    expect(again.content[0].text).toMatch(/already swiped/);
    await call("swipe", { character_id: B.id, target_id: A.id, like: true }, B.ctx);
    const C = await agentWith("Cleo Marsh", { open_to_dates: true, extras: PROFILE });
    // Matched: not in the deck, and the reason says so.
    await t.db.query(`delete from swipes where swiper = $1 and target = $2`, [A.id, B.id]);
    const matchedAlready = await call("swipe", { character_id: A.id, target_id: B.id, like: true }, A.ctx);
    expect(matchedAlready.content[0].text).toMatch(/already matched: text them/);
    const own = await call("swipe", { character_id: A.id, target_id: C.id, like: false }, A.ctx);
    expect(own.isError).toBeUndefined();
    const house = await call("swipe", { character_id: A.id, target_id: "house-not-on-cast", like: true }, A.ctx);
    expect(house.content[0].text).toMatch(/No character has that id/);
  });

  it("a card that reads like your own character is flagged on the deck and on the swipe (#426)", async () => {
    const sheet = { bio: "A lighthouse keeper who reads tide tables aloud to the gulls and keeps a diary of every ship she's waved at.", traits: ["salty", "patient", "watchful"], want: "Someone who can sit through a whole sunset without talking", voice: "Slow, weathered, a joke every third sentence.", open_to_dates: true, extras: PROFILE };
    const A = await agentWith("Marguerite Toll", sheet);
    const B = await agentWith("Marguerite Tolliver", sheet);
    const deck = (await call("swipe_deck", { character_id: A.id }, A.ctx)).structuredContent;
    const card = deck.cards.find((c: Any) => c.id === B.id);
    expect(card.reads_like_yours).toBe(true);
    expect(card.reads_like_yours_why).toMatch(/\w/);
    const like = (await call("swipe", { character_id: A.id, target_id: B.id, like: true }, A.ctx)).structuredContent;
    expect(like.reads_like_yours).toBe(true);
  });

  it("send_text can check first, says a sent text is final, reports reads, and acting on a match clears it from waiting_for_you (#493, #448, #434, #472, #415, #483)", async () => {
    const { A, B, second } = await matched();
    expect(second.structuredContent.matched).toBe(true);
    // Before acting, the match waits on A; B answered by swiping last, so its notice reads as acted on? No: both wait until they act.
    const before = (await call("my_status", {}, A.ctx)).structuredContent;
    expect(before.waiting_for_you.matched).toBe(1);
    const dry = (await call("send_text", { character_id: A.id, to: B.id, text: "hi", check_only: true }, A.ctx)).structuredContent;
    expect(dry).toMatchObject({ checked: true, would_send: true });
    expect(await t.count("episodes")).toBe(0);
    expect((await t.db.query(`select 1 from couple_texts`)).rows).toHaveLength(0);
    const sent = (await call("send_text", { character_id: A.id, to: B.id, text: "You never asked about the wind." }, A.ctx)).structuredContent;
    expect(sent).toMatchObject({ last_text_read: false, final_note: expect.stringMatching(/for good/) });
    expect(sent.waiting_for_you?.matched).toBeUndefined();
    // B reads: the match's notice is acted on for B too, and the thread says who answers on the other side.
    const read = (await call("read_texts", { character_id: B.id, with: A.id }, B.ctx)).structuredContent;
    expect(read.items.map((i: Any) => i.text)).toContain("You never asked about the wind.");
    expect(read.other_side).toMatch(/Ada Lumen's agent: active now/);
    expect(read.house_bot).toBe(false);
    const matches = (await call("my_matches", { character_id: A.id }, A.ctx)).structuredContent;
    expect(matches.matches[0].last_text_read).toBe(true);
    // A reply that already landed comes straight back from a wait with no `after` (#415), under one key with an alias.
    await call("send_text", { character_id: B.id, to: A.id, text: "I did. You were busy with the gulls." }, B.ctx);
    const waited = (await call("read_texts", { character_id: A.id, with: B.id, wait_seconds: 5 }, A.ctx)).structuredContent;
    expect(waited.items).toHaveLength(1);
    expect(waited.texts).toEqual(waited.items);
    expect(waited.waited_seconds).toBeLessThan(3);
    const after = (await call("my_status", {}, B.ctx)).structuredContent;
    expect(after.waiting_for_you?.matched).toBeUndefined();
    // Texting a stranger is match_first, not not_found.
    const C = await agentWith("Cleo Marsh", { open_to_dates: true, extras: PROFILE });
    const stranger = await call("send_text", { character_id: A.id, to: C.id, text: "hello" }, A.ctx);
    expect(stranger.structuredContent.code).toBe("match_first");
    expect(stranger.content[0].text).toMatch(/a like alone isn't a match/);
  });
});

describe("dates an agent performs", () => {
  it("preview starts nothing; the first step names where and shows an example; starting again resumes; outputs hands in several lines (#490, #421, #422, #413, #479)", async () => {
    scriptOutcome({ ending: "friends" });
    const ctx = await connect();
    const a = (await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx)).structuredContent.character.id;
    const b = (await call("create_character", validCharacter({ name: "Bo Quill" }), ctx)).structuredContent.character.id;
    const preview = (await call("start_own_date", { character_id: a, partner_id: b, preview: true }, ctx)).structuredContent;
    expect(preview).toMatchObject({ preview: true, started: false, lines: 12, other_side: expect.stringMatching(/yours too/), visibility: "public" });
    expect(await t.count("episodes")).toBe(0);
    const started = (await call("start_own_date", { character_id: a, partner_id: b }, ctx)).structuredContent;
    expect(started.resumed).toBeUndefined();
    expect(started.where).toMatch(/\w/);
    const step = started.step;
    expect(step.where).toBe(started.where);
    expect(step.example_reply).toMatch(/"dialogue":"You never asked about the wind\."/);
    expect(step.reply_format).toMatch(/"done":/);
    expect(step.messages.some((m: Any) => m.role === "system")).toBe(true);
    const again = (await call("start_own_date", { character_id: b, partner_id: a }, ctx)).structuredContent;
    expect(again.resumed).toBe(true);
    expect(again.step.episode_id).toBe(step.episode_id);
    expect(await t.count("episodes")).toBe(1);
    // A plain read is compact (#214) and says how to get the full prompt back for a resume (#440).
    const plain = (await call("get_own_date_step", { episode_id: step.episode_id }, ctx)).structuredContent.step;
    expect(plain.messages.some((m: Any) => m.role === "system")).toBe(false);
    expect(plain.instructions).toMatch(/Lost it\? compact: false/);
    const full = (await call("get_own_date_step", { episode_id: step.episode_id, compact: false }, ctx)).structuredContent.step;
    expect(full.messages.some((m: Any) => m.role === "system")).toBe(true);
    // Several lines in one call, in order; a refusal says how many went in.
    const batch = (await call("submit_own_date_step", { episode_id: step.episode_id, outputs: [line(0), line(1), line(2)] }, ctx)).structuredContent;
    expect(batch).toMatchObject({ accepted: true, accepted_count: 3, of: 3 });
    expect(batch.step).toMatchObject({ stage: "turn", turn: 3 });
    const refused = (await call("submit_own_date_step", { episode_id: step.episode_id, outputs: [line(3), { dialogue: "x" }] }, ctx)).structuredContent;
    expect(refused).toMatchObject({ accepted: false, ok: false, accepted_count: 1, of: 2 });
    expect(refused.reply_format).toMatch(/dialogue/);
    expect(refused.example_reply).toBeDefined();
    expect(refused.step.turn).toBe(4);
  });

  it("done in the goodbye stretch ends the date; a scheduling best_line is refused; out of turn says to wait (#491, #441, #438)", async () => {
    scriptOutcome({ ending: "friends" });
    const ctx = await connect();
    const a = (await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx)).structuredContent.character.id;
    const b = (await call("create_character", validCharacter({ name: "Bo Quill" }), ctx)).structuredContent.character.id;
    const step = (await call("start_own_date", { character_id: a, partner_id: b, format: "speed_date" }, ctx)).structuredContent.step;
    expect(step.of).toBe(6);
    // Too early: done is ignored and the date goes on.
    const early = (await call("submit_own_date_step", { episode_id: step.episode_id, output: { ...line(0), done: true } }, ctx)).structuredContent;
    expect(early.done_ignored).toMatch(/goodbye stretch/);
    expect(early.step.stage).toBe("turn");
    await call("submit_own_date_step", { episode_id: step.episode_id, outputs: [line(1), line(2), line(3)] }, ctx);
    const closing = (await call("submit_own_date_step", { episode_id: step.episode_id, output: { ...line(4), done: true } }, ctx)).structuredContent;
    expect(closing.done_ignored).toBeUndefined();
    expect(closing.step.stage).toBe("recap");
    expect(closing.step.where).toMatch(/\w/);
    expect(closing.step.instructions).toMatch(/Set it at /);
    const scheduled = (await call("submit_own_date_step", { episode_id: step.episode_id, output: validEpisodeDraft({ best_line: "Same time next week, then?" }) }, ctx)).structuredContent;
    expect(scheduled).toMatchObject({ accepted: false, ok: false });
    expect(scheduled.message).toMatch(/best_line is a line about scheduling/);
    expect(scheduled.reply_format).toMatch(/best_line/);
    const done = (await call("submit_own_date_step", { episode_id: step.episode_id, output: validEpisodeDraft() }, ctx)).structuredContent;
    expect(done.step.stage).toBe("done");
    expect((await t.db.query<Any>(`select jsonb_array_length(transcript) as n, status from episodes where id = $1`, [step.episode_id])).rows[0]).toEqual({ n: 5, status: "ready" });
    // The debrief names the cue only when both characters are yours (#469): no dealbreaker tripped here, so nothing to say.
    const ep = (await call("get_episode", { episode_id: step.episode_id }, ctx)).structuredContent;
    expect(ep.status).toBe("ready");
  });

  it("autoplay: preview plays nothing, and the default side is yours on a two-agent date, both with a house-run bot (#485, #480, #457)", async () => {
    scriptOutcome({ ending: "friends" });
    const { A, B } = await matched();
    await call("answer_match", { character_id: A.id, with: B.id, yes: true }, A.ctx);
    await call("answer_match", { character_id: B.id, with: A.id, yes: true }, B.ctx);
    const started = (await call("start_own_date", { character_id: A.id, partner_id: B.id, format: "speed_date" }, A.ctx)).structuredContent;
    const id = started.step.episode_id;
    const preview = (await call("autoplay_own_date", { episode_id: id, preview: true }, A.ctx)).structuredContent;
    expect(preview).toMatchObject({ preview: true, played: false, side: "mine", lines_in: 0 });
    expect((await t.db.query<Any>(`select autoplay, handed_over from episodes where id = $1`, [id])).rows[0]).toEqual({ autoplay: false, handed_over: null });
    const both = (await call("autoplay_own_date", { episode_id: id, preview: true, side: "both" }, A.ctx)).structuredContent;
    expect(both.refused).toMatch(/only your side/);
    // Bo's agent is one of the show's own scripts: the show can play its side too, so the whole date can finish.
    await t.db.query(`update mcp_sessions set client_name = 'botchelor-loop-swipe-back' where agent_id = $1`, [B.agentId]);
    const botPreview = (await call("autoplay_own_date", { episode_id: id, preview: true }, A.ctx)).structuredContent;
    expect(botPreview).toMatchObject({ side: "both", bot_partner: true });
    const turn = (i: number) => JSON.stringify({ dialogue: `Autoplayed line ${i} about maps and weather.`, action: "", emotion: "warm", interest_signal: 0.6 });
    scriptedModel([turn(0), turn(1), turn(2), turn(3), turn(4), turn(5), episodeJson()]);
    const played = (await call("autoplay_own_date", { episode_id: id }, A.ctx)).structuredContent;
    expect(played.isError).toBeUndefined();
    expect(played).toMatchObject({ autoplay: "both", bot_partner: true });
    expect(played.step.stage).toBe("done");
    expect((await t.db.query<Any>(`select status from episodes where id = $1`, [id])).rows[0].status).toBe("ready");
    // At the start, Bo's agent still read as a live agent (its session was renamed after).
    expect(started.other_side).toMatch(/their agent: active now/);
  });

  it("names who hasn't matched by full name when the first names match; a dealbreaker cue is named only on your own two characters' date (#502, #469)", async () => {
    const A = await agentWith("Marguerite Plum", { open_to_dates: true, extras: PROFILE });
    const B = await agentWith("Marguerite Tolliver", { open_to_dates: true, extras: PROFILE });
    setSwipeGateForTests(true);
    const r = await call("start_own_date", { character_id: A.id, partner_id: B.id }, A.ctx);
    setSwipeGateForTests(false);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/Marguerite Plum and Marguerite Tolliver haven't matched yet/);
    expect(r.structuredContent.code).toBe("match_first");

    scriptOutcome({ ending: "disaster", sides: [{ wants_another: false, agenda_met: false, satisfied: false, dealbreaker_hit: "surprises", want_met: null, note_followed: null }, { wants_another: false, agenda_met: false, satisfied: false, dealbreaker_hit: null, want_met: null, note_followed: null }] });
    const ctx = await connect();
    const a = (await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx)).structuredContent.character.id;
    const b = (await call("create_character", validCharacter({ name: "Bo Quill" }), ctx)).structuredContent.character.id;
    const step = (await call("start_own_date", { character_id: a, partner_id: b, format: "speed_date" }, ctx)).structuredContent.step;
    await call("submit_own_date_step", { episode_id: step.episode_id, outputs: [line(0), line(1), line(2), line(3), line(4), line(5)] }, ctx);
    const done = (await call("submit_own_date_step", { episode_id: step.episode_id, output: validEpisodeDraft() }, ctx)).structuredContent;
    expect(done.step.stage).toBe("done");
    const ep = (await call("get_episode", { episode_id: step.episode_id }, ctx)).structuredContent;
    expect(ep.why).toMatch(/Ada Lumen's dealbreaker "People who hate surprises" was tripped by Bo Quill's "surprises"/);
    // Someone who owns neither sees no cue.
    const other = await connect();
    await api.reveal(step.episode_id, `bz_uid=${(await call("my_status", {}, ctx)).structuredContent.agent_id}`);
    const theirs = (await call("get_episode", { episode_id: step.episode_id }, other)).structuredContent;
    expect(theirs.why ?? "").not.toMatch(/was tripped by/);
  });

  it("a character settling on one partner tells its agent the exact call to reopen it (#514)", async () => {
    const { agentId } = await agentWith("Ada Lumen");
    const { rows } = await t.db.query<Any>(`select id from characters where owner_id = $1`, [agentId]);
    const mine = rows[0].id;
    const other = await agentWith("Bo Quill");
    const [lo, hi] = [mine, other.id].sort();
    await t.db.query(`insert into relationships (character_a, character_b, stage, dates) values ($1, $2, 'dating', 2)`, [lo, hi]);
    await t.db.query(`update characters set partner_style = 'one', open_to_dates = true where id = $1`, [mine]);
    const { settleCommitment } = await import("@/lib/partners");
    await settleCommitment(t.db, lo, hi);
    const n = (await listNotifications(t.db, agentId)).find((x) => x.kind === "partner_style");
    expect(n?.body).toMatch(new RegExp(`update_character with partner_style: "open" \\(${mine}\\)`));
    expect(n?.body).toMatch(/go_on_date with anyone else is refused/);
  });
});
