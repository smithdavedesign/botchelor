// A stranger's first screen on home (lib/home-open.ts, app/HomeOpen.tsx; the design system's first screen B, 2026-11-18):
// the hook from a history, the chip, where the one call goes and what it says, the cast line, the eyebrow and next month's
// line; then the home page itself for a stranger on a story arc's night, with the switch off, and for a creator.
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
import { addLink } from "@/lib/character-links";
import { homeOpenOn, hookOf, linkLabel, openKicker, openLine, openTonight, OPEN_HOOK_MAX, type OpenFace } from "@/lib/home-open";
import { dayOf } from "@/lib/producer";
import { seasonIdOf } from "@/lib/season-window";
import { api, newUserCookie, startTestDb, validCharacter } from "./helpers";

const SABLE_TEO =
  "They dated one summer. On their anniversary Sable threw Teo a surprise party and proposed in front of everyone. He took the ring box home and never opened it. Neither has mentioned it since.";
const BOAZ_MARISOL =
  "Marisol's paper ran Boaz's cup-stacking record under the headline 'Local Man Stacks Cups, Loses Best Friend'. He wrote to the editor every week for a year. She kept every letter.";

const face = (id: string, name = id): OpenFace => ({ id, name, hue: null, portrait: null });

describe("the first screen's words", () => {
  it("takes a history's sting from its end: whole sentences that fit, always the last one", () => {
    expect(hookOf(SABLE_TEO)).toBe("He took the ring box home and never opened it. Neither has mentioned it since.");
    expect(hookOf(BOAZ_MARISOL)).toBe("He wrote to the editor every week for a year. She kept every letter.");
    expect(hookOf(SABLE_TEO).length).toBeLessThanOrEqual(OPEN_HOOK_MAX);
    // One long sentence is still said, whole; so is a line with no full stop.
    const long = "A".repeat(120) + ".";
    expect(hookOf(long)).toBe(long);
    expect(hookOf("  They met at a   wedding  ")).toBe("They met at a wedding");
  });

  it("names the pair's history in a word", () => {
    expect(linkLabel("exes")).toBe("Exes");
    expect(linkLabel("a fake couple")).toBe("Fake couple");
    expect(linkLabel("best friends")).toBe("Best friends");
  });

  it("puts tonight's people in the middle of the cast, never twice, and leaves a phone room for them", () => {
    const cast = ["a", "b", "c", "d", "e"].map((id) => face(id));
    const two = openLine(cast, [face("c"), face("x")]);
    expect(two.map((s) => `${s.face.id}${s.lead ? "*" : ""}`)).toEqual(["a", "b", "c*", "x*", "d", "e"]);
    const three = openLine(cast, [face("x"), face("y"), face("z")]);
    expect(three.map((s) => `${s.face.id}${s.lead ? "*" : ""}`)).toEqual(["a", "x*", "y*", "z*", "b"]);
    expect(openLine([], [face("x"), face("y")]).every((s) => s.lead)).toBe(true);
  });

  it("says where in the season tonight is (the strip under the header, which the screen stands in for)", () => {
    const k = openKicker(new Date("2026-11-18T20:00:00Z"), null);
    expect(k?.head).toBe("Season 2 · Night 18");
    expect(k?.long).toMatch(/^\d+ days to the finale$/);
    expect(k?.short).toMatch(/^\d+ days left$/);
  });

  it("is on unless HOME_OPEN=0", () => {
    expect(homeOpenOn({})).toBe(true);
    expect(homeOpenOn({ HOME_OPEN: "0" })).toBe(false);
  });
});

