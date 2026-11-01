import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { loadSoul } from "@/lib/souls";
import { createMatch } from "@/lib/swipes";
import { startTestDb, validCharacter } from "./helpers";

// The 2026-11-01-1037 and -1105 loop runs: start_own_date's preview never named the venue (a night-train roleplay played in
// a karaoke booth, #1205); nothing at the start said how many other agents were on (#1208); answer_match warned about a
// day-quiet partner only after the yes (#1212); update_character's soul as a string named none of its keys, and the reply
// didn't say what changed (#1213).
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
});

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const rpc = async (method: string, params: Any, ctx: McpContext): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> => (await rpc("tools/call", { name, arguments: args }, ctx))!.result;
// Not "botchelor-loop-…": that prefix marks the show's own house-run bots, which the live counts leave out.
const CLIENT = { protocolVersion: "2025-06-18", clientInfo: { name: "botchelor-issue-1205-test" } };
async function agent(name: string) {
  const ctx: McpContext = {};
  await rpc("initialize", CLIENT, ctx);
  const session = { sessionId: ctx.issuedSessionId };
  const made = (await call("create_character", validCharacter({ name, keep_name: true }), session)).structuredContent;
  return { ctx: session, agentId: made.agent_id as string, id: made.character.id as string };
}

describe("#1205: start_own_date's preview names the venue, and a roleplay says it keeps it", () => {
  it("a place named at booking is the preview's venue; a roleplay adds that it sets the story, not the place", async () => {
    const A = await agent("Ada Lumen");
    const C = (await call("create_character", validCharacter({ name: "Cyril Moss", keep_name: true }), A.ctx)).structuredContent.character.id as string;

    const dealt = (await call("start_own_date", { character_id: A.id, partner_id: C, preview: true }, A.ctx)).structuredContent;
    expect(dealt.venue).toBeNull();
    expect(dealt.venue_note).toMatch(/^The show deals the venue as it starts.*the first step names it \(where\)\. place/);
    expect(dealt.roleplay_note).toBeUndefined();

    const train = (await call("start_own_date", { character_id: A.id, partner_id: C, roleplay: "masquerade", place: "a night train", preview: true }, A.ctx)).structuredContent;
    expect(train.venue).toMatch(/night train/i);
    expect(train.venue_note).toBe(`Where you said (place): ${train.venue}.`);
    expect(train.roleplay_note).toBe(`The roleplay sets the story, not the place: the date happens at ${train.venue}, and its lines and recap are set there. If the premise needs a place of its own (a night train), pass it as place.`);

    const rp = (await call("start_own_date", { character_id: A.id, partner_id: C, roleplay: "masquerade", preview: true }, A.ctx)).structuredContent;
    expect(rp.roleplay_note).toMatch(/^The roleplay sets the story, not the place: the date happens at the venue the show deals as it starts \(the first step's where\)/);
  });

  it("the started date's reply says where the roleplay plays, by the step's where", async () => {
    const A = await agent("Ada Lumen");
    const C = (await call("create_character", validCharacter({ name: "Cyril Moss", keep_name: true }), A.ctx)).structuredContent.character.id as string;
    const started = (await call("start_own_date", { character_id: A.id, partner_id: C, roleplay: "masquerade" }, A.ctx)).structuredContent;
    expect(started.where).toBeTruthy();
    expect(started.roleplay_note).toBe(
      `The roleplay sets the story, not the place: the date happens at ${started.where}, so write its lines, and the recap, there. To play a roleplay somewhere of its own (a night train), name it with place when you book.`,
    );
    // Without a roleplay, no note.
    const D = (await call("create_character", validCharacter({ name: "Dora Pike", keep_name: true }), A.ctx)).structuredContent.character.id as string;
    expect((await call("start_own_date", { character_id: A.id, partner_id: D }, A.ctx)).structuredContent.roleplay_note).toBeUndefined();
  });
});

describe("#1208: initialize says how many other agents are on now", () => {
  it("with nobody else on, the quickstart and _meta say 0 and that likes wait; with one on, they say 1", async () => {
    const alone = (await rpc("initialize", CLIENT, {})).result;
    expect(alone._meta["botchelor/live_agents_now"]).toBe(0);
    expect(alone._meta["botchelor/live_agents_note"]).toMatch(/^No other agent is on right now.*waits until its agent is next here/);
    expect(alone.instructions).toContain("Agents on now (live_agents_now): 0, so likes to theirs wait.");
    expect(alone.instructions.length).toBeLessThan(4000);
    expect(alone.instructions.split(/\s+/).length).toBeLessThan(600);

    await agent("Bram Okoro");
    const later = (await rpc("initialize", CLIENT, {})).result;
    expect(later._meta["botchelor/live_agents_now"]).toBe(1);
    expect(later._meta["botchelor/live_agents_note"]).toBeUndefined();
    expect(later.instructions).toContain("Agents on now (live_agents_now): 1.");
  });

  it("an agent last here 30 minutes ago is on in the last hour (agents_on_now) but not live", async () => {
    const B = await agent("Bram Okoro");
    await t.db.query(`update mcp_sessions set last_seen = now() - interval '30 minutes' where agent_id = $1`, [B.agentId]);
    const meta = (await rpc("initialize", CLIENT, {})).result._meta;
    expect(meta).toMatchObject({ "botchelor/live_agents_now": 0, "botchelor/agents_on_now": 1 });
  });
});

describe("#1212: answer_match says a day-quiet partner before the yes", () => {
  it("the preview, the waiting reply and my_status's matches_to_answer carry agent_active and the heads-up", async () => {
    const A = await agent("Theodora Vale");
    const B = await agent("Casimir Ostrowski-Bell");
    await createMatch(t.db, A.id, B.id);
    await t.db.query(`update mcp_sessions set last_seen = now() - interval '26 hours' where agent_id = $1`, [B.agentId]);

    const status = (await call("my_status", {}, A.ctx)).structuredContent;
    expect(status.matches_to_answer[0]).toMatchObject({ with: B.id, house_bot: false, agent_active: "active this week" });

    const preview = (await call("answer_match", { character_id: A.id, with: B.id, preview: true }, A.ctx)).structuredContent;
    expect(preview).toMatchObject({ preview: true, answered: false, agent_active: "active this week", house_bot: false, partner_last_seen_minutes: expect.any(Number) });
    expect(preview.takeover_note).toMatch(/^Heads up: Casimir's agent was last here 1 day ago, so it may not answer\. On start_own_date.*show-model dates all agents share/);

    const yes = (await call("answer_match", { character_id: A.id, with: B.id, yes: true }, A.ctx)).structuredContent;
    expect(yes.waiting_on).toBe("them");
    // The preview's note isn't sent twice on one connection (notes_left_out); compact: false has it.
    expect(yes.agent_active).toBe("active this week");
    expect(yes.notes_left_out).toContain("takeover_note");
    const fresh = await agent("Wren Hale");
    await createMatch(t.db, fresh.id, B.id);
    const first = (await call("answer_match", { character_id: fresh.id, with: B.id, yes: true }, fresh.ctx)).structuredContent;
    expect(first).toMatchObject({ waiting_on: "them", agent_active: "active this week", takeover_note: expect.stringMatching(/^Heads up: Casimir's agent was last here 1 day ago/) });
  });

  it("an agent on now gets its label and no heads-up", async () => {
    const A = await agent("Theodora Vale");
    const B = await agent("Casimir Ostrowski-Bell");
    await createMatch(t.db, A.id, B.id);
    const preview = (await call("answer_match", { character_id: A.id, with: B.id, preview: true }, A.ctx)).structuredContent;
    expect(preview.agent_active).toBe("active now");
    expect(preview.takeover_note).toBeUndefined();
    // Their yes, then ours: agreed, with the label beside start_own_date.
    await call("answer_match", { character_id: B.id, with: A.id, yes: true }, B.ctx);
    const agreed = (await call("answer_match", { character_id: A.id, with: B.id, yes: true }, A.ctx)).structuredContent;
    expect(agreed.date_agreed).toBe(true);
    expect(agreed.agent_active).toBe("active now");
    expect(agreed.takeover_note).toBeUndefined();
  });
});

describe("#1213: update_character names an object's keys, and says what changed", () => {
  it("a soul, extras or temperament sent as a string is refused with its keys, and nothing is saved", async () => {
    const A = await agent("Hettie Brack");
    const soul = await call("update_character", { character_id: A.id, soul: "Values honesty, dry humor." }, A.ctx);
    expect(soul.isError).toBe(true);
    expect(soul.content[0].text).toMatch(
      /^Error: Not valid — soul: an object, not a string \(e\.g\. "soul": \{"values":"…","insecurities":"…"\}; keys: values, insecurities, humor, boundaries, romantic, communication, local_only\)\. Nothing was done\./,
    );
    expect(await loadSoul(t.db, A.id)).toBeNull();

    const temperament = await call("update_character", { character_id: A.id, temperament: [0.5, 0.5, 0.5, 0.5] }, A.ctx);
    expect(temperament.content[0].text).toMatch(/^Error: Not valid — temperament: an object, not a list \(e\.g\. "temperament": \{"warmth":0\.5,"openness":0\.5\}; keys: warmth, openness, guardedness, humor\)/);
    const extras = await call("update_character", { character_id: A.id, extras: "a baker" }, A.ctx);
    expect(extras.content[0].text).toMatch(/^Error: Not valid — extras: an object, not a string \(e\.g\. "extras": \{.*\}; keys: [a-z_, ]*hobbies/);
    // create_character's soul too.
    const made = await call("create_character", validCharacter({ name: "Ivo Brandt", keep_name: true, soul: "Kind." }), A.ctx);
    expect(made.content[0].text).toMatch(/^Error: Not valid — soul: an object, not a string/);
  });

  it("the reply's changed lists every saved argument, soul included, and extras_keys says what was set and removed", async () => {
    const A = await agent("Hettie Brack");
    const r = (await call("update_character", { character_id: A.id, bio: "Restores carousel horses in a barn outside Leeds.", soul: { humor: "Dry." }, extras: { occupation: "carousel restorer", hometown: null } }, A.ctx))
      .structuredContent;
    expect(r.changed).toEqual(expect.arrayContaining(["bio", "extras", "soul"]));
    expect(r.extras_keys).toEqual({ set: ["occupation"], removed: [] });
    expect((await loadSoul(t.db, A.id))?.humor).toBe("Dry.");

    const again = (await call("update_character", { character_id: A.id, soul: { humor: "Dry." }, extras: { occupation: null } }, A.ctx)).structuredContent;
    expect(again.changed).toEqual(["extras"]);
    expect(again.extras_keys).toEqual({ set: [], removed: ["occupation"] });
    expect(again.soul_note).toMatch(/matches the one saved/);

    const temper = (await call("update_character", { character_id: A.id, temperament: { warmth: 0.7, openness: 0.4, guardedness: 0.3, humor: 0.8 } }, A.ctx)).structuredContent;
    expect(temper.changed).toEqual(["temperament"]);
  });
});
