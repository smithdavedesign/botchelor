import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The character page reads the viewer from next/headers: hand it this cookie store.
const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(),
}));
// The owner's controls are client components that ask for the router; a static render has none.
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
}));
import { renderToStaticMarkup } from "react-dom/server";
import CharactersPage from "@/app/characters/page";
import CastPage from "@/app/cast/page";
import { DIRECTORY_PAGE, DIRECTORY_QUERY_MAX, directoryEntries, likeWord, listTab, offSeasonHouse, parseDirectoryQuery, searchDirectory, tabCounts } from "@/lib/directory";
import { claimAdmin } from "@/lib/admins";
import { ALL_HOUSE_CHARACTERS, HOUSE_CHARACTERS } from "@/lib/house";
import { originsOf, parseTab, tabHref, tabOf } from "@/lib/origin";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { api, episodeJson, newUserCookie, scriptedModel, scriptOutcome, startTestDb, userIdOf, validCharacter } from "./helpers";

// The /characters hub (lib/directory.ts, lib/origin.ts): the cast, people's characters, agent-made; a private one by name only.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});
afterEach(() => {
  setSeasonCastForTests(HOUSE_CHARACTERS.map((c) => c.id));
});

async function made(name: string, cookie = newUserCookie()) {
  return { cookie, id: (await (await api.createCharacter(validCharacter({ name }), cookie)).json()).id as string };
}
/** A character its agent made over MCP; `bot` makes the agent one of the show's loop scripts (botchelor-loop-…). */
async function agentMade(name: string, client = "claude-code") {
  const c = await made(name);
  await t.db.query(`update characters set created_via = 'mcp' where id = $1`, [c.id]);
  await t.db.query(`insert into mcp_sessions (id, agent_id, client_name) values ($1, $2, $3)`, [`s-${c.id}`, userIdOf(c.cookie), client]);
  return c;
}
/** The show's own: made by the cast script AND its agent linked to an admin's account (lib/house-bots.ts originalSql). */
async function ours(name: string) {
  const c = await agentMade(name, "botchelor-cast");
  const admin = `admin-${c.id}`;
  await claimAdmin(t.db, admin);
  await t.db.query(`insert into agent_links (agent_id, user_id) values ($1, $2)`, [userIdOf(c.cookie), admin]);
  return c;
}
const render = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await CharactersPage({ searchParams: Promise.resolve(sp) }));

/** Every public character, by tab, as the hub lists them: the cast tab's season, candidates and off-season house. */
async function everyTab() {
  const cast = [...(await directoryEntries(t.db, HOUSE_CHARACTERS.map((c) => c.id))), ...(await offSeasonHouse(t.db, HOUSE_CHARACTERS.map((c) => c.id)))].map((e) => e.id);
  const people = (await listTab(t.db, "people")).entries.map((e) => e.id);
  const agents = (await listTab(t.db, "agents")).entries.map((e) => e.id);
  const originals = (await listTab(t.db, "originals")).entries.map((e) => e.id);
  return { cast, people, agents, originals };
}

