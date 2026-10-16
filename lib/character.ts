/**
 * M14 — the Character: the one representation of who a character is.
 *
 * A character's identity used to be scattered: the sheet + look in `characters`, the personality + engine
 * signals in `souls`, the pair history in `relationships`, the per-date outcomes and dialogue on the
 * episode, the crowd read in `character_ratings`. Each prompt builder re-assembled its own ad-hoc slice.
 * This module assembles all of it into one object — how they look, their soul, their preferences, their
 * learned history — and exposes the two privacy-aware views that are the ONLY things the live models see:
 *
 *   - characterSelfView: the full inner life (soul + learned memory). What the SPEAKING agent, and the
 *     narrator, get for this character. This is what keeps every character unique and consistent.
 *   - characterPublicView: name, age, bio, traits, appearance only. What the OTHER agent and spectators
 *     ever see — never the soul, dealbreaker, memory or signals.
 *
 * Per-date context (secret agenda, the owner's note, autonomy, strategy) is NOT part of a Character — it
 * belongs to one date, so the builders wrap the self view with it. The deterministic engine (lib/engine.ts)
 * is untouched: it still decides from the sheet + signals; this object just gathers and presents them.
 */
import type { Db } from "./db";
import { deriveSoulSignals, NEUTRAL_SIGNALS, type CharacterSheet, type SoulSignals } from "./engine";
import { loadSoul, soulText, type StoredSoul } from "./souls";
import { characterPortrait } from "./portraits";
import { loadCharacterMemory, MEMORY_SIGNAL_CAP, type CharacterMemory } from "./memory";
import { getCharacterHistory, type CharacterRecord } from "./game";
import { extrasForPrompt, extrasVisible, hasExtras, voiceExamples, type CharacterExtras } from "./extras";
import { thisWeek, type StoredThisWeek } from "./life";
import { baseSignals, sheetSignals } from "./temperament";

const ZERO_RECORD: CharacterRecord = { dates: 0, second_dates: 0, friends: 0, disasters: 0 };

