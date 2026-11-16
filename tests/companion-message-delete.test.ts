// Deleting one message of a companion thread (lib/companion-message-delete.ts), and companion conversations and call
// records in the account export (lib/account.ts). The privacy notice had to admit both gaps on 2026-11-15; this pins
// what a delete removes, what it leaves and why (the AI notice, a text's blank marker), and that the export holds the
// right person's conversations and nothing of After Dark. The copy is pinned in tests/call-honesty.test.ts.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE as deleteMessageRoute } from "@/app/api/companion/[id]/messages/[messageId]/route";
import { POST as openRoute } from "@/app/api/companion/route";
import { POST as actRoute } from "@/app/api/companion/[id]/route";
import CompanionChat from "@/app/companion/[id]/CompanionChat";
import DeleteMessages from "@/app/companion/[id]/messages/DeleteMessages";
import { exportAccount } from "@/lib/account";
import { signSession } from "@/lib/auth";
import { companionNotice, getThread, postFromCharacter, setCompanionModelForTests } from "@/lib/companion";
import { updateSummary } from "@/lib/companion-memory";
import { deletableMessages, deleteMessage } from "@/lib/companion-message-delete";
import type { CompanionAllowance } from "@/lib/companion-plan";
import { companionMessageDelete } from "@/lib/companion-shared";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { loadChat } from "@/lib/chat-inbox";
import { setObjectStoreForTests, type ObjectStore } from "@/lib/object-store";
import { BASE_URL, signedInCookie, startTestDb, TEST_SESSION_SECRET } from "./helpers";

// The memory follow-up after a reply runs in after() on a server; here nothing races a test.
vi.mock("@/lib/sets", async (orig) => ({ ...((await orig()) as object), inBackground: () => {} }));
// Client components outside the app router: the router they ask for is a stub.
vi.mock("next/navigation", async (original) => ({ ...((await original()) as object), useRouter: () => ({ push: () => {}, refresh: () => {} }), usePathname: () => "/companion/t1" }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});

const CAST = HOUSE_CHARACTERS[0];
const first = CAST.name.split(" ")[0];

