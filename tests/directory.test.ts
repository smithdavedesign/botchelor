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
import { DIRECTORY_PAGE, directoryEntries, listTab, offSeasonHouse, tabCounts } from "@/lib/directory";
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
const render = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await CharactersPage({ searchParams: Promise.resolve(sp) }));

/** Every public character, by tab, as the hub lists them: the cast tab's season, candidates and off-season house. */
async function everyTab() {
  const cast = [...(await directoryEntries(t.db, HOUSE_CHARACTERS.map((c) => c.id))), ...(await offSeasonHouse(t.db, HOUSE_CHARACTERS.map((c) => c.id)))].map((e) => e.id);
  const people = (await listTab(t.db, "people")).entries.map((e) => e.id);
  const agents = (await listTab(t.db, "agents")).entries.map((e) => e.id);
  return { cast, people, agents };
}

describe("the Characters hub's tabs", () => {
  it("files every character under exactly one tab by who made it, a private one by name only (and counted)", async () => {
    const person = await made("Open Book");
    const hidden = await made("Quiet Type");
    expect((await api.editCharacter(hidden.id, { visibility: "private" }, hidden.cookie)).status).toBe(200);
    const agent = await agentMade("Ada Lumen");
    const bot = await agentMade("Bo Quill", "botchelor-loop-swipe-back");
    const crowd = await agentMade("Cy Fenn", "crowd-agent-7"); // an ordinary client name: a real agent

    const tabs = await everyTab();
    expect(tabs.people).toEqual([hidden.id, person.id]);
    const [named] = (await listTab(t.db, "people")).entries;
    expect(named).toMatchObject({ id: hidden.id, name: "Quiet Type", private: true, traits: [], portrait: null, reviews: 0, stars: null });
    expect(tabs.agents).toEqual([crowd.id, agent.id, bot.id]); // the house-run bot after the real agents
    expect(tabs.cast).toEqual(expect.arrayContaining(ALL_HOUSE_CHARACTERS.map((c) => c.id)));
    // A partition: nobody twice, everyone once.
    const all = [...tabs.cast, ...tabs.people, ...tabs.agents];
    expect(new Set(all).size).toBe(all.length);
    expect(await tabCounts(t.db)).toEqual({ people: 2, agents: 3, private: 1 });

    const origins = await originsOf(t.db, [person.id, agent.id, bot.id, crowd.id, HOUSE_CHARACTERS[0].id]);
    expect(Object.fromEntries(origins)).toEqual({ [person.id]: "person", [agent.id]: "agent", [bot.id]: "house_bot", [crowd.id]: "agent", [HOUSE_CHARACTERS[0].id]: "cast" });
    expect([...origins.values()].map(tabOf).sort()).toEqual(["agents", "agents", "agents", "cast", "people"]);
  });

  it("each cast card has the basics: age and pronouns, what they do and where they're from", async () => {
    setSeasonCastForTests(["house-juniper"]);
    const html = await render({ tab: "cast" });
    expect(html).toContain('<p class="muted small dir-basics">29 · she/her</p>');
    expect(html).toContain("💼 Lighthouse keeper and podcaster · 📍 A rock off the Cornish coast");
  });

  it("has a Create a character button at the top, on every tab", async () => {
    for (const tab of ["cast", "people", "agents"]) {
      const html = await render({ tab });
      expect(html.indexOf('<a class="button" href="/create">✨ Create a character</a>'), tab).toBeGreaterThan(-1);
      expect(html.indexOf("/create"), tab).toBeLessThan(html.indexOf('class="segmented"'));
    }
  });

  it("reads ?tab= (the cast by default, anything unknown too) and links each tab by a plain address", () => {
    expect([parseTab(undefined), parseTab("cast"), parseTab("people"), parseTab("agents"), parseTab("nope"), parseTab(["agents"])]).toEqual([
      "cast",
      "cast",
      "people",
      "agents",
      "cast",
      "cast",
    ]);
    expect([tabHref("cast"), tabHref("people"), tabHref("agents", 2)]).toEqual(["/characters", "/characters?tab=people", "/characters?tab=agents&page=2"]);
  });

  it("renders the three tabs as links with counts, the chosen one current, each card with its origin badge", async () => {
    const person = await made("Open Book");
    const hidden = await made("Quiet Type");
    await api.editCharacter(hidden.id, { visibility: "private" }, hidden.cookie);
    const agent = await agentMade("Ada Lumen");
    const bot = await agentMade("Bo Quill", "botchelor-loop-swipe-back");

    const cast = await render();
    expect(cast).toMatch(/<h1>Characters<\/h1>/);
    expect(cast).toMatch(/class="segmented-tab" aria-current="page" href="\/characters">The cast <span class="segmented-count">\d+<\/span>/);
    expect(cast).toContain(`class="segmented-tab" href="/characters?tab=people">People&#x27;s characters <span class="segmented-count">2</span>`);
    expect(cast).toContain(`class="segmented-tab" href="/characters?tab=agents">Agent-made <span class="segmented-count">2</span>`);
    expect(cast).toMatch(/This season: /);
    expect(cast).toMatch(/Next season&#x27;s candidates: /);
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
    expect(agents).toContain(">🤖 Agent-made</span>");
    expect(agents).toContain(`/characters/${bot.id}`);
    expect(agents).toContain(">House-run bot</span>");

    // The private one: its name in its own tab, never linked, no traits; nowhere else.
    expect(people).toMatch(/<span class="directory-private"><strong>Quiet Type<\/strong>/);
    expect(people).toMatch(/Private: their creator keeps them to themselves/);
    expect(people).not.toContain(`/characters/${hidden.id}`);
    const card = people.slice(people.lastIndexOf("<li", people.indexOf("directory-private")), people.indexOf("</li>", people.indexOf("directory-private")));
    expect(card).not.toMatch(/<img|class="chip"|badge/); // no portrait, no traits, no badges
    for (const html of [cast, agents]) expect(html).not.toContain("Quiet Type");
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
    expect(html).toContain(`class="segmented-tab" aria-current="page" href="/characters">The cast <span class="segmented-count">2</span>`);
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
