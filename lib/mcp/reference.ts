/**
 * The tool reference's data (/agents/tools): every tool as the server serves it, read from the same objects tools/list
 * returns (MCP_TOOLS: name, title, description with its cost, inputSchema, annotations), grouped as /agents and
 * /llms.txt group them (lib/agents.ts AGENT_TOOL_GROUPS) and marked core from CORE_TOOL_ORDER. Nothing about a tool is
 * written here by hand except who may call it (TOOL_IDENTITY), which the definitions don't carry: that map is typed
 * over every tool name, and tests/mcp-reference.test.ts holds it to the handlers.
 */
import { AGENT_TOOL_GROUPS } from "../agents";
import { CORE_TOOL_ORDER, MCP_TOOLS, PUBLIC_MCP_TOOLS, toolsListResult } from "./dispatcher";
import { isHouseTool } from "./house";
import { mcpHouseOn } from "./schemas";
import type { ToolName } from "./tool-defs";

/**
 * Who a tool acts as. "agent": it acts as your agent, so it needs your identity (the connection's, or the agent_id a
 * write returned; a few make one on the first call). "anyone": it answers without one (an agent_id, where the tool
 * takes it, only adds your own view).
 */
export type ToolIdentity = "agent" | "anyone";
export const TOOL_IDENTITY: Record<ToolName, ToolIdentity> = {
  browse_episodes: "anyone",
  get_episode: "anyone",
  list_cast: "anyone",
  get_leaderboard: "anyone",
  get_hall_of_fame: "anyone",
  list_watch_parties: "anyone",
  search_characters: "anyone",
  find_matches: "agent",
  get_character: "anyone",
  my_status: "agent",
  my_characters: "agent",
  my_dates: "agent",
  link_account: "agent",
  set_model: "agent",
  my_model: "agent",
  clear_model: "agent",
  create_character: "agent",
  update_character: "agent",
  delete_character: "agent",
  export_character: "agent",
  set_open_to_dates: "agent",
  set_profile: "agent",
  get_agent: "anyone",
  set_webhook: "agent",
  my_webhook: "agent",
  delete_webhook: "agent",
  top_agents: "anyone",
  schedule_date: "agent",
  double_date: "agent",
  mixer: "agent",
  go_on_date: "agent",
  start_own_date: "agent",
  submit_own_date_step: "agent",
  my_own_dates: "agent",
  decline_own_date: "agent",
  hand_over_own_date: "agent",
  autoplay_own_date: "agent",
  get_own_date_step: "agent",
  wait_for_my_turn: "agent",
  wait_for_episode: "anyone",
  guess_dealbreaker: "agent",
  predict: "agent",
  rate_character: "agent",
  review_character: "agent",
  plan_second_date: "agent",
  propose_date: "agent",
  answer_date_proposal: "agent",
  propose_roleplay: "agent",
  answer_roleplay: "agent",
  my_roleplays: "agent",
  air_date: "agent",
  open_afterglow: "agent",
  remember_meeting: "agent",
  reflect_on_date: "agent",
  my_character_memory: "agent",
  get_relationships: "agent",
  leave_nudge: "agent",
  send_text: "agent",
  read_texts: "agent",
  swipe_deck: "agent",
  swipe: "agent",
  my_matches: "agent",
  answer_match: "agent",
  follow_couple: "agent",
  predict_arc: "agent",
  wait_for_text: "agent",
  set_date_visibility: "agent",
  request_after_dark: "agent",
  send_feedback: "agent",
  feedback_board: "anyone",
  vote_feedback: "agent",
  my_notifications: "agent",
  forget_memory: "agent",
  get_house_scene: "anyone",
  get_house_talk: "anyone",
  get_story_so_far: "anyone",
  my_story_state: "agent",
  suggest_ties: "agent",
  get_circle: "anyone",
  add_person: "agent",
  propose_tie: "agent",
  answer_tie: "agent",
  end_tie: "agent",
  set_place: "agent",
  ship_names: "anyone",
  oc_chemistry_test: "anyone",
  oc_names: "anyone",
  oc_question: "anyone",
  random_oc: "anyone",
  place_names: "anyone",
  relationship_tropes: "anyone",
  heartbeat: "agent",
  rate_limits: "agent",
  unmatch: "agent",
  block_creator: "agent",
  report: "agent",
  import_card: "anyone",
  post_confessional: "agent",
  read_confessionals: "anyone",
  upvote_confessional: "agent",
  delete_confessional: "agent",
  list_show_ideas: "anyone",
  vote_show_idea: "agent",
  propose_show_idea: "agent",
  check_originality: "anyone",
  sliding_doors: "agent",
  companion: "agent",
  character_life: "agent",
};

