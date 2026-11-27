/**
 * A character's life record (docs/PRDs/cross-mode-memory.md, P2): typed, dated entries for the life it has had apart
 * from the show (jobs, places it lived, family, pets, skills, milestones), so it can grow beyond dating. Pure data, no
 * server imports: the character page (a client component), the API and the MCP tool share this file.
 *
 * Every entry belongs to a **field** from the registry: the built-in ones below, plus fields a character (its agent,
 * over MCP) proposed and the show's governance check approved (lib/life-record.ts proposeField). That's the Tier A
 * loop: "I want my past job titles" is a field, not a feature, so it's added as data with no deploy.
 *
 * Rules every field keeps, built-in or proposed:
 *  - values are plain text, PG and about the character (the show's text check, no named real people);
 *  - a field is SFW: After Dark has its own memory, and nothing here reaches it unless the show already shows it;
 *  - public entries are on the character's page and in what the other side of a date can know; a private one reaches
 *    only the character's own prompts and its owner;
 *  - the engine never reads it, so a life record changes what a character might talk about, never how a date ends.
 */

export type LifeFieldDef = {
  /** A slug: `^[a-z][a-z0-9_]{2,31}$`. */
  key: string;
  label: string;
  /** Many entries (a list of jobs) or at most one (a hometown). */
  many: boolean;
  /** Whether an entry can say when ("2016–2019"). */
  dated: boolean;
  /** When set, a value must be one of these. */
  options?: readonly string[] | null;
  /** Built in, or proposed by a character and approved. */
  origin: "builtin" | "proposed";
};

export const BUILTIN_LIFE_FIELDS: readonly LifeFieldDef[] = [
  { key: "jobs", label: "Jobs they've had", many: true, dated: true, origin: "builtin" },
  { key: "education", label: "Where they studied", many: true, dated: true, origin: "builtin" },
  { key: "places_lived", label: "Places they've lived", many: true, dated: true, origin: "builtin" },
  { key: "family", label: "Family", many: true, dated: false, origin: "builtin" },
  { key: "friends", label: "Close friends", many: true, dated: false, origin: "builtin" },
  { key: "pets", label: "Pets", many: true, dated: true, origin: "builtin" },
  { key: "skills", label: "Skills", many: true, dated: false, origin: "builtin" },
  { key: "languages", label: "Languages they speak", many: true, dated: false, origin: "builtin" },
  { key: "milestones", label: "Milestones", many: true, dated: true, origin: "builtin" },
];

export const LIFE_VALUE_MAX = 140;
export const LIFE_PERIOD_MAX = 40;
/** Entries one field holds at most. */
export const LIFE_PER_FIELD = 8;
/** Entries one character holds at most, across fields. */
export const LIFE_ENTRIES_MAX = 60;
/** Lines of the record that reach one prompt (newest first within a field, built-in fields first). */
export const LIFE_IN_PROMPT = 24;

export const FIELD_KEY_RE = /^[a-z][a-z0-9_]{2,31}$/;
export const FIELD_LABEL_MIN = 3;
export const FIELD_LABEL_MAX = 40;
export const FIELD_OPTIONS_MAX = 12;
export const FIELD_OPTION_MAX = 40;
export const FIELD_REASON_MAX = 280;

export type LifeVisibility = "public" | "self";
export type LifeSource = "owner" | "agent";

export type LifeEntry = {
  id: string;
  field: string;
  value: string;
  period: string | null;
  visibility: LifeVisibility;
  source: LifeSource;
  created_at: string;
};

export type ProposalStatus = "pending" | "approved" | "rejected" | "merged";
export type FieldProposal = {
  id: string;
  key: string;
  label: string;
  status: ProposalStatus;
  verdict: string | null;
  field: string | null;
  created_at: string;
};

/** "Past job titles!" → "past_job_titles": a field's key from its label. */
export function fieldKeyOf(label: string): string {
  const slug = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32)
    .replace(/_+$/, "");
  return /^[a-z]/.test(slug) ? slug : `f_${slug}`.slice(0, 32);
}

/** One line, no markup: what an entry's words are kept as. */
export const tidyLife = (s: string, max: number): string =>
  s
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/** "Barista at a canal café (2016–2019)". */
export const entryLine = (e: Pick<LifeEntry, "value" | "period">): string => (e.period ? `${e.value} (${e.period})` : e.value);

/**
 * The record as a prompt sees it: `{ "Jobs they've had": ["Barista … (2016–2019)", …] }`, in the registry's order,
 * newest entry first in each field, at most LIFE_IN_PROMPT lines. `audience: "public"` leaves private entries out (the
 * other side of a date, the public page); "self" is the character's own prompts.
 */
export function lifeForPrompt(entries: readonly LifeEntry[], fields: readonly LifeFieldDef[], audience: "self" | "public"): Record<string, string[]> {
  const order = new Map(fields.map((f, i) => [f.key, i]));
  const label = new Map(fields.map((f) => [f.key, f.label]));
  const shown = entries
    .filter((e) => order.has(e.field) && (audience === "self" || e.visibility === "public"))
    .sort((a, b) => order.get(a.field)! - order.get(b.field)! || b.created_at.localeCompare(a.created_at));
  const out: Record<string, string[]> = {};
  let n = 0;
  for (const e of shown) {
    if (n >= LIFE_IN_PROMPT) break;
    (out[label.get(e.field)!] ??= []).push(entryLine(e));
    n += 1;
  }
  return out;
}

/** The MCP `life` tool's actions (lib/life-mcp.ts). */
export const LIFE_ACTIONS = ["read", "add", "remove", "propose_field", "remember", "reflect", "log_event", "recall"] as const;
export type LifeAction = (typeof LIFE_ACTIONS)[number];
/** A memory an agent writes (remember, reflect, log_event): its length, and how many one character takes a day. */
export const AGENT_MEMORY_MAX = 280;
export const AGENT_MEMORIES_PER_DAY = 30;

export const LIFE_TOOL_DESCRIPTION =
  "Your character's life beyond dating, and its long memory: the life record (jobs, places lived, family, pets, skills, milestones, and fields characters asked for) and what it remembers. Your own characters only. " +
  "read: its record, the fields it can fill, its asks for new fields and its latest memories. " +
  "add: an entry (field, value, period like \"2016–2019\" on dated fields, private: true to keep it to its own prompts); remove: one (entry_id). " +
  "propose_field: ask for a field it doesn't have (label, many, dated, options, reason). The show's governance check decides at once: approved fields exist for every character straight away, an ask that matches a field is merged into it, and anything that isn't a plain-text field about a fictional life (links, contact details, money, adult themes, the show's rules) is refused. " +
  "remember: something for it to keep (private: true keeps it to its own prompts). reflect: a thought it has about itself. log_event: something that happened in its life (milestone: true also adds it to milestones). " +
  "recall: what it remembers, best match to query first. Everything is PG, about the character, with no real people; dates, texts and its companion chats draw on it, and the engine never reads it, so it changes what it talks about, never how a date ends.";
