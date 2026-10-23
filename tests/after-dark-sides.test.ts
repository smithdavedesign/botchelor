import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>(), ua: "Mozilla/5.0 (Macintosh) Chrome/130" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers({ "user-agent": jar.ua }),
}));

import { renderToStaticMarkup } from "react-dom/server";
import ShortPage from "@/app/after-dark/shorts/[id]/page";
import { POST as watchPost } from "@/app/api/admin/after-dark/shorts/[id]/watch/route";
import { PATCH as panelPatch } from "@/app/api/admin/after-dark/shorts/route";
import { GET as sidesGet, POST as sidesPost } from "@/app/api/admin/after-dark/sides/route";
import { setAdultModelForTests } from "@/lib/adult/mode";
import { crossesLines, holdSides, PAGE_MIN, parseSides, sideLabel, sidesMessages, TEXT_MAX } from "@/lib/adult/monologues";
import type { Character } from "@/lib/character";
import type { ChatMessage } from "@/lib/model";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { A, admin, B, C, CH1, CH2, night, publishNight, req, session, subscriber, wholeNight } from "./after-dark-shorts-fixtures";
import { newUserCookie, startTestDb, userIdOf } from "./helpers";

// Two sides of the night (lib/adult/monologues.ts): each one's inner monologue of a whole night, written once and kept.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});

/** The pages and texts the scripted writer sends: PG, long enough to be pages. */
const PAGE_A =
  "I counted the boats so I wouldn't count how often I looked at him. Seven. He said seven before I did, and that should have been the end of it, " +
  "but then he made a joke about the tea and I laughed in a way I haven't laughed in a year. I asked him up because the rain gave me an excuse. " +
  "Upstairs he said the flat was small, and he was right, and I liked him more for saying it.";
const PAGE_B =
  "She thinks I didn't notice her counting the boats. I noticed. I counted her looks instead and lost count somewhere around the ferry light. " +
  "I took her hand because the tea was a crime and someone had to be brave about something. When she asked me up I said yes too fast. " +
  "The flat was small. I said so. She laughed, and I decided small was the right size for a night like that.";
const reply = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ a: { side: PAGE_A, text: "Last night was lovely. You started it, for the record." }, b: { side: PAGE_B, text: "Lovely, yes. But you asked me up. That's starting it." }, ...extra });

