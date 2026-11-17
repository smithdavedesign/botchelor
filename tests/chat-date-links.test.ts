// A chat message knows which date it is about (the connected model, stage 5; lib/chat-date-links.ts): the tag's date
// (pure), the column written with the text, the hourly backfill, and the two quiet reads of it: the link in a thread
// and the owner's line on the date's page. A companion conversation is its person's alone: nobody else sees either.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined), has: (name: string) => jar.cookies.has(name), getAll: () => [] }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { exportAccount } from "@/lib/account";
import { castOpenerTag } from "@/lib/cast-opener";
import { backfillMessageEpisodes, textsAboutDate, threadDates } from "@/lib/chat-date-links";
import { getThread, openThread, postFromCharacter, setCompanionModelForTests } from "@/lib/companion";
import { deleteMessage } from "@/lib/companion-message-delete";
import { aboutDateLabel, chatDateLinks, DATE_TEXT_KINDS, DATE_TEXT_TAG_SQL, isTextTag, tagEpisode, textLink } from "@/lib/companion-shared";
import { textPhoto } from "@/lib/date-photo";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { lockedPictureTag } from "@/lib/locked-picture";
import { REPORT_HIDE_THRESHOLD } from "@/lib/rules";
import { api, episodeJson, newUserCookie, scriptedModel, scriptOutcome, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

const EP = "5305594b-ea07-4b56-ad87-a1725c18113f";
const NOW = new Date("2026-11-16T20:00:00Z");
const CAST = HOUSE_CHARACTERS[0];
const castFirst = CAST.name.split(/\s+/)[0];

describe("the date a tag names (pure)", () => {
  it("every kind of text about a date names it", () => {
    expect([...DATE_TEXT_KINDS].sort()).toEqual(["after_date", "date_photo", "day_after", "life", "locked_picture", "opener", "overnight", "tease"]);
    for (const kind of DATE_TEXT_KINDS) {
      expect(tagEpisode(`${kind}:${EP}`), kind).toBe(EP);
      expect(tagEpisode(`${kind}:ep_1-b`), kind).toBe("ep_1-b");
      expect(isTextTag(`${kind}:${EP}`), kind).toBe(true);
    }
    // The tags as the senders build them (lib/cast-opener.ts, lib/locked-picture.ts).
    expect(tagEpisode(castOpenerTag(EP))).toBe(EP);
    expect(tagEpisode(lockedPictureTag(EP))).toBe(EP);
  });

  it("a tag about anything else, a stage direction and a malformed tag name none", () => {
    const others = [
      "house_scene:scene-2026-11-16",
      "house_tonight:2026-11-16",
      `gift:${EP}`,
      `offer:${EP}`,
      `offer_none:${EP}`,
      `offer_out:${EP}`,
      "question:occupation",
      `answer:${EP}`,
      "rose:2026-11-2026-11-15",
      "peoples_rose:2026-11",
      "ceremony:2026-12-3",
      "lessons:2026-W46",
      "casting_invite:Ab3_x-9QzK",
      // Close to a date tag, and not one: no ref, a second colon, a space, another case, a longer kind.
      "after_date:",
      `after_date:${EP}:again`,
      `after_date: ${EP}`,
      `After_date:${EP}`,
      `after_dates:${EP}`,
      `my_after_date:${EP}`,
      `after_date:${"x".repeat(65)}`,
      "leans in, grinning",
      "",
    ];
    for (const tag of others) expect(tagEpisode(tag), tag).toBeNull();
    expect(tagEpisode(null)).toBeNull();
    expect(tagEpisode(undefined)).toBeNull();
  });

  it("the backfill's SQL pattern is the same rule", () => {
    expect(DATE_TEXT_TAG_SQL).toBe(`'^(${DATE_TEXT_KINDS.join("|")}):[A-Za-z0-9_-]{1,64}$'`);
  });

  it("the link's words: your date for your own character, the character's own for a cast member", () => {
    expect(aboutDateLabel({ yours: true, character: "Lexi Marlowe", partner: "Nell Okafor" })).toBe("About your date with Nell");
    expect(aboutDateLabel({ yours: false, character: "Nell Okafor", partner: "Rafe Castellanos" })).toBe("About Nell's date with Rafe");
  });

  it("CHAT_DATE_LINKS is on unless it is 0", () => {
    expect(chatDateLinks({})).toBe(true);
    expect(chatDateLinks({ CHAT_DATE_LINKS: "1" })).toBe(true);
    expect(chatDateLinks({ CHAT_DATE_LINKS: " 0 " })).toBe(false);
  });

  it("the schema adds the column at the end, and never backfills inside the schema script", () => {
    const db = readFileSync(join(process.cwd(), "lib/db.ts"), "utf8");
    expect(db).toContain("alter table companion_messages add column if not exists episode_id text;");
    expect(db).toContain("create index if not exists companion_messages_episode_idx on companion_messages (episode_id) where episode_id is not null;");
    expect(db).not.toMatch(/update companion_messages set episode_id/);
    // The hourly job fills old rows (app/api/jobs/lobby/route.ts), like the shown stages.
    expect(readFileSync(join(process.cwd(), "app/api/jobs/lobby/route.ts"), "utf8")).toContain("await backfillMessageEpisodes(db).catch(() => null)");
  });
});

/* ------------------------------------------------------ with a database ------------------------------------------------------ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  jar.cookies.clear();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("COMPANION_OPEN", "1");
  // A text is written, never drawn; a hello the model writes (a new thread's opener) is one plain line.
  setCompanionModelForTests({
    async complete(messages) {
      if (String(messages[0]?.content ?? "").startsWith("You check one message")) return '{"risk": false}';
      return JSON.stringify({ messages: ["Hi."] });
    },
  });
});
afterEach(() => {
  setCompanionModelForTests(null);
  vi.unstubAllEnvs();
});

const as = (cookie: string | null) => {
  jar.cookies.clear();
  if (cookie) jar.cookies.set(cookie.split("=")[0], cookie.split("=")[1]);
};

/** A person's own character on a date with a cast member; `aired` airs it (public, both characters public). */
async function ownDate(opts: { aired?: boolean; name?: string } = {}) {
  const cookie = newUserCookie();
  const me = userIdOf(cookie);
  const mine = (await (await api.createCharacter(validCharacter({ name: opts.name ?? "Lexi Marlowe", open_to_dates: true }), cookie)).json()).id as string;
  scriptOutcome({ ending: "second_date" });
  scriptedModel([episodeJson()]);
  const res = await api.createEpisode({ character_id: mine, partner_id: CAST.id }, cookie);
  expect(res.status).toBe(200);
  const episode = (await res.json()).id as string;
  if (opts.aired) expect((await api.reveal(episode, cookie)).status).toBeLessThan(300);
  return { cookie, me, mine, episode };
}

const rows = async (threadId: string) =>
  (await t.db.query<{ id: string; role: string; text: string; action: string | null; via: string; episode_id: string | null; replaced_by: string | null }>(
    `select id, role, text, action, via, episode_id, replaced_by from companion_messages where thread_id = $1 order by created_at, id`,
    [threadId],
  )).rows;

const view = async (userId: string, threadId: string) => {
  const r = await getThread(t.db, userId, threadId);
  if (!r.ok) throw new Error("no thread");
  return r.view;
};

const EpisodePage = async (id: string) => renderToStaticMarkup(await (await import("@/app/episodes/[id]/page")).default({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));

describe("a text is written with its date", () => {
  it("every row of a text about a date carries the date, its photo included; the notice and other texts carry none", async () => {
    const d = await ownDate();
    const photo = textPhoto({ id: d.episode, names: ["Lexi Marlowe", CAST.name], venue: null, at: NOW.toISOString() });
    const sent = await postFromCharacter(t.db, { userId: d.me, characterId: d.mine, lines: ["Back from the date.", "I think it went well?"], now: NOW, kind: "after_date", dedupeKey: `after_date:${d.episode}`, photo });
    expect(sent).not.toBeNull();
    await postFromCharacter(t.db, { userId: d.me, characterId: d.mine, lines: ["They talked about you in the house."], now: new Date(NOW.getTime() + 60_000), kind: "house_scene", dedupeKey: "house_scene:scene-1" });
    const all = await rows(sent!.threadId);
    const about = all.filter((m) => m.action === `after_date:${d.episode}`);
    expect(about).toHaveLength(photo ? 3 : 2);
    expect(about.every((m) => m.episode_id === d.episode)).toBe(true);
    if (photo) expect(about.filter((m) => m.via === "photo")).toHaveLength(1);
    // The tag stays: it is the dedupe key.
    expect(await postFromCharacter(t.db, { userId: d.me, characterId: d.mine, lines: ["Again."], now: new Date(NOW.getTime() + 120_000), kind: "after_date", dedupeKey: `after_date:${d.episode}` })).toBeNull();
    expect(all.filter((m) => m.role === "system").every((m) => m.episode_id === null)).toBe(true);
    expect(all.filter((m) => m.action === "house_scene:scene-1").map((m) => m.episode_id)).toEqual([null]);
  });

  it("the cast's opener about its last aired date is written with that date", async () => {
    const d = await ownDate({ aired: true });
    const stranger = crypto.randomUUID();
    const opened = await openThread(t.db, stranger, CAST.id, NOW);
    expect(opened.ok).toBe(true);
    const all = await rows((opened as Any).thread_id);
    const opener = all.filter((m) => m.action === castOpenerTag(d.episode));
    expect(opener.length).toBeGreaterThan(0);
    expect(opener.every((m) => m.episode_id === d.episode)).toBe(true);
  });
});

describe("the hourly backfill (backfillMessageEpisodes)", () => {
  it("fills old rows whose tag names a date that exists, a batch a call, and is idempotent", async () => {
    const d = await ownDate();
    await t.db.query(`insert into companion_threads (id, user_id, character_id) values ('th-old', $1, $2)`, [d.me, d.mine]);
    const old = (id: string, role: string, action: string | null) =>
      t.db.query(`insert into companion_messages (id, thread_id, role, text, action) values ($1, 'th-old', $2, 'x', $3)`, [id, role, action]);
    await old("m-after-1", "character", `after_date:${d.episode}`);
    await old("m-after-2", "character", `after_date:${d.episode}`);
    await old("m-tease", "character", `tease:${d.episode}`);
    await old("m-photo", "character", `date_photo:${d.episode}`);
    await old("m-gone", "character", `after_date:${EP}`); // a date that no longer exists
    await old("m-house", "character", "house_scene:scene-1");
    await old("m-offer", "character", `offer:${d.episode}`); // a ref that happens to be the date's id, on a kind that isn't about one
    await old("m-user", "user", null);
    await old("m-reply", "character", null);
    // A deleted text's blank marker (replaced_by = its own id) keeps only its tag and its time.
    await t.db.query(`insert into companion_messages (id, thread_id, role, text, action, replaced_by) values ('m-marker', 'th-old', 'character', '', $1, 'm-marker')`, [`day_after:${d.episode}`]);
    // A scene's stage direction is never a tag, whatever it reads like.
    await t.db.query(`insert into companion_messages (id, thread_id, role, text, action, scene) values ('m-scene', 'th-old', 'character', 'x', $1, 'rooftop_bar')`, [`after_date:${d.episode}`]);

    expect(await backfillMessageEpisodes(t.db, 3)).toBe(3);
    expect(await backfillMessageEpisodes(t.db)).toBe(1);
    expect(await backfillMessageEpisodes(t.db)).toBe(0);
    const filled = Object.fromEntries((await rows("th-old")).map((m) => [m.id, m.episode_id]));
    expect(filled).toEqual({
      "m-after-1": d.episode,
      "m-after-2": d.episode,
      "m-tease": d.episode,
      "m-photo": d.episode,
      "m-gone": null,
      "m-house": null,
      "m-offer": null,
      "m-user": null,
      "m-reply": null,
      "m-marker": null,
      "m-scene": null,
    });
  });

  it("a text deleted on its own leaves a marker without the date, and the backfill never sets it again", async () => {
    const d = await ownDate();
    const sent = await postFromCharacter(t.db, { userId: d.me, characterId: d.mine, lines: ["Back from the date."], now: NOW, kind: "after_date", dedupeKey: `after_date:${d.episode}` });
    const r = await deleteMessage(t.db, d.me, sent!.threadId, sent!.messageId);
    expect(r).toMatchObject({ ok: true, marker: true });
    const marker = (await rows(sent!.threadId)).find((m) => m.action === `after_date:${d.episode}`)!;
    expect(marker).toMatchObject({ text: "", episode_id: null, replaced_by: marker.id });
    expect(await backfillMessageEpisodes(t.db)).toBe(0);
    // And neither read counts it.
    expect(await textsAboutDate(t.db, d.me, d.episode)).toEqual([]);
    expect((await threadDates(t.db, { threadId: sent!.threadId, characterId: d.mine, viewer: d.me })).size).toBe(0);
  });
});

describe("in the thread: About your date with …", () => {
  it("under the last bubble of the owner's text about their own character's date, aired or not", async () => {
    const d = await ownDate();
    const photo = textPhoto({ id: d.episode, names: ["Lexi Marlowe", CAST.name], venue: null, at: NOW.toISOString() });
    const sent = await postFromCharacter(t.db, { userId: d.me, characterId: d.mine, lines: ["Back from the date.", "I think it went well?", "Want me to see them again?"], now: NOW, kind: "after_date", dedupeKey: `after_date:${d.episode}`, photo });
    const v = await view(d.me, sent!.threadId);
    const about = v.messages.filter((m) => m.about);
    expect(about).toHaveLength(1);
    expect(about[0].text).toBe("Want me to see them again?");
    expect(about[0].about).toEqual({ href: `/episodes/${d.episode}`, label: `About your date with ${castFirst}`, episode: d.episode });
    // The component draws it as one small link (the client file is read, not rendered: it needs a browser).
    const chat = readFileSync(join(process.cwd(), "app/companion/[id]/CompanionChat.tsx"), "utf8");
    expect(chat).toContain("{m.about && (");
    expect(chat).toContain("<Link href={m.about.href} data-track=\"companion-about-date\" data-track-character={c.id} data-track-episode={m.about.episode}>");
  });

  it("once a text, and never beside the Watch link a tease or an opener already carries", async () => {
    const d = await ownDate({ aired: true });
    const post = (kind: string, lines: string[], minutes: number) => postFromCharacter(t.db, { userId: d.me, characterId: d.mine, lines, now: new Date(NOW.getTime() + minutes * 60_000), kind, dedupeKey: `${kind}:${d.episode}` });
    const first = await post("tease", ["Back from the date.", "Come see how it went."], 0);
    await post("day_after", ["Still thinking about them.", "Want me to try someone new?"], 60);
    await post("overnight", ["We left together."], 120);
    const v = await view(d.me, first!.threadId);
    expect(textLink(`tease:${d.episode}`)).not.toBeNull();
    const tease = v.messages.filter((m) => m.text === "Come see how it went.")[0];
    expect(tease.link).toEqual({ href: `/episodes/${d.episode}`, label: "Watch the date" });
    expect(tease.about).toBeUndefined();
    expect(v.messages.filter((m) => m.about).map((m) => m.text)).toEqual(["Want me to try someone new?", "We left together."]);
  });

  it("is absent for a date the viewer may not open: someone else's, until it has aired publicly", async () => {
    const d = await ownDate();
    const stranger = crypto.randomUUID();
    // A cast member texts someone who isn't on the date about it (the way a locked picture's text reaches a follower).
    const sent = await postFromCharacter(t.db, { userId: stranger, characterId: CAST.id, lines: ["One more thing about last night."], now: NOW, kind: "locked_picture", dedupeKey: lockedPictureTag(d.episode) });
    expect(sent).not.toBeNull();
    expect((await rows(sent!.threadId)).filter((m) => m.episode_id === d.episode)).toHaveLength(1);
    // Unaired: the column is there, the link is not.
    expect((await view(stranger, sent!.threadId)).messages.some((m) => m.about)).toBe(false);
    // A private date stays its owners' even once it has aired.
    await t.db.query(`update episodes set visibility = 'private', revealed_at = now() where id = $1`, [d.episode]);
    expect((await view(stranger, sent!.threadId)).messages.some((m) => m.about)).toBe(false);
    // Aired and public, but one of the two is not a public character: still nothing.
    await t.db.query(`update episodes set visibility = 'public' where id = $1`, [d.episode]);
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [d.mine]);
    expect((await view(stranger, sent!.threadId)).messages.some((m) => m.about)).toBe(false);
    // Aired publicly between two public characters: anyone may open it, and it is the character's date, not theirs.
    await t.db.query(`update characters set visibility = 'public' where id = $1`, [d.mine]);
    const open = (await view(stranger, sent!.threadId)).messages.filter((m) => m.about);
    expect(open.map((m) => m.about)).toEqual([{ href: `/episodes/${d.episode}`, label: `About ${castFirst}'s date with Lexi`, episode: d.episode }]);
    // Hidden by reports: gone again for a stranger, still there for the owner of a side in their own thread.
    for (let i = 0; i < REPORT_HIDE_THRESHOLD; i++) await t.db.query(`insert into reports (episode_id, reporter_id, reason) values ($1, $2, 'other')`, [d.episode, crypto.randomUUID()]);
    expect((await view(stranger, sent!.threadId)).messages.some((m) => m.about)).toBe(false);
    const mine = await postFromCharacter(t.db, { userId: d.me, characterId: d.mine, lines: ["Back from the date."], now: NOW, kind: "after_date", dedupeKey: `after_date:${d.episode}` });
    expect((await view(d.me, mine!.threadId)).messages.filter((m) => m.about)).toHaveLength(1);
  });

  it("CHAT_DATE_LINKS=0 hides it; the column is still written", async () => {
    vi.stubEnv("CHAT_DATE_LINKS", "0");
    const d = await ownDate();
    const sent = await postFromCharacter(t.db, { userId: d.me, characterId: d.mine, lines: ["Back from the date."], now: NOW, kind: "after_date", dedupeKey: `after_date:${d.episode}` });
    expect((await rows(sent!.threadId)).filter((m) => m.episode_id === d.episode)).toHaveLength(1);
    expect((await view(d.me, sent!.threadId)).messages.some((m) => m.about)).toBe(false);
    vi.stubEnv("CHAT_DATE_LINKS", "1");
    expect((await view(d.me, sent!.threadId)).messages.some((m) => m.about)).toBe(true);
  });
});

describe("on the date's page: … texted you about this", () => {
  it("the owner of a side sees one line to their own thread; a stranger, a signed-out visitor and the other owner never do", async () => {
    const d = await ownDate({ aired: true });
    const sent = await postFromCharacter(t.db, { userId: d.me, characterId: d.mine, lines: ["Back from the date.", "I think it went well?"], now: NOW, kind: "after_date", dedupeKey: `after_date:${d.episode}` });
    expect(await textsAboutDate(t.db, d.me, d.episode)).toEqual([{ thread_id: sent!.threadId, character_id: d.mine, name: "Lexi Marlowe" }]);

    as(d.cookie);
    const owner = await EpisodePage(d.episode);
    expect(owner).toContain("Lexi texted you about this");
    expect(owner).toContain(`href="/companion/${sent!.threadId}"`);
    expect(owner.match(/data-chat-about/g)).toHaveLength(1);

    // Someone else, who even has a thread of their own with the cast member about this very date: never the line, and
    // never the owner's thread.
    const strangerCookie = newUserCookie();
    const stranger = userIdOf(strangerCookie);
    const theirs = await postFromCharacter(t.db, { userId: stranger, characterId: CAST.id, lines: ["One more thing about last night."], now: NOW, kind: "locked_picture", dedupeKey: lockedPictureTag(d.episode) });
    expect(theirs).not.toBeNull();
    expect(await textsAboutDate(t.db, stranger, d.episode)).toEqual([]);
    for (const cookie of [strangerCookie, null]) {
      as(cookie);
      const html = await EpisodePage(d.episode);
      expect(html).not.toContain("texted you about this");
      expect(html).not.toContain("data-chat-about");
      expect(html).not.toContain(sent!.threadId);
      if (theirs) expect(html).not.toContain(theirs.threadId);
    }
  });

  it("an owner hears nothing of the other owner's texts: each sees only their own thread", async () => {
    // Two people's characters on one date.
    const a = await ownDate({ name: "Lexi Marlowe" });
    const bCookie = newUserCookie();
    const b = userIdOf(bCookie);
    const theirs = (await (await api.createCharacter(validCharacter({ name: "Odalys Brandt", open_to_dates: true }), bCookie)).json()).id as string;
    await t.db.query(`update episodes set character_b = $2, revealed_at = now() where id = $1`, [a.episode, theirs]);
    const sent = await postFromCharacter(t.db, { userId: a.me, characterId: a.mine, lines: ["Back from the date."], now: NOW, kind: "after_date", dedupeKey: `after_date:${a.episode}` });
    expect(await textsAboutDate(t.db, b, a.episode)).toEqual([]);
    as(bCookie);
    const other = await EpisodePage(a.episode);
    expect(other).not.toContain("texted you about this");
    expect(other).not.toContain(sent!.threadId);
    // Once their own character texts them too, each owner's line leads to their own thread only.
    const own = await postFromCharacter(t.db, { userId: b, characterId: theirs, lines: ["Back from the date."], now: NOW, kind: "after_date", dedupeKey: `after_date:${a.episode}` });
    const again = await EpisodePage(a.episode);
    expect(again).toContain("Odalys texted you about this");
    expect(again).toContain(`href="/companion/${own!.threadId}"`);
    expect(again).not.toContain(sent!.threadId);
  });

  it("CHAT_DATE_LINKS=0 hides the line", async () => {
    const d = await ownDate({ aired: true });
    await postFromCharacter(t.db, { userId: d.me, characterId: d.mine, lines: ["Back from the date."], now: NOW, kind: "after_date", dedupeKey: `after_date:${d.episode}` });
    as(d.cookie);
    expect(await EpisodePage(d.episode)).toContain("texted you about this");
    vi.stubEnv("CHAT_DATE_LINKS", "0");
    expect(await EpisodePage(d.episode)).not.toContain("texted you about this");
  });

  it("the page asks only for an owner of a side, inside the reads it already makes", () => {
    const page = readFileSync(join(process.cwd(), "app/episodes/[id]/page.tsx"), "utf8");
    expect(page).toContain("ready && episode.is_creator && viewerId && chatDateLinks() ? textsAboutDate(db, viewerId, id)");
  });
});

describe("the export", () => {
  it("a conversation's rows carry the date a text is about", async () => {
    const d = await ownDate();
    await postFromCharacter(t.db, { userId: d.me, characterId: d.mine, lines: ["Back from the date."], now: NOW, kind: "after_date", dedupeKey: `after_date:${d.episode}` });
    const data = await exportAccount(t.db, d.me);
    const messages = data.companion_conversations[0].messages as Any[];
    expect(messages.find((m) => m.text === "Back from the date.")).toMatchObject({ about: `after_date:${d.episode}`, episode_id: d.episode });
    expect(messages.filter((m) => m.said_by === "notice").every((m) => m.episode_id === undefined)).toBe(true);
  });
});
