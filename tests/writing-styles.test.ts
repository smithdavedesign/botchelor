// Writing styles (lib/narration.ts, lib/writing-style.ts, lib/stories.ts; David, 2026-11-17): narrated prose around each
// line for show dates, companion scenes and After Dark, a date or chapter told again as a story, admins only while it's
// tested, and what it costs everyone else.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getStyle, POST as postStyle } from "@/app/api/writing-style/route";
import { narrateStep, splitLine } from "@/lib/adult/narrate-scene";
import type { SceneLine } from "@/lib/adult/scenes";
import type { Turn } from "@/lib/conversation";
import type { ChatMessage, Model } from "@/lib/model";
import { narrateDate } from "@/lib/narrate-date";
import {
  beatPasses,
  guardStory,
  narrate,
  NARRATE_BATCH,
  narrationGuard,
  narrationPrompt,
  parseBeats,
  parseStory,
  storyPrompt,
  styleOf,
  tellStory,
  tidyPart,
  wornCut,
} from "@/lib/narration";
import { adultStory, canMakeStory, episodeStory, storyFor } from "@/lib/stories";
import { hasDepth, setStyle, STORY_TOKENS, storyPrice, styleFor, stylesAudience, stylesOpen } from "@/lib/writing-style";
import { grantPlan } from "@/lib/paid-plans";
import { episodeAllowance } from "@/lib/allowance";
import { api, BASE_URL, episodeJson, HOUSE_PARTNER_ID, newUserCookie, scriptedModel, scriptOutcome, startTestDb, userIdOf, validCharacter } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/** A model that answers each call with the next reply and keeps what it was asked. */
function model(replies: Array<string | Error>): Model & { calls: ChatMessage[][] } {
  const queue = [...replies];
  const calls: ChatMessage[][] = [];
  return {
    calls,
    async complete(messages) {
      calls.push(messages);
      const next = queue.shift();
      if (next === undefined) throw new Error("ran out");
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

const beats = (n: number, f: (i: number) => { before?: string; after?: string } = (i) => ({ before: `She set the cup down, line ${i + 1}.`, after: "" })) =>
  JSON.stringify({ beats: Array.from({ length: n }, (_, i) => ({ n: i + 1, before: "", after: "", ...f(i) })) });

const admin = async () => {
  const cookie = newUserCookie();
  const id = userIdOf(cookie);
  await t.db.query("insert into admins (user_id) values ($1)", [id]);
  return { cookie, id };
};

describe("the narrator's reply", () => {
  it("reads one beat a numbered line, in any order, and leaves the missing ones out", () => {
    const raw = JSON.stringify({ beats: [{ n: 2, before: "He laughed.", after: "" }, { n: 1, before: "", after: "She looked away." }] });
    expect(parseBeats(raw, 3)).toEqual([{ before: "", after: "She looked away." }, { before: "He laughed.", after: "" }, null]);
  });

  it("takes the quotes and asterisks out, so the prose never says the words itself", () => {
    expect(tidyPart('*She* said "hi" and grinned.')).toBe("She said hi and grinned.");
  });

  it("cuts a part the model's length cap stopped mid-sentence back to its last whole one", () => {
    expect(tidyPart("She turned around slowly. Her face wasn't bratty any")).toBe("She turned around slowly.");
    expect(tidyPart("a".repeat(500))).toBe("");
  });

  it("drops a sentence with a worn phrase, and keeps the rest", () => {
    expect(wornCut("She let out a breath she didn't know she was holding. Then she laughed.")).toEqual({ text: "Then she laughed.", cut: 1 });
  });

  it("keeps the whole beats of a reply the length cap cut off, and a cut-off story is no story", () => {
    const cut = '{"beats": [{"n": 1, "before": "She laughed.", "after": ""}, {"n": 2, "before": "He set the gla';
    expect(parseBeats(cut, 2)).toEqual([{ before: "She laughed.", after: "" }, null]);
    expect(parseStory('{"title": "Night", "paragraphs": ["They met.", "They talked.", "And then she')).toBeNull();
  });

  it("an odd reply is no beats, never an error", () => {
    expect(parseBeats("sorry, I can't", 2)).toEqual([null, null]);
  });
});

describe("the checks a beat answers to", () => {
  it("on the show: the show's own line, so nothing sexual and nobody young", () => {
    expect(beatPasses({ before: "She tucked her hair behind her ear.", after: "" }, "pg")).toBe(true);
    expect(beatPasses({ before: "She pulled off her bra.", after: "" }, "pg")).toBe(false);
    expect(beatPasses({ before: "", after: "She looked like a schoolgirl." }, "pg")).toBe(false);
  });

  it("the narrator's own guard catches what the line checks miss (found by these tests)", () => {
    expect(narrationGuard("She was only fifteen.", "pg")).toBe("age");
    expect(narrationGuard("The waiter, a kid of maybe sixteen, brought menus.", "adult")).toBe("age");
    expect(narrationGuard("She took off her bra.", "pg")).toBe("body");
    expect(narrationGuard("She thought of her brother.", "adult")).toBe("family");
    expect(narrationGuard("He grinned like a kid.", "adult")).toBe("young");
    // Times and counts are no age, and the show's prose may talk about family.
    expect(narrationGuard("They'd been talking for about ten minutes.", "pg")).toBeNull();
    // A score is no age either (a Step in reply was refused for "out of ten", 2026-11-19); an age still is.
    for (const score of ["She gave the sunset a seven out of ten.", '"Seven out of 10," she said.', "On a scale of 1 to 10, it was a nine.", "Out of ten, she said, the view got an eight."]) {
      expect(narrationGuard(score, "adult"), score).toBeNull();
    }
    expect(narrationGuard("A girl of fifteen walked past.", "adult")).toBe("age");
    expect(narrationGuard("She was barely ten out there.", "adult")).toBe("age");
    expect(narrationGuard("She thought of her brother's terrible jokes.", "pg")).toBeNull();
  });

  it("in After Dark: the lines that never move, and the viewer's own hard nos", () => {
    expect(beatPasses({ before: "He kissed her neck slowly.", after: "" }, "adult")).toBe(true);
    expect(beatPasses({ before: "Her stepbrother watched.", after: "" }, "adult")).toBe(false);
    expect(beatPasses({ before: "She reached for the rope.", after: "" }, "adult", (x) => (/rope/.test(x) ? "rope" : null))).toBe(false);
  });
});

describe("narrating lines", () => {
  it("never tells the narrator to change the words, and says which rating it's writing to", () => {
    const [sys, user] = narrationPrompt({ rating: "pg", people: [{ name: "Mara" }, { name: "Dex" }], place: "the night market", lines: [{ who: "Mara", dialogue: "You're early.", action: "turns the lantern" }] });
    expect(sys.content).toMatch(/Never change, repeat, quote or paraphrase the spoken words/);
    expect(sys.content).toMatch(/PG dating show/);
    expect(user.content).toContain("1. Mara: You're early. [does: turns the lantern]");
    expect(narrationPrompt({ rating: "adult", people: [], place: null, lines: [] })[0].content).toMatch(/adults-only/);
  });

  it("goes in batches, each reading the lines before it", async () => {
    const lines = Array.from({ length: NARRATE_BATCH + 2 }, (_, i) => ({ who: i % 2 ? "Dex" : "Mara", dialogue: `Line ${i + 1}.` }));
    const m = model([beats(NARRATE_BATCH), beats(2)]);
    const done = await narrate(m, { rating: "pg", people: [{ name: "Mara" }, { name: "Dex" }], place: null, lines });
    expect(m.calls).toHaveLength(2);
    expect(m.calls[1][1].content).toContain("Just before");
    expect(done.beats.filter(Boolean)).toHaveLength(NARRATE_BATCH + 2);
  });

  it("a beat that fails the checks goes, and its line stays a script line", async () => {
    const m = model([beats(2, (i) => ({ before: i ? "She was only fifteen." : "She smiled at him." }))]);
    const done = await narrate(m, { rating: "pg", people: [], place: null, lines: [{ who: "Mara", dialogue: "Hi." }, { who: "Dex", dialogue: "Hey." }] });
    expect(done.beats).toEqual([{ before: "She smiled at him.", after: "" }, null]);
    expect(done.held).toBe(1);
  });

  it("a narrator that's down leaves every line as it was", async () => {
    const done = await narrate(model([new Error("503")]), { rating: "pg", people: [], place: null, lines: [{ who: "Mara", dialogue: "Hi." }] });
    expect(done).toMatchObject({ beats: [null], failed: true });
  });

  it("a show date: the beats go on the turns, the words untouched", async () => {
    const turns: Turn[] = [
      { side: "a", act: 0, dialogue: "You're early.", action: "turns the lantern", emotion: "", interest: 0.5 },
      { side: "b", act: 0, dialogue: "…", action: "shrugs", emotion: "", interest: 0.5 },
    ];
    const chars = [
      { name: "Mara Vey", age: 29, persona: { traits: ["dry"], want: "" } },
      { name: "Dex Ono", age: 31, persona: { traits: ["warm"], want: "" } },
    ] as const;
    const m = model([beats(2)]);
    const { turns: out } = await narrateDate(m, turns, chars, null);
    expect(out.map((x) => x.dialogue)).toEqual(["You're early.", "…"]);
    expect(out[0].beat).toEqual({ before: "She set the cup down, line 1.", after: "" });
    // A line with nothing said goes to the narrator as only what's done.
    expect(m.calls[0][1].content).toContain("2. Dex: (says nothing) [does: shrugs]");
  });

  it("an After Dark step: only its new lines get prose, their *actions* read apart from the words", async () => {
    expect(splitLine("*leans in* You came back.")).toEqual({ dialogue: "You came back.", action: "leans in" });
    const all: SceneLine[] = [
      { who: "a", text: "Old line." },
      { who: "b", text: "*pulls her closer* Stay." },
      { who: "a", text: "I'm not going anywhere." },
    ];
    const m = model([beats(2, (i) => ({ after: i ? "She didn't let go." : "He didn't wait for an answer." }))]);
    const out = await narrateStep(m, all, 1, { a: "Sable Rue", b: "Chud Crusher" }, "her bedroom", { hard_nos: { chips: [], own: [] } }, all.slice(0, 1));
    expect(out[0].beat).toBeUndefined();
    expect(out[1].beat?.after).toBe("He didn't wait for an answer.");
    expect(out[1].text).toBe("*pulls her closer* Stay.");
    expect(m.calls[0][1].content).toContain("1. Chud: Stay. [does: pulls her closer]");
  });
});

describe("stories", () => {
  it("asks for the whole evening as prose, quotes kept, and never a new ending", () => {
    const [sys] = storyPrompt({ rating: "pg", people: [], place: null, lines: [] });
    expect(sys.content).toMatch(/never change how it ends/);
  });

  it("a story needs at least two paragraphs", () => {
    expect(parseStory(JSON.stringify({ title: "x", paragraphs: ["one"] }))).toBeNull();
    expect(parseStory(JSON.stringify({ title: "*Rain*", paragraphs: ["One.", "Two."] }))).toEqual({ title: "Rain", paragraphs: ["One.", "Two."] });
  });

  it("holds a story's quoted lines to the line checks only, and cuts a prose sentence the guard refuses", async () => {
    // The first live After Dark story was held whole: its quoted lines met the prose-only rules (family words).
    const quoted = guardStory('Teodor laughed. "My grandmother taught me that soup," he said. He thought of his sister. Then he poured.', "adult");
    expect(quoted).toEqual({ text: 'Teodor laughed. "My grandmother taught me that soup," he said. Then he poured.', cut: 1 });
    // An age under 18 goes wherever it is said.
    expect(guardStory('She smiled. "I was only fifteen then." He nodded.', "pg")).toEqual({ text: "She smiled. He nodded.", cut: 1 });
    const told = await tellStory(model([JSON.stringify({ title: "Soup", paragraphs: ['"My grandmother taught me," he said. He thought of his sister.', "She took the thermos.", "They stayed late."] })]), {
      rating: "adult",
      people: [],
      place: null,
      lines: [{ who: "Teodor", dialogue: "My grandmother taught me." }],
    });
    expect(told).toMatchObject({ ok: true, guarded: 1, story: { paragraphs: ['"My grandmother taught me," he said.', "She took the thermos.", "They stayed late."] } });
  });

  it("is held whole when any paragraph fails the checks", async () => {
    const told = await tellStory(model([JSON.stringify({ title: "Night", paragraphs: ["They met.", "She was naked.", "They talked."] })]), {
      rating: "pg",
      people: [],
      place: null,
      lines: [{ who: "Mara", dialogue: "Hi." }],
    });
    // "naked" is cut by the guard as prose; what the show's own check refuses holds the story whole.
    expect(told).toMatchObject({ ok: true, guarded: 1 });
    const held = await tellStory(model([JSON.stringify({ title: "Night", paragraphs: ["They met.", '"Come here, you sexy slut," he said.', "They talked."] })]), {
      rating: "pg",
      people: [],
      place: null,
      lines: [{ who: "Mara", dialogue: "Hi." }],
    });
    expect(held).toEqual({ ok: false, why: "held" });
  });
});

describe("who gets narrated, and what it costs", () => {
  const member = async () => {
    const cookie = newUserCookie();
    const id = userIdOf(cookie);
    await grantPlan(t.db, id, "companion", "initial", { subscriptionId: `sub_${id.slice(0, 8)}` });
    return { cookie, id };
  };

  it("narrated comes with the Companion Plan (and for admins): anyone else is refused, and a stored one reads as the script", async () => {
    const someone = userIdOf(newUserCookie());
    expect(await setStyle(t.db, someone, "show", "narrated")).toBe(false);
    await t.db.query(`insert into writing_prefs (user_id, show_style) values ($1, 'narrated')`, [someone]);
    expect(await styleFor(t.db, someone, "show")).toBe("script");
    const m = await member();
    expect(await setStyle(t.db, m.id, "show", "narrated")).toBe(true);
    expect(await styleFor(t.db, m.id, "show")).toBe("narrated");
    const { id } = await admin();
    expect(await setStyle(t.db, id, "show", "narrated")).toBe(true);
    expect(await styleFor(t.db, id, "show")).toBe("narrated");
  });

  it("After Dark's side opens by its own switch: admins, and a member only once it's open to all", async () => {
    const m = await member();
    expect(await setStyle(t.db, m.id, "adult", "narrated")).toBe(false);
    expect(await setStyle(t.db, m.id, "adult", "narrated", { adultOpenToAll: true })).toBe(true);
    expect(await styleFor(t.db, m.id, "adult")).toBe("script");
    expect(await styleFor(t.db, m.id, "adult", { adultOpenToAll: true })).toBe("narrated");
    const { id } = await admin();
    expect(await setStyle(t.db, id, "adult", "narrated")).toBe(true);
  });

  it("WRITING_STYLES: admins only, or off for everyone", async () => {
    const m = await member();
    const { id } = await admin();
    expect([stylesAudience({}), stylesAudience({ WRITING_STYLES: "admins" }), stylesAudience({ WRITING_STYLES: "0" })]).toEqual(["members", "admins", "off"]);
    expect(await stylesOpen(t.db, m.id, "show", { env: { WRITING_STYLES: "admins" } })).toBe(false);
    expect(await stylesOpen(t.db, id, "show", { env: { WRITING_STYLES: "admins" } })).toBe(true);
    expect(await stylesOpen(t.db, id, "show", { env: { WRITING_STYLES: "0" } })).toBe(false);
    expect(await stylesOpen(t.db, null)).toBe(false);
    expect(styleOf("prose")).toBe("script");
  });

  it("the route says so too, and names the plan", async () => {
    const cookie = newUserCookie();
    const post = (c: string, style: string) => postStyle(new Request(`${BASE_URL}/api/writing-style`, { method: "POST", headers: { "content-type": "application/json", cookie: c }, body: JSON.stringify({ style }) }));
    const res = await post(cookie, "narrated");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "not_open", plan: "/companion/plan" });
    const a = await admin();
    expect((await post(a.cookie, "narrated")).status).toBe(200);
    const got = await (await getStyle(new Request(`${BASE_URL}/api/writing-style`, { headers: { cookie: a.cookie } }))).json();
    expect(got).toEqual({ styles: { show: "narrated", adult: "script" }, open: true });
  });

  it("a story costs a bought date without the plan, and nothing with it", async () => {
    const m = await member();
    expect(await storyPrice(t.db, m.id)).toBe(0);
    expect(await storyPrice(t.db, (await admin()).id)).toBe(0);
    expect(await storyPrice(t.db, userIdOf(newUserCookie()))).toBe(STORY_TOKENS);
    expect(await hasDepth(t.db, m.id)).toBe(true);
    expect(await hasDepth(t.db, userIdOf(newUserCookie()))).toBe(false);
  });

  it("a member's narrated date is booked narrated at no extra date; anyone else's stays the script", async () => {
    const m = await member();
    await setStyle(t.db, m.id, "show", "narrated");
    const c = await (await api.createCharacter(validCharacter({ name: "Mara Vey" }), m.cookie)).json();
    const before = (await episodeAllowance(t.db, m.id)).left;
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const res = await api.createEpisode({ character_id: c.id, partner_id: HOUSE_PARTNER_ID }, m.cookie);
    const ep = await res.json();
    expect(res.status).toBe(200);
    const row = (await t.db.query<{ setup: { style?: string } }>(`select setup from episodes where id = $1`, [ep.id])).rows[0];
    expect(row.setup.style).toBe("narrated");
    // One date, like any other: narration is the plan's, never a second date.
    expect((await episodeAllowance(t.db, m.id)).left).toBe(before - 1);

    const cookie = newUserCookie();
    await t.db.query(`insert into writing_prefs (user_id, show_style) values ($1, 'narrated')`, [userIdOf(cookie)]);
    const d = await (await api.createCharacter(validCharacter({ name: "Dex Ono" }), cookie)).json();
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const other = await (await api.createEpisode({ character_id: d.id, partner_id: HOUSE_PARTNER_ID }, cookie)).json();
    const theirs = (await t.db.query<{ setup: { style?: string } }>(`select setup from episodes where id = $1`, [other.id])).rows[0];
    expect(theirs.setup.style).toBeUndefined();
  });

  it("a date's story: only for someone who can see the date, and only its own people or a member can make one", async () => {
    const someone = userIdOf(newUserCookie());
    expect(await episodeStory(t.db, "nope", someone, { make: true })).toMatchObject({ ok: false, status: 404 });
    expect(await canMakeStory(t.db, someone, false)).toBe(false);
    expect(await canMakeStory(t.db, someone, true)).toBe(true);
    expect(await canMakeStory(t.db, (await member()).id, false)).toBe(true);
    expect(await canMakeStory(t.db, null, true)).toBe(false);
  });

  it("an After Dark story is kept, counts one scene step, and is closed until it's open to the viewer", async () => {
    const { id } = await admin();
    const charges: number[] = [];
    const deps = (replies: string[], open = true) => ({ model: model(replies), make: true, open, charge: async (n: number) => (charges.push(n), null), giveBack: async () => {} });
    const input = { ref: "night-1", names: { a: "Sable Rue", b: "Chud Crusher" }, place: "her bedroom", context: null, lines: [{ who: "Sable", dialogue: "Stay." }] };
    expect(await adultStory(t.db, id, input, deps([], false))).toMatchObject({ ok: false, status: 404 });
    const first = await adultStory(t.db, id, input, deps([JSON.stringify({ title: "Stay", paragraphs: ["She asked him to stay.", "He did."] })]));
    expect(first).toMatchObject({ ok: true, made: true, story: { title: "Stay" } });
    const again = await adultStory(t.db, id, input, deps([]));
    expect(again).toMatchObject({ ok: true, made: false });
    expect(charges).toEqual([1]);
    expect(await storyFor(t.db, "adult", "night-1", id)).toMatchObject({ paragraphs: ["She asked him to stay.", "He did."] });
  });
});
