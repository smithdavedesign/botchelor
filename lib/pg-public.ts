/**
 * Public sheet fields that don't fit the PG show, as they're shown (2026-11-02, David: "moderate explicit text in public
 * profile fields"). Saving is held to lib/safety.ts checkSheetText now; a sheet saved before that can still hold a line
 * that isn't PG ("They're boring or not into exploring in the bedroom"). Nothing here writes: the row stays as its
 * owner wrote it, and every public view shows a neutral line in its place (or leaves a flagged trait out) until the owner
 * edits it. The owner's own character page names the fields to fix (pgFlags). The dealbreaker quiz skips a flagged
 * dealbreaker, as answer or decoy (lib/mechanics.ts). Pure, no server imports.
 */
import { TEXT_DETAIL_KEYS, type CharacterExtras } from "./extras";
import { sheetPgIssue } from "./safety";

/** What a flagged text field reads as in public. */
export const PG_HIDDEN_TEXT = "(Hidden for now: this part doesn't fit the show's PG rules yet.)";

/** The public text fields this looks at, with how the owner's notice names each one. */
export const PG_FIELD_LABELS = {
  bio: "bio",
  want: "what they want",
  dealbreaker: "dealbreaker",
  appearance: "look",
  voice: "voice",
  traits: "traits",
  details: "profile details",
} as const;
export type PgField = keyof typeof PG_FIELD_LABELS;

type Sheetish = {
  bio?: string | null;
  want?: string | null;
  dealbreaker?: string | null;
  appearance?: string | null;
  voice?: string | null;
  traits?: readonly string[] | null;
  extras?: CharacterExtras | null;
};

/** Which public fields of a sheet don't fit the PG show, in the order above; empty when they all do. */
export function pgFlags(c: Sheetish): PgField[] {
  return (Object.keys(PG_FIELD_LABELS) as PgField[]).filter((k) => {
    if (k === "details") return c.extras ? pgExtras(c.extras) !== c.extras : false;
    const v = c[k];
    return Array.isArray(v) ? v.some((t) => sheetPgIssue(t)) : typeof v === "string" && sheetPgIssue(v) !== null;
  });
}

/** Whether one text fits the PG show. */
export const fitsPg = (text: string | null | undefined): boolean => !text || sheetPgIssue(text) === null;

/** The sheet as it may be shown in public: each flagged text in PG_HIDDEN_TEXT's place, flagged traits left out. */
export function pgPublic<T extends Sheetish>(c: T): T {
  const flags = pgFlags(c);
  if (!flags.length) return c;
  const out: T = { ...c };
  for (const k of flags) {
    if (k === "details") (out as Sheetish).extras = pgExtras(c.extras!);
    else if (k === "traits") (out as Sheetish).traits = (c.traits ?? []).filter((t) => fitsPg(t));
    else (out as Record<string, unknown>)[k] = PG_HIDDEN_TEXT;
  }
  return out;
}

/**
 * The public details (lib/extras.ts) as they may be shown: a flagged free-text detail, hobby, take, line, fact or prompt
 * answer left out (Chud's quirk "trys to manipulate you into sleeping with him"). The same object back when nothing is.
 */
export function pgExtras(e: CharacterExtras): CharacterExtras {
  const out: CharacterExtras = { ...e };
  let changed = false;
  const drop = <V>(list: V[] | undefined, text: (v: V) => string[]): V[] | undefined => {
    if (!list) return list;
    const kept = list.filter((v) => text(v).every((t) => fitsPg(t)));
    if (kept.length !== list.length) changed = true;
    return kept;
  };
  const dropKeys = <R extends Partial<Record<string, string>>>(rec: R | undefined): R | undefined => {
    if (!rec) return rec;
    const kept = Object.fromEntries(Object.entries(rec).filter(([, v]) => fitsPg(v))) as R;
    if (Object.keys(kept).length !== Object.keys(rec).length) changed = true;
    return kept;
  };
  for (const k of TEXT_DETAIL_KEYS) {
    if (typeof e[k] === "string" && !fitsPg(e[k])) {
      delete out[k];
      changed = true;
    }
  }
  if (e.kind_label && !fitsPg(e.kind_label)) {
    delete out.kind_label;
    changed = true;
  }
  if (e.hobbies) out.hobbies = drop(e.hobbies, (h) => [h]);
  if (e.never_says) out.never_says = drop(e.never_says, (h) => [h]);
  if (e.hot_takes) out.hot_takes = drop(e.hot_takes, (h) => [h]);
  if (e.prompts) out.prompts = drop(e.prompts, (p) => [p.answer]);
  if (e.facts) out.facts = drop(e.facts, (f) => [f.label, f.value]);
  if (e.lines) out.lines = dropKeys(e.lines);
  if (e.tells) out.tells = dropKeys(e.tells);
  return changed ? out : e;
}
