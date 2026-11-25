/**
 * Ideas for what to say (docs/companions.md, "Ideas for what to say"): After Dark's Step in has them
 * (lib/adult/step-in-ideas.ts), and the show's companions have the same, in PG. Most people who open a companion send
 * one line and leave (2026-11-24: 11 outside people, 16 lines in 30 days), so under the character's newest reply there
 * are three short lines they could send next: one warm, one playful, one bold. A tap puts one in the box to send or
 * change. Nothing is ever sent for them, and no reply is counted until they send a line.
 *
 *  - **Drawn when the page asks**, never in a reply's way: one call to the companion's own writer (lib/companion.ts
 *    companionWriter, never the show's free model; no writer, no ideas) with the thread's last few lines and nothing
 *    else (no memory, no profile). Kept on the reply's row (companion_messages.ideas), so a reload shows the same three;
 *    "Other ideas" draws again, IDEA_DRAWS times a reply at most (companion_messages.idea_draws).
 *  - **Each one is a line the person would be writing**, so each is held to the checks their own message gets before
 *    it's shown, and again when it's read back: the crisis list (and anything that might be one: there's no second look
 *    for an idea, it's just dropped) and the show's PG line (lib/safety.ts checkFamilyTalk). One that fails is dropped;
 *    three that fail show nothing.
 *  - **Sent, it's a line like any other**: every check runs again on what they actually send.
 *  - The register follows the thread: a text message while texting; something said or done there in a scene, story
 *    mode's scenes included.
 *  - Nothing for a thread that's paused, a person out of replies, a conversation that isn't in English, or with
 *    COMPANION_IDEAS=0.
 */
import { track } from "./analytics";
import { companionEligible, companionIdeasWriter, roleplayView, type CompanionFail } from "./companion";
import { IDEA_TONES, type CompanionIdea, type CompanionIdeas, type IdeaTone } from "./companion-ideas-shared";
import { companionAllowance } from "./companion-plan";
import { jsonOf } from "./companion-prompt";
import { crisisIntent } from "./crisis";
import type { Db } from "./db";
import { isNotEnglish } from "./language";
import type { Model, Usage } from "./model";
import type { RoleplayTerms } from "./roleplays";
import { checkFamilyTalk } from "./safety";
import { maybeCrisis } from "./step-in";
import { venueName } from "./venues";

/** An idea's length (a sentence or two), how many times a reply's ideas are drawn, and how much of the thread a draw reads. */
export const IDEA_MAX = 120;
export const IDEA_DRAWS = 3;
export const IDEA_TURNS = 8;

/**
 * COMPANION_IDEAS=0: no ideas anywhere (the row and its Settings switch go, the route answers none). On unless it's "0".
 * A person hides them on their own device from the thread's Settings (companion-ideas-shared.ts IDEAS_KEY).
 */
export function companionIdeasOn(env: Record<string, string | undefined> = process.env): boolean {
  return env.COMPANION_IDEAS?.trim() !== "0";
}

const NONE: CompanionIdeas = { for: null, ideas: [], more: false };

const fail = (status: number, error: string, message: string): CompanionFail => ({ ok: false, status, error, message });
const NOT_FOUND = fail(404, "not_found", "Not found.");

/** Where the person's next line goes: a text, or something said or done in a scene (story mode's scenes too). */
export type IdeasRegister = "text" | "scene";

export type IdeasThread = {
  /** The character's name. */
  name: string;
  register: IdeasRegister;
  /** The scene's place, by name (null while texting). */
  place: string | null;
  /** The scene's roleplay, and the part the person plays in it, when there's one. */
  roleplay: { title: string; part: string | null } | null;
  /** The thread's last few lines, oldest first, as the draw reads them. */
  lines: string[];
};

