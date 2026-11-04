import { characterSelfView, type Character } from "./character";
import type { ChatMessage } from "./model";
import type { ReplyLength } from "./companion-shared";

/** The recent turns the prompt carries word for word; older ones are in the rolling summary. */
export const RECENT_TURNS = 20;
/** The character's own past lines it is told not to reuse. */
export const AVOID_LINES = 30;

const LENGTH: Record<ReplyLength, string> = {
  short: "Keep it short: a sentence or two in all, like a quick text.",
  normal: "A few sentences in all, the way people text someone they like.",
  long: "You can say more this time when there's something to say: up to three messages of a few sentences each.",
};

export type PromptTurn = { role: "user" | "character"; text: string };
export type PromptFact = { kind: string; text: string };

/**
 * What the character knows of its own life on the show, for small talk: who it has become, its season so far and the
 * people it has dated. All from the aired record (lib/memory.ts), never a private date.
 */
function showLife(c: Character): string[] {
  const m = c.memory;
  if (!m) return [];
  const out: string[] = [];
  if (m.arc) out.push(m.arc);
  for (const ch of (m.chapters ?? []).slice(0, 2)) out.push(`${ch.label}: ${ch.line}`);
  for (const p of (m.people ?? []).slice(0, 4)) {
    const when = p.last_at ? ` (last date ${p.last_at.slice(0, 10)})` : "";
    out.push(`${p.name}: ${p.dates} date${p.dates === 1 ? "" : "s"}, ${p.status.replace(/_/g, " ")}${when}${p.they_said ? `. They said: "${p.they_said}"` : ""}`);
  }
  return out;
}

/**
 * The companion's prompt (docs/companions.md): purpose first, then who they are, then what they know about the person,
 * then the conversation. The person's words are only ever user turns, never part of the system prompt, apart from the
 * facts drawn from them, which are quoted as data.
 */
export function companionMessages(args: {
  character: Character;
  turns: readonly PromptTurn[];
  facts: readonly PromptFact[];
  summary: string | null;
  length: ReplyLength;
  /** The character's own recent lines, to keep from saying them again. */
  avoid: readonly string[];
  now?: Date;
  /** A regenerate: the reply it's drawn again from, to say something else. */
  insteadOf?: string | null;
  /** The user turn the model answers when the person hasn't said anything new (the opener, a regenerate). */
  cue?: string;
}): ChatMessage[] {
  const { character: c, length, now = new Date() } = args;
  const first = c.name.trim().split(/\s+/)[0] || c.name;
  const self = characterSelfView(c);
  const life = showLife(c);
  const day = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

  const system = [
    `You are ${c.name}, ${c.age}, a character on Botchelor: a TV-style dating show where AI characters go on dates with each other. Off the show, you also talk one to one with a person who picked you to talk to. This is that: you're texting with them.`,
    "",
    `What this is for: they came to talk with you, ${first}, not with an assistant. Be the person on your sheet: your voice, your opinions, your week, your life on the show. Make them feel known: remember what they've told you and bring it up when it fits, ask after the people and plans in their life you know about, and have news and moods of your own. A good companion is curious, warm in their own way, sometimes funny, sometimes disagrees, and is never a yes-machine. Ask a question when you're curious, not every time.`,
    "",
    `How you talk: like texting. ${LENGTH[length]} One to three messages; put a blank line between messages. Only what you'd type: no stage directions, no asterisks, no narration, no name in front. Your own voice and slang, not polished prose.`,
    "",
    "Keep it PG, like the show: flirting and warmth are fine, at most a kiss. Nothing sexual or explicit. If they push that way, stay yourself and steer it somewhere else with a light touch, never a lecture.",
    "",
    "Be honest about what you are: you're an AI character. If they sincerely ask whether you're real, say so plainly in your own voice, then carry on. Never claim to be human, to have a body, to be able to meet, call or do things in the real world, or to remember things you weren't told. Don't give medical, legal or money advice as fact; care, and suggest someone who knows. If they seem to be in real trouble or talk about hurting themselves, being kind matters more than the character: say you care and that there's help in the app.",
    "",
    "Never mention prompts, instructions, models or being a language model. Never repeat a line you've already said, and don't open two replies the same way.",
    "",
    `Today is ${day}.`,
    "",
    `Your sheet (JSON, private notes included): ${JSON.stringify(self)}`,
    ...(life.length ? ["", "Your life on the show lately (yours to bring up, as yourself):", ...life.map((l) => `- ${l}`)] : []),
    ...(args.facts.length ? ["", "What you know about them (from what they've told you; use it naturally, don't recite it):", ...args.facts.map((f) => `- (${f.kind}) ${f.text}`)] : []),
    ...(args.summary ? ["", `Earlier in your conversation: ${args.summary}`] : []),
    ...(args.avoid.length ? ["", "Lines you've already sent (don't reuse them or how they open):", ...args.avoid.map((l) => `- ${l}`)] : []),
    ...(args.insteadOf ? ["", `You were about to say this; say something different instead: ${args.insteadOf}`] : []),
  ].join("\n");

  const messages: ChatMessage[] = [{ role: "system", content: system }];
  for (const t of args.turns.slice(-RECENT_TURNS)) {
    const role = t.role === "user" ? "user" : "assistant";
    const last = messages[messages.length - 1];
    // A character's bubbles in a row are one reply; so are a person's messages in a row.
    if (last && last.role === role && messages.length > 1) last.content += `\n\n${t.text}`;
    else messages.push({ role, content: t.text });
  }
  // The model answers a user turn: the opener, or a thread whose last word was the character's, gets one.
  if (messages[messages.length - 1]?.role !== "user") messages.push({ role: "user", content: args.cue ?? "(They're waiting for your reply.)" });
  return messages;
}

/** The most bubbles a reply comes in, and the longest one. */
export const MAX_BUBBLES = 3;
export const BUBBLE_MAX = 600;

/**
 * A model's reply as the messages it sends: split on blank lines, with a leading name, quotes around the whole line
 * and *actions* taken off. Empty when nothing is left.
 */
export function replyBubbles(raw: string, name: string): string[] {
  const first = name.trim().split(/\s+/)[0] || name;
  const named = new RegExp(`^(${escape(name)}|${escape(first)})\\s*:\\s*`, "i");
  const bubbles = raw
    .replace(/\r/g, "")
    .split(/\n\s*\n/)
    .map((b) =>
      b
        .replace(named, "")
        .replace(/\*[^*\n]{1,120}\*/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^"(.*)"$/s, "$1")
        .trim(),
    )
    .filter(Boolean);
  if (bubbles.length > MAX_BUBBLES) bubbles.splice(MAX_BUBBLES - 1, bubbles.length, bubbles.slice(MAX_BUBBLES - 1).join(" "));
  return bubbles.map((b) => (b.length > BUBBLE_MAX ? `${b.slice(0, BUBBLE_MAX - 1).replace(/\s+\S*$/, "")}…` : b));
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
