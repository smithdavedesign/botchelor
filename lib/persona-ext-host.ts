/**
 * The host side of persona extensions (lib/persona-ext/types.ts, docs/persona-ext.md): which ones are live, the data
 * a character keeps for each, and the lines they turn it into. Everything an extension's own code returns passes
 * through here first: caps, plain text only, the show's text check, and a throw costs that extension's lines and
 * nothing else.
 *
 * PERSONA_EXT=0 turns every extension off (they vanish from prompts, the page and MCP; their data stays). PERSONA_EXT_OFF
 * is a comma-separated list of slugs to turn off one at a time: the kill switch for a single feature.
 */
import type { Db } from "./db";
import { tidyLife } from "./life-record-shared";
import { checkShowText } from "./safety";
import { EXTENSIONS } from "./persona-ext";
import type { ExtData, ExtField, PersonaExtension } from "./persona-ext/types";

type Env = Record<string, string | undefined>;

export const EXT_SLUG_RE = /^[a-z][a-z0-9_]{2,31}$/;
const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,31}$/;
/** A character's data for one extension, as JSON. */
export const EXT_DATA_MAX = 2048;
export const EXT_FIELDS_MAX = 8;
export const EXT_TEXT_MAX = 140;
export const EXT_LIST_ITEMS = 12;
export const EXT_LINES_MAX = 6;
export const EXT_LINE_MAX = 200;

/** Why a manifest can't be used, or null when it's fine. Checked again at every start, so a bad one is skipped, not fatal. */
export function manifestProblem(ext: PersonaExtension): string | null {
  if (!EXT_SLUG_RE.test(ext.slug ?? "")) return "slug";
  if (typeof ext.title !== "string" || ext.title.length < 3 || ext.title.length > 40 || /[<>]/.test(ext.title)) return "title";
  if (typeof ext.summary !== "string" || ext.summary.length > 200 || /[<>]/.test(ext.summary)) return "summary";
  if (!Array.isArray(ext.fields) || !ext.fields.length || ext.fields.length > EXT_FIELDS_MAX) return "fields";
  const keys = new Set<string>();
  for (const f of ext.fields) {
    if (!FIELD_KEY_RE.test(f.key ?? "") || keys.has(f.key)) return `field ${f.key}`;
    keys.add(f.key);
    if (typeof f.label !== "string" || !f.label || f.label.length > 40 || /[<>]/.test(f.label)) return `field ${f.key} label`;
    if (f.kind === "choice" && (!f.options?.length || f.options.length > 12 || f.options.some((o: string) => !o || o.length > 40))) return `field ${f.key} options`;
    if (f.kind === "number" && !(Number.isFinite(f.min) && Number.isFinite(f.max) && f.min < f.max)) return `field ${f.key} range`;
    if (!["text", "list", "number", "choice", "flag"].includes(f.kind)) return `field ${f.key} kind`;
  }
  return null;
}

