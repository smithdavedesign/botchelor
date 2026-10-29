import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postTexts } from "@/app/api/couples/[a]/[b]/texts/route";
import { buildAfterglowMessages } from "@/lib/afterglow";
import { dateFacts } from "@/lib/beats";
import { dayOf } from "@/lib/between-dates";
import { loadCharacter } from "@/lib/character";
import { buildTurnMessages } from "@/lib/conversation";
import { fixedEngine, type SideOutcome } from "@/lib/engine";
import { handleMcpMessage } from "@/lib/mcp";
import { ModelError, setModelForTests, type ChatMessage, type Model } from "@/lib/model";
import { listNotifications } from "@/lib/notifications";
import { pairKey, refreshRelationship, usableFor, visibleTo, type End } from "@/lib/relationships";
import { buildDate, DEFAULT_DATE_REQUEST } from "@/lib/simulation";
import { TEXT_MAX } from "@/lib/text-chain";
import { sendText, TEXTS_PER_MINUTE, writeOwnText } from "@/lib/texting";
import { api, BASE_URL, episodeJson, HOUSE_PARTNER_ID, newUserCookie, scriptedModel, scriptOutcome, setupPairedEpisode, startTestDb, userIdOf, validCharacter } from "./helpers";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Line = { side: "a" | "b"; text: string };
const side = (wants: boolean): SideOutcome => ({ wants_another: wants, agenda_met: true, satisfied: wants, dealbreaker_hit: null, want_met: null, note_followed: null });
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();
/** The data a texting or date prompt carries (its user message, after the first line). */
const dataOf = (messages: ChatMessage[]): Any => JSON.parse(messages[1].content.slice(messages[1].content.indexOf("{")));
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
const rpc = async (name: string, args: Record<string, unknown>): Promise<Any> =>
  ((await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, {})) as Any).result;

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
  setModelForTests(null);
});

/** An owner and their character, and which end of the pair with the house partner each is. */
async function owner(name = "Wren Kestrel") {
  const creator = newUserCookie();
  const character = await (await api.createCharacter(validCharacter({ name }), creator)).json();
  const [lo, hi] = pairKey(character.id, HOUSE_PARTNER_ID);
  const me: End = character.id === lo ? "lo" : "hi";
  return { creator, userId: userIdOf(creator), character, lo, hi, me, them: (me === "lo" ? "hi" : "lo") as End };
}

/** An aired date with the house partner at `at`, with its morning-after texts (side "a" is the owner's character). */
async function date(creator: string, characterId: string, at: string, afterglow: Line[] = [], opts: { air?: boolean } = {}) {
  scriptOutcome({ ending: "second_date", sides: [side(true), side(true)] });
  scriptedModel([episodeJson()]);
  const res = await api.createEpisode({ character_id: characterId, partner_id: HOUSE_PARTNER_ID }, creator);
  expect(res.status).toBe(200);
  const episode = await res.json();
  if (opts.air !== false) await api.reveal(episode.id, creator);
  await t.db.query(`update episodes set created_at = $2, afterglow = $3::jsonb where id = $1`, [episode.id, at, JSON.stringify(afterglow)]);
  return episode;
}

async function text(characterId: string, who: End, day: string, seq: number, body: string) {
  const [lo, hi] = pairKey(characterId, HOUSE_PARTNER_ID);
  await t.db.query(`insert into couple_texts (character_lo, character_hi, day, seq, who, text, created_at) values ($1, $2, $3, $4, $5, $6, $7)`, [
    lo, hi, day, seq, who, body, `${day}T16:00:0${seq}Z`,
  ]);
}

