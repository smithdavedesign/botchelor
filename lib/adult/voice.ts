/**
 * After Dark's voice anchoring (David, 2026-10-21). On a show date Chud says "I spent three hours debugging a server
 * migration today just so I could clear my evening for this exact brand of chaos"; after dark he said "Star, your words
 * are the lyrics to our symphony". Sheet details turned up in 2 of 977 lines. Prompt v2 (lib/adult/scenes.ts) gives each
 * character more of themselves to stay: the voice kit the show's dates use (lib/extras.ts: sample lines, never-says, the
 * four tells), their details (job, hobbies, quirk…), a few public facts, and 3 to 5 of their own best lines from their
 * show dates, shown as "how {name} talks".
 */
import { assembleCharacter, type Character } from "../character";
import { standsAlone, type Turn } from "../conversation";
import type { Db } from "../db";
import type { CharacterSheet } from "../engine";
import { extrasForPrompt, publicExtras, TELLS, voiceExamples, type CharacterExtras } from "../extras";
import { isLogistics } from "../memory";
import { checkAdultText, checkShowText } from "../safety";
import { repeatOf } from "./continuity";
import { castableName, givenName } from "./guards";

/** Style examples per character, at most, and how long one may be. */
export const STYLE_LINES_MAX = 5;
const STYLE_LINE_MIN = 25;
const STYLE_LINE_MAX = 160;
/** Lines taken from one date at most, so one night out doesn't speak for them. */
const STYLE_PER_DATE = 2;
const STYLE_DATES = 30;

export type StyleTurn = Pick<Turn, "dialogue" | "interest"> & { episode: string };

/**
 * A character's best show lines, as examples of how they talk: short, not logistics ("Tuesday at seven"), held to the
 * show's and After Dark's text checks, naming nobody else on the show, no near-copies, at most two from one date. The
 * most interested first, lines that stand on their own ahead of ones leaning on the line before (lib/conversation.ts).
 */
export function pickStyleLines(turns: readonly StyleTurn[], others: ReadonlySet<string>, max = STYLE_LINES_MAX): string[] {
  const names = (line: string) => (line.match(/\b[A-Z][a-zà-ÿ'’-]{2,}\b/g) ?? []).some((w) => others.has(w.replace(/['’]s$/, "").toLowerCase()));
  const ok = turns.filter((t) => {
    const d = t.dialogue?.trim() ?? "";
    return d.length >= STYLE_LINE_MIN && d.length <= STYLE_LINE_MAX && !isLogistics(d) && !names(d) && checkShowText({ line: d }).ok && checkAdultText({ line: d }).ok;
  });
  const ranked = [...ok].sort((x, y) => Number(standsAlone(y.dialogue)) - Number(standsAlone(x.dialogue)) || (y.interest ?? 0) - (x.interest ?? 0));
  const out: string[] = [];
  const perDate = new Map<string, number>();
  for (const t of ranked) {
    if (out.length >= max) break;
    const d = t.dialogue.trim();
    if ((perDate.get(t.episode) ?? 0) >= STYLE_PER_DATE || repeatOf(d, out)) continue;
    out.push(d);
    perDate.set(t.episode, (perDate.get(t.episode) ?? 0) + 1);
  }
  return out;
}

/**
 * A character's style examples from their show dates (read-only): the public, aired ones, and this person's own (as a
 * date's memory reads them, lib/memory.ts pairMemory), the latest STYLE_DATES. [] when they have none.
 */
export async function styleExamples(db: Db, characterId: string, ownerId: string, others: ReadonlySet<string>): Promise<string[]> {
  const { rows } = await db
    .query<{ id: string; is_a: boolean; transcript: { side: "a" | "b"; dialogue: string; interest?: number }[] | null }>(
      `select id, (character_a = $1) as is_a, transcript from episodes
        where (character_a = $1 or character_b = $1) and status = 'ready' and varies_episode_id is null
          and ((revealed_at is not null and visibility = 'public') or creator_id = $2 or partner_performer = $2)
        order by created_at desc limit $3`,
      [characterId, ownerId, STYLE_DATES],
    )
    .catch(() => ({ rows: [] as { id: string; is_a: boolean; transcript: { side: "a" | "b"; dialogue: string; interest?: number }[] | null }[] }));
  const turns = rows.flatMap((r) =>
    (Array.isArray(r.transcript) ? r.transcript : [])
      .filter((t) => t && t.side === (r.is_a ? "a" : "b") && typeof t.dialogue === "string")
      .map((t) => ({ dialogue: t.dialogue, interest: typeof t.interest === "number" ? t.interest : 0.5, episode: r.id })),
  );
  return pickStyleLines(turns, others);
}

