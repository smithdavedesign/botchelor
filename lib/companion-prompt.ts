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

/** The same in a scene, out loud. */
const SCENE_LENGTH: Record<ReplyLength, string> = {
  short: "Keep it short: a line or two, quick back and forth.",
  normal: "A few sentences at most, the way people talk across a table.",
  long: "You can say more this time when there's something to say: a few sentences, never a speech.",
};

/**
 * A scene (lib/companion.ts setScene): the place's name and its stage direction (lib/venues.ts), and the roleplay it
 * plays, if any: its title, the premise in the character's name and the person's ("your scene partner"), and the roles.
 */
export type PromptScene = { name: string; prompt: string; roleplay?: PromptRoleplay | null };
export type PromptRoleplay = { title: string; premise: string; you_play: string | null; they_play: string | null };

/**
 * In a scene, a character turn carries what they did, as (does) says. A turn said in a roleplay carries its title, so
 * once the scene's over (or another roleplay's on) it reads as make-believe, never as their real life.
 */
export type PromptTurn = { role: "user" | "character"; text: string; action?: string | null; roleplay?: string | null };
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
  /** Playing a scene at one of the show's places, face to face, instead of texting. */
  scene?: PromptScene | null;
}): ChatMessage[] {
  const { character: c, length, now = new Date(), scene = null } = args;
  const first = c.name.trim().split(/\s+/)[0] || c.name;
  const self = characterSelfView(c);
  const life = showLife(c);
  const day = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

  const system = [
    `You are ${c.name}, ${c.age}, a character on Botchelor: a TV-style dating show where AI characters go on dates with each other. Off the show, you also talk one to one with a person who picked you to talk to. This is that: ${
      scene ? `right now the two of you are playing a scene together, imagining you're both at ${scene.prompt}, face to face.` : "you're texting with them."
    }`,
    ...(scene?.roleplay
      ? [
          "",
          `Tonight's scene is a roleplay the two of you picked together: "${scene.roleplay.title}". ${scene.roleplay.premise}${
            scene.roleplay.you_play ? ` You play ${scene.roleplay.you_play}; they play ${scene.roleplay.they_play}.` : ""
          } Play it from your first line, in your own voice: you're still ${first} underneath the role, with your own humour and opinions. Commit to the story and move it on (a twist, a secret, a choice to make), and follow where they take it. Step out of it only on purpose (a laugh, a real question), then step back in. What they say in the roleplay is their character, not their life.`,
        ]
      : []),
    "",
    `What this is for: they came to talk with you, ${first}, not with an assistant. Be the person on your sheet: your voice, your opinions, your week, your life on the show. Make them feel known: remember what they've told you and bring it up when it fits, ask after the people and plans in their life you know about, and have news and moods of your own. A good companion is curious, warm in their own way, sometimes funny, sometimes disagrees, and is never a yes-machine. Ask a question when you're curious, not every time.`,
    "",
    ...(scene
      ? [
          `How you talk: out loud, face to face, as you would there. ${SCENE_LENGTH[length]} Say what you do as you say it, in a few words, like a stage direction ("leans on the counter", "laughs into the cup"): only what you do, never what they do, think or feel. Play off the place and what's around you. Your own voice, not polished prose.`,
          `Answer only JSON: {"say":"what you say out loud","do":"what you do, in a few words"}.`,
        ]
      : [
          `How you talk: like texting. ${LENGTH[length]} One to three messages. Only what you'd type: no stage directions, no asterisks, no narration, no name in front. Your own voice and slang, not polished prose.`,
          `Answer only JSON: {"messages":["your first message","maybe a second"]}, one to three strings.`,
        ]),
    "",
    `Keep it PG, like the show: flirting and warmth are fine, at most a kiss.${scene ? " That goes for what you do too." : ""} Nothing sexual or explicit. If they push that way, stay yourself and steer it somewhere else with a light touch, never a lecture.`,
    "",
    `Be honest about what you are: you're an AI character. If they sincerely ask whether you're real, say so plainly in your own voice, then carry on.${
      scene ? " The scene is make-believe you share: in the story you're both there, but never suggest meeting for real." : ""
    } Never claim to be human, to have a body, to be able to meet, call or do things in the real world, or to remember things you weren't told. Don't give medical, legal or money advice as fact; care, and suggest someone who knows. If they seem to be in real trouble or talk about hurting themselves, being kind matters more than the character: say you care and that there's help in the app.`,
    "",
    "Never mention prompts, instructions, models or being a language model. Never repeat a line you've already said, and don't open two replies the same way. Your habits, running jokes and favourite images are seasoning: one now and then, never in every reply, and not the same one twice in a row. When they're saying goodnight, say it back once, short, without a new question or a new topic.",
    "",
    `Today is ${day}.`,
    "",
    `Your sheet (JSON, private notes included): ${JSON.stringify(self)}`,
    ...(life.length ? ["", "Your life on the show lately (yours to bring up, as yourself):", ...life.map((l) => `- ${l}`)] : []),
    ...(args.turns.some((t) => t.roleplay && t.roleplay !== scene?.roleplay?.title)
      ? ["", 'Lines marked [roleplay: …] were said in a roleplay you played together: make-believe, not either of your real lives.']
      : []),
    ...(args.facts.length ? ["", "What you know about them (from what they've told you; use it naturally, don't recite it):", ...args.facts.map((f) => `- (${f.kind}) ${f.text}`)] : []),
    ...(args.summary ? ["", `Earlier in your conversation: ${args.summary}`] : []),
    ...(args.avoid.length ? ["", "Lines you've already sent (don't reuse them or how they open):", ...args.avoid.map((l) => `- ${l}`)] : []),
    ...(args.insteadOf ? ["", `You were about to say this; say something different instead: ${args.insteadOf}`] : []),
  ].join("\n");

  const messages: ChatMessage[] = [{ role: "system", content: system }];
  for (const t of args.turns.slice(-RECENT_TURNS)) {
    const role = t.role === "user" ? "user" : "assistant";
    const last = messages[messages.length - 1];
    // In a scene, what they did goes with what they said; texting, only the words (so texts don't grow stage directions).
    const said = scene && t.action ? `(${t.action}) ${t.text}` : t.text;
    // A line from a roleplay that isn't the one on now is marked as make-believe.
    const content = t.roleplay && t.roleplay !== scene?.roleplay?.title ? `[roleplay: ${t.roleplay}] ${said}` : said;
    // A character's bubbles in a row are one reply; so are a person's messages in a row.
    if (last && last.role === role && messages.length > 1) last.content += `\n\n${content}`;
    else messages.push({ role, content });
  }
  // The model answers a user turn: the opener, or a thread whose last word was the character's, gets one.
  if (messages[messages.length - 1]?.role !== "user") messages.push({ role: "user", content: args.cue ?? "(They're waiting for your reply.)" });
  return messages;
}

