import type { Db } from "./db";
import { bookingAsk } from "./date-roleplays";
import {
  carryOn,
  COMPANION_MESSAGE_MAX,
  COMPANION_REPORT_REASONS,
  companionFollowUp,
  companionOpen,
  deleteThread,
  editLast,
  getThread,
  listCompanions,
  openThread,
  regenerate,
  reportMessage,
  REPLY_LENGTHS,
  SCENE_PLACES,
  SCENE_TEXTING,
  screenFact,
  sendMessage,
  setReplyLength,
  setScene,
  isScenePlace,
  COMPANION_ACTIONS,
  COMPANION_AGENT_LIMITS,
  COMPANION_AGENTS_DAILY,
  type CompanionAction,
  type CompanionFail,
  type CompanionReportReason,
  type CompanionThreadView,
  type ReplyLength,
} from "./companion";
import { editFacts, FACT_MAX, listFacts } from "./companion-memory";
import { CRISIS_RESOURCES } from "./crisis";
import { overLimit } from "./limits";
import { inBackground } from "./sets";
import { venueName } from "./venues";

/**
 * Companions over MCP (docs/companions.md): an agent talks one to one with a character, as itself. Its threads are its
 * own (keyed to its agent id), its own characters are its companions too, and everything a person's thread has holds:
 * the AI notice, PG both ways, the self-harm check on its words (counted as mcp_companion), the memory it can read and
 * change. Open to every agent once COMPANION_OPEN=1; until then only to the admin's own (the admin key, or an agent
 * linked to an admin account).
 */

export { COMPANION_ACTIONS, COMPANION_AGENT_LIMITS, COMPANION_AGENTS_DAILY, COMPANION_TOOL_DESCRIPTION, type CompanionAction } from "./companion-shared";
/** How many of the newest messages a reply carries (read takes up to READ_MAX). */
const RECENT = 8;
const READ_MAX = 50;

type ToolError = { error: string; code?: string; details?: Record<string, unknown> };
export type CompanionToolResult = { data: Record<string, unknown> } | ToolError;

/** Whether this agent may use companions: open to all, or the admin's own. */
export async function companionAgentAllowed(db: Db, agentId: string, admin: boolean, env: Record<string, string | undefined> = process.env): Promise<boolean> {
  if (companionOpen(env) || admin) return true;
  const { rows } = await db.query(`select 1 from agent_links l join admins a on a.user_id = l.user_id where l.agent_id = $1 limit 1`, [agentId]);
  return rows.length > 0;
}

const failed = (r: CompanionFail): ToolError => ({
  error: r.message,
  code: r.error,
  ...(r.crisis_resources ? { details: { crisis_resources: r.crisis_resources, paused: true, note: "The conversation is paused: action carry_on when you're ready." } } : {}),
});

