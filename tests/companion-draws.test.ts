// Alternates and Continue (the roleplay audit, 2026-11-17, item 4; lib/companion.ts swipeReply, continueReply): a
// regenerate keeps the earlier draws and the person can flip through them ("‹ 2 of 3 ›"), free; Continue has the
// character carry on without the person saying anything, counted like any reply.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as openRoute } from "@/app/api/companion/route";
import { POST as actRoute } from "@/app/api/companion/[id]/route";
import CompanionChat from "@/app/companion/[id]/CompanionChat";
import { setCompanionModelForTests } from "@/lib/companion";
import type { CompanionAllowance } from "@/lib/companion-plan";
import type { CompanionThreadView } from "@/lib/companion-shared";
import { deleteMessage } from "@/lib/companion-message-delete";
import { HOUSE_CHARACTERS } from "@/lib/house";
import type { ChatMessage } from "@/lib/model";
import { BASE_URL, signedInCookie, startTestDb, TEST_SESSION_SECRET } from "./helpers";

vi.mock("@/lib/sets", async (orig) => ({ ...((await orig()) as object), inBackground: () => {} }));
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
const PLACE = "rooftop_bar";
const NUMBERS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth"];

let calls: ChatMessage[][] = [];
let down = false;
/** How many messages the next text reply comes in. */
let bubbles = 1;
let n = 0;
beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("COMPANION_OPEN", "1");
  calls = [];
  down = false;
  bubbles = 1;
  n = 0;
  setCompanionModelForTests({
    async complete(messages) {
      const system = messages[0]?.content ?? "";
      if (system.startsWith("You check one message")) return `{"risk": false}`;
      if (!system.startsWith("You are ")) return "{}";
      if (down) throw new Error("model down");
      calls.push(messages);
      const word = NUMBERS[n++ % NUMBERS.length];
      if (system.includes("playing a scene together")) return JSON.stringify({ say: `Here's the ${word} thing I'd say across this table.`, do: `taps the ${word} coaster` });
      return JSON.stringify({ messages: Array.from({ length: bubbles }, (_, i) => `This is my ${word} text to you, part ${i + 1} of it.`) });
    },
  });
});
afterEach(() => {
  setCompanionModelForTests(null);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

const person = () => {
  const id = crypto.randomUUID();
  return { id, cookie: `${signedInCookie(id)}; bz_adult=1` };
};
const req = (path: string, body: unknown, cookie: string) => new Request(BASE_URL + path, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
async function open(cookie: string): Promise<string> {
  return ((await (await openRoute(req("/api/companion", { character_id: CAST.id }, cookie))).json()) as Any).thread_id;
}
async function act(cookie: string, id: string, body: Record<string, unknown>) {
  const res = await actRoute(req(`/api/companion/${id}`, body, cookie), { params: Promise.resolve({ id }) });
  return { status: res.status, body: (await res.json()) as Any };
}
const all = async (id: string) => (await t.db.query<Any>(`select id, role, text, draw, replaced_by from companion_messages where thread_id = $1 and role = 'character' order by created_at, id`, [id])).rows;
const usage = async (userId: string) => (await t.db.query<{ replies: number }>(`select coalesce(sum(replies), 0)::int as replies from companion_usage where user_id = $1`, [userId])).rows[0].replies;
const last = (view: Any) => view.messages.at(-1);
const cue = () => calls.at(-1)!.at(-1)!.content;

describe("alternates: flipping through regenerated replies", () => {
  it("keeps every draw of the newest reply, says how many and which is showing, and flips between them in the order drawn", async () => {
    const me = person();
    const id = await open(me.cookie);
    const one = await act(me.cookie, id, { action: "send", text: "Tell me something." });
    expect(one.body.view.draws).toBeUndefined();
    const first = last(one.body.view).text;
    const two = await act(me.cookie, id, { action: "regenerate" });
    expect(two.body.view.draws).toEqual({ count: 2, showing: 2 });
    const second = last(two.body.view).text;
    const three = await act(me.cookie, id, { action: "regenerate" });
    expect(three.body.view.draws).toEqual({ count: 3, showing: 3 });
    const third = last(three.body.view).text;
    expect(new Set([first, second, third]).size).toBe(3);

    // Free: nothing is drawn and nothing is counted.
    const drawn = calls.length;
    const counted = await usage(me.id);
    const back = await act(me.cookie, id, { action: "swipe", to: "prev" });
    expect(back.status).toBe(200);
    expect(back.body.view.draws).toEqual({ count: 3, showing: 2 });
    expect(last(back.body.view).text).toBe(second);
    const backAgain = await act(me.cookie, id, { action: "swipe", to: "prev" });
    expect(backAgain.body.view.draws).toEqual({ count: 3, showing: 1 });
    expect(last(backAgain.body.view).text).toBe(first);
    // No further than the first or the newest.
    expect((await act(me.cookie, id, { action: "swipe", to: "prev" })).body).toMatchObject({ error: "no_more" });
    const forward = await act(me.cookie, id, { action: "swipe", to: "next" });
    expect(forward.body.view.draws).toEqual({ count: 3, showing: 2 });
    await act(me.cookie, id, { action: "swipe", to: "next" });
    expect((await act(me.cookie, id, { action: "swipe", to: "next" })).body).toMatchObject({ error: "no_more" });
    expect(calls.length).toBe(drawn);
    expect(await usage(me.id)).toBe(counted);

    // Exactly one draw is ever current, and every other points at it.
    await act(me.cookie, id, { action: "swipe", to: "prev" });
    const rows = (await all(id)).filter((m) => [first, second, third].includes(m.text));
    const current = rows.filter((m) => m.replaced_by === null);
    expect(current.map((m) => m.text)).toEqual([second]);
    expect(rows.filter((m) => m.replaced_by !== null).every((m) => m.replaced_by === current[0].draw)).toBe(true);
    // Only one of them is in the thread, where the reply was.
    const view = (await act(me.cookie, id, { action: "length", length: "normal" })).body.view;
    expect(view.messages.filter((m: Any) => [first, second, third].includes(m.text)).map((m: Any) => m.text)).toEqual([second]);
    expect(view.messages.at(-2)).toMatchObject({ role: "user", text: "Tell me something." });

    // Drawing again from the one showing keeps them all: four now, the new one current.
    const four = await act(me.cookie, id, { action: "regenerate" });
    expect(four.body.view.draws).toEqual({ count: 4, showing: 4 });
    const fourth = last(four.body.view).text;
    const allFour = (await all(id)).filter((m) => [first, second, third, fourth].includes(m.text));
    const now = allFour.find((m) => m.replaced_by === null)!;
    expect(now.text).toBe(fourth);
    expect(allFour.filter((m) => m.id !== now.id).every((m) => m.replaced_by === now.draw)).toBe(true);
  });

  it("only the newest reply, and only while nothing has been said after it", async () => {
    const me = person();
    const id = await open(me.cookie);
    await act(me.cookie, id, { action: "send", text: "Tell me something." });
    // One draw: nothing to flip to.
    expect((await act(me.cookie, id, { action: "swipe", to: "prev" })).body).toMatchObject({ error: "one_draw" });
    await act(me.cookie, id, { action: "regenerate" });
    // The person says something: the earlier reply's draws are no longer offered, and a swipe is refused.
    const next = await act(me.cookie, id, { action: "send", text: "And another thing." });
    expect(next.body.view.draws).toBeUndefined();
    const before = (await all(id)).map((m) => `${m.id}:${m.replaced_by}`);
    const refused = await act(me.cookie, id, { action: "swipe", to: "prev" });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe("one_draw");
    expect((await all(id)).map((m) => `${m.id}:${m.replaced_by}`)).toEqual(before);
    // A scene starting after it does the same.
    await act(me.cookie, id, { action: "regenerate" });
    const scene = await act(me.cookie, id, { action: "scene", place: PLACE });
    expect(scene.body.view.draws).toBeUndefined();
    // Paused: refused, like a regenerate.
    await t.db.query(`update companion_threads set paused_at = now() where id = $1`, [id]);
    expect((await act(me.cookie, id, { action: "swipe", to: "prev" })).body.error).toBe("paused");
  });

  it("a reply in several messages is one draw; an edit's old reply is never an alternate; deleting the reply takes its draws", async () => {
    const me = person();
    const id = await open(me.cookie);
    bubbles = 2;
    const one = await act(me.cookie, id, { action: "send", text: "Tell me two things." });
    const firstTexts = one.body.view.messages.slice(-2).map((m: Any) => m.text);
    bubbles = 3;
    const two = await act(me.cookie, id, { action: "regenerate" });
    expect(two.body.view.draws).toEqual({ count: 2, showing: 2 });
    expect(two.body.view.messages.slice(-3).every((m: Any) => m.role === "character")).toBe(true);
    const back = await act(me.cookie, id, { action: "swipe", to: "prev" });
    expect(back.body.view.messages.slice(-2).map((m: Any) => m.text)).toEqual(firstTexts);
    expect(back.body.view.messages.at(-3)).toMatchObject({ role: "user" });
    expect(back.body.view.draws).toEqual({ count: 2, showing: 1 });

    // Rewriting their message answers other words: what answered the old ones is set aside for good.
    bubbles = 1;
    const edited = await act(me.cookie, id, { action: "edit", text: "Tell me one thing instead." });
    expect(edited.status).toBe(200);
    expect(edited.body.view.draws).toBeUndefined();
    expect((await act(me.cookie, id, { action: "swipe", to: "prev" })).body.error).toBe("one_draw");
    // And drawing again from here counts two, not the ones from before the edit.
    const again = await act(me.cookie, id, { action: "regenerate" });
    expect(again.body.view.draws).toEqual({ count: 2, showing: 2 });

    // Deleting the reply deletes every draw of it (lib/companion-message-delete.ts follows replaced_by).
    const shown = last(again.body.view);
    const hidden = (await all(id)).filter((m) => m.replaced_by !== null).length;
    expect(hidden).toBeGreaterThan(0);
    expect((await deleteMessage(t.db, me.id, id, shown.id)).ok).toBe(true);
    expect((await all(id)).filter((m) => m.replaced_by !== null)).toHaveLength(0);
  });

  it("in a scene too, with what they do beside what they say", async () => {
    const me = person();
    const id = await open(me.cookie);
    const opened = await act(me.cookie, id, { action: "scene", place: PLACE });
    const first = last(opened.body.view);
    const again = await act(me.cookie, id, { action: "regenerate" });
    expect(again.body.view.draws).toEqual({ count: 2, showing: 2 });
    const back = await act(me.cookie, id, { action: "swipe", to: "prev" });
    expect(last(back.body.view)).toMatchObject({ text: first.text, action: first.action, scene: PLACE });
  });
});

describe("Continue: they carry on without you", () => {
  it("is one more reply, counted like any, after the one before it; a regenerate then redraws only that one", async () => {
    const me = person();
    const id = await open(me.cookie);
    const sent = await act(me.cookie, id, { action: "send", text: "Tell me something." });
    const reply = last(sent.body.view).text;
    const counted = await usage(me.id);
    const more = await act(me.cookie, id, { action: "continue" });
    expect(more.status).toBe(200);
    expect(await usage(me.id)).toBe(counted + 1);
    expect(more.body.view.messages.slice(-2).map((m: Any) => m.role)).toEqual(["character", "character"]);
    expect(more.body.view.messages.at(-2).text).toBe(reply);
    // Texting: one more short thought, and the reply before it is the last thing the model read.
    expect(cue()).toBe("(They're letting you carry on. Add one more short thought of your own, a line or two: something new, not a question to fill the silence.)");
    expect(calls.at(-1)!.at(-2)).toMatchObject({ role: "assistant", content: reply });
    // Drawing again redraws the continuation alone, on the same cue; the reply before it stays.
    const continued = last(more.body.view).text;
    const again = await act(me.cookie, id, { action: "regenerate" });
    expect(again.body.view.messages.at(-2).text).toBe(reply);
    expect(last(again.body.view).text).not.toBe(continued);
    expect(again.body.view.draws).toEqual({ count: 2, showing: 2 });
    expect(cue()).toContain("They're letting you carry on.");
    // Rewriting their message replaces everything said since, the continuation included.
    const edited = await act(me.cookie, id, { action: "edit", text: "Tell me something else." });
    const since = edited.body.view.messages.slice(edited.body.view.messages.findLastIndex((m: Any) => m.role === "user") + 1);
    expect(since).toHaveLength(1);
    expect(since[0].text).not.toBe(reply);
  });

  it("in a scene it moves the scene on", async () => {
    const me = person();
    const id = await open(me.cookie);
    await act(me.cookie, id, { action: "scene", place: PLACE });
    const more = await act(me.cookie, id, { action: "continue" });
    expect(more.status).toBe(200);
    expect(cue()).toBe("(They're letting you carry on. Move the scene on yourself: something happens, or you do the next thing. Don't repeat what you just said or did, and don't ask what they want to do.)");
    expect(more.body.view.messages.slice(-2).every((m: Any) => m.role === "character" && m.scene === PLACE)).toBe(true);
  });

  it("is given back when none comes, and refused while the thread is paused, like a send", async () => {
    const me = person();
    const id = await open(me.cookie);
    await act(me.cookie, id, { action: "send", text: "Tell me something." });
    const counted = await usage(me.id);
    const written = (await all(id)).length;
    down = true;
    const failed = await act(me.cookie, id, { action: "continue" });
    expect(failed.status).toBe(503);
    expect(await usage(me.id)).toBe(counted);
    expect((await all(id)).length).toBe(written);
    down = false;
    await t.db.query(`update companion_threads set paused_at = now() where id = $1`, [id]);
    const paused = await act(me.cookie, id, { action: "continue" });
    expect(paused.status).toBe(409);
    expect(paused.body.error).toBe("paused");
    expect(await usage(me.id)).toBe(counted);
    expect((await all(id)).length).toBe(written);
  });

  it("with nothing of theirs to carry on from, it's simply the reply that's due", async () => {
    const me = person();
    const id = await open(me.cookie);
    // The model was down when they spoke: Continue answers them.
    down = true;
    await act(me.cookie, id, { action: "send", text: "Are you there?" });
    down = false;
    const answered = await act(me.cookie, id, { action: "continue" });
    expect(answered.status).toBe(200);
    expect(calls.at(-1)!.at(-1)).toMatchObject({ role: "user", content: "Are you there?" });
    expect(last(answered.body.view).role).toBe("character");
  });
});

describe("in the chat", () => {
  const allowance = { unlimited: false, left: 12, per_day: 30, resets_at: "2026-11-18T00:00:00Z", guest: false, plan: "none", on_sale: true, price: "$9 a month" } as unknown as CompanionAllowance;
  const message = (over: Record<string, unknown>) => ({ at: "2026-11-17T00:00:00Z", action: null, marker: null, roleplay: null, voice: null, scene: null, reported: false, ...over });
  const base: CompanionThreadView = {
    id: "t1",
    character: { id: "c1", name: "Mara Quinn", portrait: null, hue: 200, house: true, yours: false, pronouns: "she/her" },
    messages: [],
    reply_length: "normal",
    texts: false,
    scene: null,
    roleplay: null,
    paused: false,
    facts: 0,
  };
  const render = (view: CompanionThreadView) => renderToStaticMarkup(createElement(CompanionChat, { initial: view, initialCrisis: null, initialAllowance: allowance, signedIn: true }));
  const actions = (html: string) => html.slice(html.indexOf('class="companion-actions"'), html.indexOf('id="companion-line"'));

  it("a story reply is prose, not a bubble: what's said and the narration around it are marked apart, and the stage shows the first thing said", () => {
    const text = 'Mara slid the menu across the bar. "You made it," she said, and tapped it twice.\n\nThe awning still dripped. "Order for both of us."';
    const html = render({
      ...base,
      scene: "rooftop_bar",
      messages: [message({ id: "m1", role: "system", text: "Rooftop bar: a scene you're both imagining.", marker: "scene", scene: "rooftop_bar" }), message({ id: "m2", role: "character", text, scene: "rooftop_bar", form: "story" })] as unknown as CompanionThreadView["messages"],
    });
    const story = html.slice(html.indexOf('class="chat-story"'));
    expect(html).toContain('class="chat-story" data-story="true"');
    expect(story.match(/<p>/g)?.length).toBeGreaterThanOrEqual(2);
    expect(story).toContain('<span class="chat-story-told">Mara slid the menu across the bar. </span><span class="chat-story-said">&quot;You made it,&quot;</span><span class="chat-story-told"> she said, and tapped it twice.</span>');
    // No bubble holds the prose.
    expect(html).not.toMatch(/class="chat-bubble">[^<]*Mara slid the menu/);
    // The stage has the first thing said, not the narration.
    const stage = html.slice(html.indexOf('class="companion-stage"'), html.indexOf('class="companion-scroll"'));
    expect(stage).toContain("You made it,");
    expect(stage).not.toContain("slid the menu");
    // In a scene, Continue is beside the composer.
    expect(actions(html)).toContain("Continue");
  });

  it("shows the draws beside Regenerate with names a screen reader can say, and Continue in the menu while texting", () => {
    const messages = [message({ id: "m1", role: "user", text: "Tell me something." }), message({ id: "m2", role: "character", text: "Here's the second thing." })] as unknown as CompanionThreadView["messages"];
    const html = render({ ...base, messages, draws: { count: 3, showing: 2 } });
    const bar = actions(html);
    expect(bar).toContain('aria-label="Mara&#x27;s replies to choose from"');
    expect(bar).toContain('aria-label="Show the reply before this one"');
    expect(bar).toContain('aria-label="Show the reply after this one"');
    expect(bar).toContain("2 of 3");
    expect(bar).toContain("↻ Another reply");
    // At either end the button that can't go further is off.
    const atEnd = actions(render({ ...base, messages, draws: { count: 3, showing: 3 } }));
    expect(atEnd).toMatch(/disabled=""[^>]*aria-label="Show the reply after this one"/);
    expect(atEnd).not.toMatch(/disabled=""[^>]*aria-label="Show the reply before this one"/);
    // One draw: no control at all.
    expect(actions(render({ ...base, messages }))).not.toContain("replies to choose from");
    // Texting: Continue is in the Settings menu, not on the main surface.
    expect(bar).not.toContain("Continue");
    expect(html).toContain("Let Mara carry on");
    // Their word last: nothing to carry on from, so no Continue; and no draws to flip.
    const waiting = render({ ...base, messages: messages.slice(0, 1), draws: undefined });
    expect(waiting).not.toContain("Let Mara carry on");
  });
});