describe("the Characters hub's tabs", () => {
  it("files every character under exactly one tab by who made it, a private one by name only (and counted)", async () => {
    const person = await made("Open Book");
    const hidden = await made("Quiet Type");
    expect((await api.editCharacter(hidden.id, { visibility: "private" }, hidden.cookie)).status).toBe(200);
    const agent = await agentMade("Ada Lumen");
    const bot = await agentMade("Bo Quill", "botchelor-loop-swipe-back");
    const crowd = await agentMade("Cy Fenn", "crowd-agent-7"); // an ordinary client name: a real agent
    const original = await ours("Dee Marlow"); // the show's own cast script, linked to an admin: a Botchelor original (2026-11-20)

    const tabs = await everyTab();
    expect(tabs.people).toEqual([hidden.id, person.id]);
    const [named] = (await listTab(t.db, "people")).entries;
    expect(named).toMatchObject({ id: hidden.id, name: "Quiet Type", private: true, traits: [], portrait: null, reviews: 0, stars: null });
    expect(tabs.agents).toEqual([crowd.id, agent.id, bot.id]); // the house-run bot after the real agents
    expect(tabs.originals).toEqual([original.id]); // never on the agents' tab
    expect(tabs.cast).toEqual(expect.arrayContaining(ALL_HOUSE_CHARACTERS.map((c) => c.id)));
    // A partition: nobody twice, everyone once.
    const all = [...tabs.cast, ...tabs.people, ...tabs.agents, ...tabs.originals];
    expect(new Set(all).size).toBe(all.length);
    expect(await tabCounts(t.db)).toEqual({ people: 2, originals: 1, agents: 3, private: 1 });

    const origins = await originsOf(t.db, [person.id, agent.id, bot.id, crowd.id, original.id, HOUSE_CHARACTERS[0].id]);
    expect(Object.fromEntries(origins)).toEqual({ [person.id]: "person", [agent.id]: "agent", [bot.id]: "house_bot", [crowd.id]: "agent", [original.id]: "original", [HOUSE_CHARACTERS[0].id]: "cast" });
    expect([...origins.values()].map(tabOf).sort()).toEqual(["agents", "agents", "agents", "cast", "originals", "people"]);
  });

  it("a person's character is a companion only once its owner opens it, and a private one never (Talk follows)", async () => {
    const c = await made("Talky Type");
    const companion = async () => (await listTab(t.db, "people")).entries.find((e) => e.id === c.id)?.companion;
    expect(await companion()).toBe(false);
    expect((await api.editCharacter(c.id, { companion_open: true }, c.cookie)).status).toBe(200);
    expect(await companion()).toBe(true);
    expect((await api.editCharacter(c.id, { visibility: "private" }, c.cookie)).status).toBe(200);
    expect(await companion()).toBe(false);
    const [house] = await directoryEntries(t.db, [HOUSE_CHARACTERS[0].id]);
    expect(house.companion).toBe(true);
  });

  it("each cast card has the basics: age and pronouns, what they do and where they're from", async () => {
    setSeasonCastForTests(["house-juniper"]);
    const html = await render({ tab: "cast" });
    expect(html).toContain('<p class="muted small dir-basics">29 · she/her</p>');
    // Drawn icons, not emoji (2026-11-08 UI audit, item 8): a briefcase and a pin, each fact its own piece.
    expect(html).toMatch(
      /<p class="small dir-job"><span class="dir-fact"><svg class="icon"[^>]*aria-hidden="true">.*?<\/svg> Lighthouse keeper and podcaster<\/span><span class="dir-fact"><svg class="icon"[^>]*aria-hidden="true">.*?<\/svg> A rock off the Cornish coast<\/span><\/p>/,
    );
  });

  it("has a Make your character button at the top, on every tab", async () => {
    for (const tab of ["cast", "people", "agents"]) {
      const html = await render({ tab });
      expect(html.indexOf('<a class="button secondary" href="/create">Make your character</a>'), tab).toBeGreaterThan(-1);
      expect(html.indexOf("/create"), tab).toBeLessThan(html.indexOf('class="segmented"'));
    }
  });

  it("reads ?tab= (the cast by default, anything unknown too) and links each tab by a plain address", () => {
    expect([parseTab(undefined), parseTab("cast"), parseTab("people"), parseTab("agents"), parseTab("originals"), parseTab("nope"), parseTab(["agents"])]).toEqual([
      "cast",
      "cast",
      "people",
      "agents",
      "originals",
      "cast",
      "cast",
    ]);
    expect([tabHref("cast"), tabHref("people"), tabHref("agents", 2)]).toEqual(["/characters", "/characters?tab=people", "/characters?tab=agents&page=2"]);
  });

  it("renders the three tabs as links with no counts, the chosen one current, each card with its origin badge", async () => {
    const person = await made("Open Book");
    const hidden = await made("Quiet Type");
    await api.editCharacter(hidden.id, { visibility: "private" }, hidden.cookie);
    const agent = await agentMade("Ada Lumen");
    const bot = await agentMade("Bo Quill", "botchelor-loop-swipe-back");

    const cast = await render();
    expect(cast).toMatch(/<h1>Characters<\/h1>/);
    // A stranger lands on the cast, and the strip names who's here without numbers (2026-11-15: "34 against 250" read
    // as bots talking to bots). The agents' tab keeps its plain label.
    expect(cast).toContain(`<nav class="segmented" aria-label="Characters"><a class="segmented-tab" href="/characters?tab=people">People&#x27;s</a><a class="segmented-tab" aria-current="page" href="/characters">The cast</a><a class="segmented-tab" href="/characters?tab=originals">Originals</a><a class="segmented-tab" href="/characters?tab=agents">AI agents</a></nav>`);
    expect(cast).not.toContain("segmented-count");
    expect(cast).toMatch(/This season: /);
    expect(cast).not.toMatch(/Next season&#x27;s candidates/); // shown only once there are candidates (UX audit 2026-10-31, A4)
    expect(cast).toMatch(/The relationship graph/); // what /cast had moved here
    expect(cast).toContain(`/characters/${HOUSE_CHARACTERS[0].id}`);
    expect(cast).not.toContain(">Cast</span>"); // every card on the cast tab is the show's own: no chip saying so (UX audit 2026-10-23)
    expect(cast).not.toContain(`/characters/${person.id}`);

    const people = await render({ tab: "people" });
    expect(people).toMatch(/class="segmented-tab" aria-current="page" href="\/characters\?tab=people"/);
    expect(people).toContain(`/characters/${person.id}`);
    expect(people).toContain(">Made by a person</span>");
    expect(people).not.toContain(`/characters/${agent.id}`);
    expect(people).not.toContain(`/characters/${HOUSE_CHARACTERS[0].id}"`);

    const agents = await render({ tab: "agents" });
    expect(agents).toContain(`/characters/${agent.id}`);
    expect(agents).toContain(">🤖 Made by an AI agent</span>"); // plain words, not jargon (2026-11-07 audit, item 19)
    expect(agents).toContain(`/characters/${bot.id}`);
    expect(agents).toContain(">House-run bot</span>");

    // The show's own originals (2026-11-20): their own tab and badge, never with the agents.
    const original = await ours("Dee Marlow");
    // Anyone can name their client "botchelor-cast"; without the admin link it's an agent's, not ours.
    const borrowed = await agentMade("Imo Postor", "botchelor-cast");
    expect(Object.fromEntries(await originsOf(t.db, [original.id, borrowed.id]))).toEqual({ [original.id]: "original", [borrowed.id]: "agent" });
    // Linked to a person who isn't an admin: still an agent's.
    await t.db.query(`insert into agent_links (agent_id, user_id) values ($1, $2)`, [userIdOf(borrowed.cookie), "someone-else"]);
    expect((await originsOf(t.db, [borrowed.id])).get(borrowed.id)).toBe("agent");
    expect(await render({ tab: "agents" })).toContain(`/characters/${borrowed.id}`);
    const originals = await render({ tab: "originals" });
    expect(originals).not.toContain(`/characters/${borrowed.id}`);
    expect(originals).toContain(`/characters/${original.id}`);
    expect(originals).toContain(">Botchelor original</span>");
    expect(originals).toMatch(/written and drawn by Botchelor/);
    expect(await render({ tab: "agents" })).not.toContain(`/characters/${original.id}`);

    // The private one: its name in its own tab, never linked, no traits; nowhere else.
    expect(people).toMatch(/<span class="directory-private"><strong>Quiet Type<\/strong>/);
    expect(people).toMatch(/Private: their creator keeps them to themselves/);
    expect(people).not.toContain(`/characters/${hidden.id}`);
    const card = people.slice(people.lastIndexOf("<li", people.indexOf("directory-private")), people.indexOf("</li>", people.indexOf("directory-private")));
    expect(card).not.toMatch(/<img|class="chip"|badge/); // no portrait, no traits, no badges
    for (const html of [cast, agents]) expect(html).not.toContain("Quiet Type");
  });

  it("says how many inside each tab's own page, never on the strip: people's by the empty-room rule, the agents' on their fold", async () => {
    // The strip's words, without its tags (an apostrophe's entity has digits of its own).
    const strip = (html: string) => (/<nav class="segmented"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "0").replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'");
    const owner = await made("Open Book");
    await made("Second Sight");
    await agentMade("Ada Lumen");
    // A stranger, two people's characters: under CROWD_MIN, so no number at all (lib/crowd-threshold.ts).
    let people = await render({ tab: "people" });
    expect(people).toContain("Original characters people built on the site.");
    expect(people).not.toMatch(/\d+ characters? people built/);
    // From the threshold up, the count is the tab's own muted line.
    vi.stubEnv("CROWD_MIN", "2");
    people = await render({ tab: "people" });
    expect(people).toContain('<p class="muted">2 characters people built on the site. <a href="/create">Make your own</a>.');
    vi.unstubAllEnvs();
    // Someone with a character sees it from 1.
    jar.cookies.set(owner.cookie.split("=")[0], owner.cookie.split("=")[1]);
    try {
      expect(await render({ tab: "people" })).toContain("2 characters people built on the site.");
    } finally {
      jar.cookies.clear();
    }
    // The agents' count is on their fold, labelled as what it is.
    const agents = await render({ tab: "agents" });
    expect(agents).toContain("<summary>1 character made by AI agents</summary>");
    for (const html of [people, agents, await render()]) expect(strip(html)).not.toMatch(/\d/);
  });

  it("gives someone with a character a Yours tab that leads the strip, on every tab; a stranger has none", async () => {
    const owner = await made("Open Book");
    expect(await render()).not.toContain("/characters?tab=yours");
    jar.cookies.set(owner.cookie.split("=")[0], owner.cookie.split("=")[1]);
    try {
      for (const tab of ["cast", "people", "agents"]) {
        const html = await render({ tab });
        expect(html, tab).toContain('<nav class="segmented" aria-label="Characters"><a class="segmented-tab" href="/characters?tab=yours">Yours</a>');
      }
      // The tab itself: their own characters, each with the two doors that are about one character.
      const yours = await render({ tab: "yours" });
      expect(yours).toContain('<a class="segmented-tab" aria-current="page" href="/characters?tab=yours">Yours</a>');
      expect(yours).toContain(`href="/chat?character=${owner.id}"`);
      expect(yours).toContain(`href="/studio?character=${owner.id}"`);
      expect(yours).toContain("Open Book");
    } finally {
      jar.cookies.clear();
    }
  });

  it("pages a long tab at 24, newest first", async () => {
    const first = await made("Ira Fenn");
    // The rest straight into the table: 24 more of the same person's characters, each newer than the last.
    for (let i = 0; i < DIRECTORY_PAGE; i++) {
      await t.db.query(
        `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, created_at)
         select $2, owner_id, false, $3, age, bio, traits, want, dealbreaker, now() + ($4 || ' seconds')::interval from characters where id = $1`,
        [first.id, `copy-${i}`, `Copy ${i}`, String(i + 1)],
      );
    }
    const one = await listTab(t.db, "people", 1);
    const two = await listTab(t.db, "people", 2);
    expect([one.total, one.pages, one.entries.length, two.entries.length]).toEqual([25, 2, 24, 1]);
    expect(one.entries[0].name).toBe(`Copy ${DIRECTORY_PAGE - 1}`);
    expect(two.entries[0].id).toBe(first.id);
    expect((await listTab(t.db, "people", 99)).page).toBe(2);
    const html = await render({ tab: "people", page: "2" });
    expect(html).toContain('rel="prev" aria-label="Newer page" href="/characters?tab=people"');
    expect(html).toMatch(/aria-current="page" aria-label="Page 2 of 2">2</);
  });

  it("the cast tab is this month's house cast, with the rest of the house folded under Off this season", async () => {
    setSeasonCastForTests([HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id]);
    const html = await render();
    expect(html).toContain(`class="segmented-tab" aria-current="page" href="/characters">The cast</a>`);
    expect(html).toMatch(/<summary>Off this season \(\d+\)<\/summary>/);
    expect(html).toContain(`/characters/${HOUSE_CHARACTERS[2].id}`);
  });
});

describe("the cast tab's leaderboard and relationship graph", () => {
  it("show a private character by name only: never linked, no portrait, nothing about the couple's dates", async () => {
    const hidden = await made("Quiet Type");
    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const res = await api.createEpisode({ character_id: hidden.id, partner_id: HOUSE_CHARACTERS[0].id }, hidden.cookie);
    expect(res.status).toBe(200);
    expect((await api.reveal((await res.json()).id, hidden.cookie)).status).toBeLessThan(300);
    await t.db.query(`insert into character_ratings (rater_id, character_id, category) values ('fan-1', $1, 'likable')`, [hidden.id]);
    const before = await render();
    expect(before).toContain(`/characters/${hidden.id}"`); // public: linked on the board and in the graph
    expect(before).toMatch(/\/couples\//);

    await api.editCharacter(hidden.id, { visibility: "private" }, hidden.cookie);
    const html = await render();
    expect(html).toMatch(/<span class="directory-private"><strong>Quiet Type<\/strong>/);
    expect(html).not.toContain(`/characters/${hidden.id}`);
    expect(html).not.toMatch(/\/couples\/[^"]*/);
    expect(html.match(/Quiet Type/g)?.length).toBeGreaterThanOrEqual(2); // the board and the graph, by name
  });
});

describe("/cast", () => {
  it("is a permanent (308) redirect to the hub's cast tab", () => {
    let digest = "";
    try {
      CastPage();
    } catch (err) {
      digest = String((err as { digest?: string }).digest);
    }
    expect(digest).toBe("NEXT_REDIRECT;replace;/characters?tab=cast;308;");
  });
});

describe("a private character", () => {
  it("its card shows only its name to others, and everything to its owner", async () => {
    const hidden = await made("Quiet Type");
    await api.editCharacter(hidden.id, { visibility: "private" }, hidden.cookie);
    const { default: CharacterPage } = await import("@/app/characters/[id]/page");
    const page = async (cookie: string | null) => {
      jar.cookies.clear();
      if (cookie) jar.cookies.set(cookie.split("=")[0], cookie.split("=")[1]);
      return renderToStaticMarkup(await CharacterPage({ params: Promise.resolve({ id: hidden.id }) }));
    };
    const stranger = await page(newUserCookie());
    expect(stranger).toContain("Quiet Type");
    expect(stranger).toMatch(/keeps this character private/);
    expect(stranger).not.toContain(validCharacter().bio as string);
    expect(stranger).not.toMatch(/on a date with/);
    const owner = await page(hidden.cookie);
    expect(owner).toContain(validCharacter().bio as string);
    expect(owner).toMatch(/Make public/);
  });

  it("its relationship board is its name only to others, and the board to its owner", async () => {
    const hidden = await made("Quiet Type");
    await api.editCharacter(hidden.id, { visibility: "private" }, hidden.cookie);
    const { default: RelationshipBoard } = await import("@/app/characters/[id]/relationships/page");
    const board = async (cookie: string) => {
      jar.cookies.clear();
      jar.cookies.set(cookie.split("=")[0], cookie.split("=")[1]);
      return renderToStaticMarkup(await RelationshipBoard({ params: Promise.resolve({ id: hidden.id }) }));
    };
    const stranger = await board(newUserCookie());
    expect(stranger).toContain("Quiet Type");
    expect(stranger).toMatch(/keeps this character private/);
    expect(await board(hidden.cookie)).not.toMatch(/keeps this character private/);
  });
});

// Design audit 2026-11-14: "294 characters and no way to find one". A GET search (?q=) on /characters, by name, trait,
// bio, job or hometown, under the directory's own rules: never a private character, never a deleted account's.
describe("finding a character on /characters (lib/directory.ts searchDirectory)", () => {
  it("reads ?q= as one squashed, trimmed, bounded string", () => {
    expect(parseDirectoryQuery(undefined)).toBe("");
    expect(parseDirectoryQuery(["  Mira   Quell ", "other"])).toBe("Mira Quell");
    expect(parseDirectoryQuery("x".repeat(200))).toHaveLength(DIRECTORY_QUERY_MAX);
  });

  it("escapes LIKE's wildcards so a search matches them literally", () => {
    expect(likeWord("50%")).toBe("%50\\%%");
    expect(likeWord("a_b")).toBe("%a\\_b%");
    expect(likeWord("back\\slash")).toBe("%back\\\\slash%");
    expect(likeWord("MiRa")).toBe("%mira%");
  });

  it("finds by name, trait and bio words (every word must match), names first", async () => {
    const mira = await made("Mira Quell");
    const other = (await (await api.createCharacter(validCharacter({ name: "Tobias Wren", bio: "A baker who once met Mira at a map fair.", traits: ["shy", "kind", "punctual"] }), newUserCookie())).json()).id as string;
    const ids = async (q: string) => (await searchDirectory(t.db, q)).entries.map((e) => e.id);
    expect(await ids("mira")).toEqual([mira.id, other]); // the name match before the bio mention
    expect(await ids("cartographer tuesdays")).toEqual([mira.id]);
    expect(await ids("punctual")).toEqual([other]);
    expect(await ids("cartographer punctual")).toEqual([]);
    expect(await ids(HOUSE_CHARACTERS[0].name)).toContain(HOUSE_CHARACTERS[0].id); // the cast is in too
    expect(await ids("   ")).toEqual([]);
  });

  it("treats % and _ as plain characters, not wildcards", async () => {
    await made("Mira Quell");
    expect((await searchDirectory(t.db, "%")).entries).toEqual([]);
    expect((await searchDirectory(t.db, "_")).entries).toEqual([]);
    expect((await searchDirectory(t.db, "m_ra")).entries).toEqual([]);
    const pct = await made("Ninety% Nell");
    expect((await searchDirectory(t.db, "ninety%")).entries.map((e) => e.id)).toEqual([pct.id]);
  });

  it("never lists a private character (not even by name) or a deleted account's", async () => {
    const hidden = await made("Quiet Zephyrine");
    expect((await api.editCharacter(hidden.id, { visibility: "private" }, hidden.cookie)).status).toBe(200);
    const gone = await made("Gone Zephyrine");
    await t.db.query(`update characters set owner_id = 'deleted' where id = $1`, [gone.id]);
    const open = await made("Open Zephyrine");
    expect((await searchDirectory(t.db, "zephyrine")).entries.map((e) => e.id)).toEqual([open.id]);
    const html = await render({ q: "zephyrine" });
    expect(html).toContain(`/characters/${open.id}`);
    expect(html).not.toContain("Quiet Zephyrine");
    expect(html).not.toContain("Gone Zephyrine");
  });

  it("stops at the limit and says there are more", async () => {
    for (const n of ["Alpha", "Beta", "Gamma"]) await made(`${n} Quorra`);
    const { entries, more } = await searchDirectory(t.db, "quorra", 2);
    expect(entries.map((e) => e.name)).toEqual(["Alpha Quorra", "Beta Quorra"]);
    expect(more).toBe(true);
    expect((await searchDirectory(t.db, "quorra", 3)).more).toBe(false);
  });

  it("renders a GET form on every tab, and results as the same photo cards (no tab current), or a way to make one", async () => {
    const html = await render();
    expect(html).toContain('<form class="characters-search" role="search" action="/characters" method="get">');
    expect(html).toContain('name="q"');
    const mira = await made("Mira Quell");
    const found = await render({ q: "mira" });
    expect(found).toContain("1 character matches “mira”");
    expect(found).toContain('value="mira"');
    expect(found).toContain('<li class="card tap-card dir-card">');
    expect(found).toContain(`href="/characters/${mira.id}"`);
    expect(found).not.toMatch(/class="segmented-tab" aria-current="page"/);
    expect(found).not.toMatch(/This season: /);
    const none = await render({ q: "nobody-by-this-name" });
    expect(none).toContain("Nobody matches “nobody-by-this-name”");
    expect(none).toContain('<a href="/create">make the character you were looking for</a>');
  });

  it("draws each card photo-forward: a square portrait on top, the name a link over the whole card, Talk its own target", async () => {
    setSeasonCastForTests(["house-juniper"]);
    const html = await render({ tab: "cast" });
    const card = html.slice(html.indexOf('<li class="card tap-card dir-card">'), html.indexOf("</li>", html.indexOf('<li class="card tap-card dir-card">')));
    // The show's cast with a face loop (lib/face-loops.ts, Juniper among them) have it around the portrait.
    expect(card).toMatch(/^<li class="card tap-card dir-card"><div class="dir-portrait">(<span[^>]*>)?<(img|svg)[^>]*class="avatar[^"]* avatar-fill"/);
    expect(card).toMatch(/width="320" height="320"/);
    expect(card).toMatch(/<a class="char-name stretch dir-name char-name-link" href="\/characters\/house-juniper">/);
    expect(card.indexOf("dir-portrait")).toBeLessThan(card.indexOf("dir-name"));
  });
});
