/**
 * A model for tests that answers each of a date's prompts from the prompt alone (so the order the calls are made in
 * can't change an answer) and remembers what it was asked, by kind. The same idea as tests/fast-date.test.ts's, kept
 * small and shared by the producer's suites.
 */
import type { ChatMessage, Model } from "@/lib/model";
import { episodeJson, planJson } from "./helpers";

export type Kind = "plan" | "line" | "answer" | "recap" | "text" | "reflection" | "hot_takes" | "logline" | "other";

/** Which call this is, from its system prompt's opening words. */
export function kindOf(messages: ChatMessage[]): Kind {
  const s = messages[0]?.content ?? "";
  if (s.startsWith("You are the story editor")) return "plan";
  if (s.startsWith("You are one fictional adult on a date")) return "line";
  if (s.startsWith("You are one fictional adult who has just finished a date")) return "answer";
  if (s.startsWith("You are the showrunner")) return "recap";
  if (s.startsWith("You are one fictional adult character the morning after")) return "text";
  if (s.startsWith("You are one fictional adult who just went on a blind date")) return "reflection";
  if (s.startsWith('You write for the dating show "Botchelor". Given one fictional adult')) return "hot_takes";
  if (s.startsWith("You write the one-line logline")) return "logline";
  return "other";
}

/** Twelve lines nobody would send back: each its own opening, no names, no trait words. */
const SAID = [
  "Ferries are underrated. Have you ever taken one just to turn around and come back?",
  "Once, by accident. I fell asleep and woke up where I started, which felt like a refund.",
  "My grandmother kept bees on a roof in the middle of town. Nobody believed her until the honey.",
  "Did the neighbours complain, or did the honey buy their silence?",
  "A jar each, every August. Bribery, but the polite kind.",
  "I respect that. The most I ever grew was a tomato, and a pigeon got to it first.",
  "Pigeons know quality. What would you plant if nothing could eat it?",
  "Lemons, probably. I like a tree that makes you wait and then overdoes it.",
  "That might be the most honest thing anyone has said to me across a table this year.",
  "Then the bar was low, but I will take the win.",
  "Walk me to the corner? I want to hear how the bee story ends.",
  "It ends with a very small funeral and a very large jar. Come on.",
];

function dataOf(messages: ChatMessage[]): Record<string, unknown> {
  const user = messages.find((m) => m.role === "user")?.content ?? "";
  try {
    return JSON.parse(user.slice(user.indexOf("\n") + 1)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export type PromptModel = Model & { seen: { kind: Kind; messages: ChatMessage[] }[]; count: (k: Kind) => number };

/** `on` overrides a kind's answer (an Error is thrown; nothing returned keeps the usual one). */
export function promptModel(on: Partial<Record<Kind, (messages: ChatMessage[]) => string | Error | void>> = {}): PromptModel {
  const seen: PromptModel["seen"] = [];
  return {
    seen,
    count: (k) => seen.filter((x) => x.kind === k).length,
    async complete(messages) {
      const kind = kindOf(messages);
      seen.push({ kind, messages });
      const custom = on[kind]?.(messages);
      if (custom instanceof Error) throw custom;
      if (typeof custom === "string") return custom;
      if (kind === "plan") return planJson();
      if (kind === "line") {
        const so = dataOf(messages).conversation_so_far;
        const i = Array.isArray(so) ? so.length : 0;
        return JSON.stringify({ dialogue: SAID[i % SAID.length], action: "", emotion: "easy", interest_signal: 0.6, feeling: "curious", feeling_strength: 0.5, thought: `Private thought number ${i}.`, they_claimed: "" });
      }
      if (kind === "answer") return '{"see_again":"yes","reason":"I would like another evening like that one."}';
      if (kind === "recap") return episodeJson();
      if (kind === "text") return JSON.stringify({ text: "Home safe. The bees say hello." });
      if (kind === "reflection") return '{"reflection":"I talked about bees for an hour and nobody left. I should do that more often."}';
      if (kind === "hot_takes") return '{"hot_takes":["Ferries beat bridges.","Toast is better cold.","Maps beat apps."]}';
      return "{}";
    },
  };
}
