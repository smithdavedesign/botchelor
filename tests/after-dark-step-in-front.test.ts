// Step in's front page, made over (David, 2026-11-24: "The character select should be more full screen so you can see
// the characters. the role play is a long scroll in the dropdown it's a bad ux. overall the page needs a makeover", with a
// screenshot of the place's picture run the card's whole width under a menu). Who, the story and the place are each
// picked from pictures: a few on the page, all of them in a sheet that takes the screen (app/after-dark/step-in/
// PickSheet.tsx; what goes where is lib/adult/step-in-setup.ts). The shelf's cards are short, and tonight's eight are one
// row to swipe on a phone. No live calls here.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
  usePathname: () => "/after-dark/step-in",
}));
vi.mock("@/lib/sets", async (orig) => ({ ...((await orig()) as object), inBackground: () => {} }));
import { createElement, type ReactElement } from "react";
import { prerender } from "react-dom/static";
import StepInSetupPage from "@/app/after-dark/step-in/page";
import StepInSetup from "@/app/after-dark/step-in/StepInSetup";
import { claimAdmin } from "@/lib/admins";
import { ROLEPLAY_COVERS } from "@/lib/adult/roleplay-covers";
import { ROLEPLAYS, type Roleplay } from "@/lib/adult/roleplays";
import { saveAdultSettings } from "@/lib/adult/settings";
import { drawnSets, stepInCast, stepInPlaces, storyPlaces } from "@/lib/adult/step-in";
import { inlineFaces, INLINE_FACES, ofWhoKind, placeChoices, STORY_KIND_OWN, storyChoices, whoKinds } from "@/lib/adult/step-in-setup";
import { pronounKind } from "@/lib/adult/craft";
import { SHELF_TONIGHT } from "@/lib/adult/step-in-shelf";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { signedInCookie, startTestDb, TEST_SESSION_SECRET } from "./helpers";

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
  vi.stubEnv("ADULT_MODE", "1");
  // The whole house cast is in After Dark here: fifteen faces.
  setSeasonCastForTests(HOUSE_CHARACTERS.map((c) => c.id));
  await saveAdultSettings(t.db, { enabled: true });
});
afterEach(() => {
  vi.unstubAllEnvs();
  setSeasonCastForTests(null);
});

const WHO = HOUSE_CHARACTERS[1].id;
const NAME = HOUSE_CHARACTERS[1].name.split(/\s+/)[0];
async function admin() {
  const id = randomUUID();
  await claimAdmin(t.db, id);
  const c = signedInCookie(id);
  jar.cookies.set(c.slice(0, c.indexOf("=")), c.slice(c.indexOf("=") + 1));
  return id;
}
const html = async (el: ReactElement) => (await new Response((await prerender(el)).prelude).text()).replace(/<!-- -->/g, "");
const page = async (params: Record<string, string> = {}) => html(await StepInSetupPage({ searchParams: Promise.resolve(params) }));
/** The set-up on its own, with one of its sheets open (the page never opens one by itself). */
async function sheet(viewer: string, open: "who" | "story" | "where", props: { preselect?: string | null; preselectRoleplay?: string | null; own?: Roleplay[] } = {}) {
  const own = props.own ?? [];
  return html(
    createElement(StepInSetup, { cast: await stepInCast(t.db, viewer), places: stepInPlaces(await drawnSets(t.db)), persona: null, personaHref: "/account#persona", preselect: props.preselect ?? null, preselectRoleplay: props.preselectRoleplay ?? null, storyPlaces: storyPlaces(own), own, sheetOpen: open }),
  );
}