describe("home's first screen", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    await t.db.query("delete from story_beats");
    await t.db.query("delete from character_links");
    jar.cookies.clear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const text = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  const home = async () => text(renderToStaticMarkup(await (await import("@/app/page")).default({ searchParams: Promise.resolve({}) })));

  /** Today's beat: the first date of Sable and Teo's arc, with their history on record. */
  async function arcNight() {
    const now = new Date();
    await t.db.query(
      `insert into story_beats (day, season_id, kind, status, tension, who, about, logline, previously, tonight, arc)
       values ($1, $2, 'arc_step', 'staged', null, $3::jsonb, null, 'x', 'Previously: they dated.', 'Tonight: the exes meet again.', $4::jsonb)`,
      [dayOf(now), seasonIdOf(now), JSON.stringify(["house-sable", "house-teo"]), JSON.stringify({ id: "arc-1", kind: "second_chance", step: "spark", roleplay: null, first: null })],
    );
    await addLink(t.db, "house-sable", "house-teo", "second_chance", SABLE_TEO, "admin");
  }

  it("reads tonight's arc: the two of them, the history in a word, its sting", async () => {
    await arcNight();
    const tonight = await openTonight(t.db);
    expect(tonight).toMatchObject({ names: "Sable × Teo", label: "Exes", text: hookOf(SABLE_TEO), episode: null });
    expect(tonight?.who.map((w) => w.id)).toEqual(["house-sable", "house-teo"]);
  });

  it("opens a stranger's home as one screen: the stage, the promise, the box and the clip (2026-11-21)", async () => {
    await arcNight();
    const html = await home();
    // On a phone the clip stands on the stage, playing in the first screen (HOME_PHONE_CLIP, 2026-11-23).
    expect(html).toContain('class="home-open home-open--one home-open--arc home-open--on-stage"');
    expect(html).toContain("An AI blind-date show where nobody steers.");
    // Plain words where the season's number and night stood, and tonight's two step forward on the stage without their
    // story being told: a stranger has no season yet (the growth plan's "assumed context").
    expect(html).toContain('<p class="kicker home-open-kicker">A new blind date every night</p>');
    expect(html.match(/class="home-open-lead"/g)?.length).toBe(2);
    expect(html).not.toContain(">Exes<");
    expect(html).not.toContain("He took the ring box home and never opened it.");
    expect(html).not.toMatch(/Season \d+ · Night/);
    expect(html).toContain("Describe a character in a sentence.");
    expect(html).toContain("You watch it air. Free, no sign-up.");
    expect(html).toContain("Fictional characters only, no real people. Every date is written by AI.");
    // One h1 on the page, and no second hero under the screen.
    expect(html.match(/<h1\b/g)?.length).toBe(1);
    expect(html).not.toContain("hero-title");
    expect(html).not.toContain('class="hero');
    // The one action and the clip are inside the screen, in that order; nothing else in it asks for a click.
    const screen = html.slice(html.indexOf('class="home-open home-open--one'), html.indexOf('class="home-open-tail"'));
    expect(screen.indexOf('class="home-express"')).toBeGreaterThan(screen.indexOf("home-open-title"));
    expect(screen.indexOf('class="home-open-clip"')).toBeGreaterThan(screen.indexOf('class="home-express"'));
    expect(screen.match(/<a\b/g)?.length).toBe(1); // the clip's own way to watch
    expect(screen).not.toContain('data-track="open-watch"');
  });

  it("with HOME_PHONE_CLIP=0 keeps the screen, the cast as one line and the clip under the box (2026-11-21)", async () => {
    await arcNight();
    vi.stubEnv("HOME_PHONE_CLIP", "0");
    const html = await home();
    expect(html).toContain('class="home-open home-open--one home-open--arc"');
    expect(html).not.toContain("home-open--on-stage");
    expect(html).not.toContain("home-open-side");
    expect(html).toContain('<ul class="home-open-cast" aria-hidden="true">');
    expect(html.match(/class="home-open-lead"/g)?.length).toBe(2);
    const screen = html.slice(html.indexOf('class="home-open home-open--one'), html.indexOf('class="home-open-tail"'));
    expect(screen.indexOf('class="home-open-clip"')).toBeGreaterThan(screen.indexOf('class="home-express"'));
  });

  it("with one-sentence create off, the screen's one action is a plain button", async () => {
    vi.stubEnv("HOME_EXPRESS_BOX", "0");
    const html = await home();
    expect(html).not.toContain("home-express");
    expect(html).toContain('<a class="button" data-track="open-create" href="/create">Make your character</a>');
    expect(html).toContain("Make a character in a minute.");
  });

  it("is gone with HOME_OPEN=0, and for someone with a character", async () => {
    await arcNight();
    vi.stubEnv("HOME_OPEN", "0");
    let html = await home();
    expect(html).not.toContain("home-open");
    expect(html).toMatch(/<h1 class="hero-title">Give your character a love life\.<\/h1>/);
    vi.unstubAllEnvs();
    const owner = newUserCookie();
    expect((await api.createCharacter(validCharacter({ name: "Pell Ardent" }), owner)).status).toBeLessThan(300);
    jar.cookies.set(owner.split("=")[0], owner.split("=")[1]);
    html = await home();
    expect(html).not.toContain("home-open");
  });
});
