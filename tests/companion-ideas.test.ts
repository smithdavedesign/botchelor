// Ideas for what to say under a companion's newest reply (lib/companion-ideas.ts; docs/companions.md, "Ideas for what
// to say"): three lines the person could send next, drawn by the companion's own writer, held to the checks their own
// message gets, kept on the reply's row, drawn again three times at most, and never counted as a reply.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as openRoute } from "@/app/api/companion/route";
import { POST as actRoute } from "@/app/api/companion/[id]/route";
import { POST as ideasRoute } from "@/app/api/companion/[id]/ideas/route";
import CompanionChat from "@/app/companion/[id]/CompanionChat";
import { signSession } from "@/lib/auth";
import { setCompanionModelForTests } from "@/lib/companion";
import {
  companionIdeas,
  companionIdeasOn,
  drawIdeas,
  IDEA_DRAWS,
  IDEA_MAX,
  ideaOk,
  ideasPrompt,
  storedIdeas,
  threadLines,
  type IdeasThread,
} from "@/lib/companion-ideas";
import { END_SLACK_PX, endWasInView, followEnd, IDEA_TONES, ideasReplyFor } from "@/lib/companion-ideas-shared";
import { deleteMessage } from "@/lib/companion-message-delete";
import type { CompanionAllowance } from "@/lib/companion-plan";
import { SCENE_PLACES, type CompanionMessageView, type CompanionThreadView } from "@/lib/companion-shared";
import { crisisIntent } from "@/lib/crisis";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { detectLanguage } from "@/lib/language";
import type { Model } from "@/lib/model";
import { maybeCrisis } from "@/lib/step-in";
import { venueName } from "@/lib/venues";
import { BASE_URL, signedInCookie, startTestDb, TEST_SESSION_SECRET } from "./helpers";

vi.mock("@/lib/sets", async (orig) => ({ ...((await orig()) as object), inBackground: () => {} }));
// A client component outside the app router: the router it asks for (to leave after a delete) is a stub here.
vi.mock("next/navigation", async (original) => ({ ...((await original()) as object), useRouter: () => ({ push: () => {}, refresh: () => {} }), usePathname: () => "/companion/t1" }));

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const CAST = HOUSE_CHARACTERS[0];
const REPLY = "Long day at the shop. Someone tried to return a cactus because it was 'too spiky'. How was yours?";
const THREE = { warm: "Mine was fine, but I like hearing about yours more.", playful: "Was the cactus okay? Asking for a friend.", bold: "Tell me over coffee on Saturday?" };

/* ------------------------------------------------- the page's reads ------------------------------------------------- */

type Line = Pick<CompanionMessageView, "id" | "role" | "marker" | "offers" | "question">;
const line = (id: string, role: Line["role"], extra: Partial<Line> = {}): Line => ({ id, role, marker: null, ...extra });

describe("which message the ideas go under (ideasReplyFor)", () => {
  it("is the newest message when it's the character's, the last bubble of a reply in several", () => {
    expect(ideasReplyFor([line("a", "user"), line("b", "character")])).toBe("b");
    expect(ideasReplyFor([line("a", "user"), line("b", "character"), line("c", "character")])).toBe("c");
    // The opener of a new thread, before they've said a word: the blank box is what these are for.
    expect(ideasReplyFor([line("n", "system"), line("o", "character")])).toBe("o");
  });

  it("passes over the AI notice, and is nothing when the newest word is theirs or a scene's line", () => {
    expect(ideasReplyFor([line("a", "character"), line("n", "system")])).toBe("a");
    expect(ideasReplyFor([line("a", "character"), line("b", "user")])).toBeNull();
    expect(ideasReplyFor([line("a", "character"), line("s", "system", { marker: "scene" })])).toBeNull();
    expect(ideasReplyFor([line("a", "character"), line("s", "system", { marker: "texting" })])).toBeNull();
    expect(ideasReplyFor([])).toBeNull();
  });

  it("is nothing when the reply carries a menu or an answer box of its own: the question is already the menu", () => {
    const offers = { kinds: ["advice"] } as unknown as Line["offers"];
    const question = { field: "job" } as unknown as Line["question"];
    expect(ideasReplyFor([line("a", "user"), line("b", "character", { offers })])).toBeNull();
    expect(ideasReplyFor([line("a", "user"), line("b", "character", { offers }), line("c", "character")])).toBeNull();
    expect(ideasReplyFor([line("a", "user"), line("b", "character", { question })])).toBeNull();
    // A menu on an earlier reply, answered since, is nothing to do with the newest.
    expect(ideasReplyFor([line("a", "character", { offers }), line("b", "user"), line("c", "character")])).toBe("c");
  });
});