describe("what goes on the page, and what's left to the sheet", () => {
  const group = (label: string, n: number) => ({ label, faces: Array.from({ length: n }, (_, i) => `${label}-${i}`) });

  it("the page shows the first faces, in the groups' order, and says how many more the sheet has", () => {
    expect(INLINE_FACES).toBe(16);
    // Everyone fits: all of them, nothing more.
    expect(inlineFaces([group("theirs", 2), group("house", 13)])).toMatchObject({ shown: 15, more: 0 });
    // The people from their scenes first, the house cast cut where the page is full, everyone else left to the sheet.
    const cut = inlineFaces([group("theirs", 3), group("house", 15), group("rest", 266)]);
    expect(cut.groups.map((g) => [g.label, g.faces.length])).toEqual([["theirs", 3], ["house", 13]]);
    expect(cut).toMatchObject({ shown: 16, more: 268 });
    expect(inlineFaces([], 16)).toEqual({ groups: [], shown: 0, more: 0 });
    expect(inlineFaces([group("matches", 40)], 6)).toMatchObject({ shown: 6, more: 34 });
  });

  it("who can be narrowed to women, men or non-binary by their pronouns, and only when that narrows anything (David, 2026-11-24)", () => {
    const c = (id: string, kind: "she" | "he" | "they" | null) => ({ id, kind });
    const cast = [c("a", "she"), c("b", "he"), c("c", "she"), c("d", null), c("e", "they")];
    expect(whoKinds(cast)).toEqual([
      { id: "", label: "Everyone", count: 5 },
      { id: "she", label: "Women", count: 2 },
      { id: "he", label: "Men", count: 1 },
      { id: "they", label: "Non-binary", count: 1 },
    ]);
    // A kind nobody is isn't offered; one kind alone (or none known) is no filter at all.
    expect(whoKinds([c("a", "she"), c("b", "he")]).map((k) => k.label)).toEqual(["Everyone", "Women", "Men"]);
    expect(whoKinds([c("a", "she"), c("b", "she"), c("d", null)])).toEqual([]);
    expect(whoKinds([])).toEqual([]);
    // Narrowing: someone with no pronouns on their sheet is only under Everyone.
    expect(ofWhoKind(cast, "she").map((x) => x.id)).toEqual(["a", "c"]);
    expect(ofWhoKind(cast, "they").map((x) => x.id)).toEqual(["e"]);
    expect(ofWhoKind(cast, "")).toBe(cast);
  });

  it("the stories: the viewer's own first, then the show's by kind, each once; a kind or a search narrows them", () => {
    const own: Roleplay[] = [{ id: "u:1", title: "Rival food trucks", icon: "✨", category: "romance", premise: "{a} and {b} park side by side.", roles: ["the ramen truck owner", "the taco truck owner"] }];
    const kinds = [
      { id: "strangers", roleplays: ROLEPLAYS.slice(0, 3) },
      // A roleplay in two kinds is listed once under "All".
      { id: "work", roleplays: [ROLEPLAYS[1], ROLEPLAYS[4]] },
    ];
    expect(storyChoices(own, kinds, "", "").map((r) => r.id)).toEqual(["u:1", ROLEPLAYS[0].id, ROLEPLAYS[1].id, ROLEPLAYS[2].id, ROLEPLAYS[4].id]);
    expect(storyChoices(own, kinds, STORY_KIND_OWN, "").map((r) => r.id)).toEqual(["u:1"]);
    expect(storyChoices(own, kinds, "work", "").map((r) => r.id)).toEqual([ROLEPLAYS[1].id, ROLEPLAYS[4].id]);
    expect(storyChoices(own, kinds, "no-such-kind", "")).toEqual([]);
    // By what a card says: its title, its premise, its roles; accents and case aside.
    expect(storyChoices(own, kinds, "", "TACO").map((r) => r.id)).toEqual(["u:1"]);
    expect(storyChoices(own, kinds, "", ROLEPLAYS[0].title.slice(0, 8).toUpperCase()).map((r) => r.id)).toContain(ROLEPLAYS[0].id);
    expect(storyChoices(own, kinds, "", "zzzz")).toEqual([]);
  });

  it("the places: their own place first, then the ones with a picture, then the rest; private or public, or by name", () => {
    // The catalog's own order opens on its scenario places, a third of them with no picture (the first live check).
    const places = [
      { id: "scenario:elevator", title: "Stuck in an elevator", image: null, public: true },
      { id: "scenario:motel", title: "One room left", image: "/api/sets/motel%20room?w=400", public: false },
      { id: "venue:corner_cafe", title: "A corner café that closes in an hour", image: "/cast/venue-corner_cafe-v2.webp", public: true },
      { id: "venue:home", title: "Their place", image: "/cast/venue-home-v2.webp", public: false },
      { id: "idea:rainy-cabin", title: "Rainy cabin", image: null, public: false },
    ];
    const ids = (list: { id: string }[]) => list.map((p) => p.id);
    expect(ids(placeChoices(places, ""))).toEqual(["venue:home", "scenario:motel", "venue:corner_cafe", "scenario:elevator", "idea:rainy-cabin"]);
    expect(ids(placeChoices(places, "", "private"))).toEqual(["venue:home", "scenario:motel", "idea:rainy-cabin"]);
    expect(ids(placeChoices(places, "", "public"))).toEqual(["venue:corner_cafe", "scenario:elevator"]);
    // Accents and case aside.
    expect(ids(placeChoices(places, "CAFE"))).toEqual(["venue:corner_cafe"]);
    expect(ids(placeChoices(places, "o", "private"))).toEqual(["scenario:motel"]);
    expect(placeChoices(places, "zzzz")).toEqual([]);
  });
});