const STRAIGHT = /^["“”]([^"“”]+)["“”]$/;

const tidy = (v: unknown, register: IdeasRegister): string => {
  if (typeof v !== "string") return "";
  const text = v
    .replace(/\s+/g, " ")
    .replace(/^\s*(?:[-*•]\s*)?/, "")
    .trim();
  // A text message is just what they'd type: a model that put one in quotes is unwrapped.
  return register === "text" ? (STRAIGHT.exec(text)?.[1].trim() ?? text) : text;
};

/** No emoji or markup in a line they'd send as their own. */
const PLAIN = /^[^\p{Extended_Pictographic}*_#<>[\]{}]+$/u;

/** Whether an idea can be shown: short, plain, in English, and a line that would go in as the person's own. */
export function ideaOk(text: string): boolean {
  if (!text || text.length > IDEA_MAX || !PLAIN.test(text)) return false;
  if (crisisIntent(text) || maybeCrisis(text)) return false;
  if (isNotEnglish(text)) return false;
  return checkFamilyTalk(text).ok;
}

const same = (a: string, b: string) => a.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === b.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** What's kept on a reply's row, as ideas (anything else there is nothing). */
export function storedIdeas(raw: unknown): CompanionIdea[] {
  if (!Array.isArray(raw)) return [];
  const out: CompanionIdea[] = [];
  for (const item of raw) {
    const tone = (item as { tone?: unknown } | null)?.tone;
    const text = typeof (item as { text?: unknown } | null)?.text === "string" ? String((item as { text: string }).text).trim() : "";
    if (typeof tone === "string" && (IDEA_TONES as readonly string[]).includes(tone) && text) out.push({ tone: tone as IdeaTone, text });
  }
  return out;
}

export function ideasPrompt(t: Pick<IdeasThread, "name" | "register" | "place" | "roleplay">): string {
  const first = t.name.split(/\s+/)[0] || t.name;
  return [
    `You help one person decide what to send next in a conversation they're having with ${t.name}, an AI character on Botchelor, a PG dating show. You are not ${first}, and you never write ${first}'s side.`,
    t.register === "text"
      ? `They're texting. Write three different text messages the person could send next, each the way they'd type it themselves: first person, casual, no quotation marks. One or two short sentences each, under 20 words.`
      : `They're in a scene together${t.place ? ` (${t.place})` : ""}, imagining it. Write three different things the person could say or do next there, each the way they'd write it themselves: first person, what they say out loud in double quotes and, when it helps, a few words of what they do. One or two short sentences each, under 20 words.`,
    `- "warm": sincere and kind.`,
    `- "playful": teasing or funny.`,
    `- "bold": the most forward of the three: flirtier, or it moves things along (asks ${first} something real, asks them out, says what they feel). Forward, never explicit.`,
    `Each one answers ${first}'s last message and follows from the conversation.${t.roleplay ? ` They're playing a roleplay, ${t.roleplay.title}${t.roleplay.part ? `, the person as ${t.roleplay.part}` : ""}: stay in it.` : ""}`,
    `Keep it PG, like the show: flirting and warmth are fine, at most a kiss. Nothing sexual or explicit, nothing about anyone under 18, ages, school or family roles, nothing about hurting anyone or oneself. Never decide what ${first} does, says or feels. No emoji, no asterisks. English.`,
    `Reply with a JSON object and nothing else: {"warm": "...", "playful": "...", "bold": "..."}`,
  ].join("\n");
}

/** One draw: three ideas, each checked, in tone order; fewer when one couldn't be used, none when the writer didn't answer. */
export async function drawIdeas(model: Model, t: IdeasThread, avoid: readonly string[] = [], onUsage?: (u: Usage) => void): Promise<CompanionIdea[]> {
  try {
    const raw = await model.complete(
      [
        { role: "system", content: ideasPrompt(t) },
        { role: "user", content: `The conversation so far:\n${t.lines.join("\n")}${avoid.length ? `\n\nNot these again:\n${avoid.map((a) => `- ${a}`).join("\n")}` : ""}` },
      ],
      { temperature: 0.9, maxTokens: 220, onUsage },
    );
    const j = jsonOf(raw) as Record<string, unknown> | null;
    const out: CompanionIdea[] = [];
    for (const tone of IDEA_TONES) {
      const text = tidy(j?.[tone], t.register);
      if (!ideaOk(text) || out.some((i) => same(i.text, text)) || avoid.some((a) => same(a, text))) continue;
      out.push({ tone, text });
    }
    return out;
  } catch {
    return [];
  }
}

type ThreadRow = { id: string; character_id: string; paused_at: string | Date | null; scene: string | null; roleplay: RoleplayTerms | null };
type LineRow = { id: string; role: "user" | "character" | "system"; text: string; action: string | null; marker: "scene" | "texting" | null; scene: string | null; via: string | null; ideas: unknown; idea_draws: number | null };

const said = (text: string, max = 400) => {
  const flat = text.replace(/\s+/g, " ").trim();
  // A story reply is paragraphs long, and what it ends on is what the person answers.
  return flat.length > max ? `…${flat.slice(-max)}` : flat;
};

/**
 * The thread's last lines as the draw reads them, from its newest rows (newest first, as they're read): oldest first,
 * back as far as the scene's line or "Back to texting." that began them. A text's tag in `action` is bookkeeping, so
 * only a scene's stage direction is read.
 */
export function threadLines(rows: readonly Pick<LineRow, "role" | "text" | "action" | "marker" | "scene" | "via">[], name: string): string[] {
  const first = name.split(/\s+/)[0] || name;
  const out: string[] = [];
  for (const m of rows) {
    if (m.role === "system") {
      if (!m.marker) continue;
      out.push(m.marker === "scene" && m.scene ? `(They start a scene: ${venueName(m.scene)}.)` : "(They go back to texting.)");
      break;
    }
    if (!m.text.trim()) continue;
    if (m.role === "user") out.push(`The person: ${said(m.text)}`);
    else if (m.via === "photo") out.push(`${first} sends a photo: ${said(m.text, 200)}`);
    else out.push(`${first}: ${m.action && m.scene ? `(${said(m.action, 120)}) ` : ""}${said(m.text)}`);
  }
  return out.reverse();
}

/**
 * The ideas under the thread's newest reply: the ones kept on it, or a first draw; `again` draws others (while any
 * draws are left). `for`: the message they answer (null when the newest word isn't the character's: nothing to
 * suggest). `more`: whether "Other ideas" can still draw. The same people a message can come from may ask (a guest
 * included); a paused thread is refused as a message is.
 */
export async function companionIdeas(
  db: Db,
  userId: string,
  threadId: string,
  opts: { again?: boolean; guest?: boolean } = {},
  now: Date = new Date(),
  env: Record<string, string | undefined> = process.env,
): Promise<({ ok: true } & CompanionIdeas) | CompanionFail> {
  const t = (
    await db.query<ThreadRow>(`select id, character_id, paused_at, scene, roleplay from companion_threads where id = $1 and user_id = $2`, [threadId, userId])
  ).rows[0];
  if (!t || !(await companionEligible(db, userId, t.character_id))) return NOT_FOUND;
  if (t.paused_at) return fail(409, "paused", "This conversation is paused. Carry on when you're ready.");
  if (!companionIdeasOn(env)) return { ok: true, ...NONE };
  // The newest shown lines (an earlier draw of a reply is hidden; the AI notice isn't anything anyone said).
  const { rows } = await db.query<LineRow>(
    `select id, role, text, action, marker, scene, via, ideas, idea_draws from companion_messages
      where thread_id = $1 and replaced_by is null and (role <> 'system' or marker is not null)
      order by created_at desc, id desc limit $2`,
    [threadId, IDEA_TURNS],
  );
  const reply = rows[0];
  if (!reply || reply.role !== "character") return { ok: true, ...NONE };
  const name = (await db.query<{ name: string }>(`select name from characters where id = $1`, [t.character_id])).rows[0]?.name;
  if (!name) return NOT_FOUND;
  // Read back through the checks: what passed then may not now.
  const kept = storedIdeas(reply.ideas).filter((i) => ideaOk(i.text));
  const draws = Number(reply.idea_draws ?? 0);
  const answer = (ideas: CompanionIdea[], drawn: number) => ({ ok: true as const, for: reply.id, ideas, more: drawn < IDEA_DRAWS });
  if ((draws > 0 && !opts.again) || draws >= IDEA_DRAWS) return answer(kept, draws);
  // Out of replies: nothing they could send, so nothing to suggest (the page shows the plan or the sign-up instead).
  const allowance = await companionAllowance(db, userId, now, env, { guest: opts.guest === true });
  if (!allowance.unlimited && (allowance.left ?? 0) <= 0) return { ok: true, ...NONE };
  // The ideas are in English, and so are the checks they go through: not for a conversation in another language.
  const theirs = rows.find((r) => r.role === "user");
  if (theirs && isNotEnglish(theirs.text)) return { ok: true, ...NONE };
  const model = await companionIdeasWriter(db);
  if (!model) return { ok: true, ...NONE };
  // The draw is claimed before the writer is asked, so two asks at once can't draw past the cap (or twice for the first).
  const claimed = (
    await db.query<{ idea_draws: number }>(
      `update companion_messages set idea_draws = coalesce(idea_draws, 0) + 1
        where id = $1 and thread_id = $2 and coalesce(idea_draws, 0) = $3 and coalesce(idea_draws, 0) < $4 returning idea_draws`,
      [reply.id, threadId, draws, IDEA_DRAWS],
    )
  ).rows[0];
  if (!claimed) {
    // Someone else's ask drew first: what's kept now is the answer.
    const row = (await db.query<{ ideas: unknown; idea_draws: number | null }>(`select ideas, idea_draws from companion_messages where id = $1 and thread_id = $2`, [reply.id, threadId])).rows[0];
    return answer(storedIdeas(row?.ideas).filter((i) => ideaOk(i.text)), Number(row?.idea_draws ?? IDEA_DRAWS));
  }
  const scene = t.scene && reply.scene ? t.scene : null;
  const terms = scene && t.roleplay ? roleplayView(t.roleplay, name) : null;
  const thread: IdeasThread = {
    name,
    register: scene ? "scene" : "text",
    place: scene ? venueName(scene) : null,
    roleplay: terms ? { title: terms.title, part: terms.you_play || null } : null,
    lines: threadLines(rows, name),
  };
  const started = Date.now();
  const usage: Usage[] = [];
  const fresh = await drawIdeas(
    model,
    thread,
    kept.map((i) => i.text),
    (u) => usage.push(u),
  );
  // A draw is counted whether or not anything could be shown, so a reply nothing fits isn't asked about for ever.
  const shown = fresh.length ? fresh : kept;
  if (fresh.length) await db.query(`update companion_messages set ideas = $3::jsonb where id = $1 and thread_id = $2`, [reply.id, threadId, JSON.stringify(shown)]);
  const cost = usage.reduce((s, u) => s + (u.cost ?? 0), 0);
  track("companion_ideas", {
    shown: shown.length,
    again: draws > 0 || undefined,
    scene: thread.register === "scene" || undefined,
    guest: opts.guest === true || undefined,
    cost: cost || undefined,
    ms: Date.now() - started,
  });
  return answer(shown, claimed.idea_draws);
}