describe("where the thread scrolls when they arrive (followEnd)", () => {
  // 1000px of thread in a 400px box, read at its end (scrollTop 600), then 150px of ideas added under it.
  const atEnd = { scrollTop: 600, clientHeight: 400, scrollHeight: 1150 };

  it("follows the end for someone reading it there, a line or two up included", () => {
    expect(endWasInView(atEnd, 150)).toBe(true);
    expect(endWasInView({ ...atEnd, scrollTop: 600 - END_SLACK_PX }, 150)).toBe(true);
    expect(followEnd(atEnd, 150)).toBe(750);
  });

  it("leaves someone who has scrolled up to read where they are, and never scrolls up", () => {
    expect(endWasInView({ ...atEnd, scrollTop: 200 }, 150)).toBe(false);
    expect(followEnd({ ...atEnd, scrollTop: 200 }, 150)).toBeNull();
    expect(followEnd(atEnd, 0)).toBeNull();
    expect(followEnd(atEnd, -150)).toBeNull();
  });

  it("never so far that the reply being read starts out of view (a long one, the keyboard up)", () => {
    // The reply starts at 680: the thread goes as far as that and no further.
    expect(followEnd(atEnd, 150, 680)).toBe(680);
    // Its start is already above the box's top: it stays put rather than going back up.
    expect(followEnd(atEnd, 150, 500)).toBeNull();
    // A short reply leaves room for all of them.
    expect(followEnd(atEnd, 150, 900)).toBe(750);
  });
});

/* ------------------------------------------------- the module, pure ------------------------------------------------- */

describe("an idea's checks (ideaOk)", () => {
  it("takes a short plain line, in either register", () => {
    expect(ideaOk("Was the cactus okay? Asking for a friend.")).toBe(true);
    expect(ideaOk(`I lean on the counter. "So, what's good here?"`)).toBe(true);
  });

  it("drops the long, the emoji and the markup", () => {
    expect(ideaOk("a".repeat(IDEA_MAX + 1))).toBe(false);
    expect(ideaOk("Tell me more 😍")).toBe(false);
    expect(ideaOk("*leans in* Tell me more")).toBe(false);
    expect(ideaOk("")).toBe(false);
  });

  it("drops what their own message would be stopped for: the crisis list, a maybe, the PG line", () => {
    const crisis = "Honestly I want to kill myself today";
    expect(crisisIntent(crisis)).toBe(true);
    expect(ideaOk(crisis)).toBe(false);
    const maybe = "I can't take it anymore, honestly";
    expect(maybeCrisis(maybe)).toBe(true);
    expect(ideaOk(maybe)).toBe(false);
    expect(ideaOk("let's have sex")).toBe(false);
    expect(ideaOk("schoolgirl outfit tonight?")).toBe(false);
  });

  it("drops one that isn't in English (the checks read English)", () => {
    const es = "Hola, ¿cómo estás? Me gusta mucho la playa y el café.";
    expect(detectLanguage(es)).toBe("es");
    expect(ideaOk(es)).toBe(false);
  });
});

describe("the prompt", () => {
  const base = { name: "Rosa Alvarez", place: null, roleplay: null } as const;

  it("asks for text messages while texting, and three tones in a JSON object", () => {
    const p = ideasPrompt({ ...base, register: "text" });
    expect(p.startsWith("You help one person")).toBe(true);
    expect(p).toContain("They're texting.");
    expect(p).toContain("no quotation marks");
    for (const tone of IDEA_TONES) expect(p).toContain(`"${tone}"`);
    expect(p).toContain("Forward, never explicit.");
    expect(p).toContain("Keep it PG");
    expect(p).toContain(`{"warm": "...", "playful": "...", "bold": "..."}`);
    expect(p).not.toContain("double quotes");
  });

  it("asks for something said or done there in a scene, and keeps to its roleplay", () => {
    const p = ideasPrompt({ ...base, register: "scene", place: "the night market", roleplay: { title: "Lost Luggage", part: "the traveller" } });
    expect(p).toContain("in a scene together (the night market)");
    expect(p).toContain("what they say out loud in double quotes");
    expect(p).toContain("Lost Luggage, the person as the traveller: stay in it.");
    expect(p).not.toContain("They're texting.");
  });
});

