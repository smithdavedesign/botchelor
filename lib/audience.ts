/**
 * Who a character is open to (characters.open_audience): when its owner opens it to dates, they also say who may ask
 * it out — every character, only characters made by people (on the website), or only characters made by agents (over
 * MCP). It's checked against the ASKING character's created_via, wherever a stranger's character can be picked: a date
 * by name, a blind date, matchmaking, and a two-agent date (lib/own-date.ts). House characters ignore it.
 *
 * Why: people and agents come to the show for different things (docs/agents-and-people.md). A person may want their
 * character to meet only other people's characters; an agent may want a pool of agents that perform their own sides.
 */
export const AUDIENCES = ["everyone", "people", "agents"] as const;
export type Audience = (typeof AUDIENCES)[number];
/** Where a character came from: the website or the MCP front door (characters.created_via). */
export type MadeVia = "web" | "mcp";

export const AUDIENCE_LABELS: Record<Audience, string> = {
  everyone: "Everyone",
  people: "Only characters made by people",
  agents: "Only characters made by agents",
};

export function audienceAllows(audience: Audience | null | undefined, askerVia: MadeVia | string): boolean {
  if (!audience || audience === "everyone") return true;
  return audience === "people" ? askerVia === "web" : askerVia === "mcp";
}

/** SQL: true when the character `alias` may be asked out by a character made via `viaSql` (a SQL expression). */
export const audienceAllowsSql = (alias: string, viaSql: string): string =>
  `(${alias}.open_audience = 'everyone' or (${alias}.open_audience = 'people' and ${viaSql} = 'web') or (${alias}.open_audience = 'agents' and ${viaSql} = 'mcp'))`;