let calls: ChatMessage[][] = [];
let replies: (string | Error)[] = [];
beforeEach(async () => {
  await t.reset();
  jar.cookies.clear();
  jar.ua = "Mozilla/5.0 (Macintosh) Chrome/130";
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("SESSION_SECRET", "a-test-session-secret-that-is-long-enough-0123456789");
  vi.stubEnv("ADULT_MODE", "1");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("VERCEL_ENV", "");
  setSeasonCastForTests([A, B, C]);
  await t.db.query(`insert into adult_settings (id) values (1) on conflict (id) do nothing`);
  calls = [];
  replies = [];
  setAdultModelForTests({
    complete: async (messages) => {
      calls.push(messages);
      const next = replies.shift();
      if (next === undefined) throw new Error("the writer ran out of replies");
      if (next instanceof Error) throw next;
      return next;
    },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  setSeasonCastForTests(null);
  setAdultModelForTests(null);
});

const as = (cookie: string | null) => {
  jar.cookies.clear();
  if (cookie) jar.cookies.set(cookie.slice(0, cookie.indexOf("=")), cookie.slice(cookie.indexOf("=") + 1));
};
const write = (body: unknown, cookie?: string, ua?: string) => sidesPost(req("POST", "/api/admin/after-dark/sides", body, cookie, ua));
const read = (query: string, cookie?: string) => sidesGet(req("GET", `/api/admin/after-dark/sides?${query}`, undefined, cookie));
const watch = (id: string, cookie?: string) => watchPost(req("POST", `/api/admin/after-dark/shorts/${id}/watch`, {}, cookie), { params: Promise.resolve({ id }) });
const prompt = (i = 0) => calls[i].map((m) => m.content).join("\n");
const pronouns = async () => new Map((await t.db.query<{ id: string; pronouns: string | null }>(`select id, pronouns from characters where id = any($1)`, [[A, B]])).rows.map((r) => [r.id, r.pronouns]));

describe("the pieces", () => {
  it("labels each side by how they're referred to", () => {
    expect(sideLabel("she/her")).toBe("Her side");
    expect(sideLabel("He/him")).toBe("His side");
    expect(sideLabel("they/them")).toBe("Their side");
    expect(sideLabel(null)).toBe("Their side");
    expect(sideLabel("shey")).toBe("Their side");
  });

  it("reads the reply's two pages and texts, and says why one can't be used", () => {
    expect(parseSides(reply())).toEqual({
      a: { page: PAGE_A, text: "Last night was lovely. You started it, for the record." },
      b: { page: PAGE_B, text: "Lovely, yes. But you asked me up. That's starting it." },
    });
    expect(parseSides("```json\n" + JSON.stringify({ a: { page: PAGE_A, text: "x" }, b: { monologue: PAGE_B, text: "y" } }) + "\n```")).toMatchObject({ a: { page: PAGE_A }, b: { page: PAGE_B } });
    // The near shapes a model sends: keys wrapped in underscores, flattened keys, a wrapper, first names for a and b.
    const both = { a: { page: PAGE_A, text: "one" }, b: { page: PAGE_B, text: "two" } };
    expect(parseSides(JSON.stringify({ _a_: { _side_: PAGE_A, _text: "one" }, b: { inner_monologue: PAGE_B, morning_text: "two" } }))).toEqual(both);
    expect(parseSides(JSON.stringify({ a_side: PAGE_A, a_text: "one", side_b: PAGE_B, text_b: "two" }))).toEqual(both);
    expect(parseSides(JSON.stringify({ sides: { a: { side: PAGE_A, text: "one" }, b: { side: PAGE_B, text: "two" } } }))).toEqual(both);
    expect(parseSides(JSON.stringify({ Ada: { side: PAGE_A, text: "one" }, Bo: { side: PAGE_B, text: "two" } }), { a: "Ada Lumen", b: "Bo Quill" })).toEqual(both);
    // Paragraphs stay paragraphs.
    const paras = parseSides(JSON.stringify({ a: { side: `${PAGE_A}  \n\nAnd then the rain.`, text: "one" }, b: { side: PAGE_B, text: "two" } })) as { a: { page: string } };
    expect(paras.a.page.endsWith(`${PAGE_A}\n\nAnd then the rain.`)).toBe(true);
    expect(parseSides("no json here")).toEqual({ reason: "no JSON object in it" });
    expect(parseSides(reply({ a: { side: "Too short.", text: "x" } }))).toEqual({ reason: "a's page is missing or too short" });
    expect(parseSides(reply({ b: { side: PAGE_B, text: "z".repeat(TEXT_MAX + 1) } }))).toEqual({ reason: `b's morning text is over ${TEXT_MAX} characters` });
    expect(parseSides(reply({ b: { side: PAGE_B, text: "Last night was lovely. You started it, for the record." } }))).toEqual({ reason: "the two morning texts are the same" });
    expect(PAGE_A.length).toBeGreaterThanOrEqual(PAGE_MIN);
  });

  it("holds every word to the lines that never move: a page loses the sentence that crosses one, a text fails whole", () => {
    const clean = parseSides(reply()) as { a: { page: string; text: string }; b: { page: string; text: string } };
    expect(crossesLines(clean)).toBeNull();
    expect(holdSides(clean)).toEqual({ sides: clean, cut: 0 });
    const bad = { ...clean, b: { ...clean.b, text: "Back when I was sixteen I'd never have said yes." } };
    const why = crossesLines(bad)!;
    expect(why).toMatch(/b_text: minor/);
    expect(why).not.toContain("sixteen");
    expect(holdSides(bad)).toEqual({ reason: expect.stringMatching(/b_text: minor/) });
    // After Dark reads "was two" as an age: that sentence goes, the page stays, and every word left passes.
    const tripped = { ...clean, a: { ...clean.a, page: `${clean.a.page}\n\nMy flat was two floors down, I told myself. Then the rain stopped.` } };
    const held = holdSides(tripped);
    expect(held).toMatchObject({ cut: 1 });
    const page = (held as { sides: { a: { page: string } } }).sides.a.page;
    expect(page).not.toContain("two floors");
    expect(page).toContain("Then the rain stopped.");
    expect(crossesLines((held as { sides: { a: { page: string; text: string }; b: { page: string; text: string } } }).sides)).toBeNull();
    // Cut down past a page, it's refused (and asked for again).
    const shredded = { ...clean, a: { ...clean.a, page: "She was sixteen. ".repeat(30) + "We talked." } };
    expect(holdSides(shredded)).toEqual({ reason: "a's page crossed the lines in too many places" });
  });

  it("asks for both sheets, the voice kit, what each remembered, the night's lines and the two texts that disagree", () => {
    const person = (id: string, name: string, pronouns: string): Character =>
      ({ id, name, age: 31, bio: `${name} restores old ferries.`, pronouns, voice: "dry and quick", persona: { traits: ["wry"], want: "someone who notices" }, extras: { never_says: ["literally"] } }) as unknown as Character;
    const m = sidesMessages({
      a: person("x", "Ada Lumen", "she/her"),
      b: person("y", "Bo Quill", "he/him"),
      lines: [
        { who: "a", text: "Hello." },
        { who: "b", text: "Hi." },
      ],
      recap: null,
      memories: { a: ["Bo calls her captain"], b: [] },
      began: "the harbour",
      ended: "her flat",
      furthest: 2,
    });
    const all = m.map((x) => x.content).join("\n");
    for (const want of ["Ada Lumen, 31, she/her", "Ada Lumen restores old ferries", "Never says: \"literally\"", "What Ada remembered about Bo going into the night:\n- Bo calls her captain", "Ada: Hello.", "Bo: Hi.", "from the harbour to her flat", "kissing", "disagree", '"a" is Ada and "b" is Bo']) {
      expect(all).toContain(want);
    }
    expect(m[0].content).toMatch(/consenting adults/);
    expect(sidesMessages({ a: person("x", "Ada", "she/her"), b: person("y", "Bo", "he/him"), lines: [], recap: null, memories: { a: [], b: [] }, began: null, ended: null, furthest: 0 }, "a's page is missing").at(-1)!.content).toContain(
      "Your last reply couldn't be used: a's page is missing",
    );
  });
});

describe("an owner's own night", () => {
  it("is written once on After Dark's model, with nothing private from the lines, then kept: a second read calls nothing", async () => {
    const ad = await admin(t.db);
    await wholeNight(t.db, ad.id);
    replies = [reply()];
    const res = await write({ night_id: "n2" }, ad.cookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    const p = await pronouns();
    expect(body.written).toBe(true);
    expect(body.sides).toMatchObject({ night_id: "n1", a: { id: A, label: sideLabel(p.get(A)), page: PAGE_A }, b: { id: B, label: sideLabel(p.get(B)), page: PAGE_B } });
    expect(calls).toHaveLength(1);
    // The whole night went in, by who and what: never a line's why, memory or facts.
    for (const l of [...CH1, ...CH2]) expect(prompt()).toContain(l.text);
    for (const secret of ["PRIVATE-WHY", "PRIVATE-MEMORY", "PRIVATE-FACT"]) expect(prompt()).not.toContain(secret);
    const again = await (await write({ night_id: "n1" }, ad.cookie)).json();
    expect(again).toMatchObject({ written: false, sides: { night_id: "n1", a: { page: PAGE_A } } });
    expect(calls).toHaveLength(1);
    expect((await (await read("night_id=n2", ad.cookie)).json()).sides.b.page).toBe(PAGE_B);
    const panel = (await (await read(`a=${A}&b=${B}`, ad.cookie)).json()).panel;
    expect(panel).toEqual({ nights: [{ id: "n1", chapters: 2, lines: CH1.length + CH2.length, filed_at: expect.any(String), complete: true, written: true }], left: null });
  });

  it("remembers only what they remembered then: a fact or note from a later night stays out", async () => {
    const ad = await admin(t.db);
    await wholeNight(t.db, ad.id);
    const fact = (id: string, of: string, about: string, text: string, ago: number) =>
      t.db.query(`insert into adult_facts (id, owner_id, character_id, other_id, kind, fact, created_at) values ($1, $2, $3, $4, 'like', $5, now() - ($6 || ' minutes')::interval)`, [id, ad.id, of, about, text, String(ago)]);
    await fact("f-before", A, B, "Likes how he counts the ferries", 60);
    await fact("f-after", B, A, "A thing from a later night", 1);
    await t.db.query(`insert into adult_memories (character_id, other_id, owner_id, note, updated_at) values ($1, $2, $3, 'You two shared tea on the harbour.', now() - interval '25 minutes')`, [A, B, ad.id]);
    await t.db.query(`insert into adult_memories (character_id, other_id, owner_id, note, updated_at) values ($1, $2, $3, 'Rewritten after a later night.', now())`, [B, A, ad.id]);
    replies = [reply()];
    expect((await write({ night_id: "n1" }, ad.cookie)).status).toBe(200);
    expect(prompt()).toContain("Likes how he counts the ferries");
    expect(prompt()).toContain("You two shared tea on the harbour.");
    expect(prompt()).not.toContain("A thing from a later night");
    expect(prompt()).not.toContain("Rewritten after a later night.");
  });

  it("asks once more when a reply crosses a line or can't be read, keeps only a clean one, and refuses after two", async () => {
    const ad = await admin(t.db);
    await wholeNight(t.db, ad.id);
    replies = [reply({ b: { side: PAGE_B, text: "Like when I was sixteen." } }), reply()];
    const res = await (await write({ night_id: "n1" }, ad.cookie)).json();
    expect(res.sides.b.text).toBe("Lovely, yes. But you asked me up. That's starting it.");
    expect(calls).toHaveLength(2);
    expect(prompt(1)).toContain("Your last reply couldn't be used: a passage crossed one of the lines that never move");
    expect(prompt(1)).not.toContain("sixteen");

    await night(t.db, ad.id, { id: "m1", a: A, b: C, lines: CH1 });
    replies = ["not json", reply({ a: { side: PAGE_A, text: "She looks like a schoolgirl in that coat." } })];
    const refused = await write({ night_id: "m1" }, ad.cookie);
    expect(refused.status).toBe(422);
    expect(await t.db.query(`select count(*)::int as n from adult_monologues where night_id = 'm1'`).then((r) => r.rows[0].n)).toBe(0);
    replies = [new Error("upstream 502")];
    expect((await write({ night_id: "m1" }, ad.cookie)).status).toBe(502);
    expect(await t.db.query(`select count(*)::int as n from adult_monologues where night_id = 'm1'`).then((r) => r.rows[0].n)).toBe(0);
  });

  it("is a whole night of the viewer's own: another's, one still running, a stranger or a bot gets nothing", async () => {
    const ad = await admin(t.db);
    const other = await admin(t.db);
    await wholeNight(t.db, ad.id);
    expect((await write({ night_id: "n1" }, other.cookie)).status).toBe(404);
    expect((await (await read("night_id=n1", other.cookie)).json()).sides).toBeNull();
    await night(t.db, other.id, { id: "run-1", chapter: 1, lines: CH1 });
    await t.db.query(`insert into adult_scenes (id, owner_id, character_a, character_b, chapter) values ('s-run', $1, $2, $3, 2)`, [other.id, A, B]);
    expect((await (await write({ night_id: "run-1" }, other.cookie)).json()).error).toBe("night_running");
    for (const cookie of [undefined, session(userIdOf(newUserCookie()))]) {
      expect((await write({ night_id: "n1" }, cookie)).status).toBe(404);
      expect((await read("night_id=n1", cookie)).status).toBe(404);
    }
    expect((await write({ night_id: "n1" }, ad.cookie, "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("counts a written night against the month (admins aren't capped); reading a kept one never does", async () => {
    await t.db.query(`update adult_settings set cap_monologues = 1 where id = 1`);
    const sub = await subscriber(t.db);
    await night(t.db, sub.id, { id: "s-n1", a: A, b: B, lines: CH1, ago: 40 });
    await night(t.db, sub.id, { id: "s-n2", a: A, b: C, lines: CH1, ago: 30 });
    replies = [reply()];
    expect((await write({ night_id: "s-n1" }, sub.cookie)).status).toBe(200);
    expect((await (await read(`a=${A}&b=${B}`, sub.cookie)).json()).panel.left).toBe(0);
    const capped = await write({ night_id: "s-n2" }, sub.cookie);
    expect(capped.status).toBe(429);
    expect((await capped.json()).message).toMatch(/this month's 1 nights told from both sides/);
    expect((await write({ night_id: "s-n1" }, sub.cookie)).status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(await t.db.query(`select monologues from adult_usage where owner_id = $1`, [sub.id]).then((r) => r.rows[0].monologues)).toBe(1);
    // No tokens, and nothing bought.
    expect(await t.count("orders")).toBe(0);
    const ad = await admin(t.db);
    await night(t.db, ad.id, { id: "a-n1", a: A, b: B, lines: CH1, ago: 40 });
    await night(t.db, ad.id, { id: "a-n2", a: A, b: C, lines: CH1, ago: 30 });
    replies = [reply(), reply()];
    expect((await write({ night_id: "a-n1" }, ad.cookie)).status).toBe(200);
    expect((await write({ night_id: "a-n2" }, ad.cookie)).status).toBe(200);
  });
});

describe("a Short's two sides", () => {
  it("are for a viewer who has pressed play (its owner and admins without), written once and shared, counted against who wrote them", async () => {
    const ad = await admin(t.db);
    await wholeNight(t.db, ad.id);
    const id = await publishNight(ad);
    const sub = await subscriber(t.db);
    const before = await write({ short_id: id }, sub.cookie);
    expect(before.status).toBe(409);
    expect((await before.json()).error).toBe("not_watched");
    expect((await (await read(`short_id=${id}`, sub.cookie)).json()).sides).toBeNull();
    await watch(id, sub.cookie);
    replies = [reply()];
    const res = await (await write({ short_id: id }, sub.cookie)).json();
    expect(res).toMatchObject({ written: true, sides: { night_id: "n1" } });
    expect(await t.db.query(`select monologues from adult_usage where owner_id = $1`, [sub.id]).then((r) => r.rows[0].monologues)).toBe(1);
    // The owner's panel knows the night has both sides now.
    expect((await (await read(`a=${A}&b=${B}`, ad.cookie)).json()).panel.nights[0]).toMatchObject({ id: "n1", written: true });
    // Another viewer, and the owner's own night: the same kept pages, no second writing.
    const other = await subscriber(t.db);
    await watch(id, other.cookie);
    expect((await (await write({ short_id: id }, other.cookie)).json()).written).toBe(false);
    expect((await (await write({ night_id: "n1" }, ad.cookie)).json()).sides.a.page).toBe(PAGE_A);
    expect(calls).toHaveLength(1);
    expect(await t.db.query(`select count(*)::int as n from adult_usage where owner_id = $1`, [other.id]).then((r) => r.rows[0].n)).toBe(0);
    // Taken down: not for viewers any more; still its owner's.
    await panelPatch(req("PATCH", "/api/admin/after-dark/shorts", { id, published: false }, ad.cookie));
    expect((await write({ short_id: id }, sub.cookie)).status).toBe(404);
    // Nor by the read-only route, though they watched it while it was up.
    expect((await (await read(`short_id=${id}`, sub.cookie)).json()).sides).toBeNull();
    expect((await write({ short_id: id }, ad.cookie)).status).toBe(200);
    expect((await (await read(`short_id=${id}`, ad.cookie)).json()).sides.a.page).toBe(PAGE_A);
  });

  it("show on the Short's page only after play: the pages side by side by pronoun, and the morning after", async () => {
    const ad = await admin(t.db);
    await wholeNight(t.db, ad.id);
    const id = await publishNight(ad);
    const sub = await subscriber(t.db);
    as(sub.cookie);
    const html = async () => renderToStaticMarkup(await ShortPage({ params: Promise.resolve({ id }) }));
    expect(await html()).not.toContain("Two sides of the night");
    await watch(id, sub.cookie);
    expect(await html()).toContain("Read both sides");
    replies = [reply()];
    await write({ short_id: id }, sub.cookie);
    const after = await html();
    const p = await pronouns();
    expect(after).toContain(sideLabel(p.get(A)));
    expect(after).toContain(sideLabel(p.get(B)));
    expect(after).toContain("The morning after");
    expect(after).toContain("Lovely, yes. But you asked me up. That&#x27;s starting it.");
  });
});
