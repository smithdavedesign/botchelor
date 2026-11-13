import { prerender } from "react-dom/static";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// An AI agent's public profile (app/agents/[handle]; the thin pages' lift, 2026-11-13): a lead with its numbers as chips,
// the characters as tiles with their faces and a one-line hook, the public dates as rows with the place's photo, and one
// call to action. A private character stays a name, as the directory lists it, and the footer's two links stay.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));
import AgentProfilePage from "@/app/agents/[handle]/page";
import { ensureAgentHandle, setAgentProfile } from "@/lib/agent-handle";
import { agentProfile } from "@/lib/agent-profile";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { api, episodeJson, HOUSE_PARTNER_ID, newUserCookie, scriptedModel, scriptOutcome, startTestDb, validCharacter } from "./helpers";

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
afterEach(() => vi.restoreAllMocks());

const render = async (handle: string) => {
  const { prelude } = await prerender(await AgentProfilePage({ params: Promise.resolve({ handle }) }));
  return new Response(prelude).text();
};

/**
 * An agent with two characters, one private, and one aired public date: the characters are made on the web (the suite's
 * helpers) and handed to the agent afterwards, since the profile reads owner_id and created_via, not how they arrived.
 */
async function anAgentWithADate() {
  const creator = newUserCookie();
  const nova = await (await api.createCharacter(validCharacter({ name: "Nova Quill", bio: "Keeps a lighthouse nobody sails past. Collects storms." }), creator)).json();
  const hush = await (await api.createCharacter(validCharacter({ name: "Hush Vale" }), creator)).json();
  scriptOutcome({ ending: "friends" });
  scriptedModel([episodeJson()]);
  const res = await api.createEpisode({ character_id: nova.id, partner_id: HOUSE_PARTNER_ID }, creator);
  expect(res.status).toBe(200);
  const episode = await res.json();
  await t.db.query(`update episodes set revealed_at = now() where id = $1`, [episode.id]);
  await t.db.query(`update characters set owner_id = 'agent:nova', created_via = 'mcp' where id = any($1)`, [[nova.id, hush.id]]);
  await t.db.query(`update characters set visibility = 'private' where id = $1`, [hush.id]);
  const handle = await ensureAgentHandle(t.db, "agent:nova");
  await setAgentProfile(t.db, "agent:nova", { display_name: "Studio Nova", bio: "We make slow burns." });
  return { handle, nova, hush, episode };
}

describe("/agents/[handle]", () => {
  it("carries each public character's face and hook, and lists the agent's public dates with the place", async () => {
    const { handle, nova, hush, episode } = await anAgentWithADate();
    const profile = (await agentProfile(t.db, handle))!;
    expect(profile.public_dates).toBe(1);
    expect(profile.dates).toHaveLength(1);
    expect(profile.dates[0]).toMatchObject({ episode_id: episode.id, ending: "friends", ending_label: "Just friends" });
    expect([profile.dates[0].a.id, profile.dates[0].b.id].sort()).toEqual([nova.id, HOUSE_PARTNER_ID].sort());
    // A private character carries no portrait, bio or age; a public one its hook.
    expect(profile.characters.find((c) => c.id === hush.id)).toMatchObject({ private: true, portrait: null, bio: null, age: null });
    expect(profile.characters.find((c) => c.id === nova.id)).toMatchObject({ private: false, bio: "Keeps a lighthouse nobody sails past. Collects storms.", age: 27 });

    const html = await render(handle);
    // The lead: the name, the bio, the numbers as chips, one call to action on the first public character.
    expect(html).toContain("<h1>Studio Nova</h1>");
    expect(html).toContain("We make slow burns.");
    expect(html).toContain("characters</span>");
    expect(html).toContain("public <!-- -->date</span>");
    expect(html).toContain(`data-track="agent-profile-date" href="/characters/${nova.id}"`);
    expect(html).toContain("Send your character on a date with");
    // The characters as tiles: the face, the name as the whole tile's link, the first sentence of the bio.
    const tile = html.slice(html.indexOf('class="card tap-card agent-cast-tile"'), html.indexOf('class="agent-private"'));
    expect(tile).toContain("avatar");
    expect(tile).toContain(`class="stretch" href="/characters/${nova.id}"`);
    expect(tile).toContain("Keeps a lighthouse nobody sails past.");
    expect(tile).not.toContain("Collects storms.");
    // The private one stays a name: listed, marked, not linked.
    expect(html).toContain("Hush Vale");
    expect(html).toContain("(private)");
    expect(html).not.toContain(`href="/characters/${hush.id}"`);
    // The date as a row: the place's photo with the two faces, both names, how it ended, linking the episode.
    const dates = html.slice(html.indexOf('class="agent-dates"'));
    expect(dates).toContain('class="venue-photo agent-date-photo"');
    expect(dates).toContain('class="pair-faces"');
    expect(dates).toContain(`class="stretch" href="/episodes/${episode.id}"`);
    expect(dates).toContain("Nova Quill");
    expect(dates).toContain(" ×</span>");
    expect(dates).toContain(HOUSE_CHARACTERS.find((c) => c.id === HOUSE_PARTNER_ID)!.name);
    expect(dates).toContain(">Just friends</span>");
    // The footer links stay.
    expect(html).toContain('href="/agents"');
    expect(html).toContain('href="/characters?tab=agents"');
  });

  it("an agent with no public characters has no call to action, and says so in both lists", async () => {
    const handle = await ensureAgentHandle(t.db, "agent:quiet");
    const html = await render(handle);
    expect(html).toContain(`<h1>Agent ${handle}</h1>`);
    expect(html).toContain("None public yet.");
    expect(html).toContain("None yet.");
    expect(html).not.toContain("Send your character on a date with");
    expect(html).toContain('href="/agents"');
  });

  it("an unknown handle is a 404", async () => {
    await expect(render("nobody-here")).rejects.toThrow();
  });
});
