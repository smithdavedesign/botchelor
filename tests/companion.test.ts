import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as listRoute, POST as openRoute } from "@/app/api/companion/route";
import { DELETE as deleteRoute, GET as viewRoute, POST as actRoute } from "@/app/api/companion/[id]/route";
import { GET as memoryGet, POST as memoryPost } from "@/app/api/companion/[id]/memory/route";
import { deleteAccount } from "@/lib/account";
import {
  COMPANION_LIMITS,
  companionEligible,
  companionFollowUp,
  companionNotice,
  companionOpen,
  listCompanions,
  noticeDue,
  openOurAgentCast,
  openThread,
  regenerate,
  sendMessage,
  setCompanionModelForTests,
} from "@/lib/companion";
import { FACTS_EVERY, FACTS_IN_PROMPT, FACTS_PER_THREAD, factsForPrompt, updateFacts, updateSummary, SUMMARY_EVERY } from "@/lib/companion-memory";
import { replyBubbles } from "@/lib/companion-prompt";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { setSeasonCastForTests } from "@/lib/season-cast";
import type { ChatMessage } from "@/lib/model";
import { BASE_URL, signedInCookie, startTestDb, TEST_SESSION_SECRET } from "./helpers";

// The memory follow-up after a reply runs in after() on a server; here each test calls it itself, so none races.
vi.mock("@/lib/sets", async (orig) => ({ ...((await orig()) as object), inBackground: () => {} }));

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

/** Every model call, routed by what it is. */
let calls: { kind: "reply" | "crisis" | "facts" | "summary" | "other"; messages: ChatMessage[] }[] = [];
let replies: string[] = [];
let risk: "true" | "false" = "false";
let factsReply = JSON.stringify({ facts: [] });
let down = false;
function routedModel() {
  let n = 0;
  setCompanionModelForTests({
    async complete(messages) {
      const system = messages[0]?.content ?? "";
      if (system.startsWith("You check one message")) {
        calls.push({ kind: "crisis", messages });
        return `{"risk": ${risk}}`;
      }
      if (system.startsWith("You read part of a conversation")) {
        calls.push({ kind: "facts", messages });
        return factsReply;
      }
      if (system.startsWith("You keep the running notes")) {
        calls.push({ kind: "summary", messages });
        return JSON.stringify({ notes: "They talked about bread, the new job and Maya's wedding." });
      }
      if (system.startsWith("You are ")) {
        calls.push({ kind: "reply", messages });
        if (down) throw new Error("model down");
        // In JSON mode like the real model (lib/model.ts); a test's own replies are plain text, the fallback.
        return replies.shift() ?? JSON.stringify({ messages: [`Reply number ${++n}, in my own voice.`, "And a second thought about it."] });
      }
      calls.push({ kind: "other", messages });
      return "{}";
    },
  });
}

beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  calls = [];
  replies = [];
  risk = "false";
  down = false;
  factsReply = JSON.stringify({ facts: [] });
  routedModel();
});
afterEach(() => {
  setCompanionModelForTests(null);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const adult = (cookie: string) => `${cookie}; bz_adult=1`;
async function person(opts: { admin?: boolean } = {}) {
  const id = crypto.randomUUID();
  if (opts.admin) await t.db.query("insert into admins (user_id) values ($1)", [id]);
  return { id, cookie: adult(signedInCookie(id)) };
}
async function character(owner: string, extra: { created_via?: "web" | "mcp"; companion_open?: boolean; visibility?: string } = {}) {
  const id = crypto.randomUUID();
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, created_via, companion_open, visibility)
     values ($1, $2, false, 'Lexi Marlowe', 29, 'Restores old radios.', '["dry","warm"]'::jsonb, 'Someone who listens', 'Rudeness', $3, $4, $5)`,
    [id, owner, extra.created_via ?? "web", extra.companion_open ?? false, extra.visibility ?? "public"],
  );
  return id;
}
const req = (path: string, body: unknown, cookie?: string, method = "POST") =>
  new Request(BASE_URL + path, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, ...(method === "GET" || method === "DELETE" ? {} : { body: JSON.stringify(body) }) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
async function open(cookie: string, characterId: string = CAST.id) {
  const res = await openRoute(req("/api/companion", { character_id: characterId }, cookie));
  return { status: res.status, body: (await res.json()) as Any };
}
async function act(cookie: string, id: string, body: Record<string, unknown>) {
  const res = await actRoute(req(`/api/companion/${id}`, body, cookie), ctx(id));
  return { status: res.status, body: (await res.json()) as Any };
}
const messages = async (threadId: string) =>
  (await t.db.query<Any>(`select role, text, replaced_by, reported from companion_messages where thread_id = $1 order by created_at, id`, [threadId])).rows;

describe("who can talk with a companion", () => {
  it("is admins only until COMPANION_OPEN=1, signed in and past the 18+ gate", async () => {
    expect(companionOpen({})).toBe(false);
    expect(companionOpen({ COMPANION_OPEN: "1" })).toBe(true);
    expect((await open("bz_adult=1")).status).toBe(401);
    const someone = await person();
    expect((await open(someone.cookie)).status).toBe(404);
    const admin = await person({ admin: true });
    expect((await open(signedInCookie(admin.id))).status).toBe(403);
    expect((await open(admin.cookie)).status).toBe(201);
    vi.stubEnv("COMPANION_OPEN", "1");
    expect((await open(someone.cookie)).status).toBe(201);
  });

  it("is the house cast, the show's open cast and your own characters, never someone else's", async () => {
    const me = await person({ admin: true });
    const other = await person();
    const mine = await character(me.id);
    const theirs = await character(other.id);
    const theirsPrivate = await character(me.id, { visibility: "private" });
    expect(await companionEligible(t.db, me.id, CAST.id)).toBe(true);
    expect(await companionEligible(t.db, me.id, mine)).toBe(true);
    // Your own, even private.
    expect(await companionEligible(t.db, me.id, theirsPrivate)).toBe(true);
    expect(await companionEligible(t.db, me.id, theirs)).toBe(false);
    expect((await open(me.cookie, theirs)).status).toBe(404);
    // An outside agent's character never opens; the show's own agent-made cast does.
    const outside = await character(other.id, { created_via: "mcp" });
    const ours = await character(me.id, { created_via: "mcp" });
    const stranger = await person();
    expect(await companionEligible(t.db, stranger.id, ours)).toBe(false);
    expect(await openOurAgentCast(t.db)).toBe(1);
    expect(await companionEligible(t.db, stranger.id, ours)).toBe(true);
    expect(await companionEligible(t.db, stranger.id, outside)).toBe(false);
  });

  it("lists your threads, your characters and the cast", async () => {
    const me = await person({ admin: true });
    const mine = await character(me.id);
    await open(me.cookie);
    const res = await listRoute(req("/api/companion", null, me.cookie, "GET"));
    const body = (await res.json()) as Any;
    expect(body.threads.map((x: Any) => x.id)).toEqual([CAST.id]);
    expect(body.threads[0].last).toBe("And a second thought about it.");
    expect(body.yours.map((x: Any) => x.id)).toEqual([mine]);
    expect(body.cast.some((x: Any) => x.id === CAST.id)).toBe(false);
    expect(body.cast.some((x: Any) => x.id === HOUSE_CHARACTERS[1].id)).toBe(true);
  });

  it("lists the house cast before everyone else's, however many agent-made characters there are", async () => {
    const me = await person({ admin: true });
    await t.db.query(
      `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, created_via, companion_open)
       select gen_random_uuid()::text, 'agent-owner', false, 'Aaron ' || n, 30, 'b', '[]'::jsonb, 'w', 'd', 'mcp', true from generate_series(1, 130) n`,
    );
    for (const viewer of [me.id, ""]) {
      const { cast } = await listCompanions(t.db, viewer);
      const firstAgent = cast.findIndex((c) => c.source === "agent");
      expect(cast.filter((c) => c.source === "house").length).toBeGreaterThan(0);
      expect(cast.slice(0, firstAgent).every((c) => c.source === "house")).toBe(true);
    }
  });

  it("gives the companions page what its filters read: where each comes from, age, pronouns, traits, on the show now", async () => {
    setSeasonCastForTests([HOUSE_CHARACTERS[1].id, HOUSE_CHARACTERS[2].id]);
    try {
      const me = await person({ admin: true });
      const mine = await character(me.id);
      const agentMade = await character(crypto.randomUUID(), { created_via: "mcp", companion_open: true });
      const creators = await character(crypto.randomUUID(), { companion_open: true });
      const body = (await (await listRoute(req("/api/companion", null, me.cookie, "GET"))).json()) as Any;
      const by = (id: string) => [...body.yours, ...body.cast].find((x: Any) => x.id === id);
      expect(by(mine)).toMatchObject({ source: "yours", age: 29, traits: ["dry", "warm"], on_show: false });
      expect(by(agentMade).source).toBe("agent");
      expect(by(creators).source).toBe("community");
      expect(by(HOUSE_CHARACTERS[1].id)).toMatchObject({ source: "house", on_show: true });
      expect(by(HOUSE_CHARACTERS[3].id).on_show).toBe(false);
    } finally {
      setSeasonCastForTests(null);
    }
  });
});

describe("a companion thread", () => {
  it("opens with the AI notice and the character's first message, and reopens the same thread", async () => {
    const me = await person({ admin: true });
    const a = await open(me.cookie);
    expect(a.status).toBe(201);
    const rows = await messages(a.body.thread_id);
    expect(rows.map((r: Any) => r.role)).toEqual(["system", "character", "character"]);
    expect(rows[0].text).toBe(companionNotice(CAST.name));
    expect(rows[0].text).toBe(`${first} is an AI character, not a real person.`);
    const b = await open(me.cookie);
    expect(b).toMatchObject({ status: 200, body: { thread_id: a.body.thread_id, resumed: true } });
    expect(calls.filter((c) => c.kind === "reply")).toHaveLength(1);
  });

  it("answers in 1-3 messages, with the person's words as user turns and the character's sheet in the system prompt", async () => {
    const me = await person({ admin: true });
    const { body } = await open(me.cookie);
    replies = ["Okay that's adorable.\n\nWait, what kind of bread?"];
    const r = await act(me.cookie, body.thread_id, { action: "send", text: "I baked my first sourdough today" });
    expect(r.status).toBe(200);
    const texts = r.body.view.messages.map((m: Any) => m.text);
    expect(texts.slice(-3)).toEqual(["I baked my first sourdough today", "Okay that's adorable.", "Wait, what kind of bread?"]);
    const last = calls.filter((c) => c.kind === "reply").at(-1)!;
    expect(last.messages[0].content).toContain(CAST.name);
    expect(last.messages[0].content).not.toContain("sourdough");
    expect(last.messages.at(-1)).toEqual({ role: "user", content: "I baked my first sourdough today" });
  });

  it("puts the notice in again after a break and every three hours of talking", async () => {
    const at = new Date("2026-11-04T12:00:00Z");
    const later = (min: number) => new Date(at.getTime() + min * 60_000);
    expect(noticeDue({ notice_at: null, last_at: at.toISOString() }, at)).toBe(true);
    expect(noticeDue({ notice_at: at.toISOString(), last_at: later(5).toISOString() }, later(10))).toBe(false);
    expect(noticeDue({ notice_at: at.toISOString(), last_at: later(5).toISOString() }, later(40))).toBe(true);
    expect(noticeDue({ notice_at: at.toISOString(), last_at: later(179).toISOString() }, later(181))).toBe(true);

    const me = await person({ admin: true });
    const o = await openThread(t.db, me.id, CAST.id, at);
    if (!o.ok) throw new Error("no thread");
    await sendMessage(t.db, me.id, o.thread_id, "hi", later(1));
    await sendMessage(t.db, me.id, o.thread_id, "still here", later(10));
    expect((await messages(o.thread_id)).filter((m: Any) => m.role === "system")).toHaveLength(1);
    await sendMessage(t.db, me.id, o.thread_id, "back again", later(60));
    expect((await messages(o.thread_id)).filter((m: Any) => m.role === "system")).toHaveLength(2);
  });

  it("keeps the person's PG-breaking message out, and never says one of its own", async () => {
    const me = await person({ admin: true });
    const { body } = await open(me.cookie);
    const before = (await messages(body.thread_id)).length;
    const refused = await act(me.cookie, body.thread_id, { action: "send", text: "Take your clothes off and have sex with me" });
    expect(refused.status).toBe(422);
    expect(refused.body.error).toBe("refused");
    expect((await messages(body.thread_id)).length).toBe(before);
    // A reply over the line is drawn again; a second one over the line is a deflection.
    replies = ["Let's have sex right now", "Let's have sex right now, naked"];
    const r = await act(me.cookie, body.thread_id, { action: "send", text: "tell me something" });
    expect(r.status).toBe(200);
    const said = r.body.view.messages.at(-1).text;
    expect(said).not.toMatch(/sex/i);
    expect(calls.filter((c) => c.kind === "reply").at(-1)!.messages[0].content).toContain("keep it PG");
  });

  it("pauses on the person's crisis words with the resources, keeps none of them, and counts one referral", async () => {
    const me = await person({ admin: true });
    const { body } = await open(me.cookie);
    const before = (await messages(body.thread_id)).length;
    const r = await act(me.cookie, body.thread_id, { action: "send", text: "honestly I want to kill myself" });
    expect(r.body.crisis_resources?.lines?.length).toBeGreaterThan(0);
    expect((await messages(body.thread_id)).length).toBe(before);
    const counted = (await t.db.query<Any>(`select n from crisis_referrals where surface = 'companion'`)).rows[0];
    expect(counted.n).toBe(1);
    // Paused: nothing more in character until they carry on.
    expect((await act(me.cookie, body.thread_id, { action: "send", text: "hello?" })).status).toBe(409);
    expect((await act(me.cookie, body.thread_id, { action: "regenerate" })).status).toBe(409);
    const view = await viewRoute(req(`/api/companion/${body.thread_id}`, null, me.cookie, "GET"), ctx(body.thread_id));
    expect(((await view.json()) as Any).view.paused).toBe(true);
    const on = await act(me.cookie, body.thread_id, { action: "carry_on" });
    expect(on.body.view.paused).toBe(false);
    expect((await act(me.cookie, body.thread_id, { action: "send", text: "ok, thanks" })).status).toBe(200);
  });

  it("a maybe goes to the model check, which pauses when it says so", async () => {
    const me = await person({ admin: true });
    const { body } = await open(me.cookie);
    expect((await act(me.cookie, body.thread_id, { action: "send", text: "I feel so hopeless about this exam" })).status).toBe(200);
    risk = "true";
    const r = await act(me.cookie, body.thread_id, { action: "send", text: "everything is hopeless" });
    expect(r.body.crisis_resources).toBeTruthy();
    expect(calls.filter((c) => c.kind === "crisis")).toHaveLength(2);
  });

  it("draws the last reply again (the earlier one set aside) and rewrites your last message", async () => {
    const me = await person({ admin: true });
    const { body } = await open(me.cookie);
    replies = ["First take."];
    await act(me.cookie, body.thread_id, { action: "send", text: "what's your week been like" });
    replies = ["Second take, better."];
    const r = await act(me.cookie, body.thread_id, { action: "regenerate" });
    const shown = r.body.view.messages.map((m: Any) => m.text);
    expect(shown).toContain("Second take, better.");
    expect(shown).not.toContain("First take.");
    const all = await messages(body.thread_id);
    expect(all.find((m: Any) => m.text === "First take.").replaced_by).toBeTruthy();
    const redraw = calls.filter((c) => c.kind === "reply").at(-1)!.messages;
    expect(redraw[0].content).toContain("say something different instead: First take.");
    // The reply being drawn again isn't in the turns: the model answers the person's message afresh.
    expect(redraw.at(-1)).toEqual({ role: "user", content: "what's your week been like" });
    replies = ["Ooh, Lisbon."];
    const e = await act(me.cookie, body.thread_id, { action: "edit", text: "what's your week been like? I'm off to Lisbon" });
    const after = e.body.view.messages.map((m: Any) => m.text);
    expect(after.slice(-2)).toEqual(["what's your week been like? I'm off to Lisbon", "Ooh, Lisbon."]);
    expect(after).not.toContain("what's your week been like");
    const edited = calls.filter((c) => c.kind === "reply").at(-1)!.messages;
    expect(edited.at(-1)).toEqual({ role: "user", content: "what's your week been like? I'm off to Lisbon" });
    expect(JSON.stringify(edited.slice(1))).not.toContain("Second take");
  });

  it("a model that's down writes nothing; asking again answers", async () => {
    const me = await person({ admin: true });
    const { body } = await open(me.cookie);
    down = true;
    const r = await act(me.cookie, body.thread_id, { action: "send", text: "you there?" });
    expect(r.status).toBe(503);
    expect((await messages(body.thread_id)).at(-1)).toMatchObject({ role: "user", text: "you there?" });
    down = false;
    replies = ["Sorry, I'm here."];
    const again = await regenerate(t.db, me.id, body.thread_id);
    expect(again.ok && again.view.messages.at(-1)!.text).toBe("Sorry, I'm here.");
  });

  it("reports a reply, sets the reply length, and deletes the thread", async () => {
    const me = await person({ admin: true });
    const { body } = await open(me.cookie);
    const view = (await act(me.cookie, body.thread_id, { action: "length", length: "short" })).body.view;
    expect(view.reply_length).toBe("short");
    const reply = view.messages.find((m: Any) => m.role === "character");
    const rep = await act(me.cookie, body.thread_id, { action: "report", message_id: reply.id, reason: "out_of_character" });
    expect(rep.body.view.messages.find((m: Any) => m.id === reply.id).reported).toBe(true);
    await act(me.cookie, body.thread_id, { action: "send", text: "hey" });
    expect(calls.filter((c) => c.kind === "reply").at(-1)!.messages[0].content).toContain("Keep it short");
    // Someone else can't see or touch it.
    const other = await person({ admin: true });
    expect((await act(other.cookie, body.thread_id, { action: "send", text: "hi" })).status).toBe(404);
    const del = await deleteRoute(req(`/api/companion/${body.thread_id}`, null, me.cookie, "DELETE"), ctx(body.thread_id));
    expect(del.status).toBe(200);
    expect((await t.db.query(`select 1 from companion_messages where thread_id = $1`, [body.thread_id])).rows).toHaveLength(0);
  });

  it("goes with the account", async () => {
    const me = await person({ admin: true });
    const { body } = await open(me.cookie);
    await deleteAccount(t.db, me.id);
    expect((await t.db.query(`select 1 from companion_threads where id = $1`, [body.thread_id])).rows).toHaveLength(0);
    expect((await t.db.query(`select 1 from companion_messages where thread_id = $1`, [body.thread_id])).rows).toHaveLength(0);
  });

  it("never reaches the show: no memory, no texts, no dates", async () => {
    const me = await person({ admin: true });
    const { body } = await open(me.cookie);
    await act(me.cookie, body.thread_id, { action: "send", text: "My secret word is pomegranate" });
    for (const table of ["character_memory", "couple_texts", "episodes"]) {
      const { rows } = await t.db.query<Any>(`select count(*)::int as n from ${table} where ${table === "episodes" ? "character_a" : table === "couple_texts" ? "character_lo" : "character_id"} = $1`, [CAST.id]);
      expect(rows[0].n).toBe(0);
    }
  });
});

describe("what a companion remembers", () => {
  async function talked(n: number, cookie: string) {
    const { body } = await open(cookie);
    for (let i = 0; i < n; i++) await act(cookie, body.thread_id, { action: "send", text: `Message ${i}: my sister Maya is getting married in June` });
    return body.thread_id as string;
  }

  it("draws facts every few messages, skips ones it knows, and puts them in the prompt", async () => {
    const me = await person({ admin: true });
    const id = await talked(FACTS_EVERY - 1, me.cookie);
    factsReply = JSON.stringify({ facts: [{ kind: "people", text: "Their sister Maya is getting married in June." }, { kind: "likes", text: "They bake sourdough." }] });
    expect(await updateFacts(t.db, id, CAST.name, { complete: async () => factsReply })).toBe(0);
    await act(me.cookie, id, { action: "send", text: "one more" });
    expect(await updateFacts(t.db, id, CAST.name, { complete: async () => factsReply })).toBe(2);
    // Nothing new since: no call.
    expect(await updateFacts(t.db, id, CAST.name, { complete: async () => factsReply })).toBe(0);
    await act(me.cookie, id, { action: "send", text: "tell me about the wedding plans for Maya" });
    const prompt = calls.filter((c) => c.kind === "reply").at(-1)!.messages[0].content;
    expect(prompt).toContain("(people) Their sister Maya is getting married in June.");
    // A known fact again is skipped; a crisis or PG-breaking one never goes in.
    for (let i = 0; i < FACTS_EVERY; i++) await act(me.cookie, id, { action: "send", text: `More ${i}` });
    const again = JSON.stringify({ facts: [{ kind: "people", text: "Their sister Maya is getting married in June." }, { kind: "other", text: "They have felt suicidal lately." }, { kind: "work", text: "They started a new job at a bakery." }] });
    expect(await updateFacts(t.db, id, CAST.name, { complete: async () => again })).toBe(1);
  });

  it("keeps the person's edits and pins, and forgets on request", async () => {
    const me = await person({ admin: true });
    const id = await talked(FACTS_EVERY, me.cookie);
    await updateFacts(t.db, id, CAST.name, { complete: async () => JSON.stringify({ facts: [{ kind: "name", text: "Their name is Sam." }] }) });
    const get = async () => ((await (await memoryGet(req(`/api/companion/${id}/memory`, null, me.cookie, "GET"), ctx(id))).json()) as Any).facts;
    const facts = await get();
    expect(facts).toHaveLength(1);
    const edit = async (b: Record<string, unknown>) => memoryPost(req(`/api/companion/${id}/memory`, b, me.cookie), ctx(id));
    expect((await edit({ op: "edit", id: facts[0].id, text: "Their name is Sam, never Samuel." })).status).toBe(200);
    expect((await edit({ op: "edit", id: facts[0].id, text: "Let's have sex" })).status).toBe(400);
    expect((await edit({ op: "add", text: "They're allergic to cats." })).status).toBe(200);
    const now = await get();
    expect(now.find((f: Any) => f.text === "They're allergic to cats.")).toMatchObject({ pinned: true, edited: true });
    expect(now.find((f: Any) => f.text.startsWith("Their name is Sam,"))).toMatchObject({ edited: true });
    await act(me.cookie, id, { action: "send", text: "hi" });
    expect(calls.filter((c) => c.kind === "reply").at(-1)!.messages[0].content).toContain("Their name is Sam, never Samuel.");
    // Someone else's thread: not found.
    const other = await person({ admin: true });
    expect((await memoryPost(req(`/api/companion/${id}/memory`, { op: "forget_all" }, other.cookie), ctx(id))).status).toBe(404);
    expect((await edit({ op: "forget_all" })).status).toBe(200);
    expect(await get()).toHaveLength(0);
  });

  it("keeps a thread to its cap, never dropping what the person pinned or edited", async () => {
    const me = await person({ admin: true });
    const { body } = await open(me.cookie);
    const id = body.thread_id as string;
    await memoryPost(req(`/api/companion/${id}/memory`, { op: "add", text: "Keep this one always." }, me.cookie), ctx(id));
    for (let i = 0; i < FACTS_PER_THREAD + 5; i++) await t.db.query(`insert into companion_facts (id, thread_id, kind, text) values ($1, $2, 'other', $3)`, [crypto.randomUUID(), id, `Fact number ${i} about zebras`]);
    for (let i = 0; i < FACTS_EVERY; i++) await act(me.cookie, id, { action: "send", text: `m${i}` });
    await updateFacts(t.db, id, CAST.name, { complete: async () => JSON.stringify({ facts: [{ kind: "plans", text: "They're moving to Porto in spring." }] }) });
    const { rows } = await t.db.query<Any>(`select text from companion_facts where thread_id = $1`, [id]);
    expect(rows.length).toBe(FACTS_PER_THREAD);
    expect(rows.map((r: Any) => r.text)).toContain("Keep this one always.");
  });

  it("rolls the summary once enough has fallen out of the recent turns", async () => {
    const me = await person({ admin: true });
    const { body } = await open(me.cookie);
    const id = body.thread_id as string;
    const model = { complete: async () => '{"notes":"They talked about bread."}' };
    expect(await updateSummary(t.db, id, CAST.name, model)).toBe(false);
    for (let i = 0; i < Math.ceil(SUMMARY_EVERY / 3) + 8; i++) await act(me.cookie, id, { action: "send", text: `m${i}` });
    // An empty JSON answer changes nothing.
    expect(await updateSummary(t.db, id, CAST.name, { complete: async () => "{ }" })).toBe(false);
    expect(await updateSummary(t.db, id, CAST.name, model)).toBe(true);
    await act(me.cookie, id, { action: "send", text: "and now?" });
    expect(calls.filter((c) => c.kind === "reply").at(-1)!.messages[0].content).toContain("Earlier in your conversation: They talked about bread.");
  });
});

describe("a reply as messages", () => {
  it("splits on blank lines, strips names, quotes and actions, and keeps to three", () => {
    expect(replyBubbles(`${CAST.name}: "Hey you."\n\n*smiles* So, the plan?`, CAST.name)).toEqual(["Hey you.", "So, the plan?"]);
    expect(replyBubbles("a\n\nb\n\nc\n\nd", "X")).toEqual(["a", "b", "c d"]);
    expect(replyBubbles("   \n\n  ", "X")).toEqual([]);
  });
});

describe("what a request can't do", () => {
  it("refuses an empty or too-long message, an unknown action, and a bad report", async () => {
    const me = await person({ admin: true });
    const { body } = await open(me.cookie);
    expect((await act(me.cookie, body.thread_id, { action: "send", text: "   " })).body.error).toBe("empty");
    expect((await act(me.cookie, body.thread_id, { action: "send", text: "x".repeat(1500) })).body.error).toBe("too_long");
    // A body that isn't one of the actions is the app's usual invalid_request (422).
    expect((await act(me.cookie, body.thread_id, { action: "dance" })).body.error).toBe("invalid_request");
    expect((await act(me.cookie, body.thread_id, { action: "report", message_id: "m", reason: "boring" })).body.error).toBe("invalid_request");
    // Only the character's replies can be reported.
    await act(me.cookie, body.thread_id, { action: "send", text: "hi there" });
    const mine = (await t.db.query<Any>(`select id from companion_messages where thread_id = $1 and role = 'user'`, [body.thread_id])).rows[0];
    expect((await act(me.cookie, body.thread_id, { action: "report", message_id: mine.id, reason: "other" })).status).toBe(404);
    // Nothing to edit before you've said anything.
    const fresh = await open(me.cookie, HOUSE_CHARACTERS[1].id);
    expect((await act(me.cookie, fresh.body.thread_id, { action: "edit", text: "hello" })).body.error).toBe("nothing_to_edit");
    // An unknown thread is not found, for its own page and its memory too.
    expect((await act(me.cookie, "no-such-thread", { action: "send", text: "hi" })).status).toBe(404);
    expect((await memoryGet(req(`/api/companion/nope/memory`, null, me.cookie, "GET"), ctx("nope"))).status).toBe(404);
  });

  it("rate-limits talking, never the settings", async () => {
    const me = await person({ admin: true });
    const { body } = await open(me.cookie);
    for (let i = 0; i < COMPANION_LIMITS.perHour; i++) await t.db.query(`insert into rate_hits (bucket, key, at) values ('companion', $1, now())`, [me.id]);
    expect((await act(me.cookie, body.thread_id, { action: "send", text: "hi" })).status).toBe(429);
    expect((await act(me.cookie, body.thread_id, { action: "regenerate" })).status).toBe(429);
    expect((await act(me.cookie, body.thread_id, { action: "length", length: "long" })).status).toBe(200);
  });

  it("never opens someone else's character, even once open to everyone, nor a deleted owner's", async () => {
    vi.stubEnv("COMPANION_OPEN", "1");
    const me = await person();
    const other = await person();
    const theirs = await character(other.id);
    expect((await open(me.cookie, theirs)).status).toBe(404);
    const gone = await character("deleted", { companion_open: true });
    expect(await companionEligible(t.db, me.id, gone)).toBe(false);
    const list = (await (await listRoute(req("/api/companion", null, me.cookie, "GET"))).json()) as Any;
    expect([...list.cast, ...list.yours].some((x: Any) => x.id === theirs || x.id === gone)).toBe(false);
    // A thread whose character stopped being open to them can't be talked in.
    const opened = await character(other.id, { companion_open: true });
    const th = await open(me.cookie, opened);
    expect(th.status).toBe(201);
    await t.db.query(`update characters set companion_open = false where id = $1`, [opened]);
    expect((await act(me.cookie, th.body.thread_id, { action: "send", text: "hi" })).status).toBe(404);
  });
});

describe("the character's side", () => {
  it("never talks about hurting itself: a reply on the crisis list is drawn again, then deflected", async () => {
    const me = await person({ admin: true });
    const { body } = await open(me.cookie);
    replies = ["Honestly some days I want to kill myself", "I want to die, lol"];
    const r = await act(me.cookie, body.thread_id, { action: "send", text: "rough day?" });
    expect(r.status).toBe(200);
    const said = r.body.view.messages.at(-1).text;
    expect(said).not.toMatch(/kill|die/i);
    // The thread isn't paused: it's the person's words that pause it, never the character's.
    expect(r.body.view.paused).toBe(false);
  });

  it("draws the opener again when nothing's been said yet", async () => {
    const me = await person({ admin: true });
    const { body } = await open(me.cookie);
    replies = ["A brand new hello."];
    const r = await regenerate(t.db, me.id, body.thread_id);
    if (!r.ok) throw new Error(r.message);
    const said = r.view.messages.filter((m) => m.role === "character").map((m) => m.text);
    expect(said).toEqual(["A brand new hello."]);
    expect(calls.filter((c) => c.kind === "reply").at(-1)!.messages.at(-1)!.content).toMatch(/started talking with you for the first time/);
  });

  it("keeps the cost and the model it was written on with the reply", async () => {
    const me = await person({ admin: true });
    const { body } = await open(me.cookie);
    setCompanionModelForTests({
      async complete(_m, o) {
        o?.onModel?.("deepseek/deepseek-chat-v3.1");
        o?.onUsage?.({ model: "deepseek/deepseek-chat-v3.1", input: 900, cachedInput: 0, output: 40, thinking: 0, cost: 0.0004 });
        return "Noted.";
      },
    });
    await act(me.cookie, body.thread_id, { action: "send", text: "remember this" });
    const row = (await t.db.query<Any>(`select model, cost from companion_messages where thread_id = $1 and text = 'Noted.'`, [body.thread_id])).rows[0];
    expect(row.model).toBe("deepseek/deepseek-chat-v3.1");
    expect(Number(row.cost)).toBeCloseTo(0.0004);
  });
});

describe("the memory follow-up", () => {
  it("runs after the replies: facts once enough is said, then the summary, never throwing", async () => {
    const me = await person({ admin: true });
    const { body } = await open(me.cookie);
    const id = body.thread_id as string;
    factsReply = JSON.stringify({ facts: [{ kind: "work", text: "They just started a job at a bakery." }] });
    for (let i = 0; i < FACTS_EVERY; i++) await act(me.cookie, id, { action: "send", text: `bakery story ${i}` });
    await companionFollowUp(t.db, id);
    expect((await t.db.query<Any>(`select kind, text from companion_facts where thread_id = $1`, [id])).rows).toEqual([{ kind: "work", text: "They just started a job at a bakery." }]);
    expect(calls.filter((c) => c.kind === "summary")).toHaveLength(0);
    // A model that throws changes nothing, and nothing is thrown.
    setCompanionModelForTests({ complete: async () => Promise.reject(new Error("down")) });
    for (let i = 0; i < FACTS_EVERY; i++) await t.db.query(`insert into companion_messages (id, thread_id, role, text, created_at) values ($1, $2, 'user', 'more', now() + interval '1 hour')`, [crypto.randomUUID(), id]);
    await expect(companionFollowUp(t.db, id)).resolves.toBeUndefined();
    expect((await t.db.query(`select 1 from companion_facts where thread_id = $1`, [id])).rows).toHaveLength(1);
  });

  it("an unreadable answer draws nothing but still counts those messages as read", async () => {
    const me = await person({ admin: true });
    const { body } = await open(me.cookie);
    const id = body.thread_id as string;
    for (let i = 0; i < FACTS_EVERY; i++) await act(me.cookie, id, { action: "send", text: `m${i}` });
    expect(await updateFacts(t.db, id, CAST.name, { complete: async () => "no json here" })).toBe(0);
    let asked = 0;
    expect(await updateFacts(t.db, id, CAST.name, { complete: async () => (asked++, JSON.stringify({ facts: [{ kind: "x", text: "Something new." }] })) })).toBe(0);
    expect(asked).toBe(0);
  });

  it("puts pinned facts first, then the ones the conversation is about, at most FACTS_IN_PROMPT", async () => {
    const me = await person({ admin: true });
    const { body } = await open(me.cookie);
    const id = body.thread_id as string;
    const add = (text: string, pinned = false, kind = "other") =>
      t.db.query(`insert into companion_facts (id, thread_id, kind, text, pinned) values ($1, $2, $3, $4, $5)`, [crypto.randomUUID(), id, kind, text, pinned]);
    for (let i = 0; i < 12; i++) await add(`Filler fact ${i} about weather`);
    await add("They play the cello badly.", true);
    await add("Their dog Biscuit hates thunderstorms.");
    const facts = await factsForPrompt(t.db, id, "biscuit was scared again last night");
    expect(facts).toHaveLength(FACTS_IN_PROMPT);
    expect(facts[0].text).toBe("They play the cello badly.");
    expect(facts[1].text).toBe("Their dog Biscuit hates thunderstorms.");
    const used = (await t.db.query<Any>(`select uses from companion_facts where text = 'They play the cello badly.'`)).rows[0];
    expect(used.uses).toBe(1);
  });
});