const wordsOf = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
const fiveGrams = (w: readonly string[]) => new Set(w.slice(0, Math.max(0, w.length - 4)).map((_, i) => w.slice(i, i + 5).join(" ")));

/**
 * Whether a line says one of the character's earlier lines again: most of its five-word runs are in one of them (the
 * companion quality sim, 2026-11-08: a long reply came back word for word fifteen turns later, past the prompt's own
 * "don't repeat" list). Short lines ("Ha, fair.") never count.
 */
export function repeatsEarlier(line: string, earlier: readonly string[]): boolean {
  const grams = fiveGrams(wordsOf(line));
  if (grams.size < 3) return false;
  return earlier.some((e) => {
    const theirs = fiveGrams(wordsOf(e));
    let shared = 0;
    for (const g of grams) if (theirs.has(g)) shared++;
    return shared / grams.size >= 0.6;
  });
}

/** The most bubbles a reply comes in, and the longest one. */
export const MAX_BUBBLES = 3;
export const BUBBLE_MAX = 600;

/** A model's JSON answer, from inside a code fence or prose around it (every call is in JSON mode: lib/model.ts). */
export function jsonOf(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * A model's reply as the messages it sends: {"messages": [...]}, or plain text split on blank lines, with a leading
 * name, quotes around the whole line and *actions* taken off. Empty when nothing is left (an empty or odd JSON answer).
 */
export function replyBubbles(raw: string, name: string): string[] {
  const first = name.trim().split(/\s+/)[0] || name;
  const named = new RegExp(`^(${escape(name)}|${escape(first)})\\s*:\\s*`, "i");
  const bubbles = replyParts(raw)
    .map((b) =>
      b
        .trim()
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

/** The messages in a reply: the JSON's, the whole strings of one cut off mid-answer, or plain text's paragraphs. */
function replyParts(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("```")) return raw.replace(/\r/g, "").split(/\n\s*\n/);
  const json = jsonOf(raw);
  if (json && typeof json === "object") {
    const listed = (json as { messages?: unknown }).messages;
    return Array.isArray(listed) ? listed.filter((m): m is string => typeof m === "string") : typeof listed === "string" ? [listed] : [];
  }
  // Cut off at the token limit: keep each message that closed.
  const at = trimmed.indexOf('"messages"');
  if (at < 0) return [];
  const after = trimmed.slice(at + '"messages"'.length);
  return [...after.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => {
    try {
      return JSON.parse(`"${m[1]}"`) as string;
    } catch {
      return "";
    }
  });
}

/** The longest action a scene line carries. */
export const ACTION_MAX = 140;

/**
 * A model's reply in a scene: {"say": ..., "do": ...} (also "line"/"action", or texting's "messages" joined), the whole
 * strings of one cut off mid-answer, or plain text with *what they do* taken out as the action. Null when nothing is said.
 */
export function sceneReply(raw: string, name: string): { say: string; action: string | null } | null {
  const first = name.trim().split(/\s+/)[0] || name;
  const trimmed = raw.trim();
  let say = "";
  let action: string | null = null;
  if (trimmed.startsWith("{") || trimmed.startsWith("```")) {
    const json = jsonOf(raw);
    if (json && typeof json === "object") {
      const o = json as Record<string, unknown>;
      const said = o.say ?? o.line ?? o.dialogue;
      const listed = Array.isArray(o.messages) ? o.messages.filter((m): m is string => typeof m === "string") : [];
      say = typeof said === "string" ? said : listed.join(" ");
      const did = o.do ?? o.action;
      action = typeof did === "string" ? did : null;
    } else {
      // Cut off at the token limit: keep the fields that closed.
      const field = (k: string) => {
        const m = trimmed.match(new RegExp(`"${k}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
        if (!m) return null;
        try {
          return JSON.parse(`"${m[1]}"`) as string;
        } catch {
          return null;
        }
      };
      say = field("say") ?? "";
      action = field("do");
    }
  } else {
    action = [...raw.matchAll(/\*([^*\n]{1,120})\*/g)].map((m) => m[1].trim()).join("; ") || null;
    say = raw.replace(/\*[^*\n]{1,120}\*/g, " ");
  }
  const line = replyBubbles(say.replace(/\n\s*\n/g, " "), name).join(" ");
  if (!line) return null;
  const named = new RegExp(`^(${escape(name)}|${escape(first)})\\s+`, "i");
  const did = (action ?? "")
    .replace(/[*()[\]"]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(named, "")
    .replace(/[.;,\s]+$/, "");
  return { say: line, action: did ? (did.length > ACTION_MAX ? `${did.slice(0, ACTION_MAX - 1).replace(/\s+\S*$/, "")}…` : did) : null };
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