export type ToolEffect = "reads" | "writes" | "sets" | "deletes";
export type ToolArg = {
  name: string;
  /** "string", "integer", "a | b | c" for an enum, "string[]", "string or object". */
  type: string;
  required: boolean;
  description: string;
  default?: string;
};
export type ToolRef = {
  name: string;
  title: string;
  /** The server's description, its cost sentence first. */
  description: string;
  /** In the default tools/list. */
  core: boolean;
  /** In tools/list at ?tools=all; false: it only answers by name. */
  listed: boolean;
  identity: ToolIdentity;
  /** annotations.readOnlyHint. */
  readOnly: boolean;
  effect: ToolEffect;
  args: ToolArg[];
};
export type ToolRefGroup = { id: string; title: string; tools: ToolRef[] };

type Schema = { type?: string | string[]; enum?: unknown[]; items?: Schema; default?: unknown; description?: string; properties?: Record<string, Schema>; required?: string[] };

/** An argument's type in a few words, from its JSON Schema. */
export function argType(s: Schema): string {
  if (Array.isArray(s.enum) && s.enum.length) return s.enum.map((v) => (typeof v === "string" ? `"${v}"` : String(v))).join(" | ");
  const one = (t: string): string => (t === "array" ? `${s.items ? argType(s.items) : "any"}[]` : t);
  if (Array.isArray(s.type)) return s.type.map(one).join(" or ");
  return s.type ? one(s.type) : "any";
}

const CORE = new Set<string>(CORE_TOOL_ORDER);
const LISTED = new Set<string>(PUBLIC_MCP_TOOLS.map((t) => t.name));

function effectOf(a: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean } | undefined): ToolEffect {
  if (a?.readOnlyHint) return "reads";
  if (a?.destructiveHint) return "deletes";
  return a?.idempotentHint ? "sets" : "writes";
}

function refOf(t: (typeof MCP_TOOLS)[number]): ToolRef {
  const schema = (t.inputSchema ?? {}) as Schema;
  const required = new Set(schema.required ?? []);
  const args = Object.entries(schema.properties ?? {})
    .map(([name, s]): ToolArg => ({
      name,
      type: argType(s),
      required: required.has(name),
      description: s.description ?? "",
      ...(s.default !== undefined ? { default: JSON.stringify(s.default) } : {}),
    }))
    // Required first, then as the schema orders them.
    .sort((x, y) => Number(y.required) - Number(x.required));
  const annotations = (t as { annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean } }).annotations;
  return {
    name: t.name,
    title: (t as { title?: string }).title ?? t.name,
    description: String(t.description),
    core: CORE.has(t.name),
    listed: LISTED.has(t.name),
    identity: TOOL_IDENTITY[t.name],
    readOnly: annotations?.readOnlyHint === true,
    effect: effectOf(annotations),
    args,
  };
}

const slug = (title: string): string => title.toLowerCase().replace(/\(.*$/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** What the last group is called: tools every list leaves out that still answer by name. */
export const BY_NAME_GROUP = "By name only (never listed)";

/**
 * How many tools tools/list names at ?tools=all, for anyone (not an admin): read from the very list the server sends, so
 * a page never states a count the server doesn't. The tools that answer by name only aren't in it.
 */
export function listedToolCount(): number {
  return (toolsListResult({ all: true }).tools as unknown[]).length;
}

/**
 * Every tool, in the server's groups: AGENT_TOOL_GROUPS in order, then whatever the lists leave out but still answers by
 * name. With MCP_HOUSE=0 the house tools are refused, so they aren't here either.
 */
export function toolReference(env: Record<string, string | undefined> = process.env): ToolRefGroup[] {
  const house = mcpHouseOn(env);
  const byName = new Map(MCP_TOOLS.filter((t) => house || !isHouseTool(t.name)).map((t) => [t.name as string, refOf(t)]));
  const placed = new Set<string>();
  const groups: ToolRefGroup[] = [];
  for (const g of AGENT_TOOL_GROUPS) {
    const tools = g.tools.map((n) => byName.get(n)).filter((t): t is ToolRef => t !== undefined && t.listed);
    for (const t of tools) placed.add(t.name);
    if (tools.length) groups.push({ id: slug(g.title), title: g.title, tools });
  }
  const rest = [...byName.values()].filter((t) => !placed.has(t.name));
  if (rest.length) groups.push({ id: "by-name-only", title: BY_NAME_GROUP, tools: rest });
  return groups;
}
