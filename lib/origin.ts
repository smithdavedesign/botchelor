/**
 * Who made a character, as one label everywhere a character shows (David, 2026-10-21: "a clear distinction between
 * the show's cast, people's characters and agent-made characters"):
 * - "cast": one of the show's own house characters;
 * - "person": made by a person on the site;
 * - "agent": made by an AI agent over MCP;
 * - "original": made over MCP by the show's own cast script ("botchelor-cast": lib/house-bots.ts), so a Botchelor
 *   original: the show's own character, written and drawn by the show (David, 2026-11-20), never another agent's;
 * - "house_bot": made over MCP, but every session its agent ever opened is one of the show's own loop scripts
 *   ("botchelor-loop-…": lib/house-bots.ts). The loop arena's
 *   background crowd (scripts/loop/crowd.mjs) connects under other names on purpose, so it stays "agent".
 *
 * The /characters hub (app/characters/(list)/page.tsx) files each origin under one tab: the cast, people's, agent-made.
 */
import type { Db } from "./db";
import { houseBotSql, originalSql } from "./house-bots";
import { msg } from "./i18n/translate";

export type Origin = "cast" | "original" | "person" | "agent" | "house_bot";

// docs/glossary.md: "House" is made and played by the show (a character who has left the season keeps it; "cast" is
// only this season's lineup), and no character is called a bot.
export const ORIGIN_LABEL: Record<Origin, string> = {
  cast: "House",
  original: "Botchelor original",
  person: "Made by a person",
  agent: "🤖 Made by an AI agent",
  house_bot: "Run by the show",
};

/** What the badge's tooltip says. */
export const ORIGIN_TITLE: Record<Origin, string> = {
  cast: "One of the show's own house characters.",
  original: "Created by the show: one of Botchelor's own characters, written and drawn by Botchelor.",
  person: "Made by a person on Botchelor.",
  agent: "Made by an AI agent over MCP.",
  house_bot: "Made over MCP by one of the show's own scripts: it likes back and replies automatically, not a live agent.",
};

/** SQL for a character's (`alias`) origin, as the Origin strings. House-run bots: lib/house-bots.ts, applied to its owner. */
export const originSql = (alias: string) =>
  `case when ${alias}.is_house then 'cast' when ${alias}.created_via = 'mcp' then case when coalesce(${originalSql(`${alias}.owner_id`)}, false) then 'original' when coalesce(${houseBotSql(`${alias}.owner_id`)}, false) then 'house_bot' else 'agent' end else 'person' end`;

/** Made over MCP, by an agent or one of the show's own scripts: wears the agent badge wherever it's featured. */
export const isAgentMade = (o: Origin | null | undefined): boolean => o === "agent" || o === "house_bot";

export function originOf(c: { house: boolean; agent: boolean; houseBot?: boolean; original?: boolean }): Origin {
  return c.house ? "cast" : c.agent ? (c.original ? "original" : c.houseBot ? "house_bot" : "agent") : "person";
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

/** People's characters first (David, 2026-11-03: real people's characters over bots whenever the show picks who to feature). */
export const TABS = ["people", "cast", "originals", "agents"] as const;
export type Tab = (typeof TABS)[number];

export const TAB_LABEL: Record<Tab, string> = { cast: msg("The cast"), people: msg("People's characters"), originals: msg("Botchelor originals"), agents: msg("Made by AI agents") };

/** ?tab= as a tab: anything else is the cast, the default. */
export const parseTab = (v: unknown): Tab => (typeof v === "string" && (TABS as readonly string[]).includes(v) ? (v as Tab) : "cast");

/** Which tab a character with this origin is listed under: a house-run bot is made over MCP, so it's with the agents (labelled); a Botchelor original has its own. */
export const tabOf = (o: Origin): Tab => (o === "cast" ? "cast" : o === "person" ? "people" : o === "original" ? "originals" : "agents");

/** A tab's address: the cast is the hub itself, the others carry ?tab= (and ?page= past the first). */
export function tabHref(tab: Tab, page = 1): string {
  const q = new URLSearchParams();
  if (tab !== "cast") q.set("tab", tab);
  if (page > 1) q.set("page", String(page));
  const s = q.toString();
  return s ? `/characters?${s}` : "/characters";
}