describe("the set-up, made of pictures", () => {
  it("who: faces as tiles with a search, no scroll box; and no menu anywhere in the set-up", async () => {
    await admin();
    const front = await page();
    const build = front.slice(front.indexOf("data-step-in-build"));
    // Every one of the fifteen as a tile with their portrait, large enough to tell a face by.
    expect(build.match(/<button type="button" class="ad-si-face" aria-pressed="false"[^>]*data-face="/g)).toHaveLength(HOUSE_CHARACTERS.length);
    expect(build).toMatch(/<span class="ad-si-face-pic"><img[^>]*width="240" height="240"[^>]*class="avatar avatar-portrait avatar-house avatar-fill"/);
    expect(build).toContain("data-step-in-search");
    // Under the search, the chips that narrow who shows: Everyone (on), Women, Men.
    expect(build).toMatch(/data-step-in-search="true" value=""\/><div class="ad-scenes-cats ad-si-kinds" role="radiogroup" aria-label="Show only"><button type="button" role="radio" aria-checked="true" class="on" data-step-in-who-kind="all">Everyone<span class="ad-scenes-count">15<\/span>/);
    expect(build).toMatch(/data-step-in-who-kind="she">Women<span class="ad-scenes-count">\d+<\/span>/);
    expect(build).toMatch(/data-step-in-who-kind="he">Men<span class="ad-scenes-count">\d+<\/span>/);
    expect(build).not.toContain("ad-pp-panel");
    // The roleplay and the place aren't menus any more.
    expect(build).not.toContain("<select");
    expect(build).not.toContain("<option");
    // Nothing is drawn of a sheet until it's opened.
    expect(front).not.toContain("data-step-in-sheet");
    // Nobody picked: the button isn't a dead one, it's the way to the faces.
    expect(build).toMatch(/<button type="button" class="primary" data-step-in-start="true">Pick who you(&#x27;|')re with<\/button>/);
    expect(build).not.toContain("Pick who first");
    // Fifteen fit the page on a wide screen; a phone shows nine, and so still needs the way to all of them.
    expect(build).toMatch(/<p class="ad-si-more ad-si-more-phone"><button type="button" class="button-ghost small" data-step-in-pick="who">See all 15 characters<\/button>/);
  });

  it("once someone is picked the step shows just them, and the way to everyone else", async () => {
    await admin();
    const front = await page({ with: WHO });
    const build = front.slice(front.indexOf("data-step-in-build"));
    expect(build).toContain(`data-step-in-who="${WHO}"`);
    expect(build).not.toContain("data-face=");
    expect(build).toMatch(/data-step-in-pick="who">Pick someone else<\/button>/);
    // A date, as themselves, at their place, until they pick a story; and the button says who.
    expect(build).toMatch(/data-step-in-story=""[\s\S]*?<strong>A date, as yourselves<\/strong>[\s\S]*?data-step-in-pick="story">Pick a roleplay · 45<\/button>/);
    expect(build).toMatch(new RegExp(`data-step-in-start="true">Step in with ${NAME}</button><span class="ad-si-start-what" data-step-in-summary="true">${HOUSE_CHARACTERS[1].name} · A date, as yourselves · Their place</span>`));
  });

  it("the place is a small picture beside its name, never one that runs the card's width", async () => {
    await admin();
    const build = (await page({ with: WHO })).split("data-step-in-build")[1];
    // The place's own picture, as a background (discreet mode's blur is for people, not rooms), inside the chosen card.
    expect(build).toMatch(/<div class="ad-si-chosen" data-step-in-place="venue:home"><span class="ad-si-chosen-pic ad-si-chosen-place" style="background-image:url\(&quot;[^&]+&quot;\)" aria-hidden="true" data-step-in-place-picture="true"><\/span>/);
    const css = readFileSync("app/ux/after-dark.css", "utf8");
    expect(css).not.toContain(".ad-si-place-picture");
    expect(css).toMatch(/\.ad-si-chosen-pic \{[^}]*width: clamp\(5\.5rem, 24vw, 9\.5rem\);/);
  });

  it("a story chosen shows as its card: how it starts, who plays whom, where it's set, and the ways to another or none", async () => {
    await admin();
    const cover = ROLEPLAY_COVERS.neighbours;
    const build = (await page({ with: cover.character, roleplay: "neighbours" })).split("data-step-in-build")[1];
    expect(build).toMatch(/data-step-in-story="neighbours"/);
    // With the one on its cover, on the side it shows, the story's poster is beside its name.
    expect(build).toContain(`<img src="${cover.src}" alt=""`);
    expect(build).toContain("You play the neighbour who knocks");
    expect(build).toMatch(/data-step-in-pick="story">Pick another story<\/button>/);
    expect(build).toMatch(/data-step-in-story-none="true">No roleplay<\/button>/);
    // With anyone else there's no picture of them in it, so none is shown.
    const other = (await page({ with: HOUSE_CHARACTERS[0].id, roleplay: "neighbours" })).split("data-step-in-build")[1];
    expect(other).toMatch(/data-step-in-story="neighbours"/);
    expect(other).not.toContain(cover.src);
  });
});

describe("the sheets", () => {
  it("who: everyone, under their headings, as faces, with a search and a way out", async () => {
    const a = await admin();
    const who = await sheet(a, "who");
    expect(who).toMatch(/<div class="ad-scenes-overlay ad-si-sheet-overlay" data-step-in-sheet="who"><div class="ad-scenes ad-si-sheet" role="dialog" aria-modal="true" aria-label="Who are you stepping in with\?">/);
    expect(who).toMatch(/<input type="search"[^>]*placeholder="Search 15 characters by name"[^>]*data-step-in-sheet-search="true"/);
    expect(who).toMatch(/<button type="button" class="theater-icon" aria-label="Close"[^>]*data-step-in-sheet-close="true">/);
    const grid = who.slice(who.indexOf("data-step-in-sheet-grid"));
    expect(grid).toMatch(/<li class="ad-si-sheet-label"><h3>House cast<\/h3><\/li>/);
    expect(grid.match(/data-face="/g)).toHaveLength(HOUSE_CHARACTERS.length);
    expect(who).toContain('class="ad-scenes-grid ad-si-sheet-grid ad-si-sheet-faces"');
    // Women / Men across the top, each with how many (the house cast's own pronouns).
    const women = HOUSE_CHARACTERS.filter((c) => pronounKind(c.pronouns) === "she").length;
    const men = HOUSE_CHARACTERS.filter((c) => pronounKind(c.pronouns) === "he").length;
    expect(women).toBeGreaterThan(0);
    expect(men).toBeGreaterThan(0);
    expect((await stepInCast(t.db, a)).filter((c) => c.kind === "she")).toHaveLength(women);
    const cats = who.slice(who.indexOf('<div class="ad-scenes-cats" role="radiogroup" aria-label="Show only">'));
    expect(cats).toMatch(/^<div class="ad-scenes-cats" role="radiogroup" aria-label="Show only"><button type="button" role="radio" aria-checked="true" class="on" data-step-in-sheet-kind="all">Everyone<span class="ad-scenes-count">15<\/span><\/button>/);
    expect(cats).toContain(`data-step-in-sheet-kind="she">Women<span class="ad-scenes-count">${women}</span>`);
    expect(cats).toContain(`data-step-in-sheet-kind="he">Men<span class="ad-scenes-count">${men}</span>`);
    expect(cats).not.toContain('data-step-in-sheet-kind="they"');
    // The one already picked is marked.
    const picked = await sheet(a, "who", { preselect: WHO });
    expect(picked).toMatch(new RegExp(`<button type="button" class="ad-si-face on" aria-pressed="true"[^>]*data-face="${WHO}"`));
  });

  it("the story: no roleplay first, then every roleplay once with its poster, by kind", async () => {
    const a = await admin();
    const story = await sheet(a, "story", { preselect: WHO });
    expect(story).toContain('data-step-in-sheet="story"');
    expect(story).toContain(`For you and ${NAME}.`);
    const picks = [...story.matchAll(/data-story="([^"]*)"/g)].map((m) => m[1]);
    expect(picks[0]).toBe("");
    expect(picks.slice(1).sort()).toEqual(ROLEPLAYS.map((r) => r.id).sort());
    // The kinds are chips: all of them first, and no "Yours" for someone with none.
    expect(story).toMatch(/<button type="button" role="radio" aria-checked="true" class="on" data-step-in-sheet-kind="">✨ All<span class="ad-scenes-count">45<\/span>/);
    expect(story).not.toContain('data-step-in-sheet-kind="yours"');
    expect(story.match(/data-step-in-sheet-kind="/g)!.length).toBeGreaterThan(5);
    // Each of the show's has its poster, and the story told to "you" with whoever is picked.
    for (const r of ROLEPLAYS) expect(story, r.id).toContain(`<img src="${ROLEPLAY_COVERS[r.id].src}" alt=""`);
    expect(story).not.toMatch(/\{[ab]\}/);
    // With nobody picked yet the stories still read: "someone" stands in.
    const early = await sheet(a, "story");
    expect(early).not.toMatch(/\{[ab]\}/);
    expect(early).not.toContain("them&#x27;s");
  });

  it("where: every place by its name, and where the story is set first when it has a place of its own", async () => {
    const a = await admin();
    const places = stepInPlaces(await drawnSets(t.db));
    const plain = await sheet(a, "where", { preselect: WHO });
    const listed = [...plain.matchAll(/data-place="([^"]*)"/g)].map((m) => m[1]);
    // Every place once, their own place first, the ones with a picture before the ones without.
    expect([...listed].sort()).toEqual(places.map((p) => p.id).sort());
    expect(listed).toEqual(placeChoices(places, "").map((p) => p.id));
    expect(listed[0]).toBe("venue:home");
    expect(plain).toMatch(/<button type="button" class="ad-si-pick on" aria-pressed="true" data-place="venue:home">/);
    // Private or out in public is one press: a scene somewhere public goes as far as a kiss.
    const open = places.filter((p) => p.public).length;
    expect(plain).toMatch(new RegExp(`data-step-in-sheet-kind="private"[^>]*>Private<span class="ad-scenes-count">${places.length - open}</span>`));
    expect(plain).toMatch(new RegExp(`data-step-in-sheet-kind="public"[^>]*>Out in public<span class="ad-scenes-count">${open}</span>`));
    // A card further down a sheet isn't drawn (or its picture asked for) until it's near the window.
    expect(readFileSync("app/ux/after-dark.css", "utf8")).toMatch(/\.ad-si-sheet-grid > li:has\(> \.ad-si-pick\) \{\n  content-visibility: auto;/);
    expect(plain).toMatch(new RegExp(`placeholder="Search ${places.length} places"`));
    const set = await sheet(a, "where", { preselect: WHO, preselectRoleplay: "neighbours" });
    expect([...set.matchAll(/data-place="([^"]*)"/g)][0][1]).toBe("story");
    expect(set).toMatch(/aria-pressed="true" data-place="story">[\s\S]*?<strong>Where the story is set<\/strong><span class="muted small">The landing between two flats<\/span>/);
  });
});

describe("the page around it", () => {
  it("has its two ways in at its top, the shelf's cards short, and tonight's eight a row to swipe on a phone", async () => {
    await admin();
    const front = await page();
    expect(front).toMatch(/<p class="ad-si-jumps" data-step-in-jumps="true"><a href="#ad-si-shelf-h">Tonight(&#x27;|')s stories<\/a><a href="#ad-si-set">Set your own scene<\/a><\/p>/);
    expect(front).toMatch(/<section class="ad-si-build" aria-labelledby="ad-si-set"><h2 id="ad-si-set">Set your own scene<\/h2>/);
    const shelf = front.slice(front.indexOf("data-step-in-shelf"), front.indexOf('id="ad-si-set"'));
    expect(shelf).toMatch(/<ul class="ad-si-shelf-cards" data-step-in-shelf-row="">/);
    // What the viewer is playing for and who plays whom fold under one line on every card; one loud button a card.
    expect(shelf.match(/<details class="ad-si-shelf-more"><summary>What you(&#x27;|')re playing for<\/summary>/g)).toHaveLength(SHELF_TONIGHT);
    expect(shelf.match(/data-step-in-card-goal/g)).toHaveLength(SHELF_TONIGHT);
    expect(shelf.match(/<p class="ad-si-shelf-go">/g)).toHaveLength(SHELF_TONIGHT);
    expect(shelf.match(/<p class="ad-si-shelf-ways">/g)).toHaveLength(SHELF_TONIGHT);
    const css = readFileSync("app/ux/after-dark.css", "utf8");
    expect(css).toMatch(/@media \(max-width: 700px\) \{\n  \.ad-si-shelf-cards\[data-step-in-shelf-row\] \{\n    display: flex;[^}]*scroll-snap-type: x mandatory;/);
    expect(css).toMatch(/\.ad-si-shelf-setup \{[^}]*-webkit-line-clamp: 3;/);
    // The set-up runs as wide as the shelf.
    expect(css).toMatch(/\.ad-si-shelf,\n  \.ad-si-build \{\n    margin-inline: calc\(50% - min\(32rem, 50vw - 1\.5rem\)\);/);
  });
});
