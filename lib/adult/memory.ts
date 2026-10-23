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

/** One side's PG note as stored, for a rewind to put back as it was (restoreNotes). */
export type NoteRow = { character_id: string; other_id: string; owner_id: string; note: string; updated_at: string };

/** The pair's PG notes as they stand, both ways (none, one or two). */
export async function notesBetween(db: Db, aId: string, bId: string): Promise<NoteRow[]> {
  const r = await db
    .query<{ character_id: string; other_id: string; owner_id: string; note: string; updated_at: string | Date }>(
      `select character_id, other_id, owner_id, note, updated_at from adult_memories where (character_id = $1 and other_id = $2) or (character_id = $2 and other_id = $1)`,
      [aId, bId],
    )
    .catch(() => ({ rows: [] as { character_id: string; other_id: string; owner_id: string; note: string; updated_at: string | Date }[] }));
  return r.rows.map((x) => ({ ...x, updated_at: new Date(x.updated_at).toISOString() }));
}

/**
 * The pair's PG notes put back as they were (a rewound chapter close wrote new ones): each side's note as it was, or
 * none when it had none. Never throws.
 */
export async function restoreNotes(db: Db, aId: string, bId: string, before: readonly NoteRow[]): Promise<void> {
  for (const [self, other] of [
    [aId, bId],
    [bId, aId],
  ] as const) {
    const was = before.find((n) => n.character_id === self && n.other_id === other);
    await (was
      ? db.query(
          `insert into adult_memories (character_id, other_id, owner_id, note, updated_at) values ($1, $2, $3, $4, $5)
           on conflict (character_id, other_id) do update set note = excluded.note, owner_id = excluded.owner_id, updated_at = excluded.updated_at`,
          [self, other, was.owner_id, was.note, was.updated_at],
        )
      : db.query(`delete from adult_memories where character_id = $1 and other_id = $2`, [self, other])
    ).catch(() => {});
  }
}

/** The pair's PG notes this viewer's own nights wrote (both ways): what they see, and may edit, of it. */
export async function ownNotes(db: Db, ownerId: string, aId: string, bId: string): Promise<NoteRow[]> {
  return (await notesBetween(db, aId, bId)).filter((n) => n.owner_id === ownerId);
}

/**
 * Edits one side's PG note, or deletes it (null), when this viewer's nights wrote it. It reaches the pair's public dates
 * and texts, so an edit is held to the show's own text check (lib/safety.ts checkShowText: nothing sexual, no innuendo)
 * as well as the two lines, at NOTE_MAX characters.
 */
export async function setOwnNote(
  db: Db,
  ownerId: string,
  selfId: string,
  otherId: string,
  text: string | null,
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  const mine = (await ownNotes(db, ownerId, selfId, otherId)).find((n) => n.character_id === selfId);
  if (!mine) return { ok: false, status: 404, message: "There's no note of yours to change there." };
  if (text === null) {
    await db.query(`delete from adult_memories where character_id = $1 and other_id = $2 and owner_id = $3`, [selfId, otherId, ownerId]);
    return { ok: true };
  }
  if (text.length > NOTE_MAX) return { ok: false, status: 400, message: `Keep the note to ${NOTE_MAX} characters.` };
  if (!checkShowText({ note: text }).ok) {
    return { ok: false, status: 422, message: "This note goes into their public dates and texts, so it has to stay PG: nothing sexual, nothing explicit, no innuendo." };
  }
  await db.query(`update adult_memories set note = $4, updated_at = now() where character_id = $1 and other_id = $2 and owner_id = $3`, [selfId, otherId, ownerId, text]);
  return { ok: true };
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
