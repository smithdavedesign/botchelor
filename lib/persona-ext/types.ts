/**
 * The persona-extension contract (docs/persona-ext.md; docs/PRDs/cross-mode-memory.md, P4). A feature a character
 * asked for, approved by the show's governance agent (lib/feature-requests.ts), is built here by the self-improving
 * loop's fixer, and only here: one folder a feature, `lib/persona-ext/<slug>/`, registered in `./index.ts`.
 *
 * An extension is a manifest plus pure functions:
 *  - `fields` declares the data a character keeps for it (short text, lists, numbers, choices, flags). The host
 *    (lib/persona-ext-host.ts) validates and stores it, at most 2 KB a character, in its own row of persona_ext_data,
 *    and draws the form for it on the character page. An extension never stores anything itself.
 *  - `promptLines` and `pageLines` turn that data into plain-text lines: for the character's own prompts ("self"),
 *    for what others may know of it ("public"), and for its page. The host caps them, strips markup, runs every line
 *    through the show's text check and drops one that throws or fails.
 *
 * What an extension may not do, checked by tests/persona-ext-fence.test.ts and the CI path fence
 * (scripts/persona-ext-fence.mjs): import anything outside this folder, reach the network, the database, the
 * environment, timers or the page, or touch other characters, users, money, safety, After Dark, auth or the engine.
 * The engine never reads an extension, so it changes what a character talks about, never how a date ends.
 */

export type ExtField =
  | { key: string; label: string; kind: "text"; max?: number }
  | { key: string; label: string; kind: "list"; max?: number; items?: number }
  | { key: string; label: string; kind: "number"; min: number; max: number }
  | { key: string; label: string; kind: "choice"; options: readonly string[] }
  | { key: string; label: string; kind: "flag" };

export type ExtValue = string | number | boolean | string[];
export type ExtData = Record<string, ExtValue>;

export type PersonaExtension = {
  /** `^[a-z][a-z0-9_]{2,31}$`, the same as its folder's name. */
  slug: string;
  /** A short name, shown on the page and used as the heading of its lines in a prompt. */
  title: string;
  /** One sentence: what it's for. */
  summary: string;
  /** The feature request it answers (feature_requests.id), so the asker sees it shipped. */
  request?: string;
  /** Whether others (the other side of a date, the public page) see its public lines. Default true. */
  public?: boolean;
  fields: readonly ExtField[];
  /** Plain-text lines for a prompt: "self" is the character's own, "public" what others may know. At most 6. */
  promptLines?: (data: ExtData, view: "self" | "public") => string[];
  /** Plain-text lines for its card on the character page. At most 6. */
  pageLines?: (data: ExtData) => string[];
};
