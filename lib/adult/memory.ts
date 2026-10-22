/**
 * What After Dark leaves behind, in the show's own terms (David, 2026-10-19: "do characters keep after dark knowledge into
 * their next date? … add it as part of their core memories"; his pick: on their public dates too, PG only).
 *
 * After Dark never reaches the show directly: no scene line, no picture and no word of it is read anywhere else. When a
 * night (or a chapter of one) is filed, the text model writes one short note per character about what it changed between
 * them, deliberately PG ("you spent the night together at his place after the bowling date; you're closer now, and a
 * little shy about it"). The note must pass the show's own text check (lib/safety.ts checkShowText: no sexual content,
 * no minors, no real people) or a plain fallback is kept instead. Their next date and their texts carry the note in the
 * pair's memory, so they're warmer and more familiar, with the odd knowing look, and nothing explicit.
 */
import type { Character } from "../character";
import type { Db } from "../db";
import { checkShowText } from "../safety";
import { jsonOf } from "./facts";
import { adultModel } from "./mode";
import type { SceneLine } from "./scenes";

const NOTE_MAX = 300;

/** The note when the model's can't be used: true, warm and plain. */
export const FALLBACK_NOTE = (other: string) => `After your last date you and ${other} spent the night together. You're closer now, and neither of you has said much about it.`;

/** Writes (or rewrites) each side's note after a night: from the night's recap, or its last lines. Never throws. */
export async function rememberAfterDark(db: Db, ownerId: string, a: Character | null, b: Character | null, recap: string | null, lines: SceneLine[]): Promise<void> {
  if (!a || !b || (!recap && lines.length < 6)) return;
  const first = (c: Character) => c.name.split(/\s+/)[0];
  let notes: { a?: unknown; b?: unknown } = {};
  try {
    const tail = lines.slice(-40).map((l) => `${l.who === "a" ? a.name : b.name}: ${l.text}`).join("\n");
    const raw = await (await adultModel(db)).complete(
      [
        {
          role: "system",
          content:
            "You write what a private night left behind between two adult characters on a dating show, for their next appearance on the PG show. " +
            "Nothing explicit, nothing sexual, no body parts, no acts: only what changed between them, the way a TV drama would allude to it.",
        },
        {
          role: "user",
          content:
            (recap ? `What happened:\n${recap}\n\n` : "") +
            `How it ended:\n${tail}\n\n` +
            `Write one short note for each of them, in the second person, as their own memory (1 or 2 sentences, under 45 words): ` +
            `where they spent the night, how they feel about each other now, and one small detail they'd smile about (a joke, a look, a promise). ` +
            `"a" is ${a.name}, "b" is ${b.name}. Reply with a JSON object: {"a": "You and ${first(b)} …", "b": "You and ${first(a)} …"}`,
        },
      ],
      { temperature: 0.4, maxTokens: 300 },
    );
    // The JSON even inside a code fence or after a sentence (v2.2: the recap at the same chapter close lost its reply to one).
    notes = (jsonOf(raw) as { a?: unknown; b?: unknown } | null) ?? {};
  } catch {
    /* the fallbacks below */
  }
  const clean = (v: unknown, other: string) => {
    const text = typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, NOTE_MAX) : "";
    return text && checkShowText({ note: text }).ok ? text : FALLBACK_NOTE(other);
  };
  for (const [self, other, note] of [
    [a, b, clean(notes.a, first(b))],
    [b, a, clean(notes.b, first(a))],
  ] as const) {
    await db
      .query(
        `insert into adult_memories (character_id, other_id, owner_id, note) values ($1, $2, $3, $4)
         on conflict (character_id, other_id) do update set note = excluded.note, owner_id = excluded.owner_id, updated_at = now()`,
        [self.id, other.id, ownerId, note],
      )
      .catch(() => {});
  }
}

/** What one character remembers of After Dark with another, or null. Only ever the PG note. */
export async function afterDarkNote(db: Db, selfId: string, otherId: string): Promise<string | null> {
  const r = await db.query<{ note: string }>(`select note from adult_memories where character_id = $1 and other_id = $2`, [selfId, otherId]).catch(() => ({ rows: [] }));
  const note = r.rows[0]?.note ?? null;
  // Checked again on the way out: the show never carries a note that doesn't pass its own text check.
  return note && checkShowText({ note }).ok ? note : null;
}

/** A pair context (lib/relationships.ts pairContext) with the After Dark note added, for a date or a text. */
export function withAfterDark(ctx: Record<string, unknown> | null, note: string | null): Record<string, unknown> | null {
  if (!note) return ctx;
  return { ...(ctx ?? {}), what_happened_after_your_last_date: note };
}
