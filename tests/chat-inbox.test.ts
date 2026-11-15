// Chat (/chat; lib/chat-inbox.ts, 2026-11-15): one inbox for every thread a person has. The threads with them
// (lib/companion.ts) and their characters' threads with other characters (lib/inbox.ts) used to sit behind two doors
// with two product names. These pin the merge (order, which kind, unread, what's left out), the header's one number,
// and the page for each kind of viewer: nobody yet, a guest, someone signed in with no character, an owner.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
}));
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import ChatPage, { metadata } from "@/app/chat/page";
import { signSession } from "@/lib/auth";
import { CHAT_CHARACTERS, chatFilter, filterChat, loadChat } from "@/lib/chat-inbox";
import { postFromCharacter, setCompanionModelForTests } from "@/lib/companion";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { unreadChatTexts, unreadTexts } from "@/lib/inbox";
import { markCharacterTextsRead } from "@/lib/notifications";
import { pairKey } from "@/lib/relationships";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { clearSharedCache } from "@/lib/shared-cache";
import { PUBLIC_PATHS } from "@/lib/site";
import { middleware } from "@/middleware";
import { api, BASE_URL, newUserCookie, signedInCookie, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});

const CAST = HOUSE_CHARACTERS.slice(0, 4);
const NOW = new Date();
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

