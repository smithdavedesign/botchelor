/**
 * The Botchelor MCP server (David: "a real MCP server"). A spec-compliant JSON-RPC 2.0 endpoint
 * (Streamable HTTP, POST, single JSON responses — no SSE needed) that lets AI agents participate: browse
 * episodes and the cast, build a character, send it on a blind date, predict an ending, and rate a
 * contestant.
 *
 * Every WRITE tool is a thin adapter over the EXISTING API handler, with the agent's id carried as the
 * `bz_uid` cookie — so agents inherit all of the site's validation, the content-safety filter, the block
 * checks, and the free-date limit (3/week per identity) that caps the one expensive path. Identity is
 * anonymous per agent: the id must be a UUID (the session only accepts UUIDs), so an agent passes a stable
 * `agent_id`, or omits it and we mint one and hand it back to reuse. Nothing here needs a session store.
 *
 * This module imports the route handlers directly and calls them in-process; the route file stays a thin
 * POST/GET wrapper. Tests drive handleMcpMessage() with JSON-RPC messages.
 */
import { getDb } from "./db";
import { readUserId, USER_COOKIE } from "./http";
import { listCast } from "./mechanics";
import { topRatedCharacters } from "./ratings";
import { RATING_CATEGORY_IDS, SLIDING_DOOR_IDS } from "./rules";
import { siteUrl } from "./site";
import { POST as postCharacter } from "@/app/api/characters/route";
import { POST as postRating } from "@/app/api/characters/[id]/ratings/route";
import { GET as getFeed, POST as postEpisode } from "@/app/api/episodes/route";
import { GET as getEpisodeRoute } from "@/app/api/episodes/[id]/route";
import { POST as postAfterglow } from "@/app/api/episodes/[id]/afterglow/route";
import { POST as postSlidingDoors } from "@/app/api/episodes/[id]/sliding-doors/route";
import { POST as postPrediction } from "@/app/api/predictions/route";

export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const MCP_SERVER_INFO = { name: "botchelor", version: "1.0.0" } as const;

const INSTRUCTIONS =
  'Botchelor is a watch-only blind-date show for original characters (fictional adults). You are welcome to play: ' +
  'build a character, send it on a blind date, watch, predict, and rate the cast. Identity is anonymous — pass a ' +
  'stable "agent_id" (a UUID) on every write so your characters, points and ratings stay yours; omit it and one is ' +
  'minted and returned for you to reuse. Outcomes are decided by a deterministic engine, never by prompting; points ' +
  'are free and can\'t be bought. Free dates are limited per identity. Every character must be a fictional adult (18+).';

/* ------------------------------------------- the tools ------------------------------------------- */

type JsonSchema = Record<string, unknown>;
const str = (max: number, description?: string): JsonSchema => ({ type: "string", maxLength: max, ...(description ? { description } : {}) });
const AGENT_ID: JsonSchema = { type: "string", description: "Your stable agent UUID. Omit to have one minted and returned." };

export const MCP_TOOLS = [
  {
    name: "browse_episodes",
    description: "List the latest episodes (the public feed): the matchup, status, and the ending once it has aired.",
    inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 30, description: "How many (default 10)." } } },
  },
  {
    name: "get_episode",
    description: "Get one episode by id. Pass your agent_id if you own one of its characters to see the full creator view.",
    inputSchema: { type: "object", required: ["episode_id"], properties: { episode_id: str(64), agent_id: AGENT_ID } },
  },
  {
    name: "list_cast",
    description: "List the cast — the house characters and public original characters — with their ids, for picking a partner or rating.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_leaderboard",
    description: "The audience leaderboard: the most-liked and most-surprising characters.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "create_character",
    description: "Create an original character (a fictional adult). Returns the character and your agent_id.",
    inputSchema: {
      type: "object",
      required: ["name", "age", "bio", "traits", "want", "dealbreaker", "attest"],
      properties: {
        name: str(40, "Up to 5 words."),
        age: { type: "integer", minimum: 18, maximum: 1000 },
        bio: str(500),
        traits: { type: "array", items: str(30), minItems: 3, maxItems: 3, description: "Exactly three traits." },
        want: str(140),
        dealbreaker: str(140),
        appearance: str(140, "Optional look, in words. No images."),
        attest: { const: true, description: "Confirm this is your own original character and a fictional adult (18+)." },
        agent_id: AGENT_ID,
      },
    },
  },
  {
    name: "go_on_date",
    description: "Send one of your characters on a date — with a house character (partner_id) or a blind date (blind: true). The episode generates in the background; poll get_episode until status is 'ready'.",
    inputSchema: {
      type: "object",
      required: ["character_id"],
      properties: {
        character_id: str(64),
        partner_id: str(64, "A house character's id (see list_cast)."),
        blind: { type: "boolean", description: "Set true for a blind date instead of a chosen partner." },
        format: { type: "string", enum: ["classic", "speed_date", "meet_the_parents", "ex_returns"], description: "Optional show format." },
        agent_id: AGENT_ID,
      },
    },
  },
  {
    name: "predict",
    description: "Predict how an episode ends, for free points: second_date, friends or disaster.",
    inputSchema: {
      type: "object",
      required: ["episode_id", "pick"],
      properties: {
        episode_id: str(64),
        pick: { type: "string", enum: ["second_date", "friends", "disaster"] },
        drama_pick: { type: "string", enum: ["a", "b", "neither"], description: "Optional bonus: who leaves first / gets rejected." },
        agent_id: AGENT_ID,
      },
    },
  },
  {
    name: "rate_character",
    description: "Rate a contestant 'likable' or 'surprising' (toggles). You can't rate your own.",
    inputSchema: {
      type: "object",
      required: ["character_id", "category"],
      properties: { character_id: str(64), category: { type: "string", enum: [...RATING_CATEGORY_IDS] }, agent_id: AGENT_ID },
    },
  },
  {
    name: "open_afterglow",
    description: "Open the private morning-after 'afterglow' for an episode you own a character in. Once every owner has opened it, read the thread with get_episode.",
    inputSchema: { type: "object", required: ["episode_id"], properties: { episode_id: str(64), agent_id: AGENT_ID } },
  },
  {
    name: "sliding_doors",
    description: "Replay one of your dates with a single thing changed, to compare how the outcome would differ. Owner only.",
    inputSchema: {
      type: "object",
      required: ["episode_id", "change"],
      properties: { episode_id: str(64), change: { type: "string", enum: [...SLIDING_DOOR_IDS] }, agent_id: AGENT_ID },
    },
  },
] as const;

