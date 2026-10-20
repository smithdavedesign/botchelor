import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import type { ChatMessage, Model } from "@/lib/model";
import { listNotifications } from "@/lib/notifications";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { answerMatch, deckFor, matchView, myMatches, setMatchChatEnabledForTests, startMatchChat, swipe } from "@/lib/swipes";
import { loadChain } from "@/lib/text-chain";
import { sendText } from "@/lib/texting";
import { api, episodeJson, HOUSE_PARTNER_ID, newUserCookie, scriptedModel, scriptOutcome, startTestDb, userIdOf, validCharacter } from "./helpers";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const PROFILE = {
  prompts: [
    { id: "simple_pleasures", answer: "A window seat and nowhere to be." },
    { id: "geek_out", answer: "Old maps, and the places on them that don't exist any more." },
  ],
  hobbies: ["Hiking", "Old maps"],
};
/** A model that answers each call with the next text, and keeps what it was asked. */
function texter(lines: string[]): Model & { asked: ChatMessage[][] } {
  const m = {
    asked: [] as ChatMessage[][],
    async complete(messages: ChatMessage[]) {
      m.asked.push(messages);
      return JSON.stringify({ text: lines[m.asked.length - 1] ?? "ok" });
    },
  };
  return m;
}
const dataOf = (messages: ChatMessage[]): Any => JSON.parse(messages[1].content.slice(messages[1].content.indexOf("{")));
const rpc = async (name: string, args: Record<string, unknown>, ctx: McpContext = {}): Promise<Any> =>
  ((await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, ctx)) as Any).result;

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  setSeasonCastForTests([HOUSE_PARTNER_ID]);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  setSeasonCastForTests(null);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** A person and their character: with a dating profile and in the deck unless told otherwise. */
async function person(name: string, opts: { profile?: boolean; open?: boolean } = {}) {
  const cookie = newUserCookie();
  const body = validCharacter({ name, ...(opts.profile === false ? {} : { extras: PROFILE }), ...(opts.open === false ? {} : { open_to_dates: true }) });
  const character = await (await api.createCharacter(body, cookie)).json();
  return { cookie, userId: userIdOf(cookie), id: character.id as string, name };
}

/** An agent and its character (made over MCP), with a dating profile and in the deck. */
async function agent(name: string) {
  const made = (await rpc("create_character", { ...validCharacter({ name }), extras: PROFILE, open_to_dates: true })).structuredContent;
  return { userId: made.agent_id as string, id: made.character.id as string, name };
}

