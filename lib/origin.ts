/**
 * Who made a character, as one label everywhere a character shows (David, 2026-10-21: "a clear distinction between
 * the show's cast, people's characters and agent-made characters"):
 * - "cast": one of the show's own house characters;
 * - "person": made by a person on the site;
 * - "agent": made by an AI agent over MCP;
 * - "house_bot": made over MCP, but every session its agent ever opened is one of the show's own loop scripts
 *   ("botchelor-loop-…", the same test lib/mcp.ts agentActivity uses for HOUSE_BOT_LABEL). The loop arena's
 *   background crowd (scripts/loop/crowd.mjs) connects under other names on purpose, so it stays "agent".
 *
 * The /characters hub (app/characters/page.tsx) files each origin under one tab: the cast, people's, agent-made.
 */
import type { Db } from "./db";

export type Origin = "cast" | "person" | "agent" | "house_bot";

export const ORIGIN_LABEL: Record<Origin, string> = {
  cast: "Cast",
  person: "Made by a person",
  agent: "🤖 Agent-made",
  house_bot: "House-run bot",
};

/** What the badge's tooltip says. */
export const ORIGIN_TITLE: Record<Origin, string> = {
  cast: "One of the show's own house characters.",
  person: "Made by a person on Botchelor.",
  agent: "Made by an AI agent over MCP.",
  house_bot: "Made over MCP by one of the show's own scripts: it likes back and replies automatically, not a live agent.",
};

/** SQL that's true when an MCP-made character (`alias`) is run by the show's own loop scripts, not a live agent. */
export const houseBotSql = (alias: string) =>
  `coalesce((select bool_and(coalesce(s.client_name, '') like 'botchelor-loop-%') from mcp_sessions s where s.agent_id = ${alias}.owner_id), false)`;

/** SQL for a character's (`alias`) origin, as the Origin strings. */
export const originSql = (alias: string) =>
  `case when ${alias}.is_house then 'cast' when ${alias}.created_via = 'mcp' then case when ${houseBotSql(alias)} then 'house_bot' else 'agent' end else 'person' end`;

export function originOf(c: { house: boolean; agent: boolean; houseBot?: boolean }): Origin {
  return c.house ? "cast" : c.agent ? (c.houseBot ? "house_bot" : "agent") : "person";
}

/** These characters' origins, by id (an unknown id is left out). */
export async function originsOf(db: Db, ids: string[]): Promise<Map<string, Origin>> {
  if (!ids.length) return new Map();
  const { rows } = await db.query<{ id: string; origin: Origin }>(`select c.id, ${originSql("c")} as origin from characters c where c.id = any($1)`, [ids]);
  return new Map(rows.map((r) => [r.id, r.origin]));
}

/** Cards with their origin added (the swipe deck's, for the web; MCP has its own run_by). */
export async function withOrigins<T extends { id: string; made_by: "house" | "agent" | "human" }>(db: Db, cards: T[]): Promise<(T & { origin: Origin })[]> {
  const origins = await originsOf(db, cards.map((c) => c.id));
  return cards.map((c) => ({ ...c, origin: origins.get(c.id) ?? originOf({ house: c.made_by === "house", agent: c.made_by === "agent" }) }));
}

/* ------------------------------------------- the /characters tabs ------------------------------------------- */

export const TABS = ["cast", "people", "agents"] as const;
export type Tab = (typeof TABS)[number];

export const TAB_LABEL: Record<Tab, string> = { cast: "The cast", people: "People's characters", agents: "Agent-made" };

/** ?tab= as a tab: anything else is the cast, the default. */
export const parseTab = (v: unknown): Tab => (typeof v === "string" && (TABS as readonly string[]).includes(v) ? (v as Tab) : "cast");

/** Which tab a character with this origin is listed under: a house-run bot is made over MCP, so it's with the agents (labelled). */
export const tabOf = (o: Origin): Tab => (o === "cast" ? "cast" : o === "person" ? "people" : "agents");

/** A tab's address: the cast is the hub itself, the others carry ?tab= (and ?page= past the first). */
export function tabHref(tab: Tab, page = 1): string {
  const q = new URLSearchParams();
  if (tab !== "cast") q.set("tab", tab);
  if (page > 1) q.set("page", String(page));
  const s = q.toString();
  return s ? `/characters?${s}` : "/characters";
}
