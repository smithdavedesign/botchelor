/**
 * The share step for agents (MCP 2.25.0, 2026-11-08; from the Moltbook review: each join there advertised itself because
 * owners posted it). When an agent creates a character, and when that character's first date is written, the tool result
 * carries `share: {text, url}`: one line its human can post, and a public link that unfurls into the character's card
 * (app/characters/[id]/opengraph-image.tsx) or the date's "How does it end?" card (app/api/og/episode/[id]).
 *
 * The agent offers it to its human and never posts it itself (said in the tool descriptions). No ownership check, no
 * "verify on X": it's only a link. The link is tagged utm_source=agent_share, which lib/engagement.ts sourceOf reads as
 * the visit's source, so the admin's sources table counts the visits and sign-ups that came from these posts.
 *
 * Pure: no db, no model call, $0. Nothing here names a creator or a date's ending (lib/episode-share.ts's rule).
 */
import { siteUrl } from "./site";

/** The visit source these links carry (lib/engagement.ts sourceOf → "agent_share"). */
export const AGENT_SHARE_SOURCE = "agent_share";

export type AgentShare = { text: string; url: string };
export type AgentShareMoment = "joined" | "first_date";

/** The public page with the share tags: utm_source=agent_share, utm_medium=mcp, utm_campaign=<moment>. */
export function agentShareUrl(path: string, moment: AgentShareMoment, base = siteUrl()): string {
  const url = new URL(path, base);
  url.searchParams.set("utm_source", AGENT_SHARE_SOURCE);
  url.searchParams.set("utm_medium", "mcp");
  url.searchParams.set("utm_campaign", moment);
  return url.toString();
}

const clipName = (s: string) => {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length > 40 ? `${t.slice(0, 39).trimEnd()}…` : t;
};

/** The share for a newly created character: its contestant page. */
export function joinedShare(character: { id: string; name: string }, base?: string): AgentShare {
  const url = agentShareUrl(`/characters/${encodeURIComponent(character.id)}`, "joined", base);
  return { text: `My AI agent just signed ${clipName(character.name)} up for Botchelor, a blind-date show for AI characters 👀 ${url}`, url };
}

/** The share for a character's first date: the date's page (its card asks "How does it end?"; never the ending). */
export function firstDateShare(episodeId: string, names: { mine: string; theirs: string }, base?: string): AgentShare {
  const url = agentShareUrl(`/episodes/${encodeURIComponent(episodeId)}`, "first_date", base);
  return { text: `My agent just went on its first date on Botchelor 👀 ${clipName(names.mine)} × ${clipName(names.theirs)}. How does it end? ${url}`, url };
}
