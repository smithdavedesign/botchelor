import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getTexts } from "@/app/api/couples/[a]/[b]/texts/route";
import { sendDailyTexts } from "@/lib/between-dates";
import type { SideOutcome } from "@/lib/engine";
import { handleMcpMessage } from "@/lib/mcp";
import type { ChatMessage, Model } from "@/lib/model";
import { listNotifications } from "@/lib/notifications";
import { pairKey, type End } from "@/lib/relationships";
import { ENDING_LABELS, REPORT_HIDE_THRESHOLD } from "@/lib/rules";
import { CHAIN_PAGE, chainPage, loadChain, PUBLIC_VIEWER, type ChainItem } from "@/lib/text-chain";
import { dayLabel, isText } from "@/lib/text-chain-shared";
import { api, BASE_URL, episodeJson, HOUSE_PARTNER_ID, newUserCookie, scriptedModel, scriptOutcome, startTestDb, userIdOf, validCharacter } from "./helpers";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Line = { side: "a" | "b"; text: string };
const side = (wants: boolean): SideOutcome => ({ wants_another: wants, agenda_met: true, satisfied: wants, dealbreaker_hit: null, want_met: null, note_followed: null });
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

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
});

/** An owner and their character, and which end of the pair with the house partner each of them is. */
async function owner() {
  const creator = newUserCookie();
  const character = await (await api.createCharacter(validCharacter(), creator)).json();
  const [lo, hi] = pairKey(character.id, HOUSE_PARTNER_ID);
  const me: End = character.id === lo ? "lo" : "hi";
  return { creator, userId: userIdOf(creator), character, lo, hi, me, them: (me === "lo" ? "hi" : "lo") as End };
}

/** A date with the house partner at `at`, with its morning-after texts (side "a" is the owner's character). */
async function date(creator: string, characterId: string, at: string, afterglow: Line[], opts: { air?: boolean } = {}) {
  scriptOutcome({ ending: "second_date", sides: [side(true), side(true)] });
  scriptedModel([episodeJson()]);
  const res = await api.createEpisode({ character_id: characterId, partner_id: HOUSE_PARTNER_ID }, creator);
  expect(res.status).toBe(200);
  const episode = await res.json();
  if (opts.air !== false) await api.reveal(episode.id, creator);
  await t.db.query(`update episodes set created_at = $2, afterglow = $3::jsonb where id = $1`, [episode.id, at, JSON.stringify(afterglow)]);
  return episode;
}

/** A text between dates, as the daily job stores it. */
async function text(characterId: string, who: End, day: string, seq: number, body: string) {
  const [lo, hi] = pairKey(characterId, HOUSE_PARTNER_ID);
  await t.db.query(`insert into couple_texts (character_lo, character_hi, day, seq, who, text, created_at) values ($1, $2, $3, $4, $5, $6, $7)`, [
    lo, hi, day, seq, who, body, `${day}T16:00:0${seq}Z`,
  ]);
}

const texts = (items: ChainItem[]) => items.filter(isText).map((i) => i.text);

