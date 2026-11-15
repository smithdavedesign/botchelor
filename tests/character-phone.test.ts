// The owner's home is their character's phone (lib/character-phone.ts, app/CharacterPhone.tsx, 2026-11-15): the block's
// states (nothing yet, never opted in, texts waiting, an answered question, several characters), what a stranger sees
// (nothing new), and the HOME_PHONE switch. The home page's depth budget is in tests/perf-pages.test.ts.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
import { renderToStaticMarkup } from "react-dom/server";
import CharacterPhone from "@/app/CharacterPhone";
import { sendAfterDateText } from "@/lib/after-date-text";
import { characterPhone, homePhoneOn, PHONE_OTHERS, PHONE_TEXTS, PHONE_WEEK_DAYS, PHONE_WEEKLY_GAP_DAYS, type CharacterPhoneView } from "@/lib/character-phone";
import { LIFE_GAP_DAYS, lifeDatesPerDay, WEEK_DAYS } from "@/lib/character-life";
import { openThread, postFromCharacter, sendMessage, setCompanionModelForTests } from "@/lib/companion";
import { markOfferTaken } from "@/lib/companion-offers";
import { listMyCharacters } from "@/lib/game";
import { markCharacterTextsRead } from "@/lib/notifications";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { api, episodeJson, newUserCookie, scriptedModel, scriptOutcome, setupEpisode, startTestDb, TEST_SESSION_SECRET, userIdOf, validCharacter } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  jar.cookies.clear();
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  vi.stubEnv("COMPANION_OPEN", "1");
  vi.spyOn(console, "log").mockImplementation(() => {});
  setCompanionModelForTests({
    async complete(messages) {
      return (messages[0]?.content ?? "").startsWith("You check one message") ? `{"risk": false}` : JSON.stringify({ messages: ["Noted."] });
    },
  });
});
afterEach(() => {
  setCompanionModelForTests(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const NOW = new Date("2026-11-14T20:00:00Z"); // a Saturday
const H0 = HOUSE_CHARACTERS[0];
const firstOf = (name: string) => name.split(" ")[0];
const text = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

/** The phone as the home page loads it for `cookie`'s characters. */
async function phoneFor(cookie: string, now = NOW, env: Record<string, string | undefined> = process.env): Promise<CharacterPhoneView | null> {
  const me = userIdOf(cookie);
  return characterPhone(t.db, me, await listMyCharacters(t.db, me), now, env);
}
const render = (phone: CharacterPhoneView) => text(renderToStaticMarkup(CharacterPhone({ phone })));

/** The creator tapped "Hear from" on the date's verdict card: the text is in, and the thread is opted in. */
async function heard(creator: string, episodeId: string, now = NOW) {
  const r = await sendAfterDateText(t.db, { userId: userIdOf(creator), episodeId, now });
  if (!r.ok) throw new Error(r.error);
  await t.db.query(`update companion_threads set muted_proactive = false where id = $1`, [r.thread_id]);
  return r;
}

describe("the switch and the constants it shares", () => {
  it("is on by default, off with HOME_PHONE=0, and absent while companions are closed (its links would lead nowhere)", async () => {
    expect(homePhoneOn({})).toBe(true);
    expect(homePhoneOn({ HOME_PHONE: "1" })).toBe(true);
    expect(homePhoneOn({ HOME_PHONE: "0" })).toBe(false);
    const { creator } = await setupEpisode("friends");
    expect(await phoneFor(creator)).not.toBeNull();
    expect(await phoneFor(creator, NOW, { COMPANION_OPEN: "1", HOME_PHONE: "0" })).toBeNull();
    expect(await phoneFor(creator, NOW, {})).toBeNull();
    // Nobody's phone without a character.
    expect(await phoneFor(newUserCookie())).toBeNull();
  });

  it("keeps its week and its weekly gap equal to the life module's (it doesn't import it: the home page stays light)", () => {
    expect(PHONE_WEEKLY_GAP_DAYS).toBe(LIFE_GAP_DAYS);
    expect(PHONE_WEEK_DAYS).toBe(WEEK_DAYS);
    expect(lifeDatesPerDay({ LIFE_DATES_PER_DAY: "0" })).toBe(0);
  });
});

describe("nothing yet: a character with no date", () => {
  it("says so, offers the first date as the one action, and promises nothing that can't happen", async () => {
    const creator = newUserCookie();
    const character = await (await api.createCharacter(validCharacter({ name: "Mira Quill" }), creator)).json();
    const phone = (await phoneFor(creator))!;
    expect(phone).toMatchObject({ first: "Mira", threadHref: null, optedIn: false, texts: [], unread: false, chips: [], secondary: null, others: [] });
    expect(phone.action).toEqual({ kind: "link", label: "Send Mira on a first date", href: `/create?character=${character.id}` });
    expect(phone.empty).toBe("Mira hasn't been on a date yet. Send them on one and they'll text you how it went.");
    expect(phone.next.map((n) => n.key)).toEqual(["first_date"]);
    const html = render(phone);
    expect(html).toContain("Your character");
    expect(html).toContain("Mira Quill");
    expect(html).toContain(`href="/create?character=${character.id}"`);
    expect(html).toContain("Send Mira on a first date");
    expect(html).not.toContain("New text");
    expect(html).not.toContain("Hear from");
  });
});

describe("never opted in: a finished date and no texts", () => {
  it("offers 'Hear from {first}' for the date whose ending stands, and names who the date was with", async () => {
    const { creator, episode } = await setupEpisode("second_date");
    const phone = (await phoneFor(creator))!;
    expect(phone.action).toEqual({ kind: "hear", label: "Hear from Mira", episodeId: episode.id });
    expect(phone).toMatchObject({ threadHref: null, optedIn: false, texts: [], chips: [], secondary: null });
    expect(phone.empty).toBe(`Mira hasn't texted you yet. Tap "Hear from Mira" and they'll tell you how the date with ${firstOf(H0.name)} went.`);
    // The date hasn't aired: it's the next thing to watch.
    expect(phone.next[0]).toMatchObject({ key: "ready", href: `/episodes/${episode.id}` });
    const html = render(phone);
    expect(html).toContain("Hear from Mira");
    expect(html).toContain('data-track="home-phone-hear"');
    expect(html).not.toContain("Open Mira's texts");
  });

  it("a thread opened from Talk (never opted in) keeps 'Hear from' as the action, with the thread as the second", async () => {
    const { creator, character, episode } = await setupEpisode("friends");
    const o = await openThread(t.db, userIdOf(creator), character.id, NOW);
    if (!o.ok) throw new Error(o.error);
    const phone = (await phoneFor(creator))!;
    expect(phone.optedIn).toBe(false);
    expect(phone.action).toEqual({ kind: "hear", label: "Hear from Mira", episodeId: episode.id });
    expect(phone.secondary).toEqual({ label: "Open Mira's texts", href: `/companion/${o.thread_id}` });
    // What it said when the thread opened is on the screen.
    expect(phone.texts.map((x) => x.text)).toEqual(["Noted."]);
  });

  it("a date still being filmed: watch it, nothing to hear yet; once the early verdict is in, 'Hear from' goes", async () => {
    const { creator, episode } = await setupEpisode("friends");
    await t.db.query(`update episodes set status = 'generating', setup = setup - 'ending_final' where id = $1`, [episode.id]);
    const filming = (await phoneFor(creator))!;
    expect(filming.action).toEqual({ kind: "link", label: "Watch Mira's date", href: `/episodes/${episode.id}?play=1` });
    expect(filming.next[0]).toMatchObject({ key: "on_date", text: `On a date with ${firstOf(H0.name)} right now`, href: `/episodes/${episode.id}?play=1` });
    expect(filming.empty).toBe(`Mira is on a date with ${firstOf(H0.name)}. They can text you once it's over.`);
    await t.db.query(`update episodes set setup = setup || '{"ending_final":true}'::jsonb where id = $1`, [episode.id]);
    expect((await phoneFor(creator))!.action).toEqual({ kind: "hear", label: "Hear from Mira", episodeId: episode.id });
  });
});

describe("texts waiting: an opted-in thread with an unread text", () => {
  it("shows the last texts with the dot, the open question as chips into the thread, and 'Open {first}'s texts'", async () => {
    const { creator, episode } = await setupEpisode("second_date");
    const r = await heard(creator, episode.id);
    const phone = (await phoneFor(creator))!;
    const thread = `/companion/${r.thread_id}`;
    expect(phone).toMatchObject({ threadHref: thread, optedIn: true, unread: true, empty: null, secondary: null });
    expect(phone.action).toEqual({ kind: "open", label: "Open Mira's texts", href: thread });
    // The last three of the text: its photo, what it thought, the question.
    expect(phone.texts).toHaveLength(PHONE_TEXTS);
    expect(phone.texts.map((x) => x.photo)).toEqual([true, false, false]);
    expect(phone.texts[0].text).toBe("A photo from the date");
    expect(phone.texts[2].text).toBe(`Want me to see ${firstOf(H0.name)} again?`);
    // The chips are the thread's own menu, as links to the thread (nothing is booked from the home page).
    expect(phone.chips).toEqual([
      { label: `Yes, see ${firstOf(H0.name)} again`, href: thread },
      { label: "Try someone new", href: thread },
      { label: "Tell Mira what to do next time", href: thread },
    ]);
    const html = render(phone);
    expect(html).toContain("New text");
    expect(html).toContain(`Want me to see ${firstOf(H0.name)} again?`);
    expect(html).toContain(`Yes, see ${firstOf(H0.name)} again`);
    expect(html).toContain(`href="${thread}"`);
    expect(html).toContain("Open Mira's texts");
    // No form, no button but links: the chips act in the thread.
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Hear from");
  });

  it("drops the dot once the text was read, and the chips once one was tapped or a newer date exists", async () => {
    const { creator, character, episode } = await setupEpisode("second_date");
    const me = userIdOf(creator);
    const r = await heard(creator, episode.id);
    // Opening the thread reads its texts (app/companion/[id]/page.tsx calls this): someone else's, or another thread's, don't.
    expect(await markCharacterTextsRead(t.db, crypto.randomUUID(), `/companion/${r.thread_id}`)).toBe(0);
    expect(await markCharacterTextsRead(t.db, me, "/companion/another-thread")).toBe(0);
    expect((await phoneFor(creator))!.unread).toBe(true);
    expect(await markCharacterTextsRead(t.db, me, `/companion/${r.thread_id}`)).toBe(1);
    expect(await markCharacterTextsRead(t.db, me, `/companion/${r.thread_id}`)).toBe(0);
    expect((await phoneFor(creator))!.unread).toBe(false);
    expect((await phoneFor(creator))!.chips).toHaveLength(3);
    await markOfferTaken(t.db, r.message_id!, { kind: "advice" });
    // The menu is taken; the question is still there, unanswered: one chip to answer it.
    expect((await phoneFor(creator))!.chips).toEqual([{ label: "Answer Mira", href: `/companion/${r.thread_id}` }]);
    // They answered: nothing to tap.
    expect((await sendMessage(t.db, me, r.thread_id, "Yes, go for it.", new Date(NOW.getTime() + 60_000))).ok).toBe(true);
    expect((await phoneFor(creator))!.chips).toEqual([]);

    // A fresh menu on another date goes stale when a newer date exists (the question has moved on).
    const other = await setupEpisode("second_date");
    const heardOther = await heard(other.creator, other.episode.id);
    expect((await phoneFor(other.creator))!.chips).toHaveLength(3);
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    expect((await api.createEpisode({ character_id: other.character.id, partner_id: HOUSE_CHARACTERS[1].id }, other.creator)).status).toBe(200);
    const moved = (await phoneFor(other.creator))!;
    expect(moved.chips.map((c) => c.label)).toEqual(["Answer Mira"]);
    expect(moved.threadHref).toBe(`/companion/${heardOther.thread_id}`);
    expect(character.id).not.toBe(other.character.id);
  });

  it("a question the character asked about its own sheet (lib/character-question-fields.ts) is one chip to answer it, never a date menu", async () => {
    const { creator, episode } = await setupEpisode("friends");
    const me = userIdOf(creator);
    const r = await heard(creator, episode.id);
    await markOfferTaken(t.db, r.message_id!, { kind: "someone_new" });
    expect((await sendMessage(t.db, me, r.thread_id, "Someone new, then.", new Date(NOW.getTime() + 60_000))).ok).toBe(true);
    expect((await phoneFor(creator))!.chips).toEqual([]);
    // The question's box rides in the same column as a date's chips, told apart by having no episode.
    const asked = await postFromCharacter(t.db, { userId: me, characterId: (await listMyCharacters(t.db, me))[0].id, lines: ["Random question. What do I do for work? I feel like I should know."], now: new Date(NOW.getTime() + 120_000), kind: "question", dedupeKey: "question:occupation", offers: { kinds: ["answer"], field: "occupation" } });
    expect(asked).not.toBeNull();
    expect((await phoneFor(creator))!.chips).toEqual([{ label: "Answer Mira", href: `/companion/${r.thread_id}` }]);
    await t.db.query(`update companion_messages set offers = offers || '{"taken":{"kind":"answer","at":"2026-11-14T21:00:00Z"}}'::jsonb where id = $1`, [asked!.messageId]);
    expect((await phoneFor(creator))!.chips).toEqual([]);
  });

  it("what's next: Sunday's recap for a character something happened to this week, and the house's weekly date only when it can happen", async () => {
    const { creator, character, episode } = await setupEpisode("friends");
    await t.db.query(`update episodes set created_at = $2 where id = $1`, [episode.id, new Date(NOW.getTime() - 3_600_000).toISOString()]);
    await api.reveal(episode.id, creator);
    await heard(creator, episode.id);
    // No portrait: the house wouldn't take them out (lib/character-life.ts candidates), so it isn't promised.
    const plain = (await phoneFor(creator))!;
    expect(plain.next.map((n) => n.key)).toEqual(["recap"]);
    expect(plain.next[0].text).toBe("Sunday: Mira's week on the show");
    // On Sunday it comes today, and links to where it lands.
    const sunday = (await phoneFor(creator, new Date("2026-11-15T12:00:00Z")))!;
    expect(sunday.next.find((n) => n.key === "recap")).toMatchObject({ text: "Mira's week on the show comes today", href: "/notifications" });
    // With a portrait and a date behind them: the weekly date, and from which day once they've had one.
    const mine = (await listMyCharacters(t.db, userIdOf(creator))).map((c) => ({ ...c, portrait: "/api/assets/some-portrait" }));
    const withFace = (await characterPhone(t.db, userIdOf(creator), mine, NOW))!;
    expect(withFace.next.map((n) => n.key)).toEqual(["weekly", "recap"]);
    expect(withFace.next[0].text).toBe("The house takes Mira out on a date this week");
    await t.db.query(`update episodes set setup = setup || '{"met_via":"life"}'::jsonb, created_at = $2 where id = $1`, [episode.id, new Date(NOW.getTime() - 2 * 86_400_000).toISOString()]);
    expect((await characterPhone(t.db, userIdOf(creator), mine, NOW))!.next[0].text).toBe("The house takes Mira out again from Wednesday");
    // Turned off, paused, or a private character that isn't open to dates: not promised.
    expect((await characterPhone(t.db, userIdOf(creator), mine, NOW, { COMPANION_OPEN: "1", LIFE_DATES_PER_DAY: "0" }))!.next.some((n) => n.key === "weekly")).toBe(false);
    expect((await characterPhone(t.db, userIdOf(creator), mine, NOW, { COMPANION_OPEN: "1", BOTCHELOR_PAUSE: "1" }))!.next.some((n) => n.key === "weekly")).toBe(false);
    await t.db.query(`update characters set visibility = 'private', open_to_dates = false where id = $1`, [character.id]);
    expect((await characterPhone(t.db, userIdOf(creator), mine, NOW))!.next.some((n) => n.key === "weekly")).toBe(false);
  });
});

describe("several characters", () => {
  it("leads with the one that has an unread text, and lists the others as ways into their own threads or pages", async () => {
    const creator = newUserCookie();
    const me = userIdOf(creator);
    const date = async (name: string) => {
      const character = await (await api.createCharacter(validCharacter({ name }), creator)).json();
      scriptOutcome({ ending: "friends" });
      scriptedModel([episodeJson()]);
      const res = await api.createEpisode({ character_id: character.id, partner_id: H0.id }, creator);
      expect(res.status).toBe(200);
      return { character, episode: await res.json() };
    };
    const older = await date("Ada Lark");
    await t.db.query(`update episodes set created_at = $2 where id = $1`, [older.episode.id, new Date(NOW.getTime() - 3_600_000).toISOString()]);
    const newest = await (await api.createCharacter(validCharacter({ name: "Zed Novak" }), creator)).json();
    // Nobody has texted: the one something happened to most recently leads (Ada dated; Zed has done nothing).
    const quiet = (await phoneFor(creator))!;
    expect(quiet.character.id).toBe(older.character.id);
    expect(quiet.others.map((o) => o.character.id)).toEqual([newest.id]);
    expect(quiet.others[0]).toMatchObject({ href: `/characters/${newest.id}`, unread: false });

    // A second character dates later and stays quiet; Ada texts: the unread text wins over the newer date.
    const later = await date("Bea Moss");
    await t.db.query(`update episodes set created_at = $2 where id = $1`, [later.episode.id, new Date(NOW.getTime() + 3_600_000).toISOString()]);
    const r = await heard(creator, older.episode.id);
    const phone = (await phoneFor(creator))!;
    expect(phone.character.id).toBe(older.character.id);
    expect(phone.unread).toBe(true);
    expect(phone.others.map((o) => o.character.name)).toEqual(["Bea Moss", "Zed Novak"]);
    // Once read, the most recent thing that happened leads: Bea's date. Ada's row leads into her thread.
    await t.db.query(`update notifications set read_at = now() where user_id = $1`, [me]);
    const read = (await phoneFor(creator))!;
    expect(read.character.id).toBe(later.character.id);
    expect(read.others.find((o) => o.character.id === older.character.id)).toMatchObject({ href: `/companion/${r.thread_id}`, unread: false });
    const html = render(phone);
    expect(html).toContain("Your other characters");
    expect(html).toContain(`href="/characters/${newest.id}"`);
    expect(html).toContain(">Bea<");
    expect(PHONE_OTHERS).toBeGreaterThanOrEqual(2);
  });
});

describe("the home page", () => {
  const home = async () => {
    const Home = (await import("@/app/page")).default;
    return text(renderToStaticMarkup(await Home({ searchParams: Promise.resolve({}) })));
  };
  const as = (cookie: string) => jar.cookies.set(cookie.split("=")[0], cookie.split("=")[1]);

  it("a stranger sees no phone: the page they had", async () => {
    const html = await home();
    expect(html).not.toContain("char-phone");
    expect(html).toContain("<h1>Give your character a love life.</h1>");
    // A visitor with a cookie and no character, too.
    as(newUserCookie());
    expect(await home()).not.toContain("char-phone");
  });

  it("an owner lands on their character's phone, above the show and 'Since you were here'", async () => {
    const { creator, episode } = await setupEpisode("second_date");
    const r = await heard(creator, episode.id);
    as(creator);
    const html = await home();
    expect(html).toContain('id="phone"');
    expect(html).toContain("Open Mira's texts");
    expect(html).toContain(`href="/companion/${r.thread_id}"`);
    const phoneAt = html.indexOf('id="phone"');
    const sinceAt = html.indexOf("Since you were here");
    expect(phoneAt).toBeGreaterThan(-1);
    expect(sinceAt).toBeGreaterThan(phoneAt);
    // The stranger's hero is still on the page, below.
    expect(html.indexOf("<h1>Give your character a love life.</h1>")).toBeGreaterThan(sinceAt);
  });

  it("HOME_PHONE=0: the owner's page as it was", async () => {
    const { creator } = await setupEpisode("friends");
    vi.stubEnv("HOME_PHONE", "0");
    as(creator);
    const html = await home();
    expect(html).not.toContain("char-phone");
    expect(html).toContain("Since you were here");
  });
});
