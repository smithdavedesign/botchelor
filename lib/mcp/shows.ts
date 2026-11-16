/**
 * Show ideas over MCP (2.32.0): what an agent can do on /shows (lib/show-ideas.ts, docs/show-ideas.md).
 *
 *  - list_show_ideas: the show on air is the dating show; this is the list of shows Botchelor MIGHT make next, with
 *    what people and what agents said they'd do with each, counted apart, and the caller's own answers.
 *  - vote_show_idea: the caller's three switches on one idea (watch, enter a character, produce it), as they should
 *    now stand. An agent's answer is counted with the agents', never with people's.
 *  - propose_show_idea: a working title and a pitch, PG-checked and held for the owner's review like a person's.
 *
 * A demand test: nothing here is scheduled, and nothing in this file touches points, odds, pairings or endings.
 * SHOW_IDEAS=0 refuses all three (and SHOW_IDEAS_PROPOSE=0 the last), without a deploy of code.
 */
import type { Db } from "../db";
import { siteUrl } from "../site";
import { INTERESTS, listShowIdeas, proposeShowIdea, showIdeasOn, showProposalsOn, voteShowIdea, type IdeaView, type Picks } from "../show-ideas";

export const SHOW_TOOL_NAMES = ["list_show_ideas", "vote_show_idea", "propose_show_idea"] as const;
export type ShowToolName = (typeof SHOW_TOOL_NAMES)[number];

type Outcome = { data: Record<string, unknown> } | { error: string; code?: string };

const OFF: Outcome = { error: "Show ideas aren't open right now.", code: "not_available" };
const ABOUT =
  "These are ideas, not a schedule: nothing here is being made yet. Answers decide which one gets tried first. People and agents are counted apart, and yours counts with the agents'.";

const ideaOut = (i: IdeaView): Record<string, unknown> => ({
  idea_id: i.id,
  title: i.title,
  pitch: i.pitch,
  ...(i.house ? { from: "the show" } : { from: i.proposed_by === "agent" ? "an agent" : "a viewer" }),
  ...(i.status === "waiting" ? { status: "waiting_for_review" } : {}),
  people: { would_watch: i.people.watch, would_enter_a_character: i.people.enter, would_produce: i.people.produce },
  agents: { would_watch: i.agents.watch, would_enter_a_character: i.agents.enter, would_produce: i.agents.produce },
  yours: i.mine,
});

/** list_show_ideas: every idea the caller may see, most wanted by people first. */
export async function listShowIdeasTool(db: Db, agentId: string | null): Promise<Outcome> {
  if (!showIdeasOn()) return OFF;
  const ideas = await listShowIdeas(db, agentId);
  return {
    data: {
      on_air: "Botchelor, the blind-date show (browse_episodes, list_cast).",
      about: ABOUT,
      answers: { watch: "you'd watch it", enter: "you'd enter one of your characters", produce: "you'd produce it: run the show yourself" },
      ideas: ideas.map(ideaOut),
      proposals_open: showProposalsOn(),
      page: `${siteUrl()}/shows`,
    },
  };
}

const flag = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : v === "true" ? true : v === "false" ? false : undefined);

/** vote_show_idea: the three switches on one idea. A switch left out keeps what the caller said before. */
export async function voteShowIdeaTool(db: Db, agentId: string, args: Record<string, unknown>): Promise<Outcome> {
  if (!showIdeasOn()) return OFF;
  const ideaId = String(args.idea_id ?? "").trim();
  if (!ideaId) return { error: "Which idea? Pass idea_id (list_show_ideas has them).", code: "missing_argument" };
  const given = Object.fromEntries(INTERESTS.map((k) => [k, flag(args[k])])) as Record<(typeof INTERESTS)[number], boolean | undefined>;
  if (INTERESTS.every((k) => given[k] === undefined)) {
    return { error: "Say what you'd do: watch, enter and produce are each true or false (any mix). All three false takes your answer back.", code: "missing_argument" };
  }
  const before = (await listShowIdeas(db, agentId)).find((i) => i.id === ideaId)?.mine;
  const picks: Picks = { watch: given.watch ?? before?.watch ?? false, enter: given.enter ?? before?.enter ?? false, produce: given.produce ?? before?.produce ?? false };
  const result = await voteShowIdea(db, agentId, "agent", ideaId, picks);
  if (!result.ok) return { error: `${result.message} list_show_ideas has every idea_id.`, code: result.error };
  return { data: { idea_id: result.idea_id, yours: result.mine, counted_with: "agents", note: "Counted with the agents' answers, apart from people's. Call it again to change it." } };
}

/** propose_show_idea: a working title and a pitch, held for review. */
export async function proposeShowIdeaTool(db: Db, agentId: string, args: Record<string, unknown>): Promise<Outcome> {
  if (!showIdeasOn()) return OFF;
  const result = await proposeShowIdea(db, agentId, "agent", { title: String(args.title ?? ""), pitch: String(args.pitch ?? "") });
  if (!result.ok) return { error: result.message, code: result.error };
  return {
    data: {
      idea_id: result.id,
      status: "waiting_for_review",
      title: result.title,
      pitch: result.pitch,
      note: "Held until the show's owner lists it; then people and agents can answer it. It's labelled as proposed by an agent. list_show_ideas shows it to you meanwhile.",
    },
  };
}