/**
 * Every other character's given name, lower-cased, that could be someone in a line (no everyday words): the names an
 * After Dark line mustn't bring in (lib/adult/guards.ts), and a style example mustn't carry.
 */
export async function castNames(db: Db, except: readonly string[]): Promise<Set<string>> {
  const { rows } = await db.query<{ name: string }>(`select name from characters where not (id = any($1))`, [[...except]]).catch(() => ({ rows: [] as { name: string }[] }));
  return new Set(rows.map((r) => givenName(r.name)).filter(castableName).map((n) => n.toLowerCase()));
}

/**
 * A character as After Dark needs one: the sheet, the voice kit and the look, read-only. (lib/character.ts loadCharacter
 * also loads the soul, the learned memory and the record, none of which a scene reads, and may upgrade an old memory row.)
 */
export async function sceneCharacter(db: Db, id: string): Promise<Character | null> {
  const r = (
    await db.query<{
      id: string; owner_id: string | null; name: string; age: number; bio: string; traits: string[]; want: string; dealbreaker: string; is_house: boolean;
      appearance: string | null; avatar_hue: number | null; pronouns: string | null; voice: string | null; extras: CharacterExtras | null; look: string | null;
    }>(`select id, owner_id, name, age, bio, traits, want, dealbreaker, is_house, appearance, avatar_hue, pronouns, voice, extras, look from characters where id = $1`, [id])
  ).rows[0];
  if (!r) return null;
  const sheet: CharacterSheet = {
    name: r.name, age: r.age, bio: r.bio, traits: r.traits, want: r.want, dealbreaker: r.dealbreaker, house: r.is_house,
    appearance: r.appearance ?? undefined, pronouns: r.pronouns ?? undefined, voice: r.voice ?? undefined,
  };
  return assembleCharacter({ id: r.id, sheet, ownerId: r.owner_id, hue: r.avatar_hue, soul: null, memory: null, extras: r.extras, physical: r.look });
}

const TELL_WORDS: Record<string, string> = { nervous: "when nervous", smitten: "when they like someone", bored: "when bored", annoyed: "when annoyed" };

/**
 * The v2 sheet's extra lines for one character: details, public facts, the four tells by name, never-says, and their
 * sample lines (the catchphrase and the looks stay where v1 has them). Private facts never: the one prompt writes both.
 */
export function voiceKitLines(c: Character): string[] {
  const e = publicExtras(c.extras);
  const details = Object.entries(extrasForPrompt(e))
    .filter(([k]) => k !== "catchphrase" && k !== "profile_answers")
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${Array.isArray(v) ? v.join(", ") : String(v)}`);
  const answers = (e.prompts ?? []).slice(0, 3).map((p) => p.answer);
  const facts = (e.facts ?? []).slice(0, 4).map((f) => `${f.label}: ${f.value}`);
  const tells = TELLS.filter((t) => e.tells?.[t.id]).map((t) => `${TELL_WORDS[t.id]}, ${e.tells![t.id]}`);
  const samples = voiceExamples(e);
  return [
    details.length ? `Details: ${details.join("; ")}` : "",
    answers.length ? `In their own words: ${answers.map((x) => `"${x}"`).join(" / ")}` : "",
    facts.length ? `Facts: ${facts.join("; ")}` : "",
    tells.length ? `Tells (habits that slip out): ${tells.join("; ")}` : "",
    e.never_says?.length ? `Never says: ${e.never_says.map((x) => `"${x}"`).join(", ")}` : "",
    // v2.1 (the A/B of 2026-10-21: Dolphin copied these): they show the voice; never reused, even in part.
    samples.length ? `Sounds like (their own sample lines, only to show the voice; never reuse one, or any part of one):\n${samples.map((s) => `- ${s}`).join("\n")}` : "",
  ].filter(Boolean);
}