describe("agents text each other between dates (MCP send_text / read_texts)", () => {
  it("two agents text back and forth as much as they like, and each hears when the other texts", async () => {
    const { host, partner, hostCharacter, partnerCharacter, episode } = await setupPairedEpisode({ ending: "second_date" });
    await api.reveal(episode.id, host);
    const a = userIdOf(host);
    const b = userIdOf(partner);

    const first = await rpc("send_text", { character_id: hostCharacter.id, to: partnerCharacter.id, text: "Still laughing about the menu.", agent_id: a });
    expect(first.isError).toBeFalsy();
    expect(first.structuredContent).toMatchObject({ sent: { from: "this_character", text: "Still laughing about the menu.", kind: "between_dates" }, reply: null });
    expect((await listNotifications(t.db, b))[0]).toMatchObject({ kind: "texted", body: "Still laughing about the menu.", read: false });

    // The other agent reads the thread (the date first, then the text) and texts back.
    const thread = (await rpc("read_texts", { character_id: partnerCharacter.id, with: hostCharacter.id, agent_id: b })).structuredContent;
    expect(thread.items[0]).toMatchObject({ kind: "date", number: 1, episode_id: episode.id });
    expect(thread.items.at(-1)).toMatchObject({ from: "them", text: "Still laughing about the menu.", kind: "between_dates" });
    expect((await rpc("send_text", { character_id: partnerCharacter.id, to: hostCharacter.id, text: "The menu started it.", agent_id: b })).isError).toBeFalsy();
    expect((await listNotifications(t.db, a))[0]).toMatchObject({ kind: "texted", body: "The menu started it." });

    // No daily cap. The other owner's inbox keeps one unread for the couple, showing the latest text.
    for (let i = 0; i < 12; i++) {
      expect((await rpc("send_text", { character_id: hostCharacter.id, to: partnerCharacter.id, text: `Text ${i}`, agent_id: a })).isError).toBeFalsy();
    }
    const unread = (await listNotifications(t.db, b)).filter((n) => n.kind === "texted" && !n.read);
    expect(unread).toHaveLength(1);
    expect(unread[0].body).toBe("Text 11");

    // `after` gives only what's new since the last item seen.
    const fresh = (await rpc("read_texts", { character_id: partnerCharacter.id, with: hostCharacter.id, after: thread.items.at(-1).id, agent_id: b })).structuredContent;
    expect(fresh.items.map((x: Any) => x.text)).toEqual(["The menu started it.", ...Array.from({ length: 12 }, (_, i) => `Text ${i}`)]);
    expect((await t.db.query(`select via, count(*)::int as n from couple_texts group by via`)).rows).toEqual([{ via: "agent", n: 14 }]);
  });

  it("only an owner texts as its character, only to someone it has dated, clean, under the ceiling and the loop guard", async () => {
    const { creator, userId, character } = await owner();
    await date(creator, character.id, daysAgo(1));
    vi.stubEnv("HOUSE_TEXT_REPLIES", "0"); // the house partner stays quiet here
    const as = (text: string, who = userId, to = HOUSE_PARTNER_ID) => sendText(t.db, { userId: who, from: character.id, to, text });

    expect(await as("hi", userIdOf(newUserCookie()))).toMatchObject({ ok: false, error: "not_your_character" });
    const stranger = await (await api.createCharacter(validCharacter({ name: "Nobody Yet" }), creator)).json();
    expect(await as("hi", userId, stranger.id)).toMatchObject({ ok: false, error: "match_first" }); // #483
    expect(await as("   ")).toMatchObject({ ok: false, error: "invalid_text" });
    expect(await as("x".repeat(TEXT_MAX + 1))).toMatchObject({ ok: false, error: "text_too_long" });
    expect(await as("my 15 year old cousin says hi")).toMatchObject({ ok: false, error: "content_rejected" });
    // No style limit: a long text with its own line breaks goes through as written.
    const long = `${"So about Saturday. ".repeat(80).trim()}\n\nAlso: bring the boat.`;
    expect(await as(long)).toMatchObject({ ok: true, sent: { text: long } });
    // The loop guard: TEXTS_PER_MINUTE in a minute, then a pause.
    for (let i = 1; i < TEXTS_PER_MINUTE; i++) expect((await as(`text ${i}`)).ok).toBe(true);
    expect(await as("one more")).toMatchObject({ ok: false, status: 429, error: "slow_down" });
    // Reading is for the characters' owners.
    expect((await rpc("read_texts", { character_id: character.id, with: HOUSE_PARTNER_ID, agent_id: userIdOf(newUserCookie()) })).isError).toBe(true);
  });

  it("the other owner's one unread notification counts what came in, and the sender hears who was told (run 5)", async () => {
    const { host, partner, hostCharacter, partnerCharacter, episode } = await setupPairedEpisode({ ending: "second_date" });
    const [a, b] = [userIdOf(host), userIdOf(partner)];
    // Before the date airs: both owners see it, so the text goes through and the other owner hears about it.
    const first = (await rpc("send_text", { character_id: hostCharacter.id, to: partnerCharacter.id, text: "Before it airs: hi.", agent_id: a })).structuredContent;
    expect(first.told).toMatch(/new notification/);
    const second = (await rpc("send_text", { character_id: hostCharacter.id, to: partnerCharacter.id, text: "And again.", agent_id: a })).structuredContent;
    expect(second.told).toMatch(/now shows this text and counts it/);
    await rpc("send_text", { character_id: hostCharacter.id, to: partnerCharacter.id, text: "Third.", agent_id: a });
    const unread = (await listNotifications(t.db, b)).filter((n) => n.kind === "texted" && !n.read);
    expect(unread).toHaveLength(1);
    expect(unread[0]).toMatchObject({ title: `💬 ${hostCharacter.name} texted ${partnerCharacter.name} (3 new)`, body: "Third." });
    // Once read, the next text starts a fresh one.
    await rpc("my_notifications", { mark_read: true, agent_id: b });
    expect((await rpc("send_text", { character_id: hostCharacter.id, to: partnerCharacter.id, text: "Fourth.", agent_id: a })).structuredContent.told).toMatch(/new notification/);
    expect((await listNotifications(t.db, b)).filter((n) => n.kind === "texted" && !n.read)[0].title).toBe(`💬 ${hostCharacter.name} texted ${partnerCharacter.name}`);
    expect(episode.id).toBeTruthy();
  });

  it("a plan they make by text is their plan for the next date: plan_second_date shows it (run 5)", async () => {
    const { host, partner, hostCharacter, partnerCharacter, episode } = await setupPairedEpisode({ ending: "second_date" });
    await api.reveal(episode.id, host);
    const [a, b] = [userIdOf(host), userIdOf(partner)];
    await rpc("send_text", { character_id: hostCharacter.id, to: partnerCharacter.id, text: "Thursday? The 12:03 platform, front carriage.", agent_id: a });
    await rpc("send_text", { character_id: partnerCharacter.id, to: hostCharacter.id, text: "Thursday. I'll bring the thermos.", agent_id: b });
    const state = (await rpc("plan_second_date", { episode_id: episode.id, check: true, agent_id: a })).structuredContent.second_date;
    expect(state.plan).toEqual(expect.arrayContaining(["Thursday? The 12:03 platform, front carriage.", "Thursday. I'll bring the thermos."]));
  });

  it("gives a couple page link only once the page opens for anyone (after a date airs), and says why before", async () => {
    const { creator, userId, character } = await owner();
    vi.stubEnv("HOUSE_TEXT_REPLIES", "0");
    // Booked just now, so it's inside its prediction window: dates air on their own after it (lib/air.ts).
    const episode = await date(creator, character.id, new Date().toISOString(), [], { air: false });
    const before = (await rpc("send_text", { character_id: character.id, to: HOUSE_PARTNER_ID, text: "Before it airs.", agent_id: userId })).structuredContent;
    expect(before).toMatchObject({ couple_page: null, couple_page_note: expect.stringMatching(/once one of their public dates has aired/) });
    expect((await rpc("read_texts", { character_id: character.id, with: HOUSE_PARTNER_ID, agent_id: userId })).structuredContent.couple_page).toBeNull();
    await api.reveal(episode.id, creator);
    const after = (await rpc("send_text", { character_id: character.id, to: HOUSE_PARTNER_ID, text: "Now it's aired.", agent_id: userId })).structuredContent;
    expect(after.couple_page).toMatch(/^\/couples\/[^/]+\/[^/#]+#texts$/);
    expect(after.couple_page_note).toBeUndefined();
  });

  it("after a private date, texts go only where both owners can see a date: a two-agent date is both agents'", async () => {
    const { host, partner, hostCharacter, partnerCharacter, episode } = await setupPairedEpisode({ ending: "second_date" });
    const [a, b] = [userIdOf(host), userIdOf(partner)];
    expect((await api.setVisibility(episode.id, "private", host)).status).toBe(200);
    // A private show date is its creator's alone: a text would tell the other owner it happened, so it isn't sent.
    expect(await sendText(t.db, { userId: a, from: hostCharacter.id, to: partnerCharacter.id, text: "Psst." })).toMatchObject({ ok: false, error: "private_date" });
    expect(await sendText(t.db, { userId: b, from: partnerCharacter.id, to: hostCharacter.id, text: "Hi?" })).toMatchObject({ ok: false, error: "match_first" });
    expect((await listNotifications(t.db, b)).filter((n) => n.kind === "texted")).toEqual([]);

    // The same date performed by two agents (each played its own side) belongs to both: either can text and read it.
    await t.db.query(`update episodes set partner_performer = $2 where id = $1`, [episode.id, b]);
    await refreshRelationship(t.db, hostCharacter.id, partnerCharacter.id);
    expect(await sendText(t.db, { userId: a, from: hostCharacter.id, to: partnerCharacter.id, text: "Same time Thursday?" })).toMatchObject({ ok: true });
    expect(await sendText(t.db, { userId: b, from: partnerCharacter.id, to: hostCharacter.id, text: "Thursday." })).toMatchObject({ ok: true });
    const theirs = (await rpc("read_texts", { character_id: partnerCharacter.id, with: hostCharacter.id, agent_id: b })).structuredContent;
    expect(theirs.items.map((x: Any) => x.kind)).toEqual(["date", "between_dates", "between_dates"]);
  });

  it("never across a block between the owners", async () => {
    const { host, partner, hostCharacter, partnerCharacter, episode } = await setupPairedEpisode({ ending: "second_date" });
    await t.db.query(`insert into blocks (blocker_id, via_episode_id, blocked_id) values ($1, $2, $3)`, [userIdOf(partner), episode.id, userIdOf(host)]);
    expect(await sendText(t.db, { userId: userIdOf(host), from: hostCharacter.id, to: partnerCharacter.id, text: "hi" })).toMatchObject({ ok: false, error: "blocked" });
    expect(await sendText(t.db, { userId: userIdOf(partner), from: partnerCharacter.id, to: hostCharacter.id, text: "hi" })).toMatchObject({ ok: false, error: "blocked" });
  });

  it("a house character texts back on the show's free model, a few times a day per couple and show-wide", async () => {
    const { creator, userId, character, them } = await owner();
    await date(creator, character.id, daysAgo(1), [{ side: "b", text: "Last night was a rare treat." }]);
    const show = scriptedModel([1, 2, 3].map((i) => JSON.stringify({ text: `Reply ${i}` })));
    const say = (text: string, who = userId, from = character.id) => sendText(t.db, { userId: who, from, to: HOUSE_PARTNER_ID, text });

    const r = await say("Hey you.");
    expect(r).toMatchObject({ ok: true, reply: { text: "Reply 1", who: them, source: "between" } });
    // One short text on the show's model, answering the thread (the morning after included): a reply to what was just
    // said, not a new subject out of nowhere (visitor run 4).
    expect(show.calls[0][0].content).toMatch(/short text \(under 200 characters\)/);
    expect(show.calls[0][0].content).toMatch(/answer what they said or asked first/);
    expect(dataOf(show.calls[0]).texts_so_far.map((x: Any) => x.text)).toEqual(["Last night was a rare treat.", "Hey you."]);
    expect((await say("Again.")).ok && (await say("And again.")).ok).toBe(true);
    const fourth = await say("Still there?");
    expect(fourth).toMatchObject({ ok: true, reply: null });
    expect(fourth.ok && fourth.note).toMatch(/3 times today/);
    expect(show.calls).toHaveLength(3);

    // Show-wide, the house cast's replies stop at the daily budget.
    vi.stubEnv("HOUSE_TEXT_REPLIES_DAILY", "3");
    const other = await owner("Pim Alder");
    await date(other.creator, other.character.id, daysAgo(1));
    const none = await say("Hello?", other.userId, other.character.id);
    expect(none).toMatchObject({ ok: true, reply: null });
    expect(none.ok && none.note).toMatch(/used up today's texts/);
    const via = (await t.db.query<{ via: string; n: number }>(`select via, count(*)::int as n from couple_texts group by via order by via`)).rows;
    expect(via).toEqual([{ via: "agent", n: 5 }, { via: "show", n: 3 }]);
  });
});

describe("whose a two-agent date is (lib/relationships.ts)", () => {
  it("its other performer sees it and may bring it into a date, like its creator; nobody else", () => {
    const h = { public: false, private: true, creator: "agent-x", performer: "agent-y" };
    expect(visibleTo(h, { userId: "agent-y", owner: true })).toBe(true);
    expect(visibleTo(h, { userId: "agent-z", owner: true })).toBe(false);
    expect(usableFor(h, "agent-y")).toBe(true);
    expect(usableFor(h, "agent-z")).toBe(false);
    expect(usableFor({ public: false, creator: "agent-x" }, "")).toBe(false);
  });
});

describe("people text on their own model key (lib/texting.ts writeOwnText)", () => {
  it("their character texts whenever they like, as long as it likes, and a house partner answers on the same key", async () => {
    const { creator, userId, character, me, them } = await owner();
    await date(creator, character.id, daysAgo(2), [
      { side: "a", text: "Last night was fun." },
      { side: "b", text: "It really was." },
    ]);
    const long = "I keep thinking about the menu. ".repeat(20).trim();
    const own = texter([long, "Then come back tonight."]);
    const r = await writeOwnText(t.db, { userId, from: character.id, to: HOUSE_PARTNER_ID, model: own, hint: "ask about Saturday" });
    expect(r).toMatchObject({ ok: true, sent: { text: long, who: me }, reply: { text: "Then come back tonight.", who: them } });
    // Open-ended, the hint as a private nudge, and the whole thread so far.
    expect(own.asked[0][0].content).toMatch(/as long or as short as you'd naturally write it/);
    expect(own.asked[0][0].content).not.toMatch(/short text \(under/);
    expect(dataOf(own.asked[0])).toMatchObject({ your_creator_asked_you: "ask about Saturday" });
    expect(dataOf(own.asked[0]).texts_so_far.map((x: Any) => x.text)).toEqual(["Last night was fun.", "It really was."]);
    // The house reply ran on the same key and saw the new text.
    expect(dataOf(own.asked[1]).texts_so_far.at(-1).text).toBe(long);

    // No cap on their own model: the house partner keeps answering.
    const more = texter(Array.from({ length: 10 }, (_, i) => `more ${i}`));
    for (let i = 0; i < 5; i++) expect(await writeOwnText(t.db, { userId, from: character.id, to: HOUSE_PARTNER_ID, model: more })).toMatchObject({ ok: true, reply: { who: them } });
    const via = (await t.db.query<{ via: string }>(`select via from couple_texts`)).rows.map((x) => x.via);
    expect(via).toHaveLength(12);
    expect(new Set(via)).toEqual(new Set(["own_key"]));
  });

  it("when their model writes nothing, the phone says why: the key's trouble in plain words, or a reply with no text", async () => {
    const { creator, userId, character } = await owner();
    await date(creator, character.id, daysAgo(1));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const outOfCredit: Model = { async complete() { throw new ModelError("Google: out of credit. Top up.", 429); } };
    expect(await writeOwnText(t.db, { userId, from: character.id, to: HOUSE_PARTNER_ID, model: outOfCredit })).toEqual({
      ok: false,
      status: 502,
      error: "no_text",
      message: "Your model didn't write a text. Google: out of credit. Top up.",
    });
    const rambling: Model = { async complete() { return "Sure! Here's a text you could send."; } };
    expect(await writeOwnText(t.db, { userId, from: character.id, to: HOUSE_PARTNER_ID, model: rambling })).toMatchObject({ status: 502, message: expect.stringMatching(/^Your model answered, but not with a text/) });
    expect((await t.db.query(`select 1 from couple_texts where via = 'own_key'`)).rows).toHaveLength(0);
  });

  it("the phone's send needs their own key; without one it says how to add it", async () => {
    const { creator, character, lo, hi } = await owner();
    await date(creator, character.id, daysAgo(1));
    const res = await postTexts(
      new Request(`${BASE_URL}/api/couples/${lo}/${hi}/texts`, { method: "POST", headers: { "content-type": "application/json", cookie: creator }, body: JSON.stringify({ character_id: character.id }) }),
      { params: Promise.resolve({ a: lo, b: hi }) },
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "needs_own_key", message: expect.stringMatching(/own model key/) });
  });
});

describe("a date goes in with their whole text history", () => {
  const forDate = async (id: string) => {
    const c = (await loadCharacter(t.db, id))!;
    return { id, sheet: { name: c.name, age: c.age, bio: c.bio, traits: c.persona.traits, want: c.persona.want, dealbreaker: c.dealbreaker, house: id.startsWith("house-") } };
  };

  it("both sides carry every text (theirs and the morning afters they can use), the director knows, and it's shared knowledge", async () => {
    const { creator, userId, character, me, them } = await owner();
    await date(creator, character.id, daysAgo(3), [{ side: "a", text: "Morning after: you owe me a dance." }]);
    await text(character.id, them, dayOf(new Date(Date.now() - 2 * DAY)), 1, "Saturday, then. Bring your dancing shoes.");
    await text(character.id, me, dayOf(new Date(Date.now() - 2 * DAY)), 2, "I only own one shoe, but it's a good shoe.");
    // Another owner's private date, and its morning after, stays out of this owner's date.
    const theirs = await date(creator, character.id, daysAgo(1), [{ side: "a", text: "A private morning." }]);
    await t.db.query(`update episodes set visibility = 'private', creator_id = 'someone-else' where id = $1`, [theirs.id]);

    const built = await buildDate(t.db, "ep-texts", await forDate(character.id), await forDate(HOUSE_PARTNER_ID), DEFAULT_DATE_REQUEST, undefined, undefined, { creatorId: userId });
    const outcome = fixedEngine({ ending: "friends" }).decide(built.input, 1);
    const turn = (i: number): Any =>
      JSON.parse(buildTurnMessages(built.input, outcome, built.characters, "a_hard_question", "rooftop_bar", [], i, "classic", {}, { totalTurns: 6 }).messages[1].content.replace(/^[^\n]*\n/, ""));
    expect(turn(0).your_texts_with_them).toEqual({
      texts: [
        { from: "you", text: "Morning after: you owe me a dance." },
        { from: "them", text: "Saturday, then. Bring your dancing shoes." },
        { from: "you", text: "I only own one shoe, but it's a good shoe." },
      ],
    });
    expect(turn(1).your_texts_with_them.texts[0]).toEqual({ from: "them", text: "Morning after: you owe me a dance." });
    expect(JSON.stringify(turn(0))).not.toContain("A private morning");
    // The morning after this date knows them too, the director knows they've been texting, and the critic treats the
    // words as shared (never "profile reading").
    expect(dataOf(buildAfterglowMessages(built.input, outcome, built.characters, "rooftop_bar", "classic", [], 0).messages).your_texts_with_them.texts).toHaveLength(3);
    expect(dateFacts(built.input, outcome, built.characters).join(" ")).toMatch(/They've been texting \(3 texts so far\)\. The latest: .*good shoe/);
    expect(built.characters[1].pairShared).toContain("dancing shoes");

    // A very long history keeps the newest that fit, and says how many it left out.
    vi.stubEnv("DATE_TEXTS_CHARS", "60");
    const trimmed = await buildDate(t.db, "ep-texts-2", await forDate(character.id), await forDate(HOUSE_PARTNER_ID), DEFAULT_DATE_REQUEST, undefined, undefined, { creatorId: userId });
    expect(trimmed.characters[0].texts).toEqual({ earlier: 2, texts: [{ from: "you", text: "I only own one shoe, but it's a good shoe." }] });
  });

  it("a date with no texts between them carries none", async () => {
    const { userId, character } = await owner();
    const built = await buildDate(t.db, "ep-none", await forDate(character.id), await forDate(HOUSE_PARTNER_ID), DEFAULT_DATE_REQUEST, undefined, undefined, { creatorId: userId });
    expect(built.characters[0].texts).toBeUndefined();
  });
});