beforeEach(async () => {
  await t.reset();
  jar.cookies.clear();
  clearSharedCache();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("COMPANION_OPEN", "1");
  vi.spyOn(console, "log").mockImplementation(() => {});
  setSeasonCastForTests(CAST.map((c) => c.id));
  // A text from a character is written, never drawn: nothing here may ask a model for a line.
  setCompanionModelForTests({
    async complete() {
      throw new Error("the Chat inbox called a model");
    },
  });
});
afterEach(() => {
  setCompanionModelForTests(null);
  setSeasonCastForTests(HOUSE_CHARACTERS.map((c) => c.id));
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function character(name: string, cookie = newUserCookie()) {
  const c = await (await api.createCharacter(validCharacter({ name }), cookie)).json();
  return { id: c.id as string, name, cookie, userId: userIdOf(cookie) };
}

/** One character texts another (lib/text-chain.ts reads couple_texts). */
async function text(x: string, y: string, from: string, body: string, minutesAgo = 0) {
  const [lo, hi] = pairKey(x, y);
  const seq = (await t.db.query<{ n: number }>(`select count(*)::int as n from couple_texts where character_lo = $1 and character_hi = $2`, [lo, hi])).rows[0].n + 1;
  await t.db.query(
    `insert into couple_texts (character_lo, character_hi, day, seq, who, text, via, created_at)
     values ($1, $2, current_date, $3, $4, $5, 'agent', now() - make_interval(mins => $6))`,
    [lo, hi, seq, from === lo ? "lo" : "hi", body, minutesAgo],
  );
}
const textedNotice = (userId: string, x: string, y: string) => {
  const [lo, hi] = pairKey(x, y);
  return t.db.query(`insert into notifications (id, user_id, kind, title, link) values (gen_random_uuid()::text, $1, 'texted', 'They texted', $2)`, [userId, `/messages/${lo}/${hi}`]);
};
/** A character texts the person themselves (the one way in: lib/companion.ts postFromCharacter). */
const textsYou = async (userId: string, characterId: string, line: string, minutesAgo: number) =>
  (await postFromCharacter(t.db, { userId, characterId, lines: [line], now: ago(minutesAgo), kind: "after_date", dedupeKey: `after_date:${crypto.randomUUID()}` }))!.threadId;

const as = (cookie: string | null) => {
  jar.cookies.clear();
  if (cookie) jar.cookies.set(cookie.split("=")[0], cookie.split("=").slice(1).join("="));
};
const page = async (cookie: string | null, sp: Record<string, string> = {}) => {
  as(cookie);
  return renderToStaticMarkup(await ChatPage({ searchParams: Promise.resolve(sp) }));
};
const guestCookie = (userId: string = crypto.randomUUID()) => `bz_sess=${signSession({ uid: userId, authenticated: false })}`;
const rowsOf = (html: string) => [...html.matchAll(/<a class="matches-row chat-row[^"]*"[^>]*data-chat-kind="(you|dating)"[^>]*href="([^"]+)"[\s\S]*?<\/a>/g)].map((m) => ({ kind: m[1], href: m[2].replace(/&amp;/g, "&"), html: m[0] }));
const words = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("the merged inbox (loadChat)", () => {
  it("lists both kinds in one list, newest first, each saying which it is and opening its own page", async () => {
    const me = await character("Ira Fenn");
    const dex = await character("Dex Marlow");
    await text(me.id, dex.id, dex.id, "Same time next week?", 30);
    const nell = await textsYou(me.userId, CAST[0].id, "You will not believe what happened at dinner.", 10);
    const mine = await textsYou(me.userId, me.id, "Back from the date. I think it went well?", 60);

    const inbox = await loadChat(t.db, { userId: me.userId, withYou: true });
    expect(inbox.rows.map((r) => r.key)).toEqual([`you:${nell}`, `dating:${me.id}/${dex.id}`, `you:${mine}`]);
    const [lo, hi] = pairKey(me.id, dex.id);
    expect(inbox.rows[0]).toMatchObject({ kind: "you", title: CAST[0].name.split(" ")[0], says: "texting you", href: `/companion/${nell}`, mine: null, last: { text: "You will not believe what happened at dinner.", by: null }, unread: 1 });
    expect(inbox.rows[1]).toMatchObject({ kind: "dating", title: "Ira and Dex", says: "texting each other", href: `/messages/${lo}/${hi}?as=${me.id}`, mine: { id: me.id }, who: { id: dex.id }, last: { text: "Same time next week?", by: "Dex" } });
    // Their own character texting them is a thread with them, like any other.
    expect(inbox.rows[2]).toMatchObject({ kind: "you", title: "Ira", who: { id: me.id } });
    expect(inbox.counts).toEqual({ all: 3, you: 2, dating: 1 });
    expect(inbox.characters).toEqual([{ id: me.id, name: "Ira Fenn" }]);
    expect(filterChat(inbox.rows, "you").map((r) => r.kind)).toEqual(["you", "you"]);
    expect(filterChat(inbox.rows, "dating").map((r) => r.title)).toEqual(["Ira and Dex"]);
    expect(filterChat(inbox.rows, "all")).toHaveLength(3);
    expect([chatFilter("you"), chatFilter(["dating", "you"]), chatFilter("nope"), chatFilter(undefined)]).toEqual(["you", "dating", "all", "all"]);
  });

  it("says who sent the last text when it was the viewer's own character", async () => {
    const me = await character("Ira Fenn");
    const dex = await character("Dex Marlow");
    await text(me.id, dex.id, me.id, "I had a good time.");
    const [row] = (await loadChat(t.db, { userId: me.userId, withYou: true })).rows;
    expect(row.last).toEqual({ text: "I had a good time.", by: "Ira" });
  });

  it("carries unread state for both kinds, and reading a thread clears its own", async () => {
    const me = await character("Ira Fenn");
    const dex = await character("Dex Marlow");
    await text(me.id, dex.id, dex.id, "Hey you.", 5);
    await textedNotice(me.userId, me.id, dex.id);
    const thread = await textsYou(me.userId, CAST[0].id, "Morning.", 2);
    expect(await unreadChatTexts(t.db, me.userId)).toBe(2);
    // The Dating count of before (NAV_CHAT=0) is the characters' own texts only.
    expect(await unreadTexts(t.db, me.userId)).toBe(1);
    let inbox = await loadChat(t.db, { userId: me.userId, withYou: true });
    expect(inbox.rows.map((r) => [r.kind, r.unread > 0])).toEqual([["you", true], ["dating", true]]);

    // Opening the thread with them reads it (app/companion/[id]/page.tsx).
    expect(await markCharacterTextsRead(t.db, me.userId, `/companion/${thread}`)).toBe(1);
    inbox = await loadChat(t.db, { userId: me.userId, withYou: true });
    expect(inbox.rows.find((r) => r.kind === "you")?.unread).toBe(0);
    expect(await unreadChatTexts(t.db, me.userId)).toBe(1);
    // Someone else's count is their own.
    expect(await unreadChatTexts(t.db, dex.userId)).toBe(0);
  });

  it("a new match with no texts yet is a row; a pair that didn't work out stays on Matches", async () => {
    const me = await character("Ira Fenn");
    const bo = await character("Bo Quill");
    const cy = await character("Cy Marr");
    const [lo, hi] = pairKey(me.id, bo.id);
    await t.db.query(`insert into matches (character_lo, character_hi) values ($1, $2)`, [lo, hi]);
    await t.db.query(`insert into notifications (id, user_id, kind, title, link) values (gen_random_uuid()::text, $1, 'matched', 'A match', $2)`, [me.userId, `/messages/${lo}/${hi}`]);
    // Cy passed on a date: filed under "Didn't work out" on /matches, and not listed here.
    const [clo, chi] = pairKey(me.id, cy.id);
    await t.db.query(`insert into matches (character_lo, character_hi, yes_lo, yes_hi, matched_at) values ($1, $2, $3, $4, now() - interval '3 hours')`, [clo, chi, clo === me.id, clo !== me.id]);
    await text(me.id, cy.id, cy.id, "Maybe not.", 90);
    await text(me.id, cy.id, me.id, "Fair enough.", 80);

    const inbox = await loadChat(t.db, { userId: me.userId, withYou: true });
    expect(inbox.rows.map((r) => r.title)).toEqual(["Ira and Bo"]);
    expect(inbox.rows[0]).toMatchObject({ last: null, new_match: true });
  });

  it("without threads of their own (companions closed to them) lists only their characters' threads", async () => {
    const me = await character("Ira Fenn");
    const dex = await character("Dex Marlow");
    await text(me.id, dex.id, dex.id, "Hello.");
    await textsYou(me.userId, CAST[0].id, "Morning.", 1);
    const inbox = await loadChat(t.db, { userId: me.userId, withYou: false });
    expect(inbox.rows.map((r) => r.kind)).toEqual(["dating"]);
    expect(inbox.counts).toEqual({ all: 1, you: 0, dating: 1 });
  });

  it("someone with no character has only the threads with them; someone with neither has nothing", async () => {
    const me = crypto.randomUUID();
    expect(await loadChat(t.db, { userId: me, withYou: true })).toEqual({ rows: [], counts: { all: 0, you: 0, dating: 0 }, characters: [], unlisted: 0 });
    await textsYou(me, CAST[1].id, "Hi.", 1);
    const inbox = await loadChat(t.db, { userId: me, withYou: true });
    expect(inbox.rows.map((r) => r.says)).toEqual(["texting you"]);
    expect(inbox.characters).toEqual([]);
  });

  it(`merges at most ${CHAT_CHARACTERS} characters' threads, the ones with unread news first, and says how many it left`, async () => {
    const cookie = newUserCookie();
    // Bought dates aside, a person may make this many: the oldest is the one with news.
    const mine = [];
    for (let i = 0; i < CHAT_CHARACTERS + 1; i++) {
      const id = crypto.randomUUID();
      await t.db.query(
        `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, created_via, created_at)
         values ($1, $2, false, $3, 29, 'Restores old radios.', '["dry","warm"]'::jsonb, 'Someone who listens', 'Rudeness', 'web', now() - make_interval(mins => $4))`,
        [id, userIdOf(cookie), `Mine ${String.fromCharCode(65 + i)}`, 100 - i],
      );
      mine.push(id);
    }
    const oldest = mine[0];
    const dex = await character("Dex Marlow");
    await text(oldest, dex.id, dex.id, "Found you.", 3);
    await textedNotice(userIdOf(cookie), oldest, dex.id);
    const inbox = await loadChat(t.db, { userId: userIdOf(cookie), withYou: true });
    expect(inbox.characters).toHaveLength(CHAT_CHARACTERS + 1);
    expect(inbox.unlisted).toBe(1);
    expect(inbox.rows.map((r) => r.title)).toEqual(["Mine and Dex"]);
  });
});

describe("/chat", () => {
  it("is a personal page: not indexed, not in the sitemap, behind the 18+ gate like Matches", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(PUBLIC_PATHS as readonly string[]).not.toContain("/chat");
    const browser = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";
    for (const path of ["/chat", "/matches"]) {
      const res = middleware(new NextRequest(`${BASE_URL}${path}`, { headers: { "user-agent": browser } }));
      expect(res.headers.get("location"), path).toContain(`/gate?from=${encodeURIComponent(path)}`);
    }
  });

  it("a first visit: three of the cast to text now, and the way to a character of their own", async () => {
    const html = await page(null);
    expect(html).toContain("<h1>Chat</h1>");
    expect(html).toContain('id="chat-empty-title">No texts yet</h2>');
    const faces = [...html.matchAll(/<li class="chat-cast-face">[\s\S]*?<\/li>/g)].map((m) => m[0]);
    expect(faces).toHaveLength(3);
    CAST.slice(0, 3).forEach((c, i) => {
      expect(faces[i]).toContain(`href="/characters/${c.id}"`);
      expect(faces[i]).toContain(`<button type="button" class="button secondary small" data-track="verb-text">Text ${c.name.split(" ")[0]}</button>`);
    });
    expect(html).toContain('<a class="button" data-track="chat-text-someone" href="/companion">Text someone</a>');
    expect(html.match(/href="\/create\?next=%2Fchat"/g)).toHaveLength(2);
    expect(html).not.toContain("Find a match");
    // Nothing to filter yet.
    expect(html).not.toContain("chat-filter");
    expect(rowsOf(html)).toEqual([]);
  });

  it("a first visit with guests off: the cast is still shown, and texting says an account comes first", async () => {
    vi.stubEnv("COMPANION_GUEST_REPLIES", "0");
    const html = await page(null);
    expect(html).not.toContain("verb-text");
    expect(html.match(/<a class="button secondary small" href="\/account\?next=%2Fchat">Sign in to text<\/a>/g)).toHaveLength(3);
    expect(html).toContain(">Text someone</a>");
  });

  it("with texting closed to everyone, nothing offers it", async () => {
    vi.stubEnv("COMPANION_OPEN", "0");
    const html = await page(null);
    expect(html).not.toContain("Text someone");
    expect(html).not.toContain("verb-text");
    expect(html).not.toContain("Sign in to text");
    expect(html).toContain("Make your character");
  });

  it("a guest's threads are listed: a visitor without an account can have them", async () => {
    const me = crypto.randomUUID();
    const thread = await textsYou(me, CAST[0].id, "You came back.", 4);
    const html = await page(guestCookie(me));
    const rows = rowsOf(html);
    expect(rows.map((r) => [r.kind, r.href])).toEqual([["you", `/companion/${thread}`]]);
    expect(words(rows[0].html)).toContain(`${CAST[0].name.split(" ")[0]} texting you`);
    expect(words(rows[0].html)).toContain("You came back.");
    expect(rows[0].html).toContain('class="matches-dot" aria-label="1 new"');
    expect(html).toContain("Make your character");
    // An unsigned identity (a bare id cookie anyone could type) is shown nobody's threads.
    expect(rowsOf(await page(`bz_uid=${me}`))).toEqual([]);
  });

  it("someone signed in with no character: their threads, and what Their dating is for", async () => {
    const me = crypto.randomUUID();
    await textsYou(me, CAST[0].id, "Morning.", 4);
    const html = await page(signedInCookie(me));
    expect(rowsOf(html)).toHaveLength(1);
    expect(words(/<nav class="segmented chat-filter"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "")).toBe("All 1 With you 1 Their dating 0");
    expect(html).toMatch(/aria-current="page" href="\/chat">All/);
    const dating = await page(signedInCookie(me), { show: "dating" });
    expect(rowsOf(dating)).toEqual([]);
    expect(dating).toMatch(/aria-current="page" href="\/chat\?show=dating">Their dating/);
    expect(dating).toContain("This is where your character&#x27;s texts go");
    expect(dating).toContain('href="/create?next=%2Fchat"');
  });

  it("an owner: both kinds in one list, the filter, and the two ways to start something", async () => {
    const me = await character("Ira Fenn");
    const dex = await character("Dex Marlow");
    await text(me.id, dex.id, dex.id, "Same time next week?", 30);
    await textedNotice(me.userId, me.id, dex.id);
    const thread = await textsYou(me.userId, me.id, "Back from the date.", 10);
    const [lo, hi] = pairKey(me.id, dex.id);

    // On a signed identity, as the site issues them (a bare id cookie is shown no threads with them).
    const cookie = guestCookie(me.userId);
    const html = await page(cookie);
    const rows = rowsOf(html);
    expect(rows.map((r) => [r.kind, r.href])).toEqual([["you", `/companion/${thread}`], ["dating", `/messages/${lo}/${hi}?as=${me.id}`]]);
    expect(words(rows[1].html)).toContain("Ira and Dex texting each other");
    expect(words(rows[1].html)).toContain("Dex: Same time next week?");
    expect(rows[1].html).toContain("is-unread");
    // Two faces on a character's own thread, one on a thread with you.
    expect(rows[1].html).toContain('class="chat-faces is-pair"');
    expect(rows[0].html).toContain('class="chat-faces"');
    expect(html).toContain('href="/companion">Text someone</a>');
    expect(html).toContain(`<a class="button secondary" data-track="chat-find-match" href="/swipe?character=${me.id}">Find a match</a>`);
    expect(html).not.toContain("chat-empty");

    const you = rowsOf(await page(cookie, { show: "you" }));
    expect(you.map((r) => r.kind)).toEqual(["you"]);
    const dating = rowsOf(await page(cookie, { show: "dating" }));
    expect(dating.map((r) => r.kind)).toEqual(["dating"]);
  });

  it("an owner with nothing yet: the cast to text, and a match to find", async () => {
    const me = await character("Ira Fenn");
    const html = await page(me.cookie);
    expect(html).toContain("chat-empty");
    expect(html.match(/class="chat-cast-face"/g)).toHaveLength(3);
    expect(html).toContain(`href="/swipe?character=${me.id}">Find Ira a match</a>`);
    expect(html).not.toContain("/create?next=%2Fchat");
  });
});
