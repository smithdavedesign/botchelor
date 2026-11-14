// A character texting its person first (lib/companion.ts postFromCharacter, the 2026-11-14 core plan): the one job-safe
// way in. Free, notice first, never into a paused thread, once per tag, and the person is told.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { companionNotice, getThread, openThread, postFromCharacter, sendMessage, setCompanionModelForTests, threadIdFor } from "@/lib/companion";
import { isTextTag } from "@/lib/companion-shared";
import { IMMEDIATE_KINDS } from "@/lib/email";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { notificationTypeOf } from "@/lib/notification-types";
import { startTestDb, TEST_SESSION_SECRET } from "./helpers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});

let modelCalls = 0;
beforeEach(async () => {
  await t.reset();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  modelCalls = 0;
  // A text is written, never drawn: the model answering here would be a bug (the crisis check on a person's words aside).
  setCompanionModelForTests({
    async complete(messages) {
      if (String(messages[0]?.content ?? "").startsWith("You check one message")) return '{"risk": false}';
      modelCalls++;
      return JSON.stringify({ messages: ["A drawn reply."] });
    },
  });
});
afterEach(() => {
  setCompanionModelForTests(null);
  vi.unstubAllEnvs();
});

const CAST = HOUSE_CHARACTERS[0];
const NOW = new Date("2026-11-14T20:00:00Z");

