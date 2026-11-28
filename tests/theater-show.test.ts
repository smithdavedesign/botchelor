// The date theater as a show (2026-11-28, Dave: "Do 1-6 … a small watching bot that reacts to dates … put a bot or agent
// tag next to their name"): the chemistry meter, entrances and acted endings, the confessional cutaway, the crowd and its
// peanut gallery of bots (lib/peanut-gallery.ts, lib/line-reactions.ts, app/episodes/[id]/Crowd.tsx), the moment card,
// the venue's sound bed (app/motion/beds.ts), and app/ux/theater-show.css.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import Scene from "@/app/Scene";
import Crowd from "@/app/episodes/[id]/Crowd";
import { GET as getReactions, POST as postReaction } from "@/app/api/episodes/[id]/reactions/route";
import { bedFor } from "@/app/motion/beds";
import type { CharacterRef } from "@/lib/game";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { TAG_AT, lineTag } from "@/lib/line-reactions";
import { GALLERY_BOTS, heckles } from "@/lib/peanut-gallery";
import { chemistryOf, chemistryWord, leaverOf } from "@/lib/theater-beats";
import { randomUUID } from "node:crypto";
import { BASE_URL, signedInCookie, startTestDb, TEST_SESSION_SECRET } from "./helpers";

const ROOT = join(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const css = read("app/ux/theater-show.css").replace(/\/\*[\s\S]*?\*\//g, "");

function outsideMotionBlocks(text: string): string {
  let out = "";
  let i = 0;
  const open = "@media (prefers-reduced-motion: no-preference)";
  while (i < text.length) {
    const at = text.indexOf(open, i);
    if (at < 0) return out + text.slice(i);
    out += text.slice(i, at);
    let j = text.indexOf("{", at);
    let depth = 0;
    for (; j < text.length; j++) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}" && --depth === 0) break;
    }
    i = j + 1;
  }
  return out;
}

const char = (id: string, name: string, extra: Partial<CharacterRef> = {}): CharacterRef => ({ id, name, house: false, hue: 200, portrait: null, ...extra });
type T = { side: "a" | "b"; act: number; dialogue: string; action: string; emotion: string; interest: number; walked_out?: true; move?: { say: string; to: string }; moved_to?: string };
const line = (side: "a" | "b", act: number, interest: number, dialogue = "Nice weather for it.", more: Partial<T> = {}): T => ({ side, act, dialogue, action: "", emotion: "calm", interest, ...more });

const DATE: T[] = [
  line("a", 0, 0.5, "So you're the famous one."),
  line("b", 0, 0.5, "Infamous, mostly. Do you like noodles?"),
  line("a", 0, 0.55, "I could eat."),
  line("b", 1, 0.8, "My mother would love you, which is a warning."),
  line("a", 1, 0.3, "I'm sorry, did you just bring up your ex?"),
  line("b", 2, 0.3, "Let's go somewhere quieter.", { move: { say: "Let's go", to: "jazz_bar" } }),
  line("a", 2, 0.1, "I'm leaving.", { walked_out: true }),
];

describe("the chemistry meter", () => {
  it("reads the table's warmth from each side's last interest, and breaks for good on a walk-out", () => {
    expect(chemistryOf([])).toEqual({ heat: 0.5, cracked: false });
    expect(chemistryOf([line("a", 0, 0.9)])).toEqual({ heat: 0.9, cracked: false });
    expect(chemistryOf([line("a", 0, 0.9), line("b", 0, 0.5)]).heat).toBeCloseTo(0.7);
    expect(chemistryOf(DATE).cracked).toBe(true);
    expect(chemistryWord(0.9)).toBe("Sparks flying");
    expect(chemistryWord(0.1)).toBe("Ice cold");
    expect(chemistryWord(0.9, true)).toBe("Heartbreak");
  });

  it("knows who walks off: the one who walked out, else the one whose interest ended lower", () => {
    expect(leaverOf(DATE)).toBe("a");
    expect(leaverOf([line("a", 0, 0.7), line("b", 0, 0.2)])).toBe("b");
    expect(leaverOf([line("a", 0, 0.2), line("b", 0, 0.7)])).toBe("a");
  });

  it("stands on the staged stage with its reading in words, the name cards on the entrance and the ending acted out", () => {
    const characters: [CharacterRef, CharacterRef] = [char("a", "Mara Vey"), char("b", "Dex Marlow")];
    const html = renderToStaticMarkup(
      createElement(Scene, {
        characters,
        venue: null,
        lineA: null,
        lineB: null,
        staged: { speaking: null, act: 0, push: false, heat: 0.85, cracked: false, cards: ["Wants someone who laughs first", null], ending: null },
      }),
    );
    expect(html).toContain('aria-label="Chemistry: Sparks flying"');
    expect(html).toContain("data-entering");
    expect(html.match(/class="scene-namecard"/g)).toHaveLength(2);
    expect(html).toContain("Wants someone who laughs first");
    const disaster = renderToStaticMarkup(createElement(Scene, { characters, venue: null, lineA: "Bye.", lineB: null, staged: { speaking: "a", act: 2, push: true, heat: 0.1, cracked: true, ending: "disaster", leaver: "a" } }));
    expect(disaster).toContain('data-ending="disaster"');
    expect(disaster).toContain('data-leaver="a"');
    expect(disaster).toContain("scene-meter-crack");
    const well = renderToStaticMarkup(createElement(Scene, { characters, venue: null, lineA: "See you.", lineB: null, staged: { speaking: "a", act: 2, push: false, heat: 0.9, ending: "second_date" } }));
    expect(well).toContain("scene-petals");
    const friends = renderToStaticMarkup(createElement(Scene, { characters, venue: null, lineA: "Pals.", lineB: null, staged: { speaking: "a", act: 2, push: false, heat: 0.5, ending: "friends" } }));
    expect(friends.match(/scene-wave/g)).toHaveLength(2);
    // Off the staged stage (filming, After Dark) there's no meter.
    expect(renderToStaticMarkup(createElement(Scene, { characters, venue: null, lineA: "Hi.", lineB: null }))).not.toContain("scene-meter");
  });
});

