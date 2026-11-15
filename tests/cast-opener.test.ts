// A cast character opens with what happened to it (lib/cast-opener.ts, lib/companion.ts openThread, 2026-11-15): the
// opener for someone who isn't its owner is written from its last aired date (who, where, how it ended, its own
// reflection, the photo, a Watch link), with no model call; without an aired date, or with the switch off, or for its
// own creator, the model writes the hello as before. Its prompt knows the same date.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { castOpenerLines, castOpenerTag } from "@/lib/cast-opener";
import { getThread, openThread, sendMessage, setCompanionModelForTests } from "@/lib/companion";
import { runCompanionTool } from "@/lib/companion-mcp";
import { companionDateOpener, watchLinkEpisode } from "@/lib/companion-shared";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { lastAiredDateOf, lastDateOf, type LastDate } from "@/lib/last-date";
import type { ChatMessage } from "@/lib/model";
import { api, setupEpisode, startTestDb, TEST_SESSION_SECRET, userIdOf } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});

/** Every model call the companion makes: a test that expects none checks this stays empty. */
let replies: ChatMessage[][] = [];
beforeEach(() => {
  replies = [];
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("COMPANION_OPEN", "1");
  vi.spyOn(console, "log").mockImplementation(() => {});
  setCompanionModelForTests({
    async complete(messages) {
      const system = messages[0]?.content ?? "";
      if (system.startsWith("You check one message")) return `{"risk": false}`;
      if (system.startsWith("You are ")) replies.push(messages);
      return JSON.stringify({ messages: ["Hi. I'm told you wanted to talk.", "So talk."] });
    },
  });
});
afterEach(async () => {
  setCompanionModelForTests(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  // Each test starts with a cast nobody has dated on the air.
  await t.db.query(`delete from episodes`);
});

/** The house character every setupEpisode date is with (tests/helpers.ts HOUSE_PARTNER_ID). */
const CAST = HOUSE_CHARACTERS[0];
const castFirst = CAST.name.split(" ")[0];
const stranger = () => crypto.randomUUID();
const rows = async (threadId: string) =>
  (await t.db.query<{ role: string; via: string; text: string; action: string | null; model: string | null }>(`select role, via, text, action, model from companion_messages where thread_id = $1 order by created_at, id`, [threadId])).rows;

/** A date of CAST's with someone's character that aired, public, with CAST's own reflection on it. */
async function airedDate(ending: "second_date" | "friends" | "disaster" = "friends", reflection: string | null = "I laughed more than I meant to. I should say so next time.") {
  const made = await setupEpisode(ending);
  expect((await api.reveal(made.episode.id, made.creator)).status).toBeLessThan(300);
  await t.db.query(`update episodes set reflections = $2::jsonb where id = $1`, [made.episode.id, JSON.stringify({ a: "The owner's character's private thought.", b: reflection })]);
  return made;
}

const date = (over: Partial<LastDate> = {}): LastDate => ({
  episodeId: "ep-1",
  partnerId: "c-1",
  partner: "Otto Fenn",
  venue: "the night market",
  ending: "friends",
  endingLabel: "Just friends",
  reflection: null,
  at: "2026-11-14T20:00:00.000Z",
  dateNumber: 1,
  venueId: "night_market",
  names: ["Nell Okafor", "Otto Fenn"],
  ...over,
});

describe("castOpenerLines (pure)", () => {
  it("says who, where and how it ended, in the character's own words when it has them, and invites a watch on at most one question", () => {
    const friends = castOpenerLines("Nell Okafor", date({ reflection: "I talked over him twice. Next time I listen." }));
    expect(friends).toEqual([
      "Hey, I'm Nell. My last date was with Otto at the night market. Good company, and we left it as friends.",
      "I talked over him twice. Next time I listen.",
      "It aired, so you can watch it. Did I miss something?",
    ]);
    const well = castOpenerLines("Nell Okafor", date({ ending: "second_date" }));
    expect(well[0]).toBe("Hey, I'm Nell. My last date was with Otto at the night market, and it went well: we both said yes to seeing each other again.");
    expect(well[1]).toBe("There was a moment in there I keep replaying.");
    const bad = castOpenerLines("Nell Okafor", date({ ending: "disaster", venue: null, dateNumber: 3 }));
    expect(bad[0]).toBe("Hey, I'm Nell. My last date was another one with Otto, and it went about as badly as a date can.");
    expect(bad[2]).toBe("It aired, so you can watch the whole thing. What would you have done?");
    for (const lines of [friends, well, bad]) {
      expect(lines).toHaveLength(3);
      expect(lines.join(" ").match(/\?/g)?.length ?? 0).toBeLessThanOrEqual(1);
      // Never a guilt trip, never "I miss you" (docs/companions.md).
      expect(lines.join(" ")).not.toMatch(/miss you|where were you|finally/i);
    }
    expect(castOpenerTag("ep-1")).toBe("opener:ep-1");
    expect(watchLinkEpisode("opener:ep-1")).toBe("ep-1");
    expect(watchLinkEpisode("tease:ep-1")).toBe("ep-1");
    for (const tag of ["after_date:ep-1", "life:ep-1", "day_after:ep-1", "offer:m-1", null, "leans on the counter"]) expect(watchLinkEpisode(tag)).toBeNull();
    expect(companionDateOpener({})).toBe(true);
    expect(companionDateOpener({ COMPANION_DATE_OPENER: "0" })).toBe(false);
  });
});

describe("the last date anyone may watch (lastAiredDateOf)", () => {
  it("is the newest finished, aired, public date on the show; never an unaired, unlisted, private, reported or After Dark one", async () => {
    const made = await setupEpisode("friends");
    // Not aired yet: the owner's own view has it, a stranger's doesn't.
    expect((await lastDateOf(t.db, CAST.id))?.episodeId).toBe(made.episode.id);
    expect(await lastAiredDateOf(t.db, CAST.id)).toBeNull();
    expect((await api.reveal(made.episode.id, made.creator)).status).toBeLessThan(300);
    const aired = await lastAiredDateOf(t.db, CAST.id);
    expect(aired).toMatchObject({ episodeId: made.episode.id, ending: "friends", partnerId: made.character.id, partner: made.character.name, names: [made.character.name, CAST.name] });
    for (const hide of [`visibility = 'unlisted'`, `visibility = 'private'`, `setup = setup || '{"after_dark":true}'::jsonb`, `status = 'generating'`]) {
      const before = (await t.db.query<{ visibility: string; setup: unknown; status: string }>(`select visibility, setup, status from episodes where id = $1`, [made.episode.id])).rows[0];
      await t.db.query(`update episodes set ${hide} where id = $1`, [made.episode.id]);
      expect(await lastAiredDateOf(t.db, CAST.id), hide).toBeNull();
      await t.db.query(`update episodes set visibility = $2, setup = $3::jsonb, status = $4 where id = $1`, [made.episode.id, before.visibility, JSON.stringify(before.setup), before.status]);
    }
    for (let i = 0; i < 3; i++) await t.db.query(`insert into reports (episode_id, reporter_id) values ($1, $2)`, [made.episode.id, crypto.randomUUID()]);
    expect(await lastAiredDateOf(t.db, CAST.id)).toBeNull();
  });
});

describe("opening a thread with a cast character that isn't yours", () => {
  it("with an aired date: the opener is written from it (no model call), with its photo and a Watch link under the last bubble", async () => {
    const { episode, character } = await airedDate("friends");
    const me = stranger();
    const o = await openThread(t.db, me, CAST.id, new Date("2026-11-15T10:00:00Z"));
    if (!o.ok) throw new Error(o.error);
    expect(o.resumed).toBe(false);
    // The hello this replaces was the thread's one model call.
    expect(replies).toHaveLength(0);
    const all = await rows(o.thread_id);
    expect(all.map((m) => `${m.role}:${m.via}`)).toEqual(["system:text", "character:text", "character:photo", "character:text", "character:text"]);
    const said = all.filter((m) => m.role === "character" && m.via === "text").map((m) => m.text);
    expect(said[0]).toMatch(new RegExp(`^Hey, I'm ${castFirst}\\. My last date was with ${character.name.split(" ")[0]} at .+ we left it as friends\\.$`));
    // Its own reflection (side b's), never the other side's.
    expect(said[1]).toBe("I laughed more than I meant to. I should say so next time.");
    expect(said.join(" ")).not.toContain("private thought");
    expect(said[2]).toBe("It aired, so you can watch it. Did I miss something?");
    expect(all.slice(1).every((m) => m.action === `opener:${episode.id}` && m.model === null)).toBe(true);

    const view = await getThread(t.db, me, o.thread_id);
    if (!view.ok) throw new Error("no thread");
    const shown = view.view.messages;
    // The tag is bookkeeping: never shown as what the character did.
    expect(shown.every((m) => m.action === null)).toBe(true);
    expect(shown.filter((m) => m.photo)).toHaveLength(1);
    expect(shown.find((m) => m.photo)?.photo).toEqual({ src: `/api/og/date-photo/${episode.id}`, href: `/episodes/${episode.id}` });
    // One link, under the last bubble.
    expect(shown.filter((m) => m.link).map((m) => m.id)).toEqual([shown[shown.length - 1].id]);
    expect(shown[shown.length - 1].link).toEqual({ href: `/episodes/${episode.id}`, label: "Watch the date" });
    // Nobody is notified of a thread they are opening themselves, and nothing is counted against their free replies.
    expect((await t.db.query(`select 1 from notifications where user_id = $1`, [me])).rows).toHaveLength(0);
    expect((await t.db.query(`select 1 from companion_usage where user_id = $1`, [me])).rows).toHaveLength(0);
    // Opening it again finds it: no second opener.
    expect(await openThread(t.db, me, CAST.id)).toMatchObject({ ok: true, thread_id: o.thread_id, resumed: true });
    expect(await rows(o.thread_id)).toHaveLength(all.length);
  });

  it("without the date's reflection: the plain line for that ending", async () => {
    await airedDate("disaster", null);
    const o = await openThread(t.db, stranger(), CAST.id);
    if (!o.ok) throw new Error(o.error);
    const said = (await rows(o.thread_id)).filter((m) => m.role === "character" && m.via === "text").map((m) => m.text);
    expect(said[0]).toContain("it went about as badly as a date can");
    expect(said[1]).toBe("It got away from both of us. I'm still a bit wound up about it.");
    expect(replies).toHaveLength(0);
  });

  it("with no aired date: today's opener, written by the model, unchanged", async () => {
    // A date that hasn't aired doesn't count.
    await setupEpisode("friends");
    const o = await openThread(t.db, stranger(), CAST.id);
    if (!o.ok) throw new Error(o.error);
    expect(replies).toHaveLength(1);
    expect(replies[0][replies[0].length - 1].content).toContain("They've just started talking with you for the first time");
    // And its prompt has no last-date block to talk from.
    expect(replies[0][0].content).not.toContain("Your last date");
    const all = await rows(o.thread_id);
    expect(all.map((m) => `${m.role}:${m.via}`)).toEqual(["system:text", "character:text", "character:text"]);
    expect(all.slice(1).map((m) => m.text)).toEqual(["Hi. I'm told you wanted to talk.", "So talk."]);
    expect(all.slice(1).every((m) => m.action === null)).toBe(true);
    const view = await getThread(t.db, (await t.db.query<{ user_id: string }>(`select user_id from companion_threads where id = $1`, [o.thread_id])).rows[0].user_id, o.thread_id);
    expect(view.ok && view.view.messages.some((m) => m.photo || m.link)).toBe(false);
  });

  it("COMPANION_DATE_OPENER=0: the model's opener even with an aired date, and no last-date block in the prompt", async () => {
    await airedDate("second_date");
    vi.stubEnv("COMPANION_DATE_OPENER", "0");
    const me = stranger();
    const o = await openThread(t.db, me, CAST.id);
    if (!o.ok) throw new Error(o.error);
    expect(replies).toHaveLength(1);
    expect((await rows(o.thread_id)).some((m) => m.action?.startsWith("opener:") || m.via === "photo")).toBe(false);
    await sendMessage(t.db, me, o.thread_id, "how was your week?");
    expect(replies[1][0].content).not.toContain("Your last date");
  });

  it("DATE_PHOTO_TEXTS=0: the written opener without the photo, the Watch link still there", async () => {
    const { episode } = await airedDate("friends");
    vi.stubEnv("DATE_PHOTO_TEXTS", "0");
    const me = stranger();
    const o = await openThread(t.db, me, CAST.id);
    if (!o.ok) throw new Error(o.error);
    expect((await rows(o.thread_id)).map((m) => `${m.role}:${m.via}`)).toEqual(["system:text", "character:text", "character:text", "character:text"]);
    const view = await getThread(t.db, me, o.thread_id);
    expect(view.ok && view.view.messages.at(-1)?.link).toEqual({ href: `/episodes/${episode.id}`, label: "Watch the date" });
  });

  it("a creator opening their own character still gets the model's hello (their dates are theirs to hear about, not a cast's news)", async () => {
    const { creator, character } = await airedDate("friends");
    const o = await openThread(t.db, userIdOf(creator), character.id);
    if (!o.ok) throw new Error(o.error);
    expect(replies).toHaveLength(1);
    // The owner's prompt: its last date as theirs, as before.
    expect(replies[0][0].content).toContain("Your last date (they sent you on it");
    expect((await rows(o.thread_id)).some((m) => m.action?.startsWith("opener:"))).toBe(false);
  });

  it("the cast's replies know the same date: who, where, how it ended and its reflection, as its own aired news", async () => {
    const { character } = await airedDate("friends");
    const me = stranger();
    const o = await openThread(t.db, me, CAST.id);
    if (!o.ok) throw new Error(o.error);
    const sent = await sendMessage(t.db, me, o.thread_id, "wait, what happened?");
    expect(sent.ok).toBe(true);
    expect(replies).toHaveLength(1);
    const system = replies[0][0].content;
    expect(system).toContain("a person who picked you to talk to");
    expect(system).toContain("Your last date on the show (it aired, so anyone can watch it; it's your news, yours to talk about from the inside):");
    expect(system).toMatch(new RegExp(`- With ${character.name}, at .+\\. How it ended: `));
    expect(system).toContain('What you thought afterwards, in your own words: "I laughed more than I meant to. I should say so next time."');
    expect(system).not.toContain("private thought");
    expect(system).not.toContain("Their note for your next date");
    // The opener's own lines are the conversation so far; its photo is told, not said.
    expect(system).toContain("Photos you sent them");
    expect(replies[0].slice(1).map((m) => m.content).join("\n")).toContain(`Hey, I'm ${castFirst}.`);
    expect(replies[0].slice(1).map((m) => m.content).join("\n")).not.toContain("A photo from the date");
  });

  it("an agent over MCP gets the opener with links it can open: the photo and the date", async () => {
    const { episode } = await airedDate("friends");
    const agent = `agent-${crypto.randomUUID()}`;
    const opened = await runCompanionTool(t.db, agent, { action: "open", character_id: CAST.id });
    if (!("data" in opened)) throw new Error(opened.error);
    const reply = (opened.data.reply ?? []) as { text: string; photo?: string; watch?: string }[];
    expect(reply).toHaveLength(4);
    expect(reply.filter((m) => m.photo)).toHaveLength(1);
    expect(reply.find((m) => m.photo)?.photo).toMatch(new RegExp(`^https?://[^/]+/api/og/date-photo/${episode.id}$`));
    expect(reply[reply.length - 1].watch).toMatch(new RegExp(`^https?://[^/]+/episodes/${episode.id}$`));
    expect(replies).toHaveLength(0);
  });
});
