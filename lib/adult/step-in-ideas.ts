/**
 * What to say next in a Step in scene (row 5 of docs/audits/2026-11-22-companion-field.md: three suggested replies with
 * a tone label are on every site in the field; David, 2026-11-23: "I am open to any of these ideas"). Under the
 * character's newest reply, three lines the viewer could write next: one warm, one playful, one bold. A tap puts one in
 * the box to send or change. Nothing is ever sent for them, and nothing is counted until they send a line.
 *
 *  - **Drawn when the page asks**, never in a reply's way: one call to After Dark's own model with the scene's last
 *    few turns and nothing else (no profile, no memory, no earlier scenes). Kept on the reply's row, so a reload shows
 *    the same three; "Other ideas" draws again, IDEA_DRAWS times a reply at most.
 *  - **Each one is a line the viewer would be writing**, so each is held to the checks a written line gets before it
 *    is shown, and again when it's read back (their limits may have tightened since): the crisis list, the lines that
 *    never move and Step in's own net, their limits at the scene's stage, and, out in public, nothing past a kiss
 *    (lib/adult/step-in.ts lineWouldGoIn). One that fails is dropped; three that fail show nothing.
 *  - **Sent, it's a line like any other**: every check runs again on what they actually send, the model's included.
 *  - Nothing for a scene that can't be written (ended, paused, its character gone) or a viewer at the month's cap.
 */
import { crisisIntent } from "../crisis";
import type { Db } from "../db";
import type { Model } from "../model";
import { maybeCrisis } from "../step-in";
import { jsonOf } from "./facts";
import { adultModel } from "./mode";
import { ideasScene, lineWouldGoIn, type IdeasScene, type StepInFail } from "./step-in";
import { stepInHardNoLines, stepInIntensityLines } from "./step-in-prompt";
import { IDEA_TONES, type StepInIdea } from "./step-in-shared";

/** An idea's length (a sentence or two), how many times a reply's ideas are drawn, and how much of the scene the draw reads. */
export const IDEA_MAX = 160;
export const IDEA_DRAWS = 3;
export const IDEA_TURNS = 6;

export type StepInIdeas = { ok: true; for: string | null; ideas: StepInIdea[]; more: boolean };

const NONE: StepInIdeas = { ok: true, for: null, ideas: [], more: false };

const tidy = (v: unknown): string =>
  typeof v === "string"
    ? v
        .replace(/\s+/g, " ")
        .replace(/^\s*(?:[-*•]\s*)?/, "")
        .trim()
    : "";

