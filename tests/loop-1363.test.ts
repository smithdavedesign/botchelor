import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { handleMcpMessage, type McpContext } from "@/lib/mcp";
import { writeEpisodeTitle } from "@/lib/episode-title";
import type { ChatMessage, Model } from "@/lib/model";
import { placesLabel } from "@/lib/venues";
import { startTestDb, validCharacter } from "./helpers";

// #1363 (the 2026-11-08-0610 run: "the Ines date was labelled 'An ice rink, and neither can skate' while the story was a
// harbour wall and cocoa stand"): a date that moved names every place it was at wherever it names its venue with its lines.
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
const rpc = async (method: string, params: Record<string, unknown>, ctx: McpContext = {}): Promise<Any> => handleMcpMessage({ jsonrpc: "2.0", id: 1, method, params }, ctx);
const call = async (name: string, args: Record<string, unknown>, ctx: McpContext): Promise<Any> => (await rpc("tools/call", { name, arguments: args }, ctx)).result;
async function connect(): Promise<McpContext> {
  const ctx: McpContext = {};
  await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "loop-1363-test" } }, ctx);
  return { sessionId: ctx.issuedSessionId };
}
const turn = (side: "a" | "b", dialogue: string, extra: Record<string, unknown> = {}) => ({ side, act: 0, dialogue, action: "", emotion: "warm", interest: 0.6, ...extra });

/** A finished public date that started at the ice rink and moved twice, as the visitor's did. */
async function movedDate(opts: { moved: boolean; revealed: boolean }) {
  const ctx = await connect();
  const made = await call("create_character", validCharacter({ name: "Ines Varga", keep_name: true }), ctx);
  const agent = made.structuredContent.agent_id as string;
  const ines = made.structuredContent.character.id as string;
  const tomas = (await call("create_character", validCharacter({ name: "Tomas Reyes", keep_name: true }), ctx)).structuredContent.character.id as string;
  const transcript = [
    turn("a", "Neither of us can skate, can we."),
    turn("b", "Let's get off the ice and walk to the harbour wall?"),
    ...(opts.moved
      ? [turn("a", "Yes, the harbour wall.", { moved_to: "elsewhere@a harbour wall" }), turn("b", "Cocoa from that stand?"), turn("a", "The cocoa stand, yes.", { moved_to: "elsewhere@the cocoa stand" })]
      : [turn("a", "No, let's stay and fall over.")]),
  ];
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, revealed_at, transcript, status, visibility, sides, setup)
     values ('ep-1363', $1, $2, $3, 'A harbour wall at dusk, then cocoa from the stand across the road.', '["a","b"]'::jsonb, '["one","two","three"]'::jsonb, '', 'They laugh.', 'friends',
             ${opts.revealed ? "now() - interval '1 hour'" : "null"}, $4::jsonb, 'ready', 'public', '[{"wants_another":false},{"wants_another":false}]'::jsonb, $5::jsonb)`,
    [agent, ines, tomas, JSON.stringify(transcript), JSON.stringify({ venue: "ice_rink", moves: true, format: "classic", producer: "an_awkward_silence", agenda_a: "keep_it_light", agenda_b: "find_funny" })],
  );
  return { ctx };
}

describe("#1363: a moved date's label follows the story", () => {
  it("placesLabel: the venue's name, then each place, lower-cased after 'then' only for an article", () => {
    expect(placesLabel(["ice_rink"])).toBe("An ice rink, and neither can skate");
    expect(placesLabel(["ice_rink", "elsewhere@a harbour wall", "elsewhere@the cocoa stand"])).toBe("An ice rink, and neither can skate, then a harbour wall, then the cocoa stand");
    expect(placesLabel(["ice_rink", "home@Chud's place"])).toBe("An ice rink, and neither can skate, then Chud's place");
  });

  it("get_episode: the full view lists the places, and the summary's venue names them all", async () => {
    const { ctx } = await movedDate({ moved: true, revealed: true });
    const full = (await call("get_episode", { episode_id: "ep-1363" }, ctx)).structuredContent;
    const e = full.episode ?? full;
    expect(e.venue).toBe("ice_rink");
    expect(e.places).toEqual(["ice_rink", "elsewhere@a harbour wall", "elsewhere@the cocoa stand"]);
    const summary = (await call("get_episode", { episode_id: "ep-1363", summary: true }, ctx)).structuredContent;
    expect(summary.episode.venue).toBe("An ice rink, and neither can skate, then a harbour wall, then the cocoa stand");
    // Another agent reading the aired date sees the same.
    const other = (await call("get_episode", { episode_id: "ep-1363", summary: true }, await connect())).structuredContent;
    expect(other.episode.venue).toBe("An ice rink, and neither can skate, then a harbour wall, then the cocoa stand");
  });

  it("a date that stayed put keeps its one venue and carries no places", async () => {
    const { ctx } = await movedDate({ moved: false, revealed: true });
    const full = (await call("get_episode", { episode_id: "ep-1363" }, ctx)).structuredContent;
    expect((full.episode ?? full).places).toBeUndefined();
    const summary = (await call("get_episode", { episode_id: "ep-1363", summary: true }, ctx)).structuredContent;
    expect(summary.episode.venue).toBe("An ice rink, and neither can skate");
  });

  it("before it airs, a stranger's view keeps the move to itself (the teaser is where it started)", async () => {
    await movedDate({ moved: true, revealed: false });
    const other = (await call("get_episode", { episode_id: "ep-1363", summary: true }, await connect())).structuredContent;
    expect(JSON.stringify(other)).not.toMatch(/harbour wall then|then a harbour wall/);
  });

  it("the title is written from every place a moved date was at", async () => {
    const seen: ChatMessage[][] = [];
    const model: Model = { name: "stub", complete: async (m: ChatMessage[]) => (seen.push(m), JSON.stringify({ title: "Cocoa On The Harbour Wall" })) } as Any;
    const title = await writeEpisodeTitle(model, { names: ["Ines Varga", "Tomas Reyes"], setting: "A harbour wall at dusk.", venue: "ice_rink", places: ["ice_rink", "elsewhere@a harbour wall"], dateNumber: null });
    expect(title).toBe("Cocoa On The Harbour Wall");
    const prompt = String(seen[0].at(-1)!.content);
    expect(prompt).toContain("The places, in order (the date moved): An ice rink, and neither can skate, then a harbour wall.");
    expect(prompt).not.toContain("The venue:");
  });
});