describe("the peanut gallery", () => {
  const names: [string, string] = ["Mara Vey", "Dex Marlow"];
  const said = heckles(DATE, names, "ep-1");

  it("heckles every big beat: the opening, the act turning over, a swing, a move, the walk-out", () => {
    const lines = new Set(said.map((h) => h.line));
    for (const i of [0, 3, 4, 5, 6]) expect(lines.has(i)).toBe(true);
    expect(said.find((h) => h.line === 6 && !h.replyTo)?.text).toMatch(/Mara|GONE|seat|Exit|Come back/);
  });

  it("is the same every replay, never repeats itself, and fills in names, never the characters' words", () => {
    expect(heckles(DATE, names, "ep-1")).toEqual(said);
    const texts = said.map((h) => h.text);
    expect(new Set(texts).size).toBe(texts.length);
    for (const t of texts) expect(t).not.toMatch(/\{s\}|\{o\}|\{to\}/);
    for (const t of texts) for (const d of DATE) expect(t).not.toContain(d.dialogue.slice(0, 18));
  });

  it("stays a back row: on a long quiet date about half the lines get a remark, never three quiet ones running", () => {
    const quiet = Array.from({ length: 60 }, (_, i) => line(i % 2 ? "b" : "a", 0, 0.5, "Nice weather for it, really nice."));
    const h = heckles(quiet, names, "ep-quiet");
    const lines = new Set(h.map((x) => x.line));
    expect(lines.size).toBeGreaterThan(15);
    expect(lines.size).toBeLessThan(50);
    for (let i = 3; i < 60; i++) expect([i, i - 1, i - 2, i - 3].some((j) => lines.has(j))).toBe(true);
  });

  it("wears a Bot tag on every remark, and says it's the show's bots", () => {
    const html = renderToStaticMarkup(createElement(Crowd, { episodeId: "ep-1", transcript: DATE as never, shown: DATE.length, names, on: true, moments: false }));
    const shownHeckles = (html.match(/class="crowd-heckle"/g) ?? []).length;
    expect(shownHeckles).toBeGreaterThan(0);
    expect((html.match(/class="crowd-bot-tag"[^>]*>Bot</g) ?? []).length).toBe(shownHeckles);
    expect(html).toContain("the show&#x27;s bots");
    for (const b of GALLERY_BOTS) expect(b.name).not.toMatch(/viewer|fan|user/i);
    // The 🍿 off: no bots.
    expect(renderToStaticMarkup(createElement(Crowd, { episodeId: "ep-1", transcript: DATE as never, shown: DATE.length, names, on: false, moments: false }))).not.toContain("crowd-heckle");
  });

  it("keeps its jokes to the date: none about looks, bodies or who someone is", () => {
    const src = read("lib/peanut-gallery.ts");
    const quoted = [...src.matchAll(/\["[a-z]+", "([^"]+)"\]/g)].map((m) => m[1]);
    expect(quoted.length).toBeGreaterThan(40);
    for (const q of quoted) expect(q).not.toMatch(/\b(ugly|fat|skinny|hot|sexy|old|weird looking|accent|race|gay|body|face)\b/i);
  });
});

describe("the crowd's counts", () => {
  it("tags a line once enough viewers did the same thing, with its most tapped kind", () => {
    expect(lineTag(undefined)).toBe(null);
    expect(lineTag({ cringe: TAG_AT - 1 })).toBe(null);
    expect(lineTag({ cringe: 12, swoon: 4 })).toEqual({ kind: "cringe", count: 12, text: "12 viewers cringed here" });
  });

  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  let n = 0;
  async function episode(visibility = "public"): Promise<string> {
    const id = `ep-crowd-${++n}`;
    const owner = randomUUID();
    await t.db.query(
      `insert into characters (id, owner_id, name, age, bio, traits, want, dealbreaker) values ($1, $2, 'Cass Vega', 33, 'A florist.', '["bold","gentle","precise"]'::jsonb, 'Quiet.', 'Fireworks.')`,
      [`c-${id}`, owner],
    );
    await t.db.query(
      `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, transcript, visibility, status)
       values ($1, $2, $3, $4, 'A bar.', '[]'::jsonb, '[]'::jsonb, 'Twist.', 'Finale.', 'friends', $5::jsonb, $6, 'ready')`,
      [id, owner, `c-${id}`, HOUSE_CHARACTERS[0].id, JSON.stringify(DATE.slice(0, 4)), visibility],
    );
    return id;
  }
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const tap = (id: string, body: unknown, cookie?: string) =>
    postReaction(new Request(`${BASE_URL}/api/episodes/${id}/reactions`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }), ctx(id));

  it("counts taps on lines the viewer can see, with no person stored, and gives them back to the next viewer", async () => {
    const ep = await episode();
    const viewer = signedInCookie(randomUUID());
    expect((await tap(ep, { line_index: 1, kind: "cringe" })).status).toBe(401);
    expect((await tap(ep, { line_index: 1, kind: "cringe" }, viewer)).status).toBe(200);
    await tap(ep, { line_index: 1, kind: "cringe" }, signedInCookie(randomUUID()));
    await tap(ep, { line_index: 3, kind: "swoon" }, viewer);
    expect((await tap(ep, { line_index: 9, kind: "swoon" }, viewer)).status).toBe(422);
    expect((await tap(ep, { line_index: 1, kind: "boo" }, viewer)).status).toBe(422);
    const res = await getReactions(new Request(`${BASE_URL}/api/episodes/${ep}/reactions`), ctx(ep));
    expect(await res.json()).toEqual({ lines: { 1: { cringe: 2 }, 3: { swoon: 1 } } });
    const cols = (await t.db.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'line_reactions'`)).rows.map((r) => r.column_name);
    expect(cols.sort()).toEqual(["count", "episode_id", "kind", "line_index", "updated_at"]);
  });

  it("is not found for a private date that isn't theirs", async () => {
    const ep = await episode("private");
    expect((await getReactions(new Request(`${BASE_URL}/api/episodes/${ep}/reactions`), ctx(ep))).status).toBe(404);
    expect((await tap(ep, { line_index: 0, kind: "dead" }, signedInCookie(randomUUID()))).status).toBe(404);
  });
});

describe("the rest of the show", () => {
  it("hears each place as its kind of room", () => {
    expect(bedFor("night_beach")).toBe("waves");
    expect(bedFor("jazz_bar@the corner")).toBe("murmur");
    expect(bedFor("nightclub")).toBe("club");
    expect(bedFor("rainy_campsite")).toBe("rain");
    expect(bedFor("stargazing_hill")).toBe("wind");
    expect(bedFor(null)).toBe("hum");
    expect(bedFor("elsewhere@a castle")).toBe("hum");
  });

  it("only plays sound once the viewer turned it on, through the site's one switch", () => {
    const beds = read("app/motion/beds.ts");
    expect(beds).toMatch(/if \(typeof window === "undefined" \|\| !soundOn\(\)\) return/);
    const theater = read("app/episodes/[id]/EpisodeTheater.tsx");
    expect(theater).toContain("<SoundToggle");
    expect(theater).toMatch(/if \(!sound\) return;\s+return startBed\(bed\);/);
  });

  it("shares a moment only from a public date that has aired", () => {
    const route = read("app/api/og/moment/[id]/[line]/route.tsx");
    expect(route).toContain('episode.revealed && episode.visibility === "public"');
    expect(route).toContain("getEpisodeView(db, id, null)");
    const page = read("app/episodes/[id]/page.tsx");
    expect(page).toContain('moments={episode.revealed && episode.visibility === "public" && !episode.hidden}');
  });

  it("moves nothing outside a no-preference block, and keeps its colours in tokens", () => {
    expect(outsideMotionBlocks(css)).not.toMatch(/(^|[\s;{])(animation|transition)\s*:/);
    const declarations = css.split("\n").filter((l) => !/^\s*--/.test(l));
    for (const l of declarations) expect(l).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });
});
