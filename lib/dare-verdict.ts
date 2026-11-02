/**
 * The dare's verdict, from the date itself (wave 2, 2026-11-02). A dare (lib/dares.ts) rides one side's private note;
 * whether they went through with it used to be the engine's note_followed roll for that side, decided before a word was
 * written — so the card could say "they chickened out" over a date where they plainly did it. Now one cheap check reads
 * the dared side's lines against the dare and answers: went through, sort of, or chickened out.
 *
 *  - One call per dared date, on the show's free model with minimal thinking (getModel("minimal", false), the
 *    hot-takes pattern): the dare plus at most VERDICT_LINES of that side's lines, a JSON one-word answer. About 800
 *    tokens in and 20 out: $0 on the free tier, ~0.01¢ were it billed at flash-lite rates (target ≤0.1¢).
 *  - Fallback: a failed or unparseable call takes the old roll (note_followed: went through / chickened out), so a
 *    dare always has a verdict once its date exists.
 *  - Stored once (dare_nights.verdict, verdict_source), right after the night's date is built (lib/situations.ts) and
 *    before it airs; the hourly lobby job backstops any night left without one. The reveal only shows it after airing.
 *  - The answer is an enum, never shown text, so there's nothing for a content check to pass.
 */
import type { Turn } from "./conversation";
import { dareById } from "./dares";
import { DARE_VERDICTS, verdictFromRoll, type DareVerdict } from "./dare-words";
import type { Db } from "./db";
import { getModel, type Model } from "./model";

/** The most of the dared side's lines the check reads (a date's side is ~8 lines; a long one gets its first stretch). */
export const VERDICT_LINES = 16;
/** Each line is cut to this many characters: enough to see the dare land, small enough to keep the call tiny. */
const LINE_MAX = 280;

const CODE_FENCE = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;

// On in production; the shared test harness turns it off (episode tests script only the date's model), so a dare night
// there takes the roll. tests/dare-verdict.test.ts passes a model of its own.
let judgeEnabled = true;
export function setDareJudgeEnabledForTests(on: boolean): void {
  judgeEnabled = on;
}

const SYSTEM =
  "You referee dares on Botchelor, an AI reality-dating show. One dater was secretly dared by the producers to do something " +
  "on their date; their date didn't know. You get the dare and every line that dater said, in order. Decide whether they did it:\n" +
  '- "went_through": they clearly did what the dare asks (their own words are fine; the spirit counts).\n' +
  '- "sort_of": a half-hearted, partial or watered-down attempt.\n' +
  '- "chickened_out": no real attempt at it.\n' +
  'Reply with JSON only: {"verdict": "went_through" | "sort_of" | "chickened_out"}';

/** The prompt's user message: the dare, then the dared side's lines (dialogue, with its action in brackets). */
export function verdictPrompt(name: string, dare: string, lines: readonly Pick<Turn, "dialogue" | "action">[]): string {
  const clip = (s: string) => (s.length > LINE_MAX ? `${s.slice(0, LINE_MAX - 1)}…` : s);
  const shown = lines.slice(0, VERDICT_LINES).map((t, i) => {
    const action = t.action?.trim() ? ` [${clip(t.action.trim())}]` : "";
    return `${i + 1}. "${clip(t.dialogue.trim())}"${action}`;
  });
  return `The dare, given to ${name}: ${dare}\n${name}'s lines on the date:\n${shown.join("\n")}\nDid ${name} do the dare?`;
}

/** The model's verdict, or null when the call fails or doesn't answer with one of the three. */
export async function askDareVerdict(model: Model, name: string, dare: string, lines: readonly Pick<Turn, "dialogue" | "action">[]): Promise<DareVerdict | null> {
  if (!lines.length) return null;
  let raw: string;
  try {
    raw = await model.complete(
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: verdictPrompt(name, dare, lines) },
      ],
      { temperature: 0, maxTokens: 400 },
    );
  } catch {
    return null;
  }
  const body = raw.trim();
  let verdict: unknown;
  try {
    verdict = (JSON.parse(CODE_FENCE.exec(body)?.[1] ?? body) as { verdict?: unknown }).verdict;
  } catch {
    // A bare word ("went_through") is an answer too.
    verdict = body.replace(/["'`.\s]/g, "");
  }
  return typeof verdict === "string" && (DARE_VERDICTS as readonly string[]).includes(verdict) ? (verdict as DareVerdict) : null;
}

export type JudgedDare = { day: string; verdict: DareVerdict; source: "model" | "roll" };

/**
 * Judges one night's dare and stores it, once: the model's verdict, else the roll's. Null when the night has no date
 * yet, already has a verdict, or the roll has nothing to say either (no engine sides).
 */
export async function judgeDare(db: Db, day: string, opts: { model?: Model } = {}): Promise<JudgedDare | null> {
  const row = (
    await db.query<{ character_id: string; dare_id: string; name: string; is_a: boolean; transcript: Turn[] | null; sides: { note_followed: boolean | null }[] | null }>(
      `select n.character_id, n.dare_id, c.name, e.character_a = n.character_id as is_a, e.transcript, e.sides
         from dare_nights n join episodes e on e.id = n.episode_id join characters c on c.id = n.character_id
        where n.day = $1 and n.verdict is null and e.status = 'ready'`,
      [day],
    )
  ).rows[0];
  const def = row ? dareById(row.dare_id) : undefined;
  if (!row || !def) return null;
  const side = row.is_a ? "a" : "b";
  const lines = (row.transcript ?? []).filter((t) => t.side === side && t.dialogue);
  const model = opts.model ?? (judgeEnabled ? getModel("minimal", false) : null);
  const asked = model ? await askDareVerdict(model, row.name, def.text, lines) : null;
  const verdict = asked ?? verdictFromRoll(row.sides?.[row.is_a ? 0 : 1]?.note_followed ?? null);
  if (!verdict) return null;
  const source = asked ? "model" : "roll";
  const stored = await db.query(`update dare_nights set verdict = $2, verdict_source = $3 where day = $1 and verdict is null returning day`, [day, verdict, source]);
  return stored.rows.length ? { day, verdict, source } : null;
}

/** The hourly backstop: judges the few nights whose date exists but whose verdict didn't land (a crash, a timeout). */
export async function judgePendingDares(db: Db, opts: { model?: Model } = {}): Promise<JudgedDare[]> {
  const { rows } = await db.query<{ day: string }>(
    `select n.day from dare_nights n join episodes e on e.id = n.episode_id
      where n.verdict is null and e.status = 'ready' order by n.day desc limit 3`,
  );
  const out: JudgedDare[] = [];
  for (const r of rows) {
    const j = await judgeDare(db, r.day, opts).catch(() => null);
    if (j) out.push(j);
  }
  return out;
}