/** The companion's model, scripted: replies in order, the crisis check always clear; every call counted by kind. */
let replies: string[] = [];
let modelCalls: string[] = [];
beforeEach(async () => {
  await t.reset();
  await t.db.query(`delete from notifications`);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("COMPANION_OPEN", "1");
  replies = [];
  modelCalls = [];
  let n = 0;
  setCompanionModelForTests({
    async complete(messages) {
      const system = messages[0]?.content ?? "";
      if (system.startsWith("You check one message")) return '{"risk": false}';
      if (system.startsWith("You keep the running notes")) {
        modelCalls.push("summary");
        return JSON.stringify({ notes: "They talked about what was left." });
      }
      if (system.startsWith("You read part of a conversation")) return JSON.stringify({ facts: [] });
      modelCalls.push("reply");
      return replies.shift() ?? JSON.stringify({ messages: [`Reply number ${++n}, in my own voice.`] });
    },
  });
});
afterEach(() => {
  setCompanionModelForTests(null);
  setObjectStoreForTests(undefined);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const adult = (cookie: string) => `${cookie}; bz_adult=1`;
const person = () => {
  const id = crypto.randomUUID();
  return { id, cookie: adult(signedInCookie(id)) };
};
const guest = () => {
  const id = crypto.randomUUID();
  return { id, cookie: adult(`bz_sess=${signSession({ uid: id, authenticated: false })}`) };
};
const req = (path: string, body: unknown, cookie?: string, method = "POST") =>
  new Request(BASE_URL + path, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, ...(method === "DELETE" ? {} : { body: JSON.stringify(body) }) });
async function open(cookie: string, characterId: string = CAST.id): Promise<string> {
  const res = await openRoute(req("/api/companion", { character_id: characterId }, cookie));
  return ((await res.json()) as Any).thread_id;
}
async function act(cookie: string, id: string, body: Record<string, unknown>) {
  const res = await actRoute(req(`/api/companion/${id}`, body, cookie), { params: Promise.resolve({ id }) });
  return { status: res.status, body: (await res.json()) as Any };
}
async function del(cookie: string, id: string, messageId: string) {
  const res = await deleteMessageRoute(req(`/api/companion/${id}/messages/${messageId}`, null, cookie, "DELETE"), { params: Promise.resolve({ id, messageId }) });
  return { status: res.status, body: (await res.json()) as Any };
}
type Row = { id: string; role: string; text: string; action: string | null; replaced_by: string | null; via: string; offers: Any; voice_key: string | null; created_at: string };
const rows = async (threadId: string) =>
  (await t.db.query<Row>(`select id, role, text, action, replaced_by, via, offers, voice_key, created_at from companion_messages where thread_id = $1 order by created_at, id`, [threadId])).rows;
const shown = async (userId: string, threadId: string) => {
  const r = await getThread(t.db, userId, threadId);
  if (!r.ok) throw new Error("no thread");
  return r.view.messages;
};
/** A person's own character (so a text about a date can come from it), public. */
async function ownCharacter(owner: string, name = "Lexi Marlowe") {
  const id = crypto.randomUUID();
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility)
     values ($1, $2, false, $3, 29, 'Restores old radios.', '["dry","warm"]'::jsonb, 'Someone who listens', 'Rudeness', 'public')`,
    [id, owner, name],
  );
  return id;
}

describe("deleting one message", () => {
  it("deletes the person's own message and the character's, for the thread's person only", async () => {
    const me = person();
    const id = await open(me.cookie);
    replies = ["Mostly radios, honestly."];
    await act(me.cookie, id, { action: "send", text: "My secret word is pomegranate" });
    const before = await shown(me.id, id);
    const mine = before.find((m) => m.text === "My secret word is pomegranate")!;
    const theirs = before.find((m) => m.text === "Mostly radios, honestly.")!;

    // Someone else: not found, and nothing goes. So is a made-up id, and the right message under another thread's id.
    const other = person();
    const otherThread = await open(other.cookie);
    expect(await del(other.cookie, id, mine.id)).toMatchObject({ status: 404, body: { error: "not_found" } });
    expect(await del(other.cookie, otherThread, mine.id)).toMatchObject({ status: 404 });
    expect(await del(me.cookie, id, "no-such-message")).toMatchObject({ status: 404, body: { error: "not_found", message: "Not found." } });
    // No session at all: a new guest, whose thread it isn't.
    expect((await del("bz_adult=1", id, mine.id)).status).toBe(404);
    expect((await rows(id)).map((m) => m.id)).toContain(mine.id);

    expect(await del(me.cookie, id, mine.id)).toEqual({ status: 200, body: { deleted: true, summary_reset: false } });
    expect((await rows(id)).map((m) => m.text)).not.toContain("My secret word is pomegranate");
    // Twice is not-found: it's gone.
    expect((await del(me.cookie, id, mine.id)).status).toBe(404);
    expect(await del(me.cookie, id, theirs.id)).toMatchObject({ status: 200 });
    const after = await shown(me.id, id);
    expect(after.map((m) => m.text)).not.toContain("Mostly radios, honestly.");
    // The thread still works: the next message is answered, with neither deleted line in the prompt.
    replies = ["Go on then."];
    const next = await act(me.cookie, id, { action: "send", text: "anyway" });
    expect(next.status).toBe(200);
    expect(next.body.view.messages.at(-1).text).toBe("Go on then.");
  });

  it("a guest deletes from their own conversation, as they can delete the conversation", async () => {
    const g = guest();
    const id = await open(g.cookie);
    await act(g.cookie, id, { action: "send", text: "just looking around" });
    const mine = (await shown(g.id, id)).find((m) => m.role === "user")!;
    expect((await del(g.cookie, id, mine.id)).status).toBe(200);
    // A bare bz_uid is never enough (anyone could type one in).
    expect((await del(`bz_uid=${g.id}; bz_adult=1`, id, mine.id)).status).toBe(401);
  });

  it("never deletes the AI notice or a scene's line: they go with the conversation", async () => {
    const me = person();
    const id = await open(me.cookie);
    await act(me.cookie, id, { action: "scene", place: "rooftop_bar" });
    const all = await shown(me.id, id);
    const notice = all.find((m) => m.role === "system" && m.marker === null)!;
    const scene = all.find((m) => m.role === "system" && m.marker === "scene")!;
    expect(notice.text).toBe(companionNotice(CAST.name));
    for (const m of [notice, scene]) {
      expect(await del(me.cookie, id, m.id)).toMatchObject({ status: 409, body: { error: "kept" } });
    }
    expect((await shown(me.id, id)).filter((m) => m.role === "system").map((m) => m.id)).toEqual([notice.id, scene.id]);
    // And the page never lists them.
    const listed = (await deletableMessages(t.db, me.id, id))!;
    expect(listed.map((m) => m.id)).not.toContain(notice.id);
    expect(listed.map((m) => m.id)).not.toContain(scene.id);
    expect(listed.length).toBeGreaterThan(0);
    expect(await deletableMessages(t.db, "someone-else", id)).toBeNull();
  });

  it("takes a redrawn reply's earlier versions with it, and never lists or deletes one on its own", async () => {
    const me = person();
    const id = await open(me.cookie);
    replies = ["First take."];
    await act(me.cookie, id, { action: "send", text: "what's your week been like" });
    replies = ["Second take, better."];
    await act(me.cookie, id, { action: "regenerate" });
    replies = ["Third take."];
    await act(me.cookie, id, { action: "regenerate" });
    const all = await rows(id);
    const hidden = all.filter((m) => m.replaced_by);
    expect(hidden.map((m) => m.text).sort()).toEqual(["First take.", "Second take, better."]);
    // A hidden earlier version is not a message of the thread: not listed, not found.
    expect((await deletableMessages(t.db, me.id, id))!.map((m) => m.text)).not.toContain("First take.");
    expect((await del(me.cookie, id, hidden[0].id)).status).toBe(404);
    const third = all.find((m) => m.text === "Third take.")!;
    expect((await del(me.cookie, id, third.id)).status).toBe(200);
    const left = (await rows(id)).map((m) => m.text);
    for (const gone of ["First take.", "Second take, better.", "Third take."]) expect(left).not.toContain(gone);
    expect(left).toContain("what's your week been like");
  });

  it("drops the running notes when they cover the message, and leaves them when they can't hold it; no model call", async () => {
    const me = person();
    const id = await open(me.cookie);
    await act(me.cookie, id, { action: "send", text: "an early thing about my sister" });
    await act(me.cookie, id, { action: "send", text: "a later thing" });
    const [early, later] = (await shown(me.id, id)).filter((m) => m.role === "user");
    // The notes cover everything up to the early message's reply.
    const upto = (await rows(id)).find((m) => m.id === early.id)!.created_at;
    await t.db.query(`update companion_threads set summary = 'They told ${first} about their sister.', summary_upto = $2 where id = $1`, [id, upto]);
    const calls = modelCalls.length;
    // Newer than the notes: they can't hold it.
    expect(await deleteMessage(t.db, me.id, id, later.id)).toMatchObject({ ok: true, summary_reset: false });
    expect((await t.db.query<Any>(`select summary from companion_threads where id = $1`, [id])).rows[0].summary).toContain("sister");
    // Covered by the notes: gone with it, to be written again from what's left.
    expect(await deleteMessage(t.db, me.id, id, early.id)).toMatchObject({ ok: true, summary_reset: true });
    expect((await t.db.query<Any>(`select summary, summary_upto from companion_threads where id = $1`, [id])).rows[0]).toEqual({ summary: null, summary_upto: null });
    expect(modelCalls.length).toBe(calls);
    // The facts already drawn are the memory page's: a delete never touches them.
    await t.db.query(`insert into companion_facts (id, thread_id, kind, text) values ('f-1', $1, 'people', 'Their sister is called Maya.')`, [id]);
    const reply = (await shown(me.id, id)).find((m) => m.role === "character")!;
    await deleteMessage(t.db, me.id, id, reply.id);
    expect((await t.db.query(`select 1 from companion_facts where thread_id = $1`, [id])).rows).toHaveLength(1);
    // The next follow-up writes the notes again once enough has fallen out of the recent turns: from what's left only.
    const stamp = (i: number) => new Date(Date.parse("2026-11-01T00:00:00Z") + i * 1000).toISOString();
    for (let i = 0; i < 80; i++) await t.db.query(`insert into companion_messages (id, thread_id, role, text, created_at) values ($1, $2, 'user', $3, $4)`, [`old-${i}`, id, `old line ${i}`, stamp(i)]);
    let prompt = "";
    const model = { complete: async (m: { content: string }[]) => ((prompt = m[1].content), '{"notes":"They talked about old lines."}') };
    expect(await updateSummary(t.db, id, CAST.name, model as Any)).toBe(true);
    expect(prompt).toContain("Notes so far: (none yet)");
    expect(prompt).not.toContain("an early thing about my sister");
  });

  it("removes a voice note's stored audio with its reply, unless another reply says the same words", async () => {
    const removedKeys: string[] = [];
    const store: ObjectStore = { put: async () => {}, get: async () => null, remove: async (k) => void removedKeys.push(k), presign: async () => ({ url: "", maxAge: 0 }) };
    setObjectStoreForTests(store);
    const me = person();
    const id = await open(me.cookie);
    replies = ["The same words."];
    await act(me.cookie, id, { action: "send", text: "one" });
    replies = ["Different words."];
    await act(me.cookie, id, { action: "send", text: "two" });
    const [a, b] = (await shown(me.id, id)).filter((m) => m.role === "character" && /words/.test(m.text));
    await t.db.query(`insert into companion_voice (key, voice, chars, mime, object_key) values ('k-shared', 'af_sky', 15, 'audio/mpeg', 'companion/shared.mp3'), ('k-own', 'af_sky', 16, 'audio/mpeg', 'companion/own.mp3')`);
    // The opener happens to say what `a` says (the same voice and words share one file).
    const opener = (await shown(me.id, id)).find((m) => m.role === "character")!;
    await t.db.query(`update companion_messages set voice_key = 'k-shared' where id = any($1)`, [[opener.id, a.id]]);
    await t.db.query(`update companion_messages set voice_key = 'k-own' where id = $1`, [b.id]);
    expect((await deletableMessages(t.db, me.id, id))!.find((m) => m.id === b.id)).toMatchObject({ voice: true, from: "them" });

    await deleteMessage(t.db, me.id, id, a.id);
    expect((await t.db.query<Any>(`select key from companion_voice order by key`)).rows.map((r: Any) => r.key)).toEqual(["k-own", "k-shared"]);
    expect(removedKeys).toEqual([]);
    await deleteMessage(t.db, me.id, id, b.id);
    expect((await t.db.query<Any>(`select key from companion_voice order by key`)).rows.map((r: Any) => r.key)).toEqual(["k-shared"]);
    expect(removedKeys).toEqual(["companion/own.mp3"]);
  });

  it("works in a paused (crisis) thread, as deleting the conversation does", async () => {
    const me = person();
    const id = await open(me.cookie);
    await act(me.cookie, id, { action: "send", text: "something I said before" });
    await t.db.query(`update companion_threads set paused_at = now() where id = $1`, [id]);
    const mine = (await shown(me.id, id)).find((m) => m.role === "user")!;
    expect((await del(me.cookie, id, mine.id)).status).toBe(200);
    // Still paused: a delete never carries a conversation on.
    expect((await t.db.query<Any>(`select paused_at from companion_threads where id = $1`, [id])).rows[0].paused_at).not.toBeNull();
  });

  it("COMPANION_MESSAGE_DELETE=0: the route answers not-found, nothing is deleted, and Settings has no entry", async () => {
    const me = person();
    const id = await open(me.cookie);
    await act(me.cookie, id, { action: "send", text: "keep me" });
    const mine = (await shown(me.id, id)).find((m) => m.role === "user")!;
    expect(companionMessageDelete({})).toBe(true);
    expect(companionMessageDelete({ COMPANION_MESSAGE_DELETE: "0" })).toBe(false);
    vi.stubEnv("COMPANION_MESSAGE_DELETE", "0");
    expect(await del(me.cookie, id, mine.id)).toEqual({ status: 404, body: { error: "not_found", message: "Not found." } });
    expect(await deleteMessage(t.db, me.id, id, mine.id)).toMatchObject({ ok: false, status: 404 });
    expect((await rows(id)).map((m) => m.id)).toContain(mine.id);
    vi.unstubAllEnvs();

    // The chat: one entry in the Settings menu and nowhere else, only when it's on. No delete on any bubble.
    const view = (await getThread(t.db, me.id, id)) as Any;
    const allowance = { unlimited: false, left: 12, per_day: 30, resets_at: "2026-11-14T00:00:00Z", guest: false, plan: "none", on_sale: true, price: "$9 a month" } as unknown as CompanionAllowance;
    const chat = (messageDelete: boolean) => renderToStaticMarkup(createElement(CompanionChat, { initial: view.view, initialCrisis: null, initialAllowance: allowance, signedIn: true, messageDelete }));
    const on = chat(true);
    expect(on.split(`href="/companion/${id}/messages"`).length - 1).toBe(1);
    const menu = on.slice(on.indexOf('<div class="companion-menu-body">'), on.indexOf("</details>"));
    expect(menu).toContain(`href="/companion/${id}/messages"`);
    expect(menu).toContain("Delete messages…");
    expect(menu.indexOf("Delete messages…")).toBeLessThan(menu.indexOf("Delete this conversation"));
    const off = chat(false);
    expect(off).not.toContain("/messages");
    expect(off).toContain("Delete this conversation");
    // The thread's bubbles are the same either way.
    const thread = (html: string) => html.slice(html.indexOf('class="companion-thread'), html.indexOf("companion-compose"));
    expect(thread(on)).toBe(thread(off));
    expect(thread(on)).not.toMatch(/>Delete</);
  });
});

describe("the page under the thread's Settings", () => {
  it("lists what the two said, newest first, with a Delete on each and a line about memory", async () => {
    const me = person();
    const id = await open(me.cookie);
    replies = ["Said back on the call."];
    await act(me.cookie, id, { action: "send", text: "said on a call", call: true });
    const list = (await deletableMessages(t.db, me.id, id))!;
    expect(list.map((m) => m.text).slice(0, 2)).toEqual(["Said back on the call.", "said on a call"]);
    expect(list[0]).toMatchObject({ from: "them", call: true, photo: false, voice: false, reported: false });
    expect(list[1]).toMatchObject({ from: "you", call: true });
    const html = renderToStaticMarkup(createElement(DeleteMessages, { threadId: id, character: { id: CAST.id, name: CAST.name, portrait: null, hue: null, house: true, yours: false }, initial: list }));
    expect(html).toContain("<h1>Delete messages</h1>");
    expect(html).toContain(`href="/companion/${id}"`);
    // One line on memory, with the link.
    expect(html).toContain(`What ${first} already remembers from a message stays until you change it on <a href="/companion/${id}/memory">the memory page</a>.`);
    expect(html.match(/>Delete<\/button>/g)!.length).toBe(list.length);
    expect(html).toContain("said on a call");
    expect(html).toContain("📞");
    // What isn't listed, and what a deleted text leaves, said plainly.
    expect(html).toContain("is an AI character” notices");
    expect(html).toContain("leaves a blank marker of what it was about, with none of its words");
    // Empty: says so.
    const empty = renderToStaticMarkup(createElement(DeleteMessages, { threadId: id, character: { id: CAST.id, name: CAST.name, portrait: null, hue: null, house: true, yours: false }, initial: [] }));
    expect(empty).toContain("Nothing to delete");
  });
});

describe("a text the character sent first", () => {
  const text = (userId: string, characterId: string, key: string, lines: string[], extra: Partial<Parameters<typeof postFromCharacter>[1]> = {}) =>
    postFromCharacter(t.db, { userId, characterId, lines, kind: key.split(":")[0], dedupeKey: key, now: new Date("2026-11-15T12:00:00Z"), ...extra });

  it("leaves a blank marker when its last bubble is deleted, so the same text is never sent again", async () => {
    const me = person();
    const lexi = await ownCharacter(me.id);
    const sent = await text(me.id, lexi, "after_date:ep-1", ["Back from the date with Teo.", "It went well, I think.", "Want me to see Teo again?"], {
      offers: { episode_id: "ep-1", partner_id: CAST.id, partner: CAST.name, kinds: ["second_date", "someone_new", "advice"] },
      photo: { url: "/api/og/date-photo/ep-1", alt: "Lexi and Teo at the night market" },
    });
    expect(sent).not.toBeNull();
    const id = sent!.threadId;
    // Unread, with the first line in the notification.
    expect((await t.db.query<Any>(`select body from notifications where user_id = $1 and kind = 'character_texted_you'`, [me.id])).rows).toEqual([{ body: "Back from the date with Teo." }]);
    expect((await loadChat(t.db, { userId: me.id, withYou: true })).rows.find((r) => r.key === `you:${id}`)).toMatchObject({ unread: 1 });

    const bubbles = (await shown(me.id, id)).filter((m) => m.role === "character");
    expect(bubbles).toHaveLength(4);
    // All but one: the rows just go (another still carries the tag).
    for (const m of bubbles.slice(0, 3)) expect(await deleteMessage(t.db, me.id, id, m.id)).toMatchObject({ ok: true, marker: false });
    expect((await rows(id)).filter((m) => m.action === "after_date:ep-1")).toHaveLength(1);
    // The first line went, and the notification that quoted it with it: nothing unread points at a deleted text.
    expect((await t.db.query(`select 1 from notifications where user_id = $1 and kind = 'character_texted_you'`, [me.id])).rows).toHaveLength(0);
    expect((await loadChat(t.db, { userId: me.id, withYou: true })).rows.find((r) => r.key === `you:${id}`)).toMatchObject({ unread: 0 });
    // The last one: its words go, and a blank marker stays with only the tag and the time.
    expect(await deleteMessage(t.db, me.id, id, bubbles[3].id)).toMatchObject({ ok: true, marker: true });
    const left = (await rows(id)).filter((m) => m.action === "after_date:ep-1");
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ id: bubbles[3].id, role: "character", text: "", replaced_by: bubbles[3].id, via: "text", offers: null, voice_key: null });
    const all = JSON.stringify(await rows(id));
    for (const word of ["Teo", "night market", "went well"]) expect(all).not.toContain(word);
    // Nobody sees it: not the thread, not the page's list, not the inbox's last line; and it can't be deleted again.
    expect((await shown(me.id, id)).map((m) => m.role)).toEqual(["system"]);
    expect(await deletableMessages(t.db, me.id, id)).toEqual([]);
    expect((await loadChat(t.db, { userId: me.id, withYou: true })).rows.find((r) => r.key === `you:${id}`)?.last ?? null).toBeNull();
    expect(await deleteMessage(t.db, me.id, id, bubbles[3].id)).toMatchObject({ ok: false, status: 404 });
    // The same text again: nothing is written, nobody is told.
    expect(await text(me.id, lexi, "after_date:ep-1", ["Back from the date with Teo.", "Again."])).toBeNull();
    expect((await shown(me.id, id)).map((m) => m.role)).toEqual(["system"]);
    expect((await t.db.query(`select 1 from notifications where user_id = $1`, [me.id])).rows).toHaveLength(0);
    // Another text still arrives.
    expect(await text(me.id, lexi, "after_date:ep-2", ["Back from another one."])).not.toBeNull();
  });

  it("keeps the marker when a redrawn-away text's reply is deleted, and keeps a question's stop", async () => {
    const me = person();
    const lexi = await ownCharacter(me.id);
    // A question that was the last one for good (two went unanswered): its menu holds no words, only the stop.
    const q = await text(me.id, lexi, "question:occupation", ["Quick one: what do I do for work?"], { offers: { kinds: ["answer"], field: "occupation" } as Any });
    const id = q!.threadId;
    await t.db.query(`update companion_messages set offers = offers || '{"stopped": true}'::jsonb where id = $1`, [q!.messageId]);
    expect(await deleteMessage(t.db, me.id, id, q!.messageId)).toMatchObject({ ok: true, marker: true });
    expect((await rows(id)).find((m) => m.id === q!.messageId)).toMatchObject({ text: "", action: "question:occupation", offers: { kinds: ["answer"], field: "occupation", stopped: true } });

    // A text drawn again (its rows hidden under the new reply): deleting that reply keeps the text's tag as a marker.
    const sent = await text(me.id, lexi, "house_scene:2026-11-15", ["Apparently the house had opinions about my date."]);
    replies = ["A fresh line instead."];
    await act(me.cookie, id, { action: "regenerate" });
    const fresh = (await shown(me.id, id)).find((m) => m.text === "A fresh line instead.")!;
    expect((await rows(id)).find((m) => m.id === sent!.messageId)!.replaced_by).toBe(fresh.id);
    expect(await deleteMessage(t.db, me.id, id, fresh.id)).toMatchObject({ ok: true, marker: true });
    const marker = (await rows(id)).find((m) => m.action === "house_scene:2026-11-15")!;
    expect(marker).toMatchObject({ text: "", role: "character" });
    expect(marker.replaced_by).toBe(marker.id);
    expect(JSON.stringify(await rows(id))).not.toContain("opinions");
    expect(await text(me.id, lexi, "house_scene:2026-11-15", ["Apparently the house had opinions about my date."])).toBeNull();
  });
});

describe("the account export", () => {
  it("has the person's conversations, what each companion remembers and their call records: theirs only, nothing of After Dark", async () => {
    const me = person();
    const other = person();
    const id = await open(me.cookie);
    replies = ["Said back, out loud."];
    await act(me.cookie, id, { action: "send", text: "MINE-said on a call", call: true });
    replies = ["First draw."];
    await act(me.cookie, id, { action: "send", text: "MINE-typed" });
    replies = ["Second draw."];
    await act(me.cookie, id, { action: "regenerate" });
    await t.db.query(`insert into companion_facts (id, thread_id, kind, text, pinned, edited_by_user) values ('f-me', $1, 'people', 'MINE-Their sister is called Maya.', true, true)`, [id]);
    await t.db.query(`update companion_threads set summary = 'MINE-They talked about Maya.' where id = $1`, [id]);
    await t.db.query(
      `insert into companion_live_calls (id, user_id, thread_id, started_at, last_at, ended_at, minutes, turns, tts_chars, face_provider, face_seconds, first_ticket)
       values ('call-me', $1, $2, '2026-11-15T10:00:00Z', '2026-11-15T10:03:00Z', '2026-11-15T10:03:10Z', 4, 6, 420, 'ditto', 150, '{"ok":true,"kind":"minute","source":"included"}'::jsonb)`,
      [me.id, id],
    );
    // A deleted text of their own character's leaves its marker, which is theirs to see too.
    const lexi = await ownCharacter(me.id);
    const sent = await postFromCharacter(t.db, { userId: me.id, characterId: lexi, lines: ["MINE-deleted text."], kind: "after_date", dedupeKey: "after_date:ep-9" });
    await deleteMessage(t.db, me.id, sent!.threadId, sent!.messageId);

    // Someone else's conversation and call, and After Dark's own data about this very person.
    const theirs = await open(other.cookie);
    await act(other.cookie, theirs, { action: "send", text: "THEIRS-typed" });
    await t.db.query(`insert into companion_facts (id, thread_id, kind, text) values ('f-them', $1, 'other', 'THEIRS-fact.')`, [theirs]);
    await t.db.query(`insert into companion_live_calls (id, user_id, thread_id, started_at, last_at, minutes, turns) values ('call-them', $1, $2, now(), now(), 9, 9)`, [other.id, theirs]);
    await t.db.query(`insert into adult_memories (character_id, other_id, owner_id, note) values ($1, $2, $3, 'AFTERDARK-note')`, [HOUSE_CHARACTERS[1].id, HOUSE_CHARACTERS[2].id, me.id]);
    await t.db.query(`insert into adult_facts (id, owner_id, character_id, other_id, kind, fact) values ('af-1', $1, $2, $3, 'said', 'AFTERDARK-fact')`, [me.id, HOUSE_CHARACTERS[1].id, HOUSE_CHARACTERS[2].id]);

    const out = await exportAccount(t.db, me.id);
    expect(out.companion_conversations.map((c) => c.character).sort()).toEqual([CAST.name, "Lexi Marlowe"].sort());
    const convo = out.companion_conversations.find((c) => c.thread_id === id)!;
    expect(convo).toMatchObject({ character_id: CAST.id, character: CAST.name, reply_length: "normal", texts_on: false, paused: false, scene: null, notes: "MINE-They talked about Maya." });
    expect(new Date(convo.started_at).toISOString()).toBe(convo.started_at);
    // Each message: who said it, when, whether it was said on a call.
    const said = convo.messages as Any[];
    expect(said[0]).toMatchObject({ said_by: "notice", text: companionNotice(CAST.name), on_call: false });
    expect(said.find((m) => m.text === "MINE-said on a call")).toMatchObject({ said_by: "you", on_call: true });
    expect(said.find((m) => m.text === "Said back, out loud.")).toMatchObject({ said_by: "character", on_call: true });
    expect(said.find((m) => m.text === "MINE-typed")).toMatchObject({ said_by: "you", on_call: false });
    for (const m of said) expect(new Date(m.at).toISOString()).toBe(m.at);
    // A reply drawn again is still stored, so it's there, marked.
    expect(said.find((m) => m.text === "First draw.")).toMatchObject({ redrawn: true });
    expect(said.find((m) => m.text === "Second draw.").redrawn).toBeUndefined();
    // What the character remembers.
    expect(convo.memory).toEqual([expect.objectContaining({ kind: "people", text: "MINE-Their sister is called Maya.", pinned: true, edited_by_you: true })]);
    // The deleted text: what it was about and when, never its words.
    const own = out.companion_conversations.find((c) => c.character === "Lexi Marlowe")!;
    expect(own.deleted_text_markers).toEqual([{ about: "after_date:ep-9", at: expect.any(String) }]);
    expect(own.messages.map((m: Any) => m.said_by)).toEqual(["notice"]);
    // The call records: times, minutes, turns; there are no words or sound to export.
    expect(out.companion_calls).toEqual([
      expect.objectContaining({ thread_id: id, minutes: 4, turns: 6, voiced_characters: 420, face_provider: "ditto", face_seconds: 150, first_minute_paid_with: "included" }),
    ]);
    expect(Object.keys(out.companion_calls[0]).sort()).toEqual(["ended_at", "face_provider", "face_seconds", "first_minute_paid_with", "last_at", "minutes", "started_at", "thread_id", "turns", "voiced_characters"]);

    const json = JSON.stringify(out);
    expect(json).not.toContain("THEIRS-");
    expect(json).not.toContain("AFTERDARK-");
    expect(json).not.toContain("MINE-deleted text.");
    expect(json).not.toContain(other.id);
    // Nothing internal rides along: no model ids, costs or voice file keys.
    for (const m of said) expect(Object.keys(m).every((k) => ["said_by", "text", "at", "on_call", "photo", "voice_note", "scene", "roleplay", "action", "about", "reported", "reported_at", "redrawn"].includes(k))).toBe(true);
    // The other person's export is theirs alone; someone with no conversations gets empty lists.
    const theirOut = await exportAccount(t.db, other.id);
    expect(theirOut.companion_conversations.map((c) => c.thread_id)).toEqual([theirs]);
    expect(JSON.stringify(theirOut)).not.toContain("MINE-");
    const nobody = await exportAccount(t.db, crypto.randomUUID());
    expect(nobody.companion_conversations).toEqual([]);
    expect(nobody.companion_calls).toEqual([]);
  });
});