describe("the thread as the draw reads it (threadLines)", () => {
  type Row = Parameters<typeof threadLines>[0][number];
  const row = (role: Row["role"], text: string, extra: Partial<Row> = {}): Row => ({ role, text, action: null, marker: null, scene: null, via: "text", ...extra });

  it("reads the newest rows oldest first, back to the scene's line that began them, and skips the AI notice", () => {
    const place = SCENE_PLACES[0];
    const lines = threadLines(
      [
        row("character", "This place smells like rain.", { scene: place, action: "shakes out an umbrella" }),
        row("user", "Glad you made it"),
        row("system", "Rosa is an AI character."),
        row("system", "A scene", { marker: "scene", scene: place }),
        row("user", "this is before the scene"),
      ],
      "Rosa Alvarez",
    );
    expect(lines).toEqual([`(They start a scene: ${venueName(place)}.)`, "The person: Glad you made it", "Rosa: (shakes out an umbrella) This place smells like rain."]);
  });

  it("never reads a text's tag as something done, names a photo, and keeps a story reply's end", () => {
    const story = `${"The lights dim and the room goes quiet. ".repeat(20)}"Your turn," she says.`;
    const lines = threadLines(
      [
        row("character", story, { scene: SCENE_PLACES[0] }),
        row("character", "the two of them at the pier", { via: "photo" }),
        row("character", "Your date aired!", { action: "after_date:0b0c7a52-1d1e-4f6a-9a53-3f4de2a1c001" }),
      ].reverse(),
      "Rosa Alvarez",
    );
    expect(lines[0].startsWith("Rosa: …")).toBe(true);
    expect(lines[0].endsWith(`"Your turn," she says.`)).toBe(true);
    expect(lines[1]).toBe("Rosa sends a photo: the two of them at the pier");
    expect(lines[2]).toBe("Rosa: Your date aired!");
  });
});

describe("what's kept on a row (storedIdeas) and the switch", () => {
  it("reads back only ideas with a known tone and some words", () => {
    expect(storedIdeas(null)).toEqual([]);
    expect(storedIdeas({ warm: "x" })).toEqual([]);
    expect(
      storedIdeas([{ tone: "warm", text: " Hi " }, { tone: "sultry", text: "no" }, { tone: "bold", text: "" }, null, { tone: "playful", text: "Race you" }]),
    ).toEqual([
      { tone: "warm", text: "Hi" },
      { tone: "playful", text: "Race you" },
    ]);
  });

  it("is on unless COMPANION_IDEAS is 0", () => {
    expect(companionIdeasOn({})).toBe(true);
    expect(companionIdeasOn({ COMPANION_IDEAS: "1" })).toBe(true);
    expect(companionIdeasOn({ COMPANION_IDEAS: " 0 " })).toBe(false);
  });
});

describe("one draw (drawIdeas)", () => {
  const thread: IdeasThread = { name: "Rosa Alvarez", register: "text", place: null, roleplay: null, lines: ["Rosa: Hey you"] };
  const answering = (raw: string | (() => never)): Model => ({ complete: async () => (typeof raw === "string" ? raw : raw()) });

  it("keeps the three in tone order, a model's quotes around a text taken off", async () => {
    const ideas = await drawIdeas(answering(JSON.stringify({ bold: THREE.bold, warm: `"${THREE.warm}"`, playful: THREE.playful })), thread);
    expect(ideas).toEqual([
      { tone: "warm", text: THREE.warm },
      { tone: "playful", text: THREE.playful },
      { tone: "bold", text: THREE.bold },
    ]);
  });

  it("drops one that fails a check, repeats another, or was shown before; none when the model fails", async () => {
    const raw = JSON.stringify({ warm: "let's have sex", playful: THREE.playful, bold: THREE.playful.toUpperCase() });
    expect(await drawIdeas(answering(raw), thread)).toEqual([{ tone: "playful", text: THREE.playful }]);
    expect(await drawIdeas(answering(JSON.stringify(THREE)), thread, [THREE.warm, THREE.bold])).toEqual([{ tone: "playful", text: THREE.playful }]);
    expect(await drawIdeas(answering("not json at all"), thread)).toEqual([]);
    expect(
      await drawIdeas(
        answering(() => {
          throw new Error("down");
        }),
        thread,
      ),
    ).toEqual([]);
  });
});