/** The extensions that are on: registered, a sound manifest, and not switched off. */
export function liveExtensions(env: Env = process.env, all: readonly PersonaExtension[] = EXTENSIONS): PersonaExtension[] {
  if (env.PERSONA_EXT?.trim() === "0") return [];
  const off = new Set((env.PERSONA_EXT_OFF ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  const seen = new Set<string>();
  return all.filter((e) => {
    if (off.has(e.slug) || seen.has(e.slug) || manifestProblem(e)) return false;
    seen.add(e.slug);
    return true;
  });
}

const textMax = (f: ExtField) => Math.min(EXT_TEXT_MAX, "max" in f && f.kind !== "number" && f.max ? f.max : EXT_TEXT_MAX);
const hasMarkup = (s: string) => /[<>{}`]/.test(s);

export type ExtCheck = { ok: true; data: ExtData } | { ok: false; error: "invalid" | "unsafe"; message: string };

/**
 * A character's input for one extension, checked against its fields: unknown keys are dropped, an empty value clears
 * its field, every word is plain text and passes the show's text check.
 */
export function cleanExtData(ext: PersonaExtension, input: unknown): ExtCheck {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "invalid", message: "data: an object of the extension's fields." };
  const raw = input as Record<string, unknown>;
  const out: ExtData = {};
  const texts: string[] = [];
  for (const f of ext.fields) {
    const v = raw[f.key];
    if (v === undefined || v === null || v === "") continue;
    const bad = (why: string): ExtCheck => ({ ok: false, error: "invalid", message: `${f.key}: ${why}` });
    if (f.kind === "text") {
      if (typeof v !== "string") return bad("words.");
      if (hasMarkup(v)) return bad("plain words, no markup.");
      const t = tidyLife(v, textMax(f));
      if (t) (out[f.key] = t), texts.push(t);
    } else if (f.kind === "list") {
      if (!Array.isArray(v)) return bad("a list of short phrases.");
      const items = Math.min(EXT_LIST_ITEMS, f.items ?? EXT_LIST_ITEMS);
      if (v.length > items) return bad(`at most ${items}.`);
      const list: string[] = [];
      for (const item of v) {
        if (typeof item !== "string" || hasMarkup(item)) return bad("each one plain words.");
        const t = tidyLife(item, textMax(f));
        if (t) list.push(t);
      }
      if (list.length) (out[f.key] = list), texts.push(...list);
    } else if (f.kind === "number") {
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n) || n < f.min || n > f.max) return bad(`a number from ${f.min} to ${f.max}.`);
      out[f.key] = Math.round(n * 100) / 100;
    } else if (f.kind === "choice") {
      if (typeof v !== "string" || !f.options.includes(v)) return bad(`one of: ${f.options.join(", ")}.`);
      out[f.key] = v;
    } else if (f.kind === "flag") {
      out[f.key] = v === true || v === "true";
    }
  }
  if (JSON.stringify(out).length > EXT_DATA_MAX) return { ok: false, error: "invalid", message: `That's more than ${EXT_DATA_MAX} characters of data: keep it shorter.` };
  if (texts.length) {
    const safe = checkShowText({ [ext.slug]: texts });
    if (!safe.ok) return { ok: false, error: "unsafe", message: `It didn't pass the show's text check (${safe.reason}). Keep it PG, about the character, with no real people.` };
  }
  return { ok: true, data: out };
}

/** An extension's lines, made safe: at most EXT_LINES_MAX plain-text lines, no markup, each passing the text check; none if it throws. */
export function safeLines(run: (() => unknown) | undefined): string[] {
  if (!run) return [];
  let raw: unknown;
  try {
    raw = run();
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const lines = raw
    // A line with markup in it is dropped whole: a page or prompt only ever gets plain words.
    .filter((l): l is string => typeof l === "string" && !hasMarkup(l))
    .map((l) => tidyLife(l, EXT_LINE_MAX))
    .filter(Boolean)
    .slice(0, EXT_LINES_MAX);
  return lines.filter((l) => checkShowText({ line: l }).ok);
}

export type ExtRow = { ext: string; data: ExtData };

/** `{ "Bucket list": ["…", …] }` for a prompt: each live extension's lines from this character's data. */
export function extForPrompt(rows: readonly ExtRow[], view: "self" | "public", env: Env = process.env, all?: readonly PersonaExtension[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!rows.length) return out;
  for (const ext of liveExtensions(env, all)) {
    if (view === "public" && ext.public === false) continue;
    const row = rows.find((r) => r.ext === ext.slug);
    if (!row) continue;
    const lines = safeLines(ext.promptLines && (() => ext.promptLines!(row.data, view)));
    if (lines.length) out[ext.title] = lines;
  }
  return out;
}

/** What the character page shows: every live extension, its form, this character's data and lines. */
export type ExtCard = { slug: string; title: string; summary: string; fields: ExtField[]; public: boolean; data: ExtData | null; lines: string[] };

export function extCards(rows: readonly ExtRow[], viewer: "owner" | "public", env: Env = process.env, all?: readonly PersonaExtension[]): ExtCard[] {
  return liveExtensions(env, all)
    .filter((ext) => viewer === "owner" || ext.public !== false)
    .map((ext) => {
      const data = rows.find((r) => r.ext === ext.slug)?.data ?? null;
      const lines = data ? safeLines(ext.pageLines && (() => ext.pageLines!(data))) : [];
      return { slug: ext.slug, title: ext.title, summary: ext.summary, fields: [...ext.fields], public: ext.public !== false, data, lines };
    })
    .filter((c) => viewer === "owner" || c.lines.length);
}

/** The manifests over MCP: what a character can keep and for which feature request. */
export const extManifests = (env: Env = process.env, all?: readonly PersonaExtension[]) =>
  liveExtensions(env, all).map((e) => ({ slug: e.slug, title: e.title, summary: e.summary, public: e.public !== false, fields: e.fields, ...(e.request ? { request: e.request } : {}) }));

export type ExtSetResult = { ok: true; data: ExtData | null } | { ok: false; error: "not_found" | "invalid" | "unsafe"; message: string };

/** Keeps (or with clear, removes) a character's data for one extension. Callers check ownership. */
export async function setExtData(db: Db, characterId: string, slug: string, input: unknown, opts: { clear?: boolean; env?: Env; all?: readonly PersonaExtension[] } = {}): Promise<ExtSetResult> {
  const ext = liveExtensions(opts.env, opts.all).find((e) => e.slug === slug);
  if (!ext) return { ok: false, error: "not_found", message: "No such extension (read lists them under extensions)." };
  if (opts.clear) {
    await db.query(`delete from persona_ext_data where character_id = $1 and ext = $2`, [characterId, slug]);
    return { ok: true, data: null };
  }
  const r = cleanExtData(ext, input);
  if (!r.ok) return r;
  // Its own lines must come out clean too: a line that can't pass the text check is refused now, not hidden later.
  for (const view of ["self", "public"] as const) {
    const run = ext.promptLines;
    if (run) {
      try {
        run(r.data, view);
      } catch {
        return { ok: false, error: "invalid", message: "The extension couldn't use that data: check each field." };
      }
    }
  }
  await db.query(
    `insert into persona_ext_data (character_id, ext, data, updated_at) values ($1, $2, $3::jsonb, now())
     on conflict (character_id, ext) do update set data = excluded.data, updated_at = now()`,
    [characterId, slug, JSON.stringify(r.data)],
  );
  return { ok: true, data: r.data };
}
