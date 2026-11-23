/**
 * A roleplay's story in Step in: a goal the viewer can see, how far the story has got, and an ending. David,
 * 2026-11-23: "A goal and an ending for a scene (Character.AI, CrushOn)".
 *
 * What the field does (docs/audits/2026-11-23-scenes-and-side-pictures.md, row 5): Character.AI's Scenes give the player
 * a goal and say "Goal Complete"; CrushOn's Target Play has a score, a progress bar and a round limit. Step in's
 * roleplays already had the story written down (lib/scene-cards.ts: what each of the two wants, and three or four
 * beats the story can take, in order), but only the writer ever read it. A scene started in a roleplay ran until the
 * viewer got tired of it or the month ran out: nothing said what they were playing for, and nothing ever ended.
 *
 *  - **The goal** is the card's own "want" for the viewer's side, told to them ("You want to stop inventing reasons
 *    to knock…"): on the roleplay's card on the front page, and under the roleplay's name in the scene.
 *  - **How far it's got**: after a reply lands, the page asks for the story to be read (readStepInStory in
 *    lib/adult/step-in.ts): one small call on After Dark's own model, which is shown the card's beats and the scene's
 *    last stretch and says which beats have happened on the page. Beats only ever get ticked (a later reading can't
 *    untick one), and the viewer sees how many of them have played, never the beats themselves (they'd be spoilers).
 *    Nothing in the writer's own prompt changes: its reply is exactly what it was.
 *  - **The ending**: once every beat has played, the scene offers to bring the story to a close: one last reply from
 *    the character that lands it (lib/adult/step-in-prompt.ts CLOSE_CUE), and the scene ends and is filed like any
 *    other. Keep going is always there: an ending is an offer, never a stop. A closing line can be asked for in any
 *    scene from the ⋯ menu, roleplay or not.
 *  - **Played**: a roleplay whose last beat has played counts as played for that viewer (story_done_at): its card
 *    says so on the front page, and the front page says how many of the 45 they've played.
 *
 * This module is the pure part (what's asked, how the answer is read, what the viewer is shown); the scene's own
 * rows are lib/adult/step-in.ts's. Client-safe: no server imports.
 */
import type { ChatMessage } from "../model";
import { cardForYou } from "../scene-cards";
import type { Roleplay } from "./roleplays";

/** The scene's last turns the reader is shown, and how much of each (a reply can be four paragraphs). */
export const STORY_TURNS = 14;
export const STORY_TURN_CHARS = 800;

export type StoryTurn = { who: "them" | "character" | "narrator"; text: string };

/** What the viewer is shown of the story. */
export type StepInStory = {
  /** What their side of the roleplay wants, told to them. */
  goal: string;
  /** How many beats the card has, and how many have played. */
  beats: number;
  done: number;
  /** Every beat has played: the scene offers an ending. */
  complete: boolean;
  /** The newest reply hasn't been read yet: the page asks for the story to be read. */
  due: boolean;
};

/** The stored beats, read back at the card's own length (a card edited since simply starts shorter or longer). */
export function storedBeats(raw: unknown, n: number): boolean[] {
  const kept = Array.isArray(raw) ? raw : [];
  return Array.from({ length: n }, (_, i) => kept[i] === true);
}

/** Beats only ever get ticked: what was played stays played, whatever a later reading says. */
export function mergeBeats(before: readonly boolean[], played: readonly number[]): boolean[] {
  return before.map((was, i) => was || played.includes(i + 1));
}

/** What the viewer's side of the roleplay wants, told to them; null for a roleplay with no card (a person's own). */
export function storyGoal(rp: Pick<Roleplay, "card">, you: 0 | 1, characterName: string): string | null {
  if (!rp.card) return null;
  const first = characterName.trim().split(/\s+/)[0] || characterName;
  return cardForYou(rp.card, you === 1 ? "b" : "a", first).wants[you] || null;
}

const sentence = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** A card's text as the reader is told it: the viewer's side is "the person", the other is the character by name. */
export function beatForReader(text: string, you: 0 | 1, characterName: string): string {
  const [mine, theirs] = you === 0 ? ["{a}", "{b}"] : ["{b}", "{a}"];
  return sentence(text.replaceAll(mine, "the person").replaceAll(theirs, characterName));
}

/**
 * What the reader is asked: the beats in order, the scene's notes so far when it has any, and its last stretch. It
 * judges what has happened on the page and nothing else; it writes nothing a person sees.
 */
export function storyMessages(input: { name: string; beats: readonly string[]; recap: string | null; turns: readonly StoryTurn[] }): ChatMessage[] {
  const { name } = input;
  const said = input.turns
    .slice(-STORY_TURNS)
    .map((t) => `${t.who === "them" ? "The person" : t.who === "narrator" ? "(Narrator)" : name}: ${t.text.replace(/\s+/g, " ").trim().slice(0, STORY_TURN_CHARS)}`)
    .join("\n");
  return [
    {
      role: "system",
      content: `You read a private scene of adult fiction between a person and ${name}, an AI character, and say how far its story has got. You judge only what has happened on the page, never what might happen next. You answer with JSON and nothing else.`,
    },
    {
      role: "user",
      content:
        `The story's beats, in order:\n${input.beats.map((b, i) => `${i + 1}. ${b}`).join("\n")}\n\n` +
        (input.recap ? `The scene so far, in brief: ${input.recap}\n\n` : "") +
        `The latest stretch:\n${said}\n\n` +
        `Which of the beats have clearly happened by now? A beat counts once what it describes has happened in the scene, in any words; it doesn't count because the scene is heading there. ` +
        `Reply with a JSON object: {"played": [the beats' numbers]} (an empty list when none has).`,
    },
  ];
}

/** Which beats the reader says have played: whole numbers from 1 that the card has, each once. Anything unreadable is none. */
export function parsePlayed(raw: string, n: number): number[] {
  const found = raw.match(/\{[\s\S]*\}/);
  if (!found) return [];
  try {
    const list = (JSON.parse(found[0]) as { played?: unknown }).played;
    if (!Array.isArray(list)) return [];
    return [...new Set(list.map((x) => (typeof x === "number" ? x : Number.parseInt(String(x), 10))).filter((x) => Number.isInteger(x) && x >= 1 && x <= n))].sort((x, y) => x - y);
  } catch {
    return [];
  }
}

/**
 * The story as the viewer sees it. `newest`: the newest reply standing in the scene (null before any); `upto`: the
 * reply the story was last read at; `canRead`: the scene is running and the viewer has written at least one line (an
 * opening alone has played nothing of the story).
 */
export function storyView(rp: Pick<Roleplay, "card">, you: 0 | 1, characterName: string, stored: { beats: unknown; upto: string | null }, at: { newest: string | null; canRead: boolean }): StepInStory | null {
  const goal = storyGoal(rp, you, characterName);
  if (!rp.card || !goal) return null;
  const beats = storedBeats(stored.beats, rp.card.beats.length);
  const done = beats.filter(Boolean).length;
  const complete = done === beats.length;
  return { goal, beats: beats.length, done, complete, due: at.canRead && !complete && at.newest !== null && at.newest !== stored.upto };
}