/** The full, assembled character. `ownerId`, `soul`, `memory` and `signals` are server-only. */
export type Character = {
  id: string;
  name: string;
  age: number;
  bio: string;
  house: boolean;
  /** Server-only. Null for a house character. */
  ownerId: string | null;
  look: { appearance: string | null; hue: number | null; portrait: string | null };
  persona: { traits: readonly string[]; want: string };
  /** How others refer to them ("she/her", "he/him", "they/them"); null when not given (prompts then avoid gendering). */
  pronouns: string | null;
  /** How they talk (house characters have a curated one; a creator may write one). Null when not given. */
  voice: string | null;
  /** Semi-private: it is the dealbreaker quiz answer, so the self view has it but the public view never does. */
  dealbreaker: string;
  soul: StoredSoul | null;
  /** The signals from the soul / image, before any learned drift. */
  baseSignals: SoulSignals;
  /** The effective engine signals: baseSignals nudged by the learned memory, clamped to 0..1. */
  signals: SoulSignals;
  memory: CharacterMemory | null;
  /** The public, aired date record (lib/game.ts). Zeros until loadCharacter fills it. */
  record: CharacterRecord;
  /** Optional details (lib/extras.ts): occupation, style, hobbies, quirks, prompts. Dialogue flavour only. */
  extras: CharacterExtras;
  /** What's new in their life this week (lib/life.ts), or null. Public; dialogue flavour only. */
  thisWeek: string | null;
  /**
   * Set only on a date's characters (lib/simulation.ts): this side's view of its relationship with the person it's
   * meeting (lib/relationships.ts pairContext): where they stand, what the other has told it, their inside jokes,
   * tonight's plan. Server-only, like memory. `pairShared` is the words both already know (never "profile reading").
   */
  pair?: Record<string, unknown> | null;
  pairShared?: string;
  /** Set only on a date's characters: its owner's standing nudge about this person (lib/between-dates.ts). Private. */
  nudge?: string | null;
  /** Set only on a date's characters: who else it's seeing, from the public record (lib/between-dates.ts). */
  alsoSeeing?: string[];
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * The base signals a character plays from (lib/temperament.ts): explicit signals (a trained image or the builder's
 * sliders) win, then the private soul's words, then the temperament its own traits and voice describe. Without
 * a sheet (old callers), a soul-less character is blank, which the engine reads as unremarkable.
 */
export function soulBaseSignals(soul: StoredSoul | null, sheet?: Pick<CharacterSheet, "traits" | "voice">): SoulSignals {
  return baseSignals(soul, soul ? deriveSoulSignals(soul) : null, sheet ? sheetSignals(sheet) : NEUTRAL_SIGNALS);
}

/** The effective engine signals: base plus the memory's bounded drift, clamped to 0..1 per axis. */
export function effectiveSignals(base: SoulSignals, memory: CharacterMemory | null): SoulSignals {
  const d = memory?.signal_delta ?? {};
  const axis = (k: keyof SoulSignals) => clamp01(base[k] + clampDelta(d[k]));
  return { warmth: axis("warmth"), openness: axis("openness"), guardedness: axis("guardedness"), humor: axis("humor") };
}

/** A stored delta is already bounded, but clamp defensively so a bad row can never swing a result. */
const clampDelta = (n: number | undefined) => Math.max(-MEMORY_SIGNAL_CAP, Math.min(MEMORY_SIGNAL_CAP, n ?? 0));

/** Pure builder: assembles a Character from pieces already loaded. Used by buildDate (no extra queries). */
export function assembleCharacter(args: {
  id: string;
  sheet: CharacterSheet;
  ownerId?: string | null;
  hue?: number | null;
  soul: StoredSoul | null;
  memory: CharacterMemory | null;
  record?: CharacterRecord;
  extras?: CharacterExtras | null;
  thisWeek?: string | null;
}): Character {
  const base = soulBaseSignals(args.soul, args.sheet);
  return {
    id: args.id,
    name: args.sheet.name,
    age: args.sheet.age,
    bio: args.sheet.bio,
    house: args.sheet.house,
    ownerId: args.ownerId ?? null,
    look: { appearance: args.sheet.appearance ?? null, hue: args.hue ?? null, portrait: characterPortrait(args.id) },
    persona: { traits: args.sheet.traits, want: args.sheet.want },
    pronouns: args.sheet.pronouns ?? null,
    voice: args.sheet.voice ?? null,
    dealbreaker: args.sheet.dealbreaker,
    soul: args.soul,
    baseSignals: base,
    signals: effectiveSignals(base, args.memory),
    memory: args.memory,
    record: args.record ?? ZERO_RECORD,
    extras: args.extras ?? {},
    thisWeek: args.thisWeek ?? null,
  };
}

/** Loads and assembles the full Character for a display page (sheet + soul + memory + portrait + record). */
export async function loadCharacter(db: Db, id: string): Promise<Character | null> {
  const { rows } = await db.query<{
    id: string; owner_id: string | null; name: string; age: number; bio: string;
    traits: string[]; want: string; dealbreaker: string; is_house: boolean;
    appearance: string | null; avatar_hue: number | null; pronouns: string | null; voice: string | null;
    extras: CharacterExtras | null; this_week: StoredThisWeek | null;
  }>(
    `select id, owner_id, name, age, bio, traits, want, dealbreaker, is_house, appearance, avatar_hue, pronouns, voice, extras, this_week
       from characters where id = $1`,
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  const [soul, memory, history] = await Promise.all([
    loadSoul(db, id),
    loadCharacterMemory(db, id),
    getCharacterHistory(db, id),
  ]);
  const sheet: CharacterSheet = {
    name: r.name, age: r.age, bio: r.bio, traits: r.traits, want: r.want,
    dealbreaker: r.dealbreaker, house: r.is_house, appearance: r.appearance ?? undefined,
    pronouns: r.pronouns ?? undefined, voice: r.voice ?? undefined,
  };
  return assembleCharacter({
    id: r.id, sheet, ownerId: r.owner_id, hue: r.avatar_hue, soul, memory, record: history.record, extras: r.extras,
    thisWeek: thisWeek(r.id, r.this_week),
  });
}

/** The minimal deterministic input the engine reads. The engine's type is unchanged. */
export function characterSheet(c: Character): CharacterSheet {
  return {
    name: c.name,
    age: c.age,
    bio: c.bio,
    traits: c.persona.traits,
    want: c.persona.want,
    dealbreaker: c.dealbreaker,
    house: c.house,
    ...(c.look.appearance ? { appearance: c.look.appearance } : {}),
    ...(c.pronouns ? { pronouns: c.pronouns } : {}),
    ...(c.voice ? { voice: c.voice } : {}),
  };
}

/** The distilled learned memory as the model sees it: an arc, what it likes / dislikes, lines it has said. */
function memoryView(memory: CharacterMemory | null): Record<string, unknown> | null {
  if (!memory || memory.dates === 0) return null;
  const v: Record<string, unknown> = {};
  if (memory.arc) v.who_you_have_become = memory.arc;
  if (memory.likes.length) v.what_you_tend_to_like = memory.likes;
  if (memory.turnoffs.length) v.what_tends_to_put_you_off = memory.turnoffs;
  if (memory.memorable_lines.length) v.lines_you_have_said_before = memory.memorable_lines;
  return Object.keys(v).length ? v : null;
}

/**
 * The speaking agent's own private view: full sheet plus its private inner life — the soul (omitted when
 * local_only) and the learned memory. `privateExtra` carries this date's context (agenda, note, autonomy,
 * strategy), which the builders own. This is the payload that keeps each character unique in live chat.
 */
export function characterSelfView(c: Character, privateExtra: Record<string, unknown> = {}): Record<string, unknown> {
  const soul = c.soul && !c.soul.local_only ? soulText(c.soul) : null;
  const memory = memoryView(c.memory);
  const details = extrasForPrompt(c.extras);
  const examples = voiceExamples(c.extras);
  return {
    name: c.name,
    age: c.age,
    bio: c.bio,
    traits: c.persona.traits,
    want: c.persona.want,
    dealbreaker: c.dealbreaker,
    ...(c.look.appearance ? { appearance: c.look.appearance } : {}),
    ...(c.pronouns ? { pronouns: c.pronouns } : {}),
    ...(c.voice ? { voice: c.voice } : {}),
    // How they sound, shown rather than described: lines in their voice, and what they'd never say.
    ...(examples.length ? { voice_examples: examples } : {}),
    ...(c.extras.never_says?.length ? { never_say: c.extras.never_says } : {}),
    // Their own details: things they know about themselves and may bring up (never the other's).
    ...(Object.keys(details).length ? { details } : {}),
    ...(c.thisWeek ? { whats_new_this_week: c.thisWeek } : {}),
    private: {
      soul: soul ?? "(none — play from your public sheet)",
      ...(memory ? { memory } : {}),
      ...privateExtra,
    },
  };
}

/** The public persona (the contestant card): public fields only. Never soul, dealbreaker, memory, signals. */
export function characterPublicView(c: Character): Record<string, unknown> {
  return {
    name: c.name,
    age: c.age,
    bio: c.bio,
    traits: c.persona.traits,
    ...(c.look.appearance ? { appearance: c.look.appearance } : {}),
    ...(c.pronouns ? { pronouns: c.pronouns } : {}),
    ...(hasExtras(c.extras) && Object.keys(extrasForPrompt(c.extras)).length ? { details: extrasForPrompt(c.extras) } : {}),
    ...(c.thisWeek ? { this_week: c.thisWeek } : {}),
  };
}

/** "Looks about late twenties": how old someone seems across a table, not a number off a profile. */
export function apparentAge(age: number): string {
  if (age >= 100) return "hard to place — somehow both young and very old";
  // Never "teens": every character is an adult, and the date's models must never be nudged toward minors.
  if (age < 20) return "about twenty";
  const decade = Math.floor(age / 10) * 10;
  const third = age % 10 <= 3 ? "early" : age % 10 <= 6 ? "mid" : "late";
  return `${third} ${({ 20: "twenties", 30: "thirties", 40: "forties", 50: "fifties", 60: "sixties", 70: "seventies", 80: "eighties", 90: "nineties" } as Record<number, string>)[decade] ?? "years"}`;
}

/**
 * The other person as a blind date actually meets them (M15): a name, how to refer to them, and what you can
 * see across the table. Not their bio, traits or want — on a blind date you learn those only when they tell
 * you, so a model handed the other's profile ends up reciting it ("A lighthouse keeper with eleven podcast
 * listeners?"). This is what each agent gets for "them"; the profile stays on the contestant card.
 */
export function characterBlindView(c: Character): Record<string, unknown> {
  return {
    name: c.name,
    pronouns: c.pronouns ?? "not given — use their name, or they/them",
    // Only what shows at a glance: their look, their style and signature item — never their job, hobbies or answers.
    what_you_can_see: [c.look.appearance, `looks ${apparentAge(c.age)}`, ...extrasVisible(c.extras ?? {})].filter(Boolean),
  };
}
