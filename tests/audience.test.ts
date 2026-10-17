import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { audienceAllows } from "@/lib/audience";
import { findMatches } from "@/lib/dating";
import { api, episodeJson, HOUSE_PARTNER_ID, newUserCookie, scriptedModel, scriptOutcome, startTestDb, userIdOf, validCharacter } from "./helpers";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
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

const make = async (cookie: string, name: string, extra: Any = {}) => (await (await api.createCharacter(validCharacter({ name, ...extra }), cookie)).json()).id as string;
const markAgentMade = (id: string) => t.db.query(`update characters set created_via = 'mcp' where id = $1`, [id]);
const date = async (cookie: string, body: Any) => {
  scriptOutcome({ ending: "friends" });
  scriptedModel([episodeJson()]);
  const res = await api.createEpisode(body, cookie);
  return { status: res.status, body: (await res.json()) as Any };
};

describe("who a character is open to", () => {
  it("the rule", () => {
    expect(audienceAllows("everyone", "web")).toBe(true);
    expect(audienceAllows("people", "web")).toBe(true);
    expect(audienceAllows("people", "mcp")).toBe(false);
    expect(audienceAllows("agents", "mcp")).toBe(true);
    expect(audienceAllows("agents", "web")).toBe(false);
  });

  it("a date by name: only characters like the ones it's open to can ask", async () => {
    const owner = newUserCookie();
    const agentsOnly = await make(owner, "Otto Fenn", { open_to_dates: true, open_audience: "agents" });
    const person = newUserCookie();
    const mine = await make(person, "Cass Vega");
    expect((await date(person, { character_id: mine, partner_id: agentsOnly })).status).toBe(422);

    const agent = newUserCookie();
    const bot = await make(agent, "Ada Lumen");
    await markAgentMade(bot);
    expect((await date(agent, { character_id: bot, partner_id: agentsOnly })).status).toBe(200);

    // Changing it is the owner's: people only now.
    const res = await api.editCharacter(agentsOnly, { open_audience: "people" }, owner);
    expect(res.status).toBe(200);
    expect((await date(person, { character_id: mine, partner_id: agentsOnly })).status).toBe(200);
  });

  it("a blind date never draws a character that isn't open to yours", async () => {
    const owner = newUserCookie();
    await make(owner, "Otto Fenn", { open_audience: "agents" }); // the only other OC around
    const person = newUserCookie();
    const mine = await make(person, "Cass Vega");
    for (let i = 0; i < 3; i++) {
      const { body } = await date(person, { character_id: mine, blind: true });
      expect(body.characters[1].id).toMatch(/^house-/);
    }
  });

  it("matchmaking leaves out characters that aren't open to yours", async () => {
    const owner = newUserCookie();
    const people = await make(owner, "Otto Fenn", { open_to_dates: true, open_audience: "people" });
    const agent = newUserCookie();
    const bot = await make(agent, "Ada Lumen");
    await markAgentMade(bot);
    const forBot = (await findMatches(t.db, userIdOf(agent), bot, 30))!.matches.map((m) => m.id);
    expect(forBot).not.toContain(people);
    const person = newUserCookie();
    const mine = await make(person, "Cass Vega");
    expect((await findMatches(t.db, userIdOf(person), mine, 30))!.matches.map((m) => m.id)).toContain(people);
    expect(forBot).toContain(HOUSE_PARTNER_ID);
  });
});