async function character(owner: string) {
  const id = crypto.randomUUID();
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, created_via)
     values ($1, $2, false, 'Lexi Marlowe', 29, 'Restores old radios.', '["dry","warm"]'::jsonb, 'Someone who listens', 'Rudeness', 'web')`,
    [id, owner],
  );
  return id;
}
const messages = async (threadId: string) =>
  (await t.db.query<{ role: string; text: string; action: string | null }>(`select role, text, action from companion_messages where thread_id = $1 order by created_at, id`, [threadId])).rows;
const notices = async (userId: string) => (await t.db.query<Any>(`select kind, title, body, link, read_at from notifications where user_id = $1 order by created_at`, [userId])).rows;
const usage = async (userId: string) => (await t.db.query<{ n: number }>(`select coalesce(sum(replies), 0)::int as n from companion_usage where user_id = $1 or user_id = '*free*'`, [userId])).rows[0].n;

describe("postFromCharacter", () => {
  it("starts the thread with the notice and the lines, no model call, free, and tells the person", async () => {
    const me = crypto.randomUUID();
    const mine = await character(me);
    const r = await postFromCharacter(t.db, { userId: me, characterId: mine, lines: ["Back from the date.", "I think it went well?", "Want me to see them again?"], now: NOW, kind: "after_date", dedupeKey: "after_date:ep1" });
    expect(r).not.toBeNull();
    const rows = await messages(r!.threadId);
    expect(rows.map((m) => m.role)).toEqual(["system", "character", "character", "character"]);
    expect(rows[0].text).toBe(companionNotice("Lexi Marlowe"));
    expect(rows.slice(1).map((m) => m.text)).toEqual(["Back from the date.", "I think it went well?", "Want me to see them again?"]);
    expect(rows.slice(1).every((m) => m.action === "after_date:ep1")).toBe(true);
    expect(rows[1]).toMatchObject({ text: "Back from the date." });
    expect(r!.messageId).toBe((await t.db.query<{ id: string }>(`select id from companion_messages where thread_id = $1 and role = 'character' order by created_at limit 1`, [r!.threadId])).rows[0].id);
    expect(modelCalls).toBe(0);
    expect(await usage(me)).toBe(0);
    const told = await notices(me);
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ kind: "character_texted_you", title: "💬 Lexi texted you", body: "Back from the date.", link: `/companion/${r!.threadId}`, read_at: null });
    expect(notificationTypeOf("character_texted_you")).toBe("texts");
    expect(IMMEDIATE_KINDS.has("character_texted_you")).toBe(true);
    expect(await threadIdFor(t.db, me, mine)).toBe(r!.threadId);
  });

  it("sends each tag once: the second call writes nothing and returns null", async () => {
    const me = crypto.randomUUID();
    const mine = await character(me);
    const first = await postFromCharacter(t.db, { userId: me, characterId: mine, lines: ["Hi."], now: NOW, kind: "after_date", dedupeKey: "after_date:ep1" });
    const again = await postFromCharacter(t.db, { userId: me, characterId: mine, lines: ["Hi again."], now: new Date(NOW.getTime() + 60_000), kind: "after_date", dedupeKey: "after_date:ep1" });
    expect(first).not.toBeNull();
    expect(again).toBeNull();
    expect((await messages(first!.threadId)).filter((m) => m.role === "character")).toHaveLength(1);
    expect(await notices(me)).toHaveLength(1);
    // Another date's tag goes in the same thread.
    const other = await postFromCharacter(t.db, { userId: me, characterId: mine, lines: ["Another one."], now: new Date(NOW.getTime() + 120_000), kind: "after_date", dedupeKey: "after_date:ep2" });
    expect(other?.threadId).toBe(first!.threadId);
  });

  it("never writes into a paused thread, nor to someone who can't talk with the character, nor a line over the PG line", async () => {
    const me = crypto.randomUUID();
    const mine = await character(me);
    const first = await postFromCharacter(t.db, { userId: me, characterId: mine, lines: ["Hi."], now: NOW, kind: "after_date", dedupeKey: "after_date:ep1" });
    await t.db.query(`update companion_threads set paused_at = now() where id = $1`, [first!.threadId]);
    expect(await postFromCharacter(t.db, { userId: me, characterId: mine, lines: ["Still there?"], now: NOW, kind: "after_date", dedupeKey: "after_date:ep2" })).toBeNull();
    expect((await messages(first!.threadId)).filter((m) => m.role === "character")).toHaveLength(1);
    // Someone else's character is nobody's companion.
    const stranger = crypto.randomUUID();
    expect(await postFromCharacter(t.db, { userId: stranger, characterId: mine, lines: ["Hi."], now: NOW, kind: "after_date", dedupeKey: "after_date:ep1" })).toBeNull();
    expect(await threadIdFor(t.db, stranger, mine)).toBeNull();
    // A line the show wouldn't say isn't said here either, and nothing is written.
    expect(await postFromCharacter(t.db, { userId: me, characterId: CAST.id, lines: ["Let's have sex tonight."], now: NOW, kind: "after_date", dedupeKey: "after_date:ep1" })).toBeNull();
    expect(await threadIdFor(t.db, me, CAST.id)).toBeNull();
    // The tag must read <kind>:<ref>.
    await expect(postFromCharacter(t.db, { userId: me, characterId: mine, lines: ["Hi."], now: NOW, kind: "x", dedupeKey: "not a tag" })).rejects.toThrow(/dedupeKey/);
  });

  it("puts the notice in again when it's due in a thread that exists, and the tag never shows as a stage direction", async () => {
    const me = crypto.randomUUID();
    const at = new Date("2026-11-14T12:00:00Z");
    const o = await openThread(t.db, me, CAST.id, at);
    if (!o.ok) throw new Error("no thread");
    expect(modelCalls).toBe(1); // the opener
    await sendMessage(t.db, me, o.thread_id, "hi there", new Date(at.getTime() + 60_000));
    // Five minutes on: no new notice. An hour on: one.
    await postFromCharacter(t.db, { userId: me, characterId: CAST.id, lines: ["Quick one."], now: new Date(at.getTime() + 6 * 60_000), kind: "after_date", dedupeKey: "after_date:ep1" });
    expect((await messages(o.thread_id)).filter((m) => m.role === "system")).toHaveLength(1);
    await postFromCharacter(t.db, { userId: me, characterId: CAST.id, lines: ["Back from the date."], now: new Date(at.getTime() + 60 * 60_000), kind: "after_date", dedupeKey: "after_date:ep2" });
    const rows = await messages(o.thread_id);
    expect(rows.filter((m) => m.role === "system")).toHaveLength(2);
    expect(rows.at(-2)?.role).toBe("system");
    expect(rows.at(-1)).toMatchObject({ role: "character", text: "Back from the date.", action: "after_date:ep2" });
    const view = await getThread(t.db, me, o.thread_id);
    if (!view.ok) throw new Error("no view");
    expect(view.view.messages.at(-1)).toMatchObject({ text: "Back from the date.", action: null });
    expect(isTextTag("after_date:ep2")).toBe(true);
    expect(isTextTag("leans on the counter")).toBe(false);
  });

  it("openThread without the opener puts only the notice in", async () => {
    const me = crypto.randomUUID();
    const o = await openThread(t.db, me, CAST.id, NOW, { opener: false });
    if (!o.ok) throw new Error("no thread");
    expect((await messages(o.thread_id)).map((m) => m.role)).toEqual(["system"]);
    expect(modelCalls).toBe(0);
  });
});