describe("the page", () => {
  const view: CompanionThreadView = {
    id: "t1",
    character: { id: "c1", name: "Ambrose Fenn", portrait: null, hue: 200, house: false, yours: false, pronouns: "he/him" },
    messages: [
      { id: "m1", role: "character", text: "Hello. Sorry. I was in the middle of a chapter.", at: "2026-11-24T00:00:01Z", action: null, marker: null, roleplay: null, voice: null, scene: null },
    ] as unknown as CompanionThreadView["messages"],
    reply_length: "normal",
    texts: false,
    scene: null,
    roleplay: null,
    paused: false,
    facts: 0,
  };
  const allowance = { unlimited: false, left: 12, per_day: 30, resets_at: "2026-11-25T00:00:00Z", guest: false, plan: "none", on_sale: true, price: "$9.99 a month" } as unknown as CompanionAllowance;
  const render = (ideas: boolean) => renderToStaticMarkup(createElement(CompanionChat, { initial: view, initialCrisis: null, initialAllowance: allowance, signedIn: true, ideas }));

  it("has the switch in the thread's Settings, and a place for the ideas under the thread, when they're on", () => {
    const html = render(true);
    expect(html).toContain("data-companion-ideas-switch");
    expect(html).toContain("💡 Ideas for what to say");
    expect(html).toContain('class="companion-ideas-slot"');
    // Nothing is asked for until the page is in the browser and has read this device's choice.
    expect(html).not.toContain("data-companion-ideas=");
  });

  it("has neither the switch nor any ideas with COMPANION_IDEAS=0", () => {
    const html = render(false);
    expect(html).not.toContain("data-companion-ideas-switch");
    expect(html).not.toContain("Ideas for what to say");
  });
});

/* ------------------------------------------------- with a database ------------------------------------------------- */

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});

/** The ideas prompts the scripted writer was sent (system, user), and what it answers them with next. */
let asked: { system: string; user: string }[] = [];
let answers: string[] = [];

beforeEach(async () => {
  await t.reset();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("COMPANION_OPEN", "1");
  vi.stubEnv("COMPANION_IDEAS", "");
  asked = [];
  answers = [];
  setCompanionModelForTests({
    async complete(messages) {
      const system = messages[0]?.content ?? "";
      if (system.startsWith("You check one message")) return `{"risk": false}`;
      if (system.startsWith("You help one person")) {
        asked.push({ system, user: messages[1]?.content ?? "" });
        return answers.shift() ?? JSON.stringify(THREE);
      }
      if (system.startsWith("You are ")) return JSON.stringify({ messages: [REPLY], say: REPLY, do: "wipes the counter" });
      return "{}";
    },
  });
});
afterEach(() => {
  setCompanionModelForTests(null);
  vi.unstubAllEnvs();
});