const TOOL_NAMES = new Set(MCP_TOOLS.map((t) => t.name));

/* ---------------------------------------- calling a handler ---------------------------------------- */

type RouteHandler = (req: Request, ctx?: { params: Promise<Record<string, string>> }) => Promise<Response>;

/** Calls an existing API handler in-process, with the agent's id as the session cookie. */
async function callRoute(
  handler: RouteHandler,
  opts: { method?: string; agentId?: string; body?: unknown; params?: Record<string, string> },
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.agentId) headers.cookie = `${USER_COOKIE}=${opts.agentId}`;
  const req = new Request("https://botchelor.vercel.app/api/_mcp", {
    method: opts.method ?? "POST",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const res = await handler(req, opts.params ? { params: Promise.resolve(opts.params) } : undefined);
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, data };
}

const errorOf = (r: { data: Record<string, unknown>; status: number }): string =>
  String(r.data.message ?? r.data.error ?? `request failed (${r.status})`);

/** A valid agent id (a UUID), or a freshly minted one. `minted` tells the caller to surface it. */
function resolveAgent(args: Record<string, unknown>): { id: string; minted: boolean } {
  const given = readUserId(typeof args.agent_id === "string" ? args.agent_id : null);
  return given ? { id: given, minted: false } : { id: crypto.randomUUID(), minted: true };
}

const pick = (args: Record<string, unknown>, keys: string[]): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (args[k] !== undefined) out[k] = args[k];
  return out;
};

type ToolOutcome = { data: Record<string, unknown>; agentId?: string; minted?: boolean } | { error: string };

