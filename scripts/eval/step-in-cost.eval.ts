/**
 * Step into the date, measured (docs/step-into-the-date.md "Cost"): real step-in dates played in-process against an
 * in-memory database (lib/step-in.ts, the same code the routes run), the person's side typed from a fixed script and
 * the cast member's side and the recap on a real model through OpenRouter, never the live show's Gemini quota. Prints
 * each date's calls, tokens and what OpenRouter billed, and the transcript.
 *
 *   STEP_IN_EVAL_KEY="$(security find-generic-password -s vault/botchelor/OPENROUTER_LOOP_KEY -w)" \
 *     npx vitest run --config scripts/eval/vitest.eval.mts scripts/eval/step-in-cost.eval.ts
 *
 * STEP_IN_EVAL_OUT=<file> also writes the report and transcripts there.
 * Options: STEP_IN_EVAL_MODEL (default anthropic/claude-haiku-5.5, what the show's dates run on), STEP_IN_EVAL_FORMATS
 * (comma list, default speed_date,classic).
 */
import { writeFileSync } from "node:fs";
import { it } from "vitest";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { openAICompatibleModel, setModelForTests, type Model, type Usage } from "@/lib/model";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { advanceStepIn, sayStepIn, startStepIn, type StepInFormat } from "@/lib/step-in";
import { startTestDb } from "../../tests/helpers";

const env = process.env;
const KEY = env.STEP_IN_EVAL_KEY ?? "";
const MODEL = env.STEP_IN_EVAL_MODEL || "anthropic/claude-haiku-5.5";
const FORMATS = (env.STEP_IN_EVAL_FORMATS || "speed_date,classic").split(",").map((s) => s.trim()) as StepInFormat[];

/** What a person might type on a first date: plain, a little nervous, a question or two. */
const LINES = [
  "Hi! Sorry, I'm a few minutes late. The bus driver and I had a disagreement about where the stop was.",
  "I work at a bakery, so I'm up at four most days. Ask me anything about sourdough, I dare you.",
  "What do you do when you're not on a dating show? I'm guessing something with a lot of opinions.",
  "Okay, that's actually charming. I didn't expect that from you.",
  "Honestly, I'm a bit nervous. This is my first time doing anything like this.",
  "What's the best date you've ever been on? Not counting this one, obviously.",
  "I'd like that. Maybe somewhere quieter next time, though.",
  "This was fun. Thanks for not making it weird.",
];

it.skipIf(!KEY)("plays step-in dates on a real model and reports what each cost", async () => {
  const t = await startTestDb();
  const spent: Usage[] = [];
  const real = openAICompatibleModel({ baseUrl: "https://openrouter.ai/api/v1", apiKey: KEY, model: MODEL, extraBody: { usage: { include: true } } });
  const metered: Model = {
    complete(messages, options) {
      return real.complete(messages, { ...options, onUsage: (u) => (spent.push(u), options?.onUsage?.(u)) });
    },
  };
  setModelForTests(metered);
  const cast = [HOUSE_CHARACTERS[0].id, HOUSE_CHARACTERS[1].id, HOUSE_CHARACTERS[2].id];
  setSeasonCastForTests(cast);
  const userId = crypto.randomUUID();
  await t.db.query("insert into admins (user_id) values ($1)", [userId]);
  const report: Record<string, unknown>[] = [];
  const out: string[] = [];
  const say = (line: string) => (out.push(line), console.log(line));
  try {
    for (const [i, format] of FORMATS.entries()) {
      const from = spent.length;
      const started = Date.now();
      const s = await startStepIn(t.db, userId, { with: cast[i % cast.length], format, persona: { name: "Sam", pronouns: "they/them", age: 31, about: "Bakes too much bread and laughs at their own jokes." } });
      if (!s.ok) throw new Error(s.message);
      let r = await advanceStepIn(t.db, userId, s.episode_id);
      let n = 0;
      while (r.ok && r.view.state === "your_line") {
        r = await sayStepIn(t.db, userId, s.episode_id, { dialogue: LINES[n++ % LINES.length], ...(r.view.last_line ? { see_again: true } : {}) });
        if (r.ok && r.refused) throw new Error(`refused: ${r.refused}`);
      }
      if (!r.ok) throw new Error(r.message);
      const used = spent.slice(from);
      const row = (await t.db.query<{ setup: { step_in: { cost: unknown } }; ending: string; ending_detail: string | null; confessionals: unknown }>(`select setup, ending, ending_detail, confessionals from episodes where id = $1`, [s.episode_id])).rows[0];
      report.push({
        format,
        with: r.view.them.name,
        state: r.view.state,
        lines: r.view.lines.length,
        ending: row.ending,
        ending_detail: row.ending_detail,
        calls: used.length,
        input_tokens: used.reduce((x, u) => x + u.input, 0),
        output_tokens: used.reduce((x, u) => x + u.output, 0),
        billed_usd: Math.round(used.reduce((x, u) => x + (u.cost ?? 0), 0) * 1e6) / 1e6,
        kept_on_episode: row.setup.step_in.cost,
        seconds: Math.round((Date.now() - started) / 1000),
      });
      say(`\n--- ${format} with ${r.view.them.name} (ending ${row.ending}${row.ending_detail ? `, ${row.ending_detail}` : ""}) ---`);
      for (const l of r.view.lines) say(`${l.side === "a" ? "Sam" : r.view.them.name}: ${l.dialogue}${l.action ? ` (${l.action})` : ""}`);
      say(`confessionals: ${JSON.stringify(row.confessionals)}`);
    }
  } finally {
    setModelForTests(null);
    setSeasonCastForTests(null);
    await t.close();
  }
  say("\nREPORT " + JSON.stringify(report, null, 2));
  if (env.STEP_IN_EVAL_OUT) writeFileSync(env.STEP_IN_EVAL_OUT, out.join("\n"));
});