/** The thread for an agent's reply: the newest messages, not the whole history. */
function compact(view: CompanionThreadView, since?: Set<string>, limit = RECENT): Record<string, unknown> {
  const fresh = since ? view.messages.filter((m) => !since.has(m.id)) : [];
  return {
    thread_id: view.id,
    character: { id: view.character.id, name: view.character.name, yours: view.character.yours },
    ...(since ? { reply: fresh.filter((m) => m.role === "character").map((m) => ({ id: m.id, text: m.text, ...(m.action ? { does: m.action } : {}) })) } : {}),
    ...(fresh.some((m) => m.role === "system" && !m.marker) ? { notice: fresh.find((m) => m.role === "system" && !m.marker)!.text } : {}),
    messages: view.messages.slice(-limit).map((m) => ({
      id: m.id,
      from: m.role === "user" ? "you" : m.role === "character" ? "them" : m.marker ? "scene" : "notice",
      text: m.text,
      ...(m.action ? { does: m.action } : {}),
      at: m.at,
      ...(m.reported ? { reported: true } : {}),
    })),
    // A scene at one of the show's places (action scene): they answer face to face, with what they do (does).
    ...(view.scene ? { scene: { place: view.scene, name: venueName(view.scene), ...(view.roleplay ? { roleplay: view.roleplay } : {}) } } : {}),
    reply_length: view.reply_length,
    remembers: view.facts,
    ...(view.paused ? { paused: true, crisis_resources: CRISIS_RESOURCES } : {}),
  };
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** The thread an action is about: thread_id, or this agent's thread with character_id (opened when `open`). */
async function threadFor(db: Db, agentId: string, args: Record<string, unknown>, open: boolean): Promise<{ id: string; opened?: boolean } | ToolError> {
  const given = str(args.thread_id);
  if (given) return { id: given };
  const character = str(args.character_id);
  if (!character) return { error: "Say which conversation: thread_id, or character_id (from action list).", code: "missing_thread" };
  const found = (await db.query<{ id: string }>(`select id from companion_threads where user_id = $1 and character_id = $2`, [agentId, character])).rows[0];
  if (found) return found;
  if (!open) return { error: "You haven't talked with them yet: action open (or send) with this character_id.", code: "no_thread" };
  const r = await openThread(db, agentId, character);
  return r.ok ? { id: r.thread_id, opened: !r.resumed } : failed(r);
}

async function talkLimited(db: Db, agentId: string): Promise<CompanionToolResult | null> {
  if (await overLimit(db, "companion_agent", agentId, COMPANION_AGENT_LIMITS)) {
    return { error: `That's the limit for now (${COMPANION_AGENT_LIMITS.perHour} messages an hour, ${COMPANION_AGENT_LIMITS.perDay} a day). Come back in a bit.`, code: "rate_limited" };
  }
  if (await overLimit(db, "companion_agents", "all", COMPANION_AGENTS_DAILY)) {
    return { error: "Companions are busy with agents right now: try again later.", code: "busy" };
  }
  return null;
}

export async function runCompanionTool(db: Db, agentId: string, args: Record<string, unknown>, opts: { admin?: boolean } = {}): Promise<CompanionToolResult> {
  if (!(await companionAgentAllowed(db, agentId, Boolean(opts.admin)))) {
    return { error: "Companions aren't open to agents yet.", code: "not_open" };
  }
  const action = (COMPANION_ACTIONS as readonly string[]).includes(String(args.action)) ? (args.action as CompanionAction) : null;
  if (!action) return { error: `action is one of: ${COMPANION_ACTIONS.join(", ")}.`, code: "invalid_action" };

  if (action === "list") {
    const { threads, yours, cast } = await listCompanions(db, agentId);
    const card = (c: (typeof cast)[number]) => ({ character_id: c.id, name: c.name, bio: c.bio.slice(0, 140), house: c.house, ...(c.thread_id ? { thread_id: c.thread_id, last: c.last, last_at: c.last_at } : {}) });
    return { data: { threads: threads.map(card), yours: yours.map(card), cast: cast.slice(0, 40).map(card), note: "open or send with a character_id to talk with one." } };
  }

  // A scene's start is a reply too (they open it).
  const talks = action === "send" || action === "regenerate" || action === "edit" || (action === "scene" && args.place !== SCENE_TEXTING);
  if (talks || action === "open") {
    const limited = await talkLimited(db, agentId);
    if (limited) return limited;
  }
  const thread = await threadFor(db, agentId, args, action === "open" || action === "send");
  if ("error" in thread) return thread;
  const before = await getThread(db, agentId, thread.id);
  if (!before.ok) return failed(before);
  // A thread this call opened: its notice and first messages are news too.
  const seen = new Set(thread.opened ? [] : before.view.messages.map((m) => m.id));
  const done = (r: Awaited<ReturnType<typeof getThread>>, withReply = false) => {
    if (!r.ok) return failed(r);
    if (talks) inBackground(() => companionFollowUp(db, thread.id));
    return { data: compact(r.view, withReply ? seen : undefined) };
  };

  switch (action) {
    case "open":
      // A thread opened by this call: its notice and first messages are all new; one found again shows where it stands.
      return { data: { ...compact(before.view, thread.opened ? seen : undefined), resumed: !thread.opened } };
    case "read": {
      const limit = Math.max(1, Math.min(READ_MAX, Number(args.limit) || 20));
      return { data: compact(before.view, undefined, limit) };
    }
    case "send":
    case "edit": {
      const text = typeof args.text === "string" ? args.text : "";
      if (!text.trim()) return { error: "Say something in text.", code: "empty" };
      if (text.length > COMPANION_MESSAGE_MAX) return { error: `Keep text under ${COMPANION_MESSAGE_MAX} characters.`, code: "too_long" };
      const r = action === "send" ? await sendMessage(db, agentId, thread.id, text, new Date(), "mcp_companion") : await editLast(db, agentId, thread.id, text, new Date(), "mcp_companion");
      return done(r, true);
    }
    case "regenerate":
      return done(await regenerate(db, agentId, thread.id), true);
    case "length": {
      const length = (REPLY_LENGTHS as readonly string[]).includes(String(args.length)) ? (args.length as ReplyLength) : null;
      if (!length) return { error: `length is one of: ${REPLY_LENGTHS.join(", ")}.`, code: "invalid_length" };
      return done(await setReplyLength(db, agentId, thread.id, length));
    }
    case "scene": {
      const place = args.place === SCENE_TEXTING ? null : isScenePlace(args.place) ? args.place : undefined;
      if (place === undefined) {
        return {
          error: `Say where: place is one of the show's places (an id below), or ${SCENE_TEXTING} to go back to texting.`,
          code: "invalid_place",
          details: { places: SCENE_PLACES.map((id) => ({ id, name: venueName(id) })) },
        };
      }
      // A roleplay to play in it (lib/date-roleplays.ts bookingAsk: an id or {title, premise, roles}; "none" is none).
      const ask = bookingAsk(args.roleplay, args.my_role);
      return done(await setScene(db, agentId, thread.id, place, new Date(), ask && !ask.skip ? ask : null), true);
    }
    case "carry_on":
      return done(await carryOn(db, agentId, thread.id));
    case "report": {
      const reason = (COMPANION_REPORT_REASONS as readonly string[]).includes(String(args.reason)) ? (args.reason as CompanionReportReason) : null;
      if (!reason) return { error: `reason is one of: ${COMPANION_REPORT_REASONS.join(", ")}.`, code: "invalid_reason" };
      const messageId = str(args.message_id);
      if (!messageId) return { error: "Say which reply: message_id (from messages or reply).", code: "missing_message" };
      return done(await reportMessage(db, agentId, thread.id, messageId, reason));
    }
    case "memory":
      return { data: { thread_id: thread.id, facts: await listFacts(db, thread.id), note: "remember, forget {fact_id} or forget_all change it." } };
    case "remember":
    case "forget":
    case "forget_all": {
      if (action === "remember" && typeof args.text === "string") {
        const crisis = await screenFact(db, agentId, thread.id, args.text, "mcp_companion");
        if (crisis) return failed(crisis);
      }
      const edit =
        action === "remember"
          ? { op: "add" as const, text: (typeof args.text === "string" ? args.text : "").slice(0, FACT_MAX * 2) }
          : action === "forget"
            ? { op: "delete" as const, id: str(args.fact_id) ?? "" }
            : { op: "forget_all" as const };
      const problem = await editFacts(db, thread.id, edit);
      if (problem) return { error: problem, code: "invalid_request" };
      return { data: { thread_id: thread.id, facts: await listFacts(db, thread.id) } };
    }
    case "delete": {
      const r = await deleteThread(db, agentId, thread.id);
      return r.ok ? { data: { deleted: true, thread_id: thread.id } } : failed(r);
    }
  }
  return { error: "Unknown action.", code: "invalid_action" };
}