const FROM = "203.0.113.41";
const req = (path: string, body: unknown, cookie: string) =>
  new Request(BASE_URL + path, { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": FROM, cookie }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const member = () => {
  const uid = crypto.randomUUID();
  return { uid, cookie: `${signedInCookie(uid)}; bz_adult=1` };
};
const guest = () => {
  const uid = crypto.randomUUID();
  return { uid, cookie: `bz_sess=${signSession({ uid, authenticated: false })}; bz_adult=1` };
};

/** Opens a thread with a house character: its opener is the newest message. */
async function thread(cookie: string): Promise<string> {
  const res = await openRoute(req("/api/companion", { character_id: CAST.id }, cookie));
  expect(res.status).toBeLessThan(300);
  return ((await res.json()) as Any).thread_id as string;
}
async function act(cookie: string, id: string, body: Record<string, unknown>): Promise<Any> {
  const res = await actRoute(req(`/api/companion/${id}`, body, cookie), ctx(id));
  return { status: res.status, ...((await res.json()) as Any) };
}
async function ideas(cookie: string, id: string, body: Record<string, unknown> = {}): Promise<{ status: number; body: Any }> {
  const res = await ideasRoute(req(`/api/companion/${id}/ideas`, body, cookie), ctx(id));
  return { status: res.status, body: await res.json() };
}
const newestId = async (id: string) =>
  (
    await t.db.query<{ id: string }>(
      `select id from companion_messages where thread_id = $1 and replaced_by is null and (role <> 'system' or marker is not null) order by created_at desc, id desc limit 1`,
      [id],
    )
  ).rows[0].id;
const kept = async (messageId: string) => (await t.db.query<{ ideas: unknown; idea_draws: number | null }>(`select ideas, idea_draws from companion_messages where id = $1`, [messageId])).rows[0];
const replies = async (uid: string) => (await t.db.query<{ n: number }>(`select coalesce(sum(replies), 0)::int as n from companion_usage where user_id = $1`, [uid])).rows[0].n;

describe("POST /api/companion/:id/ideas", () => {
  it("draws three under the character's newest message, keeps them on its row, and counts no reply", async () => {
    const me = member();
    const id = await thread(me.cookie);
    const opener = await newestId(id);
    const before = await replies(me.uid);
    const r = await ideas(me.cookie, id);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      for: opener,
      ideas: [
        { tone: "warm", text: THREE.warm },
        { tone: "playful", text: THREE.playful },
        { tone: "bold", text: THREE.bold },
      ],
      more: true,
    });
    expect(await kept(opener)).toEqual({ ideas: r.body.ideas, idea_draws: 1 });
    expect(await replies(me.uid)).toBe(before);
    // The draw read the thread (the character's opener) and was told it's texting.
    expect(asked).toHaveLength(1);
    expect(asked[0].system).toContain("They're texting.");
    expect(asked[0].user).toContain(`${CAST.name.split(/\s+/)[0]}: `);
    expect(asked[0].user).toContain("cactus");
  });

  it("shows the kept ones on a reload, and draws others three times a reply at most", async () => {
    const me = member();
    const id = await thread(me.cookie);
    const first = await ideas(me.cookie, id);
    expect((await ideas(me.cookie, id)).body).toEqual(first.body);
    expect(asked).toHaveLength(1);
    answers = [JSON.stringify({ warm: "That sounds like a lot, are you okay?", playful: "Team cactus, obviously.", bold: "Next time, call me instead." })];
    const second = await ideas(me.cookie, id, { again: true });
    expect(second.body.ideas.map((i: Any) => i.text)).toEqual(["That sounds like a lot, are you okay?", "Team cactus, obviously.", "Next time, call me instead."]);
    expect(second.body.more).toBe(true);
    // Not these again: the ones on show were in the ask.
    expect(asked[1].user).toContain(`- ${THREE.warm}`);
    const third = await ideas(me.cookie, id, { again: true });
    expect(third.body.more).toBe(false);
    expect(await kept(first.body.for)).toMatchObject({ idea_draws: IDEA_DRAWS });
    // Past the cap: what's kept, and no call.
    const fourth = await ideas(me.cookie, id, { again: true });
    expect(fourth.body).toEqual(third.body);
    expect(asked).toHaveLength(IDEA_DRAWS);
  });

  it("counts a draw nothing could come of, and shows what was kept rather than nothing", async () => {
    const me = member();
    const id = await thread(me.cookie);
    const first = await ideas(me.cookie, id);
    answers = [JSON.stringify({ warm: "let's have sex", playful: "😍😍", bold: "" })];
    const again = await ideas(me.cookie, id, { again: true });
    expect(again.body.ideas).toEqual(first.body.ideas);
    expect(await kept(first.body.for)).toMatchObject({ idea_draws: 2 });
  });

  it("reads kept ones back through the checks", async () => {
    const me = member();
    const id = await thread(me.cookie);
    const first = await ideas(me.cookie, id);
    await t.db.query(`update companion_messages set ideas = $2::jsonb where id = $1`, [first.body.for, JSON.stringify([{ tone: "warm", text: "let's have sex" }, { tone: "bold", text: THREE.bold }])]);
    expect((await ideas(me.cookie, id)).body.ideas).toEqual([{ tone: "bold", text: THREE.bold }]);
  });

  it("is for a guest too, the same way", async () => {
    const g = guest();
    const id = await thread(g.cookie);
    const r = await ideas(g.cookie, id);
    expect(r.status).toBe(200);
    expect(r.body.ideas).toHaveLength(3);
  });

  it("follows the conversation into a scene: something said or done there", async () => {
    const me = member();
    const id = await thread(me.cookie);
    const place = SCENE_PLACES[0];
    expect((await act(me.cookie, id, { action: "scene", place })).status).toBe(200);
    const r = await ideas(me.cookie, id);
    expect(r.body.for).toBe(await newestId(id));
    expect(asked.at(-1)!.system).toContain(`in a scene together (${venueName(place)})`);
    expect(asked.at(-1)!.user).toContain(`(They start a scene: ${venueName(place)}.)`);
  });

  it("has nothing to suggest when the newest word is theirs", async () => {
    const me = member();
    const id = await thread(me.cookie);
    await t.db.query(`insert into companion_messages (id, thread_id, role, text, created_at) values ($1, $2, 'user', 'still there?', now() + interval '1 minute')`, [crypto.randomUUID(), id]);
    expect((await ideas(me.cookie, id)).body).toEqual({ for: null, ideas: [], more: false });
    expect(asked).toEqual([]);
  });

  it("draws nothing for a conversation in another language", async () => {
    const me = member();
    const id = await thread(me.cookie);
    expect((await act(me.cookie, id, { action: "send", text: "Hola, ¿cómo estás? Me gusta mucho la playa y el café." })).status).toBe(200);
    expect((await ideas(me.cookie, id)).body).toEqual({ for: null, ideas: [], more: false });
    expect(asked).toEqual([]);
  });

  it("draws nothing for someone out of replies (they couldn't send one)", async () => {
    const me = member();
    const id = await thread(me.cookie);
    await t.db.query(
      `insert into companion_usage (user_id, day, replies) values ($1, $2, 100000) on conflict (user_id, day) do update set replies = excluded.replies`,
      [me.uid, new Date().toISOString().slice(0, 10)],
    );
    expect((await ideas(me.cookie, id)).body).toEqual({ for: null, ideas: [], more: false });
    expect(asked).toEqual([]);
  });

  it("is nothing with the switch off, or without the companion's own writer (never the show's model)", async () => {
    const me = member();
    const id = await thread(me.cookie);
    vi.stubEnv("COMPANION_IDEAS", "0");
    expect((await ideas(me.cookie, id)).body).toEqual({ for: null, ideas: [], more: false });
    vi.stubEnv("COMPANION_IDEAS", "");
    setCompanionModelForTests(null);
    const r = await companionIdeas(t.db, me.uid, id);
    expect(r).toEqual({ ok: true, for: null, ideas: [], more: false });
    // No draw was counted for it: once there's a writer, the first ask still draws.
    expect(await kept(await newestId(id))).toEqual({ ideas: null, idea_draws: null });
    expect(asked).toEqual([]);
  });

  it("is refused for a paused thread, as a message is", async () => {
    const me = member();
    const id = await thread(me.cookie);
    await t.db.query(`update companion_threads set paused_at = now() where id = $1`, [id]);
    const r = await ideas(me.cookie, id);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("paused");
    expect(asked).toEqual([]);
  });

  it("is not found for someone else's thread, and asks for a session and the 18+ gate first", async () => {
    const me = member();
    const id = await thread(me.cookie);
    expect((await ideas(member().cookie, id)).status).toBe(404);
    // No session: a new guest's, whose threads this isn't.
    const res = await ideasRoute(req(`/api/companion/${id}/ideas`, {}, "bz_adult=1"), ctx(id));
    expect([401, 404]).toContain(res.status);
    const noGate = await ideasRoute(req(`/api/companion/${id}/ideas`, {}, signedInCookie(me.uid)), ctx(id));
    expect(noGate.status).toBe(403);
    expect(asked).toEqual([]);
  });
});

describe("deleting a message", () => {
  it("clears the ideas on a text's blank marker along with its words", async () => {
    const me = member();
    const id = await thread(me.cookie);
    const text = crypto.randomUUID();
    await t.db.query(
      `insert into companion_messages (id, thread_id, role, text, created_at, action, ideas, idea_draws) values ($1, $2, 'character', 'Your date aired!', now() + interval '1 minute', 'after_date:0b0c7a52-1d1e-4f6a-9a53-3f4de2a1c001', $3::jsonb, 1)`,
      [text, id, JSON.stringify([{ tone: "warm", text: THREE.warm }])],
    );
    const r = await deleteMessage(t.db, me.uid, id, text);
    expect(r).toMatchObject({ ok: true, marker: true });
    expect(await kept(text)).toEqual({ ideas: null, idea_draws: null });
  });
});
