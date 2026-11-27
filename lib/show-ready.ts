/**
 * Show-ready (David, 2026-11-27: connect the show skills to character building). A character's public card says
 * which of the show's format moves (.claude/skills/showrunner/formats.md) it can carry, and what it would take
 * to carry the rest. Building a character then reads like getting cast: "add who they'd bring home, and they can
 * have a Hometowns episode."
 *
 * Pure and client-safe: the builder (app/create/ShowReadyPanel.tsx) runs it on the draft, and the casting
 * director skill and the producer read the same answer from a saved card. It reads only the public card
 * (publicExtras) plus public record counts the caller passes in, never temperament, opinions, lessons or anything
 * owner-only, and it never touches the engine.
 */
import { publicExtras, type CharacterExtras } from "./extras";
import { neverSaid, tokens } from "./quality";

export type ShowMoveId = "cliffhanger" | "interruption" | "unequal_dates" | "first_impression" | "hometowns" | "reunion" | "spinoff" | "villain";

/** What a move needs. `card` needs the creator can fill in; `record` needs only the show's run can supply. */
type Need =
  | { kind: "card"; field: ShowField }
  | { kind: "record"; what: "rival" | "two_rivals" | "exit" };

/** The card details the show asks for, each with where it is in the builder and why the show wants it. */
export const SHOW_FIELDS = {
  hello: { label: "How they say hello", step: "voice", why: "their entrance on night one" },
  dodge: { label: "How they dodge a question", step: "voice", why: "the cliffhanger at the end of a night" },
  upset: { label: "When something goes wrong", step: "voice", why: "their exit and the reunion" },
  annoyed: { label: "When something annoys them, they…", step: "voice", why: "the moment a rival interrupts their date" },
  hometown: { label: "Hometown", step: "details", why: "Hometowns week" },
  family: { label: "Who they'd bring home", step: "details", why: "Hometowns week: the family the lead meets" },
  villain_ok: { label: "Happy to play the villain", step: "review", why: "the villain edit, only ever from their real record" },
} as const;
export type ShowField = keyof typeof SHOW_FIELDS;
export const SHOW_FIELD_IDS = Object.keys(SHOW_FIELDS) as ShowField[];

export const SHOW_MOVES: readonly { id: ShowMoveId; title: string; needs: readonly Need[] }[] = [
  { id: "cliffhanger", title: "The cliffhanger", needs: [{ kind: "card", field: "dodge" }, { kind: "record", what: "rival" }] },
  { id: "interruption", title: "The interruption", needs: [{ kind: "card", field: "annoyed" }, { kind: "record", what: "rival" }] },
  { id: "unequal_dates", title: "Unequal dates", needs: [] },
  { id: "first_impression", title: "The first impression rose", needs: [{ kind: "card", field: "hello" }] },
  { id: "hometowns", title: "Hometowns", needs: [{ kind: "card", field: "hometown" }, { kind: "card", field: "family" }] },
  { id: "reunion", title: "The reunion", needs: [{ kind: "card", field: "upset" }, { kind: "record", what: "exit" }] },
  { id: "spinoff", title: "The spinoff", needs: [{ kind: "record", what: "exit" }] },
  { id: "villain", title: "The villain edit", needs: [{ kind: "card", field: "villain_ok" }, { kind: "record", what: "two_rivals" }] },
];

/** The public record the show has on a character so far (counts from lib/story-state.ts and the ceremonies). */
export type ShowRecord = { rivals: number; exited: boolean; house: boolean };
const NO_RECORD: ShowRecord = { rivals: 0, exited: false, house: false };

const has = (v: unknown) => typeof v === "string" && v.trim().length > 0;

function cardHas(e: CharacterExtras, f: ShowField, house: boolean): boolean {
  switch (f) {
    case "hello":
    case "dodge":
    case "upset":
      return has(e.lines?.[f]);
    case "annoyed":
      return has(e.tells?.annoyed);
    case "hometown":
    case "family":
      return has(e[f]);
    case "villain_ok":
      // The house cast is the show's own: it may frame them without asking. A user's character needs its owner's yes.
      return house || e.villain_ok === true;
  }
}

function recordHas(r: ShowRecord, what: "rival" | "two_rivals" | "exit"): boolean {
  if (what === "rival") return r.rivals >= 1;
  if (what === "two_rivals") return r.rivals >= 2;
  return r.exited;
}

export type ShowReadiness = {
  /** Moves the character can carry today. */
  ready: ShowMoveId[];
  /** Moves the creator could unlock now, with the card details each still needs. */
  unlock: { move: ShowMoveId; missing: ShowField[] }[];
  /** Moves waiting only on the show's run (a rivalry, an exit): nothing to fill in. */
  waiting: ShowMoveId[];
  /** The card details still missing, most moves unlocked first: what the builder asks for. */
  asks: ShowField[];
  /** 0 to 100: the share of the show's card details filled in. */
  score: number;
};

/** Which of the show's moves this character can carry, and what would unlock the rest (pure). */
export function showReadiness(extras: CharacterExtras | null | undefined, record: Partial<ShowRecord> = {}): ShowReadiness {
  const e = publicExtras(extras);
  const r = { ...NO_RECORD, ...record };
  const ready: ShowMoveId[] = [];
  const unlock: { move: ShowMoveId; missing: ShowField[] }[] = [];
  const waiting: ShowMoveId[] = [];
  const unlocks = new Map<ShowField, number>();
  for (const m of SHOW_MOVES) {
    const missing = m.needs.flatMap((n) => (n.kind === "card" && !cardHas(e, n.field, r.house) ? [n.field] : []));
    const recordOk = m.needs.every((n) => n.kind !== "record" || recordHas(r, n.what));
    if (!missing.length && recordOk) ready.push(m.id);
    else if (missing.length) {
      unlock.push({ move: m.id, missing });
      for (const f of missing) unlocks.set(f, (unlocks.get(f) ?? 0) + 1);
    } else waiting.push(m.id);
  }
  const fields = SHOW_FIELD_IDS.filter((f) => !(f === "villain_ok" && r.house));
  const filled = fields.filter((f) => cardHas(e, f, r.house)).length;
  const asks = fields.filter((f) => !cardHas(e, f, r.house)).sort((a, b) => (unlocks.get(b) ?? 0) - (unlocks.get(a) ?? 0));
  return { ready, unlock, waiting, asks, score: Math.round((filled / fields.length) * 100) };
}

export const moveTitle = (id: ShowMoveId): string => SHOW_MOVES.find((m) => m.id === id)?.title ?? id;

/**
 * Show copy that quotes a character, checked against their voice kit (the show writer's rule): it must not use a
 * never-say, and must not repeat one of their sample lines word for word (a 4-word run), the same two checks the
 * dates' critic runs (lib/quality.ts). Returns what's wrong, or an empty list.
 */
export function voiceBreaks(line: string, extras: CharacterExtras | null | undefined): string[] {
  const out: string[] = [];
  const never = neverSaid(line, extras?.never_says);
  if (never) out.push(`uses a never-say: "${never}"`);
  const grams = (ws: string[]) => new Set(ws.slice(0, Math.max(0, ws.length - 3)).map((_, i) => ws.slice(i, i + 4).join(" ")));
  const mine = grams(tokens(line));
  for (const sample of Object.values(extras?.lines ?? {})) {
    if (!sample) continue;
    if ([...grams(tokens(sample))].some((g) => mine.has(g))) {
      out.push(`repeats their sample line "${sample}"`);
      break;
    }
  }
  return out;
}