describe("the dating profile and the deck (lib/swipes.ts)", () => {
  it("a character swipes once it has a dating profile; the deck holds this season's house cast and complete profiles in the deck", async () => {
    const bare = await person("Bare Fenn", { profile: false });
    const no = await deckFor(t.db, bare.userId, bare.id);
    expect(no).toMatchObject({ ok: false, error: "profile_incomplete", missing: [expect.stringMatching(/2 more answered profile prompts/), expect.stringMatching(/2 more interests/)] });

    const me = await person("Wren Kestrel");
    const open = await person("Pim Alder");
    await person("Closed Doe", { open: false });
    await person("Blank Doe", { profile: false });
    const deck = await deckFor(t.db, me.userId, me.id);
    if (!deck.ok) throw new Error(deck.message);
    const ids = deck.cards.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining([HOUSE_PARTNER_ID, open.id]));
    expect(ids).toHaveLength(2); // never itself, a closed character, or an incomplete profile
    const card = deck.cards.find((c) => c.id === open.id)!;
    expect(card).toMatchObject({ name: "Pim Alder", interests: ["Hiking", "Old maps"], prompts: [{ prompt: "My simple pleasures…", answer: "A window seat and nowhere to be." }, expect.any(Object)] });
    expect(card.why.length).toBeGreaterThan(0);
    // The house card is a full profile too.
    expect(deck.cards.find((c) => c.id === HOUSE_PARTNER_ID)).toMatchObject({ house: true, prompts: [expect.any(Object), expect.any(Object)] });
  });

  it("a like both ways is a match, both owners hear about it, and a swipe is final; a house character always likes back", async () => {
    const a = await person("Wren Kestrel");
    const b = await person("Pim Alder");
    expect(await swipe(t.db, a.userId, a.id, b.id, true)).toMatchObject({ ok: true, liked: true, match: null });
    expect(await swipe(t.db, a.userId, a.id, b.id, true)).toMatchObject({ ok: false, error: "already_swiped" });
    // Likes are secret: B's deck doesn't say A liked them (A just ranks a little higher).
    const bDeck = await deckFor(t.db, b.userId, b.id);
    expect(JSON.stringify(bDeck)).not.toMatch(/liked/i);
    const both = await swipe(t.db, b.userId, b.id, a.id, true);
    expect(both).toMatchObject({ ok: true, match: { agreed: expect.any(Boolean) } });
    if (!both.ok || !both.match) throw new Error("no match");
    // A person's character decides for itself: both answers are given, and repeatable.
    expect(typeof both.match.yes_lo).toBe("boolean");
    expect(typeof both.match.yes_hi).toBe("boolean");
    const told = (await listNotifications(t.db, a.userId))[0];
    expect(told).toMatchObject({ kind: "matched", title: expect.stringMatching(/^💘 It's a match: /) });
    expect(told.title).toContain(a.name);
    expect(told.title).toContain(b.name);
    expect((await listNotifications(t.db, b.userId))[0]).toMatchObject({ kind: "matched" });
    // Neither is in the other's deck any more.
    const deck = await deckFor(t.db, a.userId, a.id);
    expect(deck.ok && deck.cards.map((c) => c.id)).not.toContain(b.id);

    const house = await swipe(t.db, a.userId, a.id, HOUSE_PARTNER_ID, true);
    expect(house).toMatchObject({ ok: true, match: { agreed: expect.any(Boolean) } });
    const m = await matchView(t.db, a.id, HOUSE_PARTNER_ID);
    expect(m![a.id < HOUSE_PARTNER_ID ? "yes_hi" : "yes_lo"]).toBe(true); // the house character always says yes
  });

  it("a pass is final too, and someone outside the deck can't be swiped", async () => {
    const a = await person("Wren Kestrel");
    const closed = await person("Closed Doe", { open: false });
    expect(await swipe(t.db, a.userId, a.id, closed.id, true)).toMatchObject({ ok: false, error: "not_in_deck" });
    expect(await swipe(t.db, a.userId, a.id, HOUSE_PARTNER_ID, false)).toMatchObject({ ok: true, liked: false, match: null });
    const deck = await deckFor(t.db, a.userId, a.id);
    expect(deck.ok && deck.cards.map((c) => c.id)).not.toContain(HOUSE_PARTNER_ID);
    expect(await swipe(t.db, userIdOf(newUserCookie()), a.id, HOUSE_PARTNER_ID, true)).toMatchObject({ ok: false, error: "not_your_character" });
  });
});

describe("after a match: the chat, each character's yes, and the date", () => {
  // The shared harness turns the opening chat off; these tests drive it with their own model.
  beforeEach(() => setMatchChatEnabledForTests(true));
  afterEach(() => setMatchChatEnabledForTests(false));

  it("the opening chat performs both answers, then a yes from both is a date agreed, after the texts", async () => {
    const a = await person("Wren Kestrel");
    await swipe(t.db, a.userId, a.id, HOUSE_PARTNER_ID, true);
    const lo = a.id < HOUSE_PARTNER_ID ? a.id : HOUSE_PARTNER_ID;
    // Make the person's character a yes for this test (its answer is the character's own, seeded).
    await t.db.query(`update matches set yes_lo = true, yes_hi = true`);
    const model = texter(["Your profile says you bake. I need a verdict.", "Rain tonight. I'll be open.", "Then I'll bring an umbrella.", "It's a date."]);
    expect(await startMatchChat(t.db, a.id, HOUSE_PARTNER_ID, model)).toBe(4);
    // The person's character opens; matched mode; each text knows its private answer, the last ones land the plan.
    expect(model.asked[0][0].content).toMatch(/just matched in the show's swipe deck and haven't met yet/);
    expect(dataOf(model.asked[0]).you.name).toBe("Wren Kestrel");
    expect(dataOf(model.asked[3]).your_answer_about_a_date).toMatch(/suggest something specific|say yes to their idea/);
    const chain = await loadChain(t.db, a.id, HOUSE_PARTNER_ID, { userId: a.userId, owner: true });
    expect(chain.map((i) => (i.kind === "event" ? i.event : i.kind === "text" ? "text" : "date"))).toEqual(["matched", "text", "text", "text", "text", "date_agreed"]);
    expect((await listNotifications(t.db, a.userId))[0]).toMatchObject({ kind: "date_agreed", body: expect.stringMatching(/📅 Book date/), link: `/messages/${lo}/${lo === a.id ? HOUSE_PARTNER_ID : a.id}` });
    // Once only.
    expect(await startMatchChat(t.db, a.id, HOUSE_PARTNER_ID, model)).toBe(0);
  });

  it("an agent's character waits for its agent; a person's character can't be answered for", async () => {
    const human = await person("Wren Kestrel");
    const bot = await agent("Ada Lumen");
    await swipe(t.db, human.userId, human.id, bot.id, true);
    const back = await rpc("swipe", { character_id: bot.id, target_id: human.id, like: true, agent_id: bot.userId });
    expect(back.structuredContent).toMatchObject({ matched: true });
    const m = (await matchView(t.db, human.id, bot.id))!;
    const botSide = bot.id === m.lo ? "yes_lo" : "yes_hi";
    expect(m[botSide]).toBeNull();
    expect(await answerMatch(t.db, human.userId, human.id, bot.id, true)).toMatchObject({ ok: false, error: "decides_itself" });

    // The opening chat writes only the person's side: the agent writes its own.
    await t.db.query(`update matches set ${botSide === "yes_lo" ? "yes_hi" : "yes_lo"} = true`);
    expect(await startMatchChat(t.db, human.id, bot.id, texter(["Hi! Old maps, huh?"]))).toBe(1);
    expect(await sendText(t.db, { userId: bot.userId, from: bot.id, to: human.id, text: "Old maps forever. Coffee on Saturday?" })).toMatchObject({ ok: true });
    const answered = await rpc("answer_match", { character_id: bot.id, with: human.id, yes: true, agent_id: bot.userId });
    expect(answered.structuredContent).toMatchObject({ match: { agreed: true }, next: expect.stringMatching(/book it/) });
    const mine = (await rpc("my_matches", { character_id: bot.id, agent_id: bot.userId })).structuredContent.matches;
    expect(mine[0]).toMatchObject({ with: { id: human.id }, you: true, them: true, agreed: true });
    const thread = (await rpc("read_texts", { character_id: bot.id, with: human.id, agent_id: bot.userId })).structuredContent.items.map((x: Any) => x.kind);
    expect(thread).toEqual(["matched", "between_dates", "between_dates", "date_agreed"]);
  });

  it("the opening chat respects its daily cap, and the agreement still lands", async () => {
    vi.stubEnv("MATCH_CHATS_DAILY", "0");
    const a = await person("Wren Kestrel");
    await swipe(t.db, a.userId, a.id, HOUSE_PARTNER_ID, true);
    await t.db.query(`update matches set yes_lo = true, yes_hi = true`);
    expect(await startMatchChat(t.db, a.id, HOUSE_PARTNER_ID, texter(["never sent"]))).toBe(0);
    expect((await matchView(t.db, a.id, HOUSE_PARTNER_ID))!.agreed).toBe(true);
    expect((await loadChain(t.db, a.id, HOUSE_PARTNER_ID, { userId: a.userId, owner: true })).map((i) => i.kind)).toEqual(["event", "event"]);
  });

  it("an agreed match unlocks the date with a character that isn't open to dates; a match without both yeses doesn't", async () => {
    const a = await person("Wren Kestrel");
    const b = await person("Pim Alder");
    await swipe(t.db, a.userId, a.id, b.id, true);
    await swipe(t.db, b.userId, b.id, a.id, true);
    await t.db.query(`update characters set open_to_dates = false where id = $1`, [b.id]); // only the match can let them date now
    const book = async () => {
      scriptOutcome({ ending: "friends" });
      scriptedModel([episodeJson()]);
      return api.createEpisode({ character_id: a.id, partner_id: b.id }, a.cookie);
    };
    await t.db.query(`update matches set yes_lo = true, yes_hi = false`);
    expect((await book()).status).toBe(422);
    await t.db.query(`update matches set yes_lo = true, yes_hi = true`);
    expect((await book()).status).toBe(200);
    expect((await myMatches(t.db, a.userId, a.id))![0]).toMatchObject({ agreed: true });
  });
});

describe("swiping over MCP", () => {
  it("swipe_deck asks for the dating profile first, then deals cards; a house character matches straight away", async () => {
    const made = (await rpc("create_character", validCharacter({ name: "Ada Lumen" }))).structuredContent;
    const agentId = made.agent_id as string;
    const first = await rpc("swipe_deck", { character_id: made.character.id, agent_id: agentId });
    expect(first.isError).toBe(true);
    expect(first.content[0].text).toMatch(/dating profile.*update_character/s);
    await rpc("update_character", { character_id: made.character.id, extras: PROFILE, agent_id: agentId });
    const deck = (await rpc("swipe_deck", { character_id: made.character.id, agent_id: agentId })).structuredContent;
    expect(deck.cards.map((c: Any) => c.id)).toContain(HOUSE_PARTNER_ID);
    const swiped = (await rpc("swipe", { character_id: made.character.id, target_id: HOUSE_PARTNER_ID, like: true, agent_id: agentId })).structuredContent;
    // #405: the house cast needs no answer to book.
    expect(swiped).toMatchObject({ liked: true, matched: true, next: expect.stringMatching(/No answer needed[\s\S]*go_on_date/), why_now: expect.stringMatching(/always like/) });
  });
});

describe("a like that hasn't matched yet (#203)", () => {
  it("says no match yet and where a later match shows up; the match lands when they like back", async () => {
    const a = await agent("Ada Lumen");
    const b = await agent("Bo Quill");
    const first = (await rpc("swipe", { character_id: a.id, target_id: b.id, like: true, agent_id: a.userId })).structuredContent;
    expect(first).toMatchObject({ liked: true, matched: false, next: expect.stringMatching(/No match yet.*my_notifications.*my_matches/) });
    const back = (await rpc("swipe", { character_id: b.id, target_id: a.id, like: true, agent_id: b.userId })).structuredContent;
    expect(back).toMatchObject({ matched: true });
    expect((await listNotifications(t.db, a.userId)).map((n: Any) => n.kind)).toContain("matched");
  });

  it("a pass says nothing more", async () => {
    const a = await agent("Ada Lumen");
    const b = await agent("Bo Quill");
    const passed = (await rpc("swipe", { character_id: a.id, target_id: b.id, like: false, agent_id: a.userId })).structuredContent;
    expect(passed).toMatchObject({ liked: false, matched: false });
    expect(passed.next).toBeUndefined();
  });

  it("a date agreed between two agents' characters tells each agent the tool call, not a web button (#314)", async () => {
    const a = await agent("Ada Lumen");
    const b = await agent("Bo Quill");
    await rpc("swipe", { character_id: a.id, target_id: b.id, like: true, agent_id: a.userId });
    await rpc("swipe", { character_id: b.id, target_id: a.id, like: true, agent_id: b.userId });
    await rpc("answer_match", { character_id: a.id, with: b.id, yes: true, agent_id: a.userId });
    await rpc("answer_match", { character_id: b.id, with: a.id, yes: true, agent_id: b.userId });
    const agreed = (await listNotifications(t.db, a.userId)).find((n: Any) => n.kind === "date_agreed");
    expect(agreed?.body).toBe(`Book it with go_on_date (character_id: "${a.id}", partner_id: "${b.id}"), or play it with their agent: start_own_date with the same ids.`);
    expect(agreed?.body).not.toMatch(/Book date, at the top/);
  });

  it("reads action/direction words and a string \"true\" as a like, and refuses what it can't read (#313)", async () => {
    const a = await agent("Ada Lumen");
    const b = await agent("Bo Quill");
    const c = await agent("Cy Fenn");
    const d = await agent("Di Moss");
    const byAction = (await rpc("swipe", { character_id: a.id, target_id: b.id, action: "like", agent_id: a.userId })).structuredContent;
    expect(byAction).toMatchObject({ liked: true, read_arguments_as: ["action → like"] });
    const byString = (await rpc("swipe", { character_id: a.id, target_id: c.id, like: "true", agent_id: a.userId })).structuredContent;
    expect(byString).toMatchObject({ liked: true });
    const left = (await rpc("swipe", { character_id: b.id, target_id: a.id, direction: "left", agent_id: b.userId })).structuredContent;
    expect(left).toMatchObject({ liked: false, matched: false });
    const unread = await rpc("swipe", { character_id: a.id, target_id: d.id, like: "maybe", agent_id: a.userId });
    expect(unread.isError).toBe(true);
    expect(unread.content[0].text).toMatch(/true \(like, right\) or false \(pass, left\).*Nothing was swiped/);
    expect((await t.db.query(`select 1 from swipes where target = $1`, [d.id])).rows).toHaveLength(0);
  });

  it("two likes at once: at least one of them sees the match, and there's one match", async () => {
    const a = await agent("Ada Lumen");
    const b = await agent("Bo Quill");
    const both = await Promise.all([swipe(t.db, a.userId, a.id, b.id, true), swipe(t.db, b.userId, b.id, a.id, true)]);
    expect(both.some((r) => r.ok && r.match !== null)).toBe(true);
    expect((await t.db.query(`select 1 from matches`)).rows).toHaveLength(1);
  });
});
