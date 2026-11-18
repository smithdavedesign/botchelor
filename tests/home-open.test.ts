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
import { homeOpenOn, hookOf, linkLabel, nextSeasonLine, openKicker, openLine, openTonight, openWatch, OPEN_HOOK_MAX, type OpenFace } from "@/lib/home-open";
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

  it("only says tonight about tonight's date; then a live one, the week's best, the newest, the show", () => {
    const featured = { share_path: "/episodes/e9" };
    expect(openWatch({ tonight: { episode: "e1" }, live: { room_path: "/watch/r1" }, featured, best: true })).toEqual({ href: "/episodes/e1?play=1", label: "Watch tonight's date" });
    expect(openWatch({ tonight: { episode: null }, live: { room_path: "/watch/r1" }, featured, best: true })).toEqual({ href: "/watch/r1", label: "Watch a date live" });
    expect(openWatch({ tonight: null, live: null, featured, best: true })).toEqual({ href: "/episodes/e9?play=1", label: "Watch this week's best date" });
    expect(openWatch({ tonight: null, live: null, featured, best: false }).label).toBe("Watch the latest date");
    expect(openWatch({ tonight: null, live: null, featured: null, best: false })).toEqual({ href: "/watch", label: "Watch the show" });
  });

  it("puts tonight's people in the middle of the cast, never twice, and leaves a phone room for them", () => {
    const cast = ["a", "b", "c", "d", "e"].map((id) => face(id));
    const two = openLine(cast, [face("c"), face("x")]);
    expect(two.map((s) => `${s.face.id}${s.lead ? "*" : ""}`)).toEqual(["a", "b", "c*", "x*", "d", "e"]);
    const three = openLine(cast, [face("x"), face("y"), face("z")]);
    expect(three.map((s) => `${s.face.id}${s.lead ? "*" : ""}`)).toEqual(["a", "x*", "y*", "z*", "b"]);
    expect(openLine([], [face("x"), face("y")]).every((s) => s.lead)).toBe(true);
  });

  it("says where in the season tonight is, and next month's format with its lead when known", () => {
    const k = openKicker(new Date("2026-11-18T20:00:00Z"), null);
    expect(k?.head).toBe("Season 2 · Night 18");
    expect(k?.long).toMatch(/^\d+ days to the finale$/);
    expect(k?.short).toMatch(/^\d+ days left$/);
    expect(nextSeasonLine("December", "The Botchelor", { month: "December", name: "Nell Abiodun" })).toBe("December: The Botchelor, with Nell.");
    expect(nextSeasonLine("December", "The Botchelor", { month: "November", name: "Nell Abiodun" })).toBe("December: The Botchelor.");
    expect(nextSeasonLine("December", null, null)).toBeNull();
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

  it("opens a stranger's home on the stage, with the hero a level down under it", async () => {
    await arcNight();
    const html = await home();
    expect(html).toContain('class="home-open home-open--arc"');
    expect(html).toContain("A blind-date show where nobody steers.");
    expect(html).toContain("Sable × Teo. ");
    expect(html).toContain(">Exes<");
    expect(html).toContain("He took the ring box home and never opened it.");
    expect(html).toContain("Fictional characters only, no real people. Every date is written by AI.");
    // One h1 on the page: the first screen's. The hero's is an h2 now.
    expect(html.match(/<h1\b/g)?.length).toBe(1);
    expect(html).toMatch(/<h2 class="hero-title">Give your character a love life\.<\/h2>/);
    expect(html).toContain('data-track="open-create"');
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
