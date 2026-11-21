import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setDbForTests } from "@/lib/db";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { CORE_MCP_TOOLS, handleMcpMessage, PUBLIC_MCP_TOOLS } from "@/lib/mcp";
import { CIRCLE_TOOL_NAMES } from "@/lib/mcp/circle";
import { getTie } from "@/lib/social/ties";
import { startTestDb } from "./helpers";

// A character's circle over MCP (lib/mcp/circle.ts; docs/PRDs/social-network.md section 6.2, Phase 2b): get_circle,
// add_person, propose_tie, answer_tie, end_tie and set_place, through the People tab's own functions
// (lib/social/declare.ts), so an agent gets the web's rules: its own characters only, warm proposals to someone else's
// that their owner answers, never a tie to the show's characters. None is in the core list.

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
  setDbForTests(null);
});
beforeEach(async () => {
  await t.reset();
  setDbForTests(t.db);
  await t.db.query(`delete from social_places where kind in ('workplace', 'school')`);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const AGENT = "0f0e0d0c-0b0a-4a09-8807-0605040302c1";
const OTHER = "1f1e1d1c-1b1a-4a19-8817-1615141312c2";
const [ADA, TOM, BO] = ["cm-ada", "cm-tom", "cm-bo"];
const [HOUSE] = HOUSE_CHARACTERS.map((c) => c.id);

async function character(id: string, owner: string, name: string) {
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility, created_via)
     values ($1, $2, false, $3, 31, 'Keeps a tide table in every coat.', '["wry"]'::jsonb, 'someone kind', 'liars', 'public', 'mcp')`,
    [id, owner, name],
  );
}
async function world() {
  await character(ADA, AGENT, "Ada Quill");
  await character(TOM, AGENT, "Tom Quill");
  await character(BO, OTHER, "Bo Lark");
}
type Result = { isError?: boolean; structuredContent: Record<string, unknown>; content?: { text: string }[] };
const call = async (name: string, args: Record<string, unknown>): Promise<Result> =>
  ((await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, {})) as { result: Result }).result;
const ok = (r: Result) => {
  expect(r.isError, JSON.stringify(r.structuredContent ?? r.content)).toBeUndefined();
  return r.structuredContent;
};
const refusedWith = (r: Result) => {
  expect(r.isError).toBe(true);
  return JSON.stringify(r.structuredContent ?? r.content);
};

describe("the tools", () => {
  it("are listed outside the core list", () => {
    const all = PUBLIC_MCP_TOOLS.map((x) => x.name);
    const core = CORE_MCP_TOOLS.map((x) => x.name);
    for (const name of CIRCLE_TOOL_NAMES) {
      expect(all).toContain(name);
      expect(core).not.toContain(name);
    }
  });

  it("add_person and get_circle: the owner's agent adds someone, a stranger sees the public parts only", async () => {
    await world();
    ok(await call("add_person", { character_id: ADA, name: "Rosa Quill", relation: "mother", pronouns: "she/her", note: "Judges everyone's bread.", agent_id: AGENT }));
    ok(await call("add_person", { character_id: ADA, name: "Juno Prell", relation: "best_friend", visibility: "only_you", agent_id: AGENT }));
    // Someone else's character, or nobody's: refused, and nothing written.
    expect(refusedWith(await call("add_person", { character_id: BO, name: "Pip", relation: "sibling", agent_id: AGENT }))).toMatch(/yours|not_found|forbidden/i);
    expect((await call("add_person", { character_id: ADA, name: "Pip", relation: "sibling" })).isError).toBe(true);
    // A visibility the tool doesn't take is refused (the schema, then the handler), never written as public.
    expect(refusedWith(await call("add_person", { character_id: ADA, name: "Pip Quill", relation: "sibling", visibility: "private", agent_id: AGENT }))).toMatch(/visibility/);
    expect(refusedWith(await call("set_place", { character_id: ADA, role: "lives", place: "neighbourhood:old-town", visibility: "friends", agent_id: AGENT }))).toMatch(/visibility/);
    const mine = ok(await call("get_circle", { character_id: ADA, agent_id: AGENT, world: true })) as {
      yours: boolean;
      people: { name: string; relation: string; visibility?: string }[];
      relations: { people: string[] };
      world: { neighbourhoods: { place_key: string }[] };
    };
    expect(mine.yours).toBe(true);
    expect(mine.people.map((p) => [p.name, p.relation, p.visibility])).toEqual([
      ["Rosa Quill", "parent", "public"],
      ["Juno Prell", "best friend", "only_you"],
    ]);
    expect(mine.relations.people).toContain("best_friend");
    expect(mine.world.neighbourhoods.length).toBeGreaterThan(0);
    const theirs = ok(await call("get_circle", { character_id: ADA })) as { yours: boolean; people: { name: string }[]; relations?: unknown; world?: unknown };
    expect(theirs.yours).toBe(false);
    expect(theirs.people.map((p) => p.name)).toEqual(["Rosa Quill"]);
    expect(theirs.relations).toBeUndefined();
    expect(JSON.stringify(theirs)).not.toContain("Juno");
    const rows = (await t.db.query<{ source: string; created_by: string }>(`select source, created_by from social_people where holder_id = $1`, [ADA])).rows;
    expect(rows.every((r) => r.source === "agent" && r.created_by === AGENT)).toBe(true);
  });

  it("propose_tie, answer_tie, end_tie: live between two of yours, a proposal to someone else's that its owner answers", async () => {
    await world();
    const own = ok(await call("propose_tie", { character_id: ADA, with: TOM, relation: "sibling", story: "Shared a bunk bed.", agent_id: AGENT })) as { tie_id: string; status: string };
    expect(own.status).toBe("active");
    const asked = ok(await call("propose_tie", { character_id: ADA, with: BO, relation: "coworker", agent_id: AGENT })) as { tie_id: string; status: string };
    expect(asked.status).toBe("proposed");
    // Bo's owner is told, and it waits on them in get_circle.
    const notes = (await t.db.query<{ kind: string }>(`select kind from notifications where user_id = $1`, [OTHER])).rows.map((r) => r.kind);
    expect(notes).toContain("tie_proposal");
    const bo = ok(await call("get_circle", { character_id: BO, agent_id: OTHER })) as { ties: { tie_id: string; waiting_on_you?: string }[] };
    expect(bo.ties.find((x) => x.tie_id === asked.tie_id)?.waiting_on_you).toBeTruthy();
    // Never a negative kind about someone else's character, never the show's own, never the asker answering.
    expect(refusedWith(await call("propose_tie", { character_id: ADA, with: BO, relation: "rival", agent_id: AGENT }))).toMatch(/negative|warm|kind/i);
    expect((await call("propose_tie", { character_id: ADA, with: HOUSE, relation: "friend", agent_id: AGENT })).isError).toBe(true);
    expect((await call("answer_tie", { tie_id: asked.tie_id, answer: "yes", agent_id: AGENT })).isError).toBe(true);
    expect((await call("answer_tie", { tie_id: asked.tie_id, answer: "maybe", agent_id: OTHER })).isError).toBe(true);
    ok(await call("answer_tie", { tie_id: asked.tie_id, answer: "yes", agent_id: OTHER }));
    expect((await getTie(t.db, asked.tie_id))?.status).toBe("active");
    // A friendship that's over stays, as past; family is taken off.
    const friends = ok(await call("propose_tie", { character_id: TOM, with: ADA, relation: "close_friend", agent_id: AGENT })) as { tie_id: string };
    expect((ok(await call("end_tie", { tie_id: friends.tie_id, agent_id: AGENT })) as { ended: string }).ended).toBe("ended");
    expect((ok(await call("end_tie", { tie_id: own.tie_id, agent_id: AGENT })) as { ended: string }).ended).toBe("removed");
    expect((await call("end_tie", { tie_id: asked.tie_id, agent_id: "2f2e2d2c-2b2a-4a29-8827-2625242322c3" })).isError).toBe(true);
  });

  it("set_place: a neighbourhood from the world, a new workplace by name that coworkers share, and leaving it", async () => {
    await world();
    const home = ok(await call("set_place", { character_id: ADA, role: "lives", place: "neighbourhood:old-town", agent_id: AGENT })) as { place_key: string };
    expect(home.place_key).toBe("neighbourhood:old-town");
    const work = ok(await call("set_place", { character_id: ADA, role: "works", name: "The Salt Lantern", neighbourhood: "the-front", agent_id: AGENT })) as { place_key: string };
    ok(await call("set_place", { character_id: TOM, role: "works", place: work.place_key, agent_id: AGENT }));
    const ada = ok(await call("get_circle", { character_id: ADA })) as { places: { place_key: string; role: string; with?: { name: string }[] }[] };
    expect(ada.places.find((p) => p.role === "works")?.with?.map((w) => w.name)).toEqual(["Tom Quill"]);
    ok(await call("set_place", { character_id: TOM, role: "works", place: work.place_key, leave: true, agent_id: AGENT }));
    const after = ok(await call("get_circle", { character_id: ADA })) as { places: { role: string; with?: unknown[] }[] };
    expect(after.places.find((p) => p.role === "works")?.with).toBeUndefined();
    expect((await call("set_place", { character_id: BO, role: "lives", place: "neighbourhood:old-town", agent_id: AGENT })).isError).toBe(true);
  });

  it("SOCIAL_DECLARE=0 closes them", async () => {
    await world();
    vi.stubEnv("SOCIAL_DECLARE", "0");
    for (const [name, args] of [
      ["get_circle", { character_id: ADA }],
      ["add_person", { character_id: ADA, name: "Rosa", relation: "mother", agent_id: AGENT }],
      ["set_place", { character_id: ADA, role: "lives", place: "neighbourhood:old-town", agent_id: AGENT }],
    ] as const) {
      expect((await call(name, args)).isError).toBe(true);
    }
    expect((await t.db.query(`select count(*)::int as n from social_people`)).rows[0]).toEqual({ n: 0 });
  });
});
