import { z } from "zod";
import { airWindowMinutes } from "@/lib/air";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { updateCharacterMemory } from "@/lib/memory";
import { REFLECTION_TEXT_MAX } from "@/lib/reflection";
import { labelsOf, ReflectionLabelsInput } from "@/lib/reflection-labels";
import { checkFields } from "@/lib/safety";

type Ctx = { params: Promise<{ id: string }> };

const ReflectionInput = z
  .object({
    /** Which of your characters is reflecting; needed only when both characters on the date are yours. */
    character_id: z.string().trim().min(1).max(64).optional(),
    reflection: z.string().trim().min(1, "Write a sentence or two.").max(REFLECTION_TEXT_MAX, `At most ${REFLECTION_TEXT_MAX} characters.`).optional(),
  })
  // The structured labels (lib/reflection-labels.ts): with the words, or on their own.
  .and(ReflectionLabelsInput)
  .refine((r) => r.reflection !== undefined || labelsOf(r) !== null, {
    message: "Send a reflection, or at least one label (rating, would_date_again, worked, didnt).",
    path: ["reflection"],
  });

type Row = {
  status: string;
  character_a: string;
  character_b: string;
  owner_a: string | null;
  owner_b: string | null;
  name_a: string;
  name_b: string;
  revealed: boolean;
  visibility: string;
};

/**
 * A character's own post-date reflection, written by its creator — a person, or an AI agent (MCP
 * reflect_on_date). Replaces the show-written one for that side (lib/reflection.ts) and, once the date has
 * aired publicly, joins what the character carries into future dates (lib/memory.ts). Owner-only: only a
 * character's creator can write its reflection, so a character never speaks for another's. Same content rules.
 * Never touches the engine, the episode's outcome or anything spectators see.
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const sess = session(req);
  const input = parseBody(ReflectionInput, await readJson(req), "invalid_reflection");
  const db = await getDb();

  const row = (
    await db.query<Row>(
      `select e.status, e.character_a, e.character_b, a.owner_id as owner_a, b.owner_id as owner_b, a.name as name_a, b.name as name_b,
              (e.revealed_at is not null) as revealed, e.visibility
         from episodes e
         join characters a on a.id = e.character_a
         join characters b on b.id = e.character_b
        where e.id = $1`,
      [id],
    )
  ).rows[0];
  const mine = row ? (["a", "b"] as const).filter((s) => (s === "a" ? row.owner_a : row.owner_b) === sess.userId) : [];
  if (!row || mine.length === 0) {
    return json({ error: "not_your_date", message: "Only the creator of a character on this date can write its reflection." }, 404, sess);
  }
  const wanted = input.character_id;
  const side = wanted ? mine.find((s) => (s === "a" ? row.character_a : row.character_b) === wanted) : mine.length === 1 ? mine[0] : undefined;
  if (!side) {
    return json(
      {
        error: wanted ? "not_your_character" : "which_character",
        message: wanted ? "That character isn't one of yours on this date." : "Both characters on this date are yours: say which one is reflecting (character_id).",
      },
      422,
      sess,
    );
  }
  if (row.status !== "ready") return json({ error: "not_ready", message: "The date isn't finished yet. Reflect once it's ready." }, 409, sess);

  if (input.reflection !== undefined) {
    const verdict = checkFields({ reflection: input.reflection });
    if (!verdict.ok) return json({ error: "content_rejected", reason: verdict.reason, message: "Keep it within the show's rules: adults only, nothing sexual, no real people." }, 422, sess);
  }

  const characterId = side === "a" ? row.character_a : row.character_b;
  // The labels first: owner-only data, merged into what this side already set (a later call changes only what it sends).
  const sent = labelsOf(input);
  let labels: Record<string, unknown> | null = null;
  if (sent) {
    const saved = await db.query<{ labels: Record<string, unknown> }>(
      `update episodes set reflection_labels = coalesce(reflection_labels, '{"a": null, "b": null}'::jsonb)
              || jsonb_build_object($2::text, (case when jsonb_typeof(reflection_labels->$2::text) = 'object' then reflection_labels->$2::text else '{}'::jsonb end) || $3::jsonb)
        where id = $1
        returning reflection_labels->$2::text as labels`,
      [id, side, JSON.stringify(sent)],
    );
    labels = saved.rows[0]?.labels ?? sent;
  }
  if (input.reflection === undefined) {
    return json(
      {
        episode_id: id,
        character_id: characterId,
        labels,
        note: "Saved. Labels are yours alone: they never show on the date or change how your character talks, and they're in your account export.",
      },
      200,
      sess,
    );
  }

  await db.query(
    `update episodes set reflections = coalesce(reflections, '{"a": null, "b": null}'::jsonb) || jsonb_build_object($2::text, $3::text) where id = $1`,
    [id, side, input.reflection],
  );
  // A fresh reflection on a date is one its creator wants kept, even if they'd told it to forget the last one.
  await db.query(`delete from memory_forgets where character_id = $1 and kind = 'reflection' and item = $2`, [characterId, id]);
  // Memory only learns from aired, public dates (the same rule as the record): fold it in now if this one has.
  const learns = row.revealed && row.visibility === "public";
  if (learns) await updateCharacterMemory(db, characterId);
  return json(
    {
      episode_id: id,
      character_id: characterId,
      reflection: input.reflection,
      ...(labels ? { labels } : {}),
      carried_forward: learns,
      note: learns
        ? `${side === "a" ? row.name_a : row.name_b} will carry this into its next dates.`
        : row.visibility === "private"
          ? // #235: a private date never airs, so "once it airs" was a promise it couldn't keep.
            "Saved on this private date. Private dates stay offline and never air, so this reflection won't carry into its dates with others (the two of them still remember this date). To change that, make the date public (set_date_visibility)."
          : row.visibility === "unlisted"
            ? "Saved. Only public dates shape what a character carries forward, so this one won't: make the date public (set_date_visibility) and it will once it airs."
            : `Saved. It joins what this character carries into future dates once the date airs (it airs on its own, about ${airWindowMinutes()} minutes after it's ready).`,
    },
    200,
    sess,
  );
});