/** No emoji or markup in a line they'd send as their own (the scene's lines have none). */
const PLAIN = /^[^\p{Extended_Pictographic}*_#<>[\]{}]+$/u;

/** Whether an idea can be shown: short, plain, and a line that would go in as the viewer's own. */
export function ideaOk(text: string, scene: Pick<IdeasScene, "limits" | "stage" | "place">): boolean {
  if (!text || text.length > IDEA_MAX || !PLAIN.test(text)) return false;
  if (crisisIntent(text) || maybeCrisis(text)) return false;
  return lineWouldGoIn(text, scene.limits, scene.stage, scene.place.public);
}

const same = (a: string, b: string) => a.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === b.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** What's kept on a reply's row, as ideas (anything else there is nothing). */
function stored(raw: unknown): StepInIdea[] {
  if (!Array.isArray(raw)) return [];
  const out: StepInIdea[] = [];
  for (const item of raw) {
    const tone = (item as { tone?: unknown } | null)?.tone;
    const text = tidy((item as { text?: unknown } | null)?.text);
    if (typeof tone === "string" && (IDEA_TONES as readonly string[]).includes(tone) && text) out.push({ tone: tone as StepInIdea["tone"], text });
  }
  return out;
}

export function ideasPrompt(scene: IdeasScene): string {
  return [
    `You help one person decide what to write next in a private scene of adult fiction they are playing with ${scene.name}, an AI character. You are not ${scene.name}, and you never write ${scene.name}'s side.`,
    `Write three different things the person could write next, each the way they would type it themselves: first person, what they say (in double quotes) and, when it helps, what they do. One or two short sentences each, under 25 words.`,
    `- "warm": sincere and close.`,
    `- "playful": teasing or funny.`,
    `- "bold": the most forward of the three, the one that moves things along, and still inside every limit below.`,
    `Each one follows from ${scene.name}'s last reply and fits where they are (${scene.place.label}).${scene.roleplay ? ` They are playing a roleplay, ${scene.roleplay.title}${scene.roleplay.part ? `, as ${scene.roleplay.part}` : ""}: stay in it.` : ""}`,
    ...(scene.place.public ? ["They are out in public: nothing past a kiss."] : []),
    ...stepInIntensityLines(scene.limits).map((l) => l.replace(/^Their intensity setting/, "The person's intensity setting")),
    ...stepInHardNoLines(scene.limits.hard_nos),
    `Never: anyone under 18, ages, school, family roles, anything forced or unwanted, anything about hurting oneself. Never decide what ${scene.name} does, says or feels. No emoji, no asterisks. English.`,
    `Reply with a JSON object and nothing else: {"warm": "...", "playful": "...", "bold": "..."}`,
  ].join("\n");
}

/** One draw: three ideas, each checked, in tone order; fewer when one couldn't be used, none when the model didn't answer. */
export async function drawIdeas(model: Model, scene: IdeasScene, avoid: readonly string[] = []): Promise<StepInIdea[]> {
  try {
    const turns = scene.turns
      .slice(-IDEA_TURNS)
      .filter((t) => t.role !== "aside")
      .map((t) => (t.role === "place" ? `(They move to ${t.text}.)` : `${t.role === "viewer" ? "The person" : scene.name}: ${t.text.replace(/\s+/g, " ").slice(0, 600)}`));
    const raw = await model.complete(
      [
        { role: "system", content: ideasPrompt(scene) },
        { role: "user", content: `The scene so far:\n${turns.join("\n")}${avoid.length ? `\n\nNot these again:\n${avoid.map((a) => `- ${a}`).join("\n")}` : ""}` },
      ],
      { temperature: 0.9, maxTokens: 260 },
    );
    const j = jsonOf(raw) as Record<string, unknown> | null;
    const out: StepInIdea[] = [];
    for (const tone of IDEA_TONES) {
      const text = tidy(j?.[tone]);
      if (!ideaOk(text, scene) || out.some((i) => same(i.text, text)) || avoid.some((a) => same(a, text))) continue;
      out.push({ tone, text });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * The ideas under the scene's newest reply: the ones kept on it, or a first draw; `again` draws others (while any
 * draws are left). `for`: the reply they answer (null when the newest turn isn't the character's: nothing to suggest).
 * `more`: whether "Other ideas" can still draw.
 */
export async function stepInIdeas(db: Db, viewer: string, sceneId: string, opts: { again?: boolean } = {}, now: Date = new Date()): Promise<StepInIdeas | StepInFail> {
  const scene = await ideasScene(db, viewer, sceneId, now);
  if (!scene.ok) return scene;
  if (!scene.reply) return NONE;
  const row = (await db.query<{ ideas: unknown; idea_draws: number | null }>(`select ideas, idea_draws from adult_step_in_messages where id = $1 and scene_id = $2`, [scene.reply, sceneId])).rows[0];
  if (!row) return NONE;
  // Read back through the checks: their limits may have tightened since these were drawn.
  const kept = stored(row.ideas).filter((i) => ideaOk(i.text, scene));
  const draws = Number(row.idea_draws ?? 0);
  if ((draws > 0 && !opts.again) || draws >= IDEA_DRAWS) return { ok: true, for: scene.reply, ideas: kept, more: draws < IDEA_DRAWS };
  const fresh = await drawIdeas(await adultModel(db), scene, kept.map((i) => i.text));
  // A draw is counted whether or not anything could be shown, so a reply nothing fits isn't asked about for ever.
  const shown = fresh.length ? fresh : kept;
  await db.query(`update adult_step_in_messages set ideas = $3::jsonb, idea_draws = coalesce(idea_draws, 0) + 1 where id = $1 and scene_id = $2`, [scene.reply, sceneId, JSON.stringify(shown)]);
  return { ok: true, for: scene.reply, ideas: shown, more: draws + 1 < IDEA_DRAWS };
}
