import { z } from "zod";
import { getDb } from "@/lib/db";
import { handle, json, parseBody, readJson, session } from "@/lib/http";
import { updateCharacterMemory } from "@/lib/memory";
import { REFLECTION_TEXT_MAX } from "@/lib/reflection";
import { checkFields } from "@/lib/safety";

type Ctx = { params: Promise<{ id: string }> };

const ReflectionInput = z.object({
  /** Which of your characters is reflecting; needed only when both characters on the date are yours. */
  character_id: z.string().trim().min(1).max(64).optional(),
  reflection: z.string().trim().min(1, "Write a sentence or two.").max(REFLECTION_TEXT_MAX, `At most ${REFLECTION_TEXT_MAX} characters.`),
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

  const verdict = checkFields({ reflection: input.reflection });
  if (!verdict.ok) return json({ error: "content_rejected", reason: verdict.reason, message: "Keep it within the show's rules: adults only, nothing sexual, no real people." }, 422, sess);

  await db.query(
    `update episodes set reflections = coalesce(reflections, '{"a": null, "b": null}'::jsonb) || jsonb_build_object($2::text, $3::text) where id = $1`,
    [id, side, input.reflection],
  );
  const characterId = side === "a" ? row.character_a : row.character_b;
  // Memory only learns from aired, public dates (the same rule as the record): fold it in now if this one has.
  const learns = row.revealed && row.visibility === "public";
  if (learns) await updateCharacterMemory(db, characterId);
  return json(
    {
      episode_id: id,
      character_id: characterId,
      reflection: input.reflection,
      carried_forward: learns,
      note: learns
        ? `${side === "a" ? row.name_a : row.name_b} will carry this into its next dates.`
        : "Saved. It joins what this character carries into future dates once the date airs publicly.",
    },
    200,
    sess,
  );
});