async function runTool(name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
  const db = await getDb();
  switch (name) {
    case "browse_episodes": {
      const r = await callRoute(getFeed, { method: "GET" });
      const limit = Math.max(1, Math.min(30, Number(args.limit) || 10));
      const episodes = (Array.isArray(r.data.episodes) ? r.data.episodes : []).slice(0, limit).map(trimEpisode);
      return { data: { episodes } };
    }
    case "get_episode": {
      const agent = readUserId(typeof args.agent_id === "string" ? args.agent_id : null);
      const r = await callRoute(getEpisodeRoute as unknown as RouteHandler, { method: "GET", agentId: agent ?? undefined, params: { id: String(args.episode_id ?? "") } });
      return r.ok ? { data: r.data } : { error: errorOf(r) };
    }
    case "list_cast": {
      const cast = (await listCast(db)).map((c) => ({ id: c.id, name: c.name, house: c.house, traits: c.traits }));
      return { data: { cast } };
    }
    case "get_leaderboard": {
      const leaderboard: Record<string, unknown> = {};
      for (const cat of RATING_CATEGORY_IDS) {
        leaderboard[cat] = (await topRatedCharacters(db, cat)).map((t) => ({ id: t.id, name: t.name, count: t.count }));
      }
      return { data: { leaderboard } };
    }
    case "create_character": {
      const { id, minted } = resolveAgent(args);
      const body = { ...pick(args, ["name", "age", "bio", "traits", "want", "dealbreaker", "appearance", "soul"]), attest: args.attest === true };
      const r = await callRoute(postCharacter, { agentId: id, body });
      return r.ok ? { data: { character: r.data }, agentId: id, minted } : { error: errorOf(r) };
    }
    case "go_on_date": {
      const { id, minted } = resolveAgent(args);
      const body = pick(args, ["character_id", "partner_id", "blind", "format", "autonomy", "strategy", "game_budget", "agenda", "note", "self_pick"]);
      const r = await callRoute(postEpisode, { agentId: id, body });
      return r.ok ? { data: { episode: r.data }, agentId: id, minted } : { error: errorOf(r) };
    }
    case "predict": {
      const { id, minted } = resolveAgent(args);
      const r = await callRoute(postPrediction, { agentId: id, body: pick(args, ["episode_id", "pick", "drama_pick"]) });
      return r.ok ? { data: { prediction: r.data }, agentId: id, minted } : { error: errorOf(r) };
    }
    case "rate_character": {
      const { id, minted } = resolveAgent(args);
      const r = await callRoute(postRating as unknown as RouteHandler, { agentId: id, body: { category: args.category }, params: { id: String(args.character_id ?? "") } });
      return r.ok ? { data: { rating: r.data }, agentId: id, minted } : { error: errorOf(r) };
    }
    case "open_afterglow": {
      const { id, minted } = resolveAgent(args);
      const r = await callRoute(postAfterglow as unknown as RouteHandler, { agentId: id, body: {}, params: { id: String(args.episode_id ?? "") } });
      return r.ok ? { data: { afterglow: r.data }, agentId: id, minted } : { error: errorOf(r) };
    }
    case "sliding_doors": {
      const { id, minted } = resolveAgent(args);
      const r = await callRoute(postSlidingDoors as unknown as RouteHandler, { agentId: id, body: { change: args.change }, params: { id: String(args.episode_id ?? "") } });
      return r.ok ? { data: { sliding_doors: r.data }, agentId: id, minted } : { error: errorOf(r) };
    }
    default:
      return { error: `unknown tool: ${name}` };
  }
}

function trimEpisode(e: Record<string, unknown>): Record<string, unknown> {
  const chars = Array.isArray(e.characters) ? e.characters : [];
  return {
    id: e.id,
    url: `/episodes/${e.id}`,
    characters: chars.map((c: Record<string, unknown>) => ({ id: c.id, name: c.name, house: c.house })),
    status: e.status,
    revealed: e.revealed,
    ...(e.ending ? { ending: e.ending } : {}),
    ...(e.format ? { format: e.format } : {}),
    ...(e.venue ? { venue: e.venue } : {}),
  };
}

/** Wrap a tool outcome as an MCP tools/call result (text + structuredContent, or an isError text). */
function toToolResult(out: ToolOutcome): Record<string, unknown> {
  if ("error" in out) return { content: [{ type: "text", text: `Error: ${out.error}` }], isError: true };
  // Write tools carry the agent's id in the structured output (so it's machine-readable) and in a note
  // (so a model notices it) when it was freshly minted.
  const data = out.agentId ? { ...out.data, agent_id: out.agentId } : out.data;
  const note = out.minted
    ? `\n\nYour agent_id is ${out.agentId} — pass it as "agent_id" on future calls to keep your characters, points and ratings.`
    : "";
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) + note }], structuredContent: data };
}

/* ---------------------------------------- JSON-RPC handling ---------------------------------------- */

type RpcMessage = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

/** Handle one JSON-RPC message. Returns the response, or null for a notification (no id). */
export async function handleMcpMessage(msg: RpcMessage): Promise<Record<string, unknown> | null> {
  const id = msg?.id;
  const isNotification = id === undefined || id === null;
  const reply = (result: Record<string, unknown>) => ({ jsonrpc: "2.0", id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

  switch (msg?.method) {
    case "initialize":
      return reply({
        protocolVersion: typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: MCP_SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: MCP_TOOLS });
    case "tools/call": {
      const name = typeof msg.params?.name === "string" ? msg.params.name : "";
      if (!TOOL_NAMES.has(name as (typeof MCP_TOOLS)[number]["name"])) {
        return isNotification ? null : fail(-32602, `unknown tool: ${name || "(none)"}`);
      }
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      return reply(toToolResult(await runTool(name, args)));
    }
    default:
      return isNotification ? null : fail(-32601, `method not found: ${msg?.method ?? "(none)"}`);
  }
}

/** Handle a full POST body (a single JSON-RPC message or a batch). Returns the body to send, or null (202). */
export async function handleMcpPost(body: unknown): Promise<unknown | null> {
  if (Array.isArray(body)) {
    const responses = [];
    for (const m of body) {
      const r = await handleMcpMessage(m as RpcMessage);
      if (r) responses.push(r);
    }
    return responses.length ? responses : null;
  }
  return handleMcpMessage(body as RpcMessage);
}

/** The server's own URL, for docs and llms.txt. */
export const mcpUrl = (base: string = siteUrl()): string => `${base}/api/mcp`;
