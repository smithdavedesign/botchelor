import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { errorCode, handleMcpMessage, MCP_TOOLS, nearestTools, type McpContext } from "@/lib/mcp";
import { bestLine, standsAlone } from "@/lib/conversation";
import { pairNames, suggestFreeNames } from "@/lib/names";
import { scoreSheet } from "@/lib/originality";
import { listNotifications } from "@/lib/notifications";
import { pairKey } from "@/lib/relationships";
import { FREE_EPISODES_PER_SEASON } from "@/lib/rules";
import { weekAt } from "@/lib/seasons";
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
    // 2.11.0 (#622): swipe takes preview now; leave_nudge is a write with no dry run.
    const r = await call("leave_nudge", { character_id: id, with: HOUSE_PARTNER_ID, note: "Bring up the boat.", preview: true }, ctx);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/leave_nudge has no preview or dry run, so nothing was done or spent/);
    expect(await t.count("episodes")).toBe(0);
    // A dry run the tool knows by another name is read as that one: dry_run → preview, and nothing is booked.
    const d = (await call("go_on_date", { character_id: id, partner_id: HOUSE_PARTNER_ID, dry_run: true }, ctx)).structuredContent;
    expect(d.preview).toBe(true);
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
    expect(made.warning).toMatch(/a house-run bot's character \(one of the show's own scripts, not another agent\)/);
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
    expect(waited).toMatchObject({ wait_capped_at: 30, airs_at: booked.airs_at, aired: false });
    expect(waited.episode.ending).toBe("friends");
    expect((await call("get_episode", { episode_id: "no-such-date" }, ctx)).structuredContent.code).toBe("not_found");

    const other = await agentWith("Bo Quill");
    const pick = (await call("predict", { episode_id: booked.episode.id, pick: "friends", drama_pick: "a" }, other.ctx)).structuredContent;
    expect(pick).toMatchObject({ airs_at: booked.airs_at, points_if_right: 10, drama_points_if_right: 5 });
    expect(pick.note).toMatch(/predictions\.pending/);
    // 2.11.0 (#633): a connection's first my_status leaves the reference blocks out; include: ["all"] has them.
    const status = (await call("my_status", { include: ["all"] }, other.ctx)).structuredContent;
    expect(status.predictions.pending[0]).toMatchObject({ episode_id: booked.episode.id, pick: "friends", airs_at: booked.airs_at, points_if_right: 15 });
    // 2.11.0 (#619): the house-run bots' characters are counted beside the live agents' (none here).
    expect(status.others).toEqual({ agent_characters: 1, house_bot_characters: 0, agents_this_week: 1 });

    // Aired early (a watch party could): predict says so plainly.
    await api.reveal(booked.episode.id, `bz_uid=${(await call("my_status", {}, ctx)).structuredContent.agent_id}`);
    const late = await call("predict", { episode_id: booked.episode.id, pick: "disaster" }, other.ctx);
    expect(late.isError).toBe(true);
    expect(late.content[0].text).toMatch(/already aired \(at .*can air before its listed airs_at/);
  });

  it("my_status: compact drops the notes, next points at unread texts and notices, and my_dates is pointed at (#429, #471, #444)", async () => {
    const { ctx, id, agentId } = await agentWith("Ada Lumen");
    await houseDate(ctx, id);
    // 2.11.0 (#633): a connection's first my_status leaves the reference blocks out; include: ["all"] has them.
    const full = (await call("my_status", { include: ["all"] }, ctx)).structuredContent;
    expect(full.latest_dates_note).toMatch(/my_dates lists every date/);
    // 2.5.0 (the 2026-10-21-2300 run): a name and a line each by default; include: ["cast"] has the traits.
    expect(full.house_cast[0].line).toBeDefined();
    expect((await call("my_status", { include: ["cast"] }, ctx)).structuredContent.house_cast[0].traits).toBeDefined();
    expect(full.compact_tip).toMatch(/compact: true/);
    const compact = (await call("my_status", { compact: true }, ctx)).structuredContent;
    // 2.10.1 (#670): agent_id_note is the identity's (it was prose after the JSON in the text), not one of my_status' notes.
    expect(Object.keys(compact).filter((k) => (k.endsWith("_note") && k !== "agent_id_note") || k === "compact_tip")).toEqual([]);
    // 2.4.3: this session already had the house cast (the call above), so compact leaves it out and says how to get it back.
    expect(compact.house_cast).toBeUndefined();
    expect(compact.left_out).toMatchObject({ blocks: expect.arrayContaining(["house_cast"]), back: expect.stringMatching(/compact: false/) });
    const fresh = (await call("my_status", { compact: true, agent_id: agentId }, {})).structuredContent;
    expect(Object.keys(fresh.house_cast[0]).sort()).toEqual(["id", "name"]);
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
    // The window is in the future: a one-second wait says when to come back instead of blocking. 2.7.0 (#641): a wait never
    // books, so it answers as a preview (can_plan: false, not_aired), not an error.
    const soon = await call("plan_second_date", { episode_id: booked.episode.id, wait_seconds: 1 }, ctx);
    expect(soon.isError).toBeUndefined();
    expect(soon.structuredContent).toMatchObject({ preview: true, booked: false, returned_because: "timeout", second_date: { can_plan: false, reason: "not_aired" } });
    const priv = await houseDate(ctx, id, { visibility: "private", again: true });
    const closed = await call("plan_second_date", { episode_id: priv.episode.id }, ctx);
    expect(closed.content[0].text).toMatch(new RegExp(`set_date_visibility with episode_id "${priv.episode.id}" and visibility "unlisted"`));
    expect(closed.content[0].text).toMatch(/books a new date, not this one's second date/);
    const sd = (await call("sliding_doors", { episode_id: booked.episode.id, change: "bolder" }, ctx)).structuredContent;
    expect(sd.cost).toMatchObject({ spent: "nothing", agents_shared_daily: "not counted" });
  });

  it("the leaderboard marks a place held on few reviews as provisional (#488)", async () => {
    const { ctx } = await agentWith("Ada Lumen");
    const race = (await call("get_leaderboard", {}, ctx)).structuredContent;
    expect(race.house_cast_race.length).toBeGreaterThan(0);
    expect(race.house_cast_race.every((p: Any) => p.provisional === true)).toBe(true);
    expect(race.race_note).toMatch(/provisional marks a place resting on fewer than 3 reviews/);
    expect(race.race_note).toMatch(/reviews counts this season's reviews from agents and people \(house bots left out\)/); // #1141
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
    expect(like.next).toMatch(/Their agent was active now/);
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
    // 2.11.0 (#619): a count that went says 0, once, rather than vanishing.
    expect(sent.waiting_for_you?.matched ?? 0).toBe(0);
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
    expect(after.waiting_for_you?.matched ?? 0).toBe(0);
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
    expect(preview).toMatchObject({ preview: true, started: false, kind: "your_own_two", format: { lines: 12 }, other_side: expect.stringMatching(/You play both/), visibility: "public" });
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
    // A plain read is compact (#214; 2.8.0: the prompt left out) and says how to get the full prompt back for a resume (#440).
    const plain = (await call("get_own_date_step", { episode_id: step.episode_id }, ctx)).structuredContent.step;
    expect(plain.messages.some((m: Any) => m.role === "system")).toBe(false);
    expect(plain.instructions).toMatch(/compact: true adds this turn's prompt \(messages\), false all of it/);
    expect((await call("get_own_date_step", { episode_id: step.episode_id, compact: true }, ctx)).structuredContent.step.instructions).toMatch(/Lost it\? compact: false/);
    const full = (await call("get_own_date_step", { episode_id: step.episode_id, compact: false }, ctx)).structuredContent.step;
    expect(full.messages.some((m: Any) => m.role === "system")).toBe(true);
    // Several lines in one call, in order; a refusal says how many went in.
    const batch = (await call("submit_own_date_step", { episode_id: step.episode_id, outputs: [line(0), line(1), line(2)] }, ctx)).structuredContent;
    // 2.6.0 (the 2026-10-22-0042 run): the count is outputs_sent; `of` is the date's length, as on every step.
    expect(batch).toMatchObject({ accepted: true, accepted_count: 3, outputs_sent: 3, of: step.of });
    expect(batch.step).toMatchObject({ stage: "turn", turn: 3 });
    const refused = (await call("submit_own_date_step", { episode_id: step.episode_id, outputs: [line(3), { dialogue: "x", interest_signal: "very" }] }, ctx)).structuredContent; // a field of the wrong type: missing ones get defaults since 2.4.5
    // #1118: the first line went in, so accepted says so; refused_at names the one to resend from.
    expect(refused).toMatchObject({ accepted: true, ok: false, accepted_count: 1, refused_at: 2, outputs_sent: 2 });
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
    const goodbye = (await call("submit_own_date_step", { episode_id: step.episode_id, output: { ...line(4), done: true } }, ctx)).structuredContent;
    expect(goodbye.done_ignored).toBeUndefined();
    // 2026-10-23: a goodbye never cuts the other side off: it gets its last line (with its see_again), then the date ends.
    expect(goodbye.step).toMatchObject({ stage: "turn", turn_number: 6, of: 6, see_again: expect.any(String) });
    const closing = (await call("submit_own_date_step", { episode_id: step.episode_id, output: line(5) }, ctx)).structuredContent;
    expect(closing.step.stage).toBe("recap");
    expect(closing.step.where).toMatch(/\w/);
    expect(closing.step.instructions).toMatch(/Set it at /);
    const scheduled = (await call("submit_own_date_step", { episode_id: step.episode_id, output: validEpisodeDraft({ best_line: "Same time next week, then?" }) }, ctx)).structuredContent;
    expect(scheduled).toMatchObject({ accepted: false, ok: false });
    expect(scheduled.message).toMatch(/best_line is a line about scheduling/);
    expect(scheduled.reply_format).toMatch(/best_line/);
    const done = (await call("submit_own_date_step", { episode_id: step.episode_id, output: validEpisodeDraft() }, ctx)).structuredContent;
    expect(done.step.stage).toBe("done");
    expect((await t.db.query<Any>(`select jsonb_array_length(transcript) as n, status from episodes where id = $1`, [step.episode_id])).rows[0]).toEqual({ n: 6, status: "ready" });
    // The debrief names the cue only when both characters are yours (#469): no dealbreaker tripped here, so nothing to say.
    const ep = (await call("get_episode", { episode_id: step.episode_id }, ctx)).structuredContent;
    expect(ep.status).toBe("ready");
  });

  it("the line that brings the recap gets its reply_format and the finale rule up front, on every date on the connection (#853)", async () => {
    const ctx = await connect();
    const a = (await call("create_character", validCharacter({ name: "Ada Lumen" }), ctx)).structuredContent.character.id;
    const b = (await call("create_character", validCharacter({ name: "Bo Quill" }), ctx)).structuredContent.character.id;
    for (let date = 0; date < 2; date++) {
      scriptOutcome({ ending: "friends" });
      const step = (await call("start_own_date", { character_id: a, partner_id: b, format: "speed_date", ...(date ? { again: true } : {}) }, ctx)).structuredContent.step;
      await call("submit_own_date_step", { episode_id: step.episode_id, outputs: [line(0), line(1), line(2), line(3), line(4)] }, ctx);
      const closing = (await call("submit_own_date_step", { episode_id: step.episode_id, output: { ...line(5), see_again: true } }, ctx)).structuredContent;
      expect(closing.step.stage).toBe("recap");
      expect(closing.reply_format).toMatch(/"finale"/);
      expect(closing.step.reply_format).toBe(closing.reply_format);
      expect(closing.step.instructions).toMatch(/never a day of the week or a clock time/);
      expect(closing.step.instructions).toMatch(/not a bare string/);
      expect(closing.next_calls[0].output ?? closing.next_calls[0].args.output).toMatch(/JSON object/);
      const done = (await call("submit_own_date_step", { episode_id: step.episode_id, output: validEpisodeDraft() }, ctx)).structuredContent;
      expect(done.step.stage).toBe("done");
      expect(done.reply_format).toBeUndefined();
    }
  });

  it("autoplay: preview plays nothing, and the default side is yours on a two-agent date, both with a house-run bot (#485, #480, #457)", async () => {
    scriptOutcome({ ending: "friends" });
    const { A, B } = await matched();
    await call("answer_match", { character_id: A.id, with: B.id, yes: true }, A.ctx);
    await call("answer_match", { character_id: B.id, with: A.id, yes: true }, B.ctx);
    const started = (await call("start_own_date", { character_id: A.id, partner_id: B.id, format: "speed_date" }, A.ctx)).structuredContent;
    const id = started.step.episode_id;
    const preview = (await call("autoplay_own_date", { episode_id: id, preview: true }, A.ctx)).structuredContent;
    expect(preview).toMatchObject({ preview: true, played: false, side: "mine", lines_left: 6, show_plays: ["Ada Lumen"] });
    expect((await t.db.query<Any>(`select autoplay, handed_over from episodes where id = $1`, [id])).rows[0]).toEqual({ autoplay: false, handed_over: null });
    const both = await call("autoplay_own_date", { episode_id: id, preview: true, side: "both" }, A.ctx);
    expect(both.isError).toBe(true);
    expect(both.content[0].text).toMatch(/only your side/);
    // Bo's agent is one of the show's own scripts: the show can play its side too, so the whole date can finish.
    await t.db.query(`update mcp_sessions set client_name = 'botchelor-loop-swipe-back' where agent_id = $1`, [B.agentId]);
    const botPreview = (await call("autoplay_own_date", { episode_id: id, preview: true }, A.ctx)).structuredContent;
    expect(botPreview).toMatchObject({ side: "mine", house_bot: true, show_plays: ["Ada Lumen", "Bo Quill"] });
    const turn = (i: number) => JSON.stringify({ dialogue: `Autoplayed line ${i} about maps and weather.`, action: "", emotion: "warm", interest_signal: 0.6 });
    scriptedModel([turn(0), turn(1), turn(2), turn(3), turn(4), turn(5), episodeJson()]);
    const played = (await call("autoplay_own_date", { episode_id: id }, A.ctx)).structuredContent;
    expect(played.isError).toBeUndefined();
    expect(played).toMatchObject({ autoplay: "mine" });
    expect(played.step.stage).toBe("done");
    expect((await t.db.query<Any>(`select status from episodes where id = $1`, [id])).rows[0].status).toBe("ready");
    // #537: the "date is done" notice says who played: one agent and a house-run bot, not "both agents".
    const done = (await listNotifications(t.db, B.agentId)).find((x) => x.kind === "own_date_ready");
    expect(done?.body).toMatch(/You performed Bo Quill's side; Ada Lumen is a house-run bot's character/);
    expect(done?.body).not.toMatch(/Both agents performed/);
    // #529: a finished date leaves no "your move" or invite notice unread, on either side.
    const stale = (await t.db.query<Any>(`select count(*)::int as n from notifications where kind in ('own_date_turn', 'own_date_invite') and read_at is null and body like $1`, [`%${id}%`])).rows[0].n;
    expect(stale).toBe(0);
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
    expect(n?.body).toMatch(new RegExp(`update_character with partner_style: "open" and open_to_dates: true \\(${mine}\\)`));
    expect(n?.body).toMatch(/go_on_date with anyone else is refused/);
  });
});

describe("the 2026-10-21 runs (#517, #519, #520, #529, #534, #535, #536, #537)", () => {
  it("create_character check_only runs the sheet rules a save does: an age under 18 is refused, nothing saved (#519)", async () => {
    const ctx = await connect();
    const r = await call("create_character", validCharacter({ name: "Pip Marlow", age: 12, check_only: true }), ctx);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/adults \(18\+\)/);
    expect(r.content[0].text).toMatch(/Nothing was saved/);
    expect(await t.count("characters", "not is_house")).toBe(0);
    const ok = (await call("create_character", validCharacter({ name: "Pip Marlow", check_only: true }), ctx)).structuredContent;
    expect(ok.saved).toBe(false);
    expect(await t.count("characters", "not is_house")).toBe(0);
  });

  it("go_on_date preview runs the one-partner check, and says blind can pick another creator's character (#534, #535)", async () => {
    const { ctx, id } = await agentWith("Ada Lumen");
    const other = await agentWith("Cy Marr", { open_to_dates: true });
    const clean = (await call("go_on_date", { character_id: id, partner_id: HOUSE_PARTNER_ID, preview: true }, ctx)).structuredContent;
    expect(clean).toMatchObject({ preview: true, booked: false, can_book: true });
    expect(clean.problems).toBeUndefined();
    const blind = (await call("go_on_date", { character_id: id, blind: true, preview: true }, ctx)).structuredContent;
    expect(blind.with).toMatch(/another creator's character/);
    // Ada wants one partner and is dating Cy: a house date would be refused, and the preview says so first.
    const [lo, hi] = pairKey(id, other.id);
    await t.db.query(`update characters set partner_style = 'one' where id = $1`, [id]);
    await t.db.query(`insert into relationships (character_a, character_b, stage) values ($1, $2, 'dating')`, [lo, hi]);
    const taken = (await call("go_on_date", { character_id: id, partner_id: HOUSE_PARTNER_ID, preview: true }, ctx)).structuredContent;
    expect(taken.can_book).toBe(false);
    expect(taken.problems[0]).toMatch(/Ada is with Cy Marr and wants one partner.*partner_style: "open"/);
    expect(await t.count("episodes")).toBe(0);
    const real = await call("go_on_date", { character_id: id, partner_id: HOUSE_PARTNER_ID }, ctx);
    expect(real.isError).toBe(true);
    expect(real.content[0].text).toMatch(/wants one partner/);
  });

  it("go_on_date preview says can_book: false when there's no date left or the shared budget is spent (#769)", async () => {
    const { ctx, id, agentId } = await agentWith("Ada Lumen");
    await t.db.query(`insert into free_episode_usage (user_id, season_id, used) values ($1, $2, $3)`, [agentId, weekAt(new Date()).id, FREE_EPISODES_PER_SEASON]);
    const out = (await call("go_on_date", { character_id: id, partner_id: HOUSE_PARTNER_ID, preview: true }, ctx)).structuredContent;
    expect(out.can_book).toBe(false);
    expect(out.problems).toEqual([expect.stringMatching(/No dates left.*booking would be refused/)]);
    expect(out.cost.would_spend).toMatch(/would be refused/);
    const real = await call("go_on_date", { character_id: id, partner_id: HOUSE_PARTNER_ID }, ctx);
    expect(real.isError).toBe(true);
    expect(await t.count("episodes")).toBe(0);

    await t.db.query(`delete from free_episode_usage`);
    vi.stubEnv("BOTCHELOR_AGENT_DAILY_DATES", "0");
    const paused = (await call("go_on_date", { character_id: id, partner_id: HOUSE_PARTNER_ID, preview: true }, ctx)).structuredContent;
    expect(paused.can_book).toBe(false);
    expect(paused.problems).toEqual([expect.stringMatching(/Agent dates are paused/)]);
    vi.stubEnv("BOTCHELOR_AGENT_DAILY_DATES", "20");
    expect((await call("go_on_date", { character_id: id, partner_id: HOUSE_PARTNER_ID, preview: true }, ctx)).structuredContent.can_book).toBe(true);
  });

  it("behind the swipe gate, go_on_date preview on another agent's unmatched character says can_book: false, match first (#850)", async () => {
    setSwipeGateForTests(true);
    try {
      const A = await agentWith("Ada Lumen", { open_to_dates: true, extras: PROFILE });
      const B = await agentWith("Bo Quill", { open_to_dates: true, extras: PROFILE });
      const out = (await call("go_on_date", { character_id: A.id, partner_id: B.id, preview: true }, A.ctx)).structuredContent;
      expect(out.can_book).toBe(false);
      expect(out.code).toBe("match_first");
      expect(out.problems).toEqual([expect.stringMatching(/haven't matched yet\. Match first/)]);
      expect(out.next_calls.map((c: Any) => c.tool)).toEqual(["swipe", "swipe_deck"]);
      expect(out.next_calls[0].args).toEqual({ character_id: A.id, target_id: B.id, like: true });
      const real = await call("go_on_date", { character_id: A.id, partner_id: B.id }, A.ctx);
      expect(real.isError).toBe(true);
      // The house cast needs no match.
      expect((await call("go_on_date", { character_id: A.id, partner_id: HOUSE_PARTNER_ID, preview: true }, A.ctx)).structuredContent.can_book).toBe(true);
      // Matched, with only one yes: still not bookable, and the preview says whose answer is missing.
      await call("swipe", { character_id: A.id, target_id: B.id, like: true }, A.ctx);
      await call("swipe", { character_id: B.id, target_id: A.id, like: true }, B.ctx);
      await call("answer_match", { character_id: A.id, with: B.id, yes: true }, A.ctx);
      const waiting = (await call("go_on_date", { character_id: A.id, partner_id: B.id, preview: true }, A.ctx)).structuredContent;
      expect(waiting.can_book).toBe(false);
      expect(waiting.match_status).toBe("waiting_on_them");
      expect(waiting.next_calls).toBeUndefined();
      await call("answer_match", { character_id: B.id, with: A.id, yes: true }, B.ctx);
      const agreed = (await call("go_on_date", { character_id: A.id, partner_id: B.id, preview: true }, A.ctx)).structuredContent;
      expect(agreed.can_book).toBe(true);
      expect(agreed.code).toBeUndefined();
    } finally {
      setSwipeGateForTests(false);
    }
  });

  it("out of dates, go_on_date says when free dates return and that own dates are free, with no shop to look for (#760)", async () => {
    const { ctx, id, agentId } = await agentWith("Ada Lumen");
    await t.db.query(`insert into free_episode_usage (user_id, season_id, used) values ($1, $2, $3)`, [agentId, weekAt(new Date()).id, FREE_EPISODES_PER_SEASON]);
    const real = await call("go_on_date", { character_id: id, partner_id: HOUSE_PARTNER_ID }, ctx);
    expect(real.isError).toBe(true);
    expect(real.structuredContent.code).toBe("quota");
    const text = real.structuredContent.error as string;
    expect(text).toMatch(/^No dates left on the show's model/);
    expect(text).toContain(`Monday 00:00 UTC (${weekAt(new Date()).ends_at})`);
    expect(text).toMatch(/start_own_date is free and unlimited/);
    expect(text).toMatch(/There's no shop over MCP/);
    expect(text).not.toMatch(/in the shop/);
  });

  it("feedback_board names vote_feedback's arguments and fills in a call on another agent's item (#771)", async () => {
    const a = await agentWith("Ada Lumen");
    const empty = (await call("feedback_board", {}, a.ctx)).structuredContent;
    expect(empty.next_calls).toBeUndefined();
    await call("send_feedback", { wants: "A picnic format with a basket of props." }, a.ctx);
    expect((await call("feedback_board", {}, a.ctx)).structuredContent.next_calls).toBeUndefined(); // only its own item
    const b = await agentWith("Bo Quill");
    const board = (await call("feedback_board", {}, b.ctx)).structuredContent;
    expect(board.note).toMatch(/vote_feedback with item_id \(an item's id\) and vote: "up"/);
    expect(board.next_calls).toEqual([{ tool: "vote_feedback", args: { item_id: board.items[0].id, vote: "up" }, why: expect.any(String) }]);
    const v = await call("vote_feedback", board.next_calls[0].args, b.ctx);
    expect(v.isError).toBeUndefined();
  });

  it("sliding_doors says an autonomy change swings every number, trust included (#762)", async () => {
    const { ctx, id } = await agentWith("Ada Lumen");
    const booked = await houseDate(ctx, id);
    const bolder = (await call("sliding_doors", { episode_id: booked.episode.id, change: "bolder" }, ctx)).structuredContent.sliding_doors;
    expect(bolder.what_changed).toMatch(/how much the dice swing every number on the box score, so trust or chemistry can move up or down/);
    expect(bolder.what_changed).not.toMatch(/nothing else moved/);
    const longer = (await call("sliding_doors", { episode_id: booked.episode.id, change: "long_game" }, ctx)).structuredContent.sliding_doors;
    expect(longer.what_changed).toMatch(/weighed on trust most/);
    expect(MCP_TOOLS.find((x) => x.name === "sliding_doors")!.description).toMatch(/chance swings every number more, trust too/);
  });

  it("a date being written is said to take about 2 minutes, and the countdown runs from 3 (#770)", async () => {
    const { ctx, id } = await agentWith("Ada Lumen");
    const booked = await houseDate(ctx, id);
    const at = async (age: number) => {
      await t.db.query(`update episodes set status = 'generating', created_at = now() - make_interval(secs => $2) where id = $1`, [booked.episode.id, age]);
      return (await call("get_episode", { episode_id: booked.episode.id, summary: true }, ctx)).structuredContent.writing;
    };
    // On pace: a few lines in, as the show writes them line by line.
    await t.db.query(`update episodes set transcript = (select jsonb_agg(jsonb_build_object('turn', i)) from generate_series(1, 6) i) where id = $1`, [booked.episode.id]);
    expect((await at(60)).eta).toMatch(/^about 2 minutes, rarely more than 3 in all: probably about 1[12]\d seconds more at most$/);
    expect((await at(200)).eta).toMatch(/^a little longer than usual: \d+ lines so far/);
    expect((await at(400)).eta).toMatch(/retried automatically/);
    // #1140: a date stuck on a line or two says so, with how far it has got, instead of counting down by age.
    await t.db.query(`update episodes set transcript = '[]'::jsonb where id = $1`, [booked.episode.id]);
    const stuck = await at(240);
    expect(stuck.eta).toMatch(/^slower than usual: 0 lines in 4 minutes.*retried automatically/);
    expect(stuck.dates_writing_now).toBeGreaterThanOrEqual(1);
    expect(MCP_TOOLS.find((x) => x.name === "go_on_date")!.description).toMatch(/Written in about 2 minutes, rarely more than 3/);
    expect(JSON.stringify(MCP_TOOLS)).not.toMatch(/1 to 5 minutes/);
  });

  it("plan_second_date check says what booking would spend (#536)", async () => {
    const { ctx, id } = await agentWith("Ada Lumen");
    const booked = await houseDate(ctx, id);
    const check = (await call("plan_second_date", { episode_id: booked.episode.id, check: true }, ctx)).structuredContent;
    expect(check.second_date.can_plan).toBe(false);
    expect(check.cost.would_spend).toMatch(/1 free weekly date and 1 of the agents' shared daily dates/);
    expect(check.dates_left.free_left).toBeGreaterThan(0);
  });

  it("declining a two-agent date marks its invite read for the other side (#529)", async () => {
    const { A, B } = await matched();
    await call("answer_match", { character_id: A.id, with: B.id, yes: true }, A.ctx);
    await call("answer_match", { character_id: B.id, with: A.id, yes: true }, B.ctx);
    const started = (await call("start_own_date", { character_id: A.id, partner_id: B.id }, A.ctx)).structuredContent;
    const unreadInvites = async () => (await t.db.query<Any>(`select count(*)::int as n from notifications where user_id = $1 and kind = 'own_date_invite' and read_at is null`, [B.agentId])).rows[0].n;
    expect(await unreadInvites()).toBe(1);
    await call("decline_own_date", { episode_id: started.step.episode_id }, A.ctx);
    expect(await unreadInvites()).toBe(0);
  });

  it("get_relationships names both second-date numbers (#520)", async () => {
    const { ctx, id } = await agentWith("Ada Lumen");
    await houseDate(ctx, id);
    await t.db.query(`update episodes set revealed_at = now()`);
    const r = (await call("get_relationships", { character_id: id }, ctx)).structuredContent;
    const edge = r.relationships?.[0];
    if (edge) {
      expect(edge.second_dates).toBeUndefined();
      expect(edge).toMatchObject({ second_dates_earned: expect.any(Number), second_dates_had: 0 });
      expect(edge.second_dates_note).toMatch(/follow-up dates that took place/);
    }
  });

  it("when a date airs, each predictor hears what their pick scored, in my_status's new_since (#851)", async () => {
    const { ctx, id, agentId } = await agentWith("Ada Lumen");
    const booked = await houseDate(ctx, id);
    const right = await agentWith("Bo Quill");
    const wrong = await agentWith("Cy Marr");
    const pick = (await call("predict", { episode_id: booked.episode.id, pick: "friends" }, right.ctx)).structuredContent;
    expect(pick.note).toMatch(/you'll hear what it scored when it airs/);
    await call("predict", { episode_id: booked.episode.id, pick: "disaster" }, wrong.ctx);
    const before = (await call("my_status", {}, right.ctx)).structuredContent;
    await api.reveal(booked.episode.id, `bz_uid=${agentId}`);
    const after = (await call("my_status", { since: before.cursor }, right.ctx)).structuredContent;
    expect(after.new_since).toEqual([expect.objectContaining({ kind: "prediction_scored", title: expect.stringMatching(/Your pick on Ada × .* scored: \+10 points/) })]);
    const missed = await listNotifications(t.db, wrong.agentId);
    expect(missed).toEqual([expect.objectContaining({ kind: "prediction_scored", title: expect.stringMatching(/not this time/), body: expect.stringMatching(/You picked a disaster; it ended in just friends/) })]);
    // The booker made no pick, so hears nothing about one.
    expect((await listNotifications(t.db, agentId)).filter((n) => n.kind === "prediction_scored")).toEqual([]);
  });

  it("my_status waits the whole wait when nothing is newer than since, and says why it returned (#540)", async () => {
    const { ctx, agentId } = await agentWith("Ada Lumen");
    // An old unread notice: it must not end a wait that starts after it.
    await t.db.query(`insert into notifications (id, user_id, kind, title, body, link, created_at) values ($1, $2, 'texted', 'Bo texted', null, null, now() - interval '1 minute')`, [crypto.randomUUID(), agentId]);
    const first = (await call("my_status", {}, ctx)).structuredContent;
    const started = Date.now();
    const waited = (await call("my_status", { since: first.cursor, wait_seconds: 1 }, ctx)).structuredContent;
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    expect(waited).toMatchObject({ new_since: [], returned_because: "timeout" });
    expect(waited.waited_seconds).toBeGreaterThanOrEqual(1);
    // An older since returns at once, and the reply says so instead of looking like a broken wait.
    const stale = (await call("my_status", { since: new Date(Date.now() - 3_600_000).toISOString(), wait_seconds: 1 }, ctx)).structuredContent;
    expect(stale.returned_because).toBe("new"); // 2.4.1: new | timeout | unread_at_start; since_note says it was already there
    expect(stale.since_note).toMatch(/already newer than since/);
    expect(stale.new_since).toHaveLength(1);
  });

  it("the budget block says tokens are the topped-up pack, apart from the free dates (#539)", async () => {
    const { ctx, id } = await agentWith("Ada Lumen");
    const preview = (await call("go_on_date", { character_id: id, partner_id: HOUSE_PARTNER_ID, preview: true }, ctx)).structuredContent;
    expect(preview.cost.left).toMatchObject({ free_dates_this_week: 3, tokens: 0, note: expect.stringMatching(/topped-up pack dates only/) });
  });

  it("a short episode id resolves when one date starts with it, and says the full id is needed otherwise (#542)", async () => {
    const { ctx, id } = await agentWith("Ada Lumen");
    const booked = await houseDate(ctx, id);
    const short = booked.episode.id.slice(0, 8);
    const r = (await call("get_episode", { episode_id: short, summary: true }, ctx)).structuredContent;
    expect(r.episode.id).toBe(booked.episode.id);
    expect((r.read_arguments_as ?? []).join(" ")).toMatch(new RegExp(`episode_id ${short} → ${booked.episode.id}`));
    const none = await call("predict", { episode_id: "deadbeef", pick: "friends" }, ctx);
    expect(none.isError).toBe(true);
    expect(none.content[0].text).toMatch(/full 36-character id \(got 8 characters, and no date starts with that\)/);
  });

  it("set_date_visibility says what each visibility changes, before and after (#543)", async () => {
    const { ctx, id } = await agentWith("Ada Lumen");
    const booked = await houseDate(ctx, id);
    const tool = MCP_TOOLS.find((t) => t.name === "set_date_visibility")!;
    expect(tool.description).toMatch(/unlisted: anyone with the link; airs on its own like a public date; not in the feed, no predictions or points/);
    expect(tool.description).toMatch(/private: offline/);
    const unlisted = (await call("set_date_visibility", { episode_id: booked.episode.id, visibility: "unlisted" }, ctx)).structuredContent;
    expect(unlisted.now).toMatch(/^unlisted: anyone with the link; airs on its own/);
    await t.db.query(`update episodes set revealed_at = now() where id = $1`, [booked.episode.id]);
    const back = (await call("set_date_visibility", { episode_id: booked.episode.id, visibility: "public" }, ctx)).structuredContent;
    expect(back.note).toMatch(/had already aired \(airing isn't undone\), so from now on it's in the feed, scoring and counting/);
    expect(back.now).toMatch(/^public: in the feed/);
  });
});

describe("2026-10-23 production visitors", () => {
  it("two agents starting a date for the same couple at once end up in one date, the oldest", async () => {
    scriptOutcome({ ending: "friends" });
    const { A, B } = await matched();
    await call("answer_match", { character_id: A.id, with: B.id, yes: true }, A.ctx);
    await call("answer_match", { character_id: B.id, with: A.id, yes: true }, B.ctx);
    const [ra, rb] = await Promise.all([
      call("start_own_date", { character_id: A.id, partner_id: B.id, format: "speed_date" }, A.ctx),
      call("start_own_date", { character_id: B.id, partner_id: A.id, format: "speed_date" }, B.ctx),
    ]);
    const live = (await t.db.query<Any>(
      `select id from episodes where status = 'generating' and ((character_a = $1 and character_b = $2) or (character_a = $2 and character_b = $1))`,
      [A.id, B.id],
    )).rows;
    expect(live).toHaveLength(1);
    // Both agents are pointed at the date that stands (one booked it, the other is told it's already started or resumed).
    for (const r of [ra, rb]) {
      const id = r.structuredContent?.step?.episode_id ?? (r.content[0].text.match(/[0-9a-f-]{36}/) ?? [])[0];
      expect(id).toBe(live[0].id);
    }
  });
});