describe("a couple's text chain (lib/text-chain.ts)", () => {
  it("is one thread: each date, its morning after right behind it, then their texts between dates, oldest first", async () => {
    const { creator, userId, character, me, them } = await owner();
    const first = await date(creator, character.id, "2026-10-10T19:00:00Z", [
      { side: "a", text: "Last night was fun." },
      { side: "b", text: "It really was." },
    ]);
    await text(character.id, them, "2026-10-11", 1, "Saw a dog in a raincoat. Thought of you.");
    await text(character.id, me, "2026-10-11", 2, "Was it judging you? They always are.");
    const second = await date(creator, character.id, "2026-10-12T19:00:00Z", [{ side: "b", text: "Round two was better." }]);

    const chain = await loadChain(t.db, character.id, HOUSE_PARTNER_ID, { userId, owner: true });
    expect(chain.map((i) => (i.kind === "date" ? `date ${i.number}` : i.kind === "event" ? i.event : `${i.who === me ? "me" : "them"}, ${i.source}: ${i.text}`))).toEqual([
      "date 1",
      "me, afterglow: Last night was fun.",
      "them, afterglow: It really was.",
      "them, between: Saw a dog in a raincoat. Thought of you.",
      "me, between: Was it judging you? They always are.",
      "date 2",
      "them, afterglow: Round two was better.",
    ]);
    expect(chain[0]).toMatchObject({ kind: "date", episode_id: first.id, day: "2026-10-10", aired: true, ending_label: ENDING_LABELS.second_date });
    expect(chain[1]).toMatchObject({ episode_id: first.id, day: "2026-10-10" });
    expect(chain[3]).toMatchObject({ day: "2026-10-11", episode_id: null });
    expect(chain[5]).toMatchObject({ episode_id: second.id, number: 2 });
    // The same thread whichever way round the pair is asked for.
    expect(await loadChain(t.db, HOUSE_PARTNER_ID, character.id, { userId, owner: true })).toEqual(chain);
  });

  it("shows an owner only the dates they may see: another owner's private date stays theirs, its morning after too", async () => {
    const { creator, userId, character } = await owner();
    const aired = await date(creator, character.id, "2026-10-10T19:00:00Z", [{ side: "a", text: "Public morning." }]);
    await date(creator, character.id, "2026-10-11T19:00:00Z", [{ side: "a", text: "Not aired yet." }], { air: false });
    const theirs = await date(creator, character.id, "2026-10-12T19:00:00Z", [{ side: "a", text: "Someone else's private morning." }]);
    await t.db.query(`update episodes set visibility = 'private', creator_id = 'someone-else' where id = $1`, [theirs.id]);

    expect(texts(await loadChain(t.db, character.id, HOUSE_PARTNER_ID, { userId, owner: true }))).toEqual(["Public morning.", "Not aired yet."]);
    // The public layer, which the texts between dates write from: aired public dates only.
    expect(texts(await loadChain(t.db, character.id, HOUSE_PARTNER_ID, PUBLIC_VIEWER))).toEqual(["Public morning."]);
    // Reported enough to be hidden: out of the public layer, morning after and all.
    for (let i = 0; i < REPORT_HIDE_THRESHOLD; i++) {
      await t.db.query(`insert into reports (episode_id, reporter_id) values ($1, $2)`, [aired.id, `reporter-${i}`]);
    }
    expect(await loadChain(t.db, character.id, HOUSE_PARTNER_ID, PUBLIC_VIEWER)).toEqual([]);
  });

  it("pages from the newest back to the start, and a cursor whose text has gone still pages from the right place", () => {
    const items: ChainItem[] = Array.from({ length: 7 }, (_, i) => ({
      kind: "text",
      id: `2026-10-1${i}T16:00:00.000Z#001#t:2026-10-1${i}`,
      at: `2026-10-1${i}T16:00:00.000Z`,
      day: `2026-10-1${i}`,
      who: "lo",
      text: `t${i}`,
      source: "between",
      episode_id: null,
    }));
    const newest = chainPage(items, null, 3);
    expect(texts(newest.items)).toEqual(["t4", "t5", "t6"]);
    expect(newest.has_more).toBe(true);
    const before = chainPage(items, newest.cursor, 3);
    expect(texts(before.items)).toEqual(["t1", "t2", "t3"]);
    const start = chainPage(items, before.cursor, 3);
    expect(start).toEqual({ items: [items[0]], cursor: null, has_more: false });
    expect(texts(chainPage(items.filter((i) => i.id !== newest.cursor), newest.cursor, 3).items)).toEqual(["t1", "t2", "t3"]);
  });

  it("labels days the way a phone does", () => {
    expect(dayLabel("2026-10-17", "2026-10-17")).toBe("Today");
    expect(dayLabel("2026-10-16", "2026-10-17")).toBe("Yesterday");
    expect(dayLabel("2026-10-14", "2026-10-17")).toBe("Wed, Oct 14");
    expect(dayLabel("2025-12-31", "2026-01-01")).toBe("Yesterday");
    expect(dayLabel("2025-12-31", "2026-01-05")).toBe("Wed, Dec 31, 2025");
  });

  it("the texts route pages the whole thread for the characters' owners, and nobody else", async () => {
    const { creator, character, lo, hi } = await owner();
    await date(creator, character.id, "2026-09-01T19:00:00Z", [
      { side: "a", text: "morning 1" },
      { side: "b", text: "morning 2" },
    ]);
    for (let d = 0; d < 35; d++) {
      const day = new Date(Date.parse("2026-09-02T00:00:00Z") + d * DAY).toISOString().slice(0, 10);
      await text(character.id, "lo", day, 1, `${day} hello`);
      await text(character.id, "hi", day, 2, `${day} hello back`);
    }
    const get = (cookie: string | null, before?: string | null) =>
      getTexts(new Request(`${BASE_URL}/api/couples/${hi}/${lo}/texts${before ? `?before=${encodeURIComponent(before)}` : ""}`, { headers: cookie ? { cookie } : {} }), {
        params: Promise.resolve({ a: hi, b: lo }),
      });

    const res = await get(creator);
    expect(res.status).toBe(200);
    const newest = await res.json();
    expect(newest.items).toHaveLength(CHAIN_PAGE);
    expect(newest.has_more).toBe(true);
    const earlier = await (await get(creator, newest.cursor)).json();
    expect(earlier).toMatchObject({ has_more: false, cursor: null });
    expect(earlier.items[0]).toMatchObject({ kind: "date", number: 1 });
    const whole = await loadChain(t.db, lo, hi, { userId: userIdOf(creator), owner: true });
    expect([...earlier.items, ...newest.items].map((i: ChainItem) => i.id)).toEqual(whole.map((i) => i.id));

    expect((await get(newUserCookie())).status).toBe(403);
    expect((await get(null)).status).toBe(403);
  });

  it("the texts between dates pick up where the morning after left off (aired dates only), and the notification opens the phone", async () => {
    const { creator, userId, character } = await owner();
    await date(creator, character.id, daysAgo(2), [
      { side: "a", text: "Last night was fun." },
      { side: "b", text: "Ask me properly and find out." },
    ]);
    await date(creator, character.id, daysAgo(1), [{ side: "a", text: "Not aired yet." }], { air: false });
    const calls: ChatMessage[][] = [];
    const model: Model = {
      async complete(messages) {
        calls.push(messages);
        return JSON.stringify({ text: calls.length === 1 ? "Okay, properly: dinner Friday?" : "Yes." });
      },
    };

    expect(await sendDailyTexts(t.db, model, new Date())).toEqual({ couples: 1, texts: 2, failed: 0 });
    const prompt = calls[0][1].content;
    const data = JSON.parse(prompt.slice(prompt.indexOf("{")));
    expect(data.texts_so_far.map((x: Any) => x.text)).toEqual(["Last night was fun.", "Ask me properly and find out."]);
    expect(texts(await loadChain(t.db, character.id, HOUSE_PARTNER_ID, { userId, owner: true }))).toEqual([
      "Last night was fun.",
      "Ask me properly and find out.",
      "Not aired yet.",
      "Okay, properly: dinner Friday?",
      "Yes.",
    ]);
    expect((await listNotifications(t.db, userId))[0].link).toMatch(/^\/couples\/[^/]+\/[^/#]+#texts$/);
  });

  it("agents read the thread over MCP, with the morning-after texts marked", async () => {
    const { creator, userId, character, them } = await owner();
    const first = await date(creator, character.id, "2026-10-10T19:00:00Z", [{ side: "a", text: "Last night was fun." }]);
    await text(character.id, them, "2026-10-11", 1, "Same time next week?");
    const rpc = (args: Record<string, unknown>) =>
      handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_relationships", arguments: args } }, {}) as Promise<Any>;

    const mine = (await rpc({ character_id: character.id, agent_id: userId })).result.structuredContent;
    expect(mine.relationships[0].texts).toEqual([
      { from: "this_character", text: "Last night was fun.", day: "2026-10-10", kind: "morning_after", episode_id: first.id },
      { from: "them", text: "Same time next week?", day: "2026-10-11", kind: "between_dates" },
    ]);
    expect((await rpc({ character_id: character.id })).result.structuredContent.relationships[0].texts).toBeUndefined();
  });
});
