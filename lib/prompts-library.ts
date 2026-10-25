/**
 * The prompts library (app/prompts): 2,000 openly licensed image prompts for portraits of adults, for anyone drawing
 * their character, each tagged with the Studio's own options where it matches one. The seed is lib/prompts-library.json,
 * built by scripts/build-prompts-library.mjs from the open prompt dump (Civitai left out; every prompt held to the show's
 * own safety bar and lib/prompt-library-rules.ts). Read on the server only, so the whole list never ships to a browser:
 * a page gets PROMPTS_PER_PAGE prompts.
 */
import { STUDIO_GROUPS } from "./adult/studio-catalog";
import { FACET_RULES, STUDIO_TAG_RULES, YOUNG } from "./prompt-library-rules";
import LIBRARY from "./prompts-library.json";

/** `tags`: Studio option ids ("framing.close") and facets ("style:photo"), from lib/prompt-library-rules.ts tagPrompt. */
export type LibraryPrompt = { prompt: string; source: string; license: string; tags: string[] };

/**
 * A tag as the page shows it. A Studio tag takes its option's own label and its group's title from the Studio's
 * catalog; it's `nsfw` when the option is above the Studio's dressed level (or Filthy's), and then only an After Dark
 * viewer sees it. Facets are the library's own and say so (`studio: false`).
 */
export type PromptTag = { id: string; label: string; group: string; studio: boolean; nsfw: boolean };

const STUDIO_TAGS: PromptTag[] = STUDIO_TAG_RULES.flatMap(({ id }) => {
  const [groupId, optionId] = id.split(".");
  const group = STUDIO_GROUPS.find((g) => g.id === groupId);
  const option = group?.options.find((o) => o.id === optionId);
  return group && option ? [{ id, label: option.label, group: group.title, studio: true, nsfw: option.level > 0 || Boolean(option.filthy) }] : [];
});
const FACET_TAGS: PromptTag[] = FACET_RULES.map(({ id, label }) => ({ id, label, group: id.startsWith("style:") ? "Style" : "Who", studio: false, nsfw: false }));

/** Every tag a prompt can carry, Studio tags first in catalog order. */
export const PROMPT_TAGS: readonly PromptTag[] = [...STUDIO_TAGS, ...FACET_TAGS];
const TAG_BY_ID = new Map(PROMPT_TAGS.map((t) => [t.id, t]));
export const tagById = (id: string): PromptTag | undefined => TAG_BY_ID.get(id);

/** The datasets, as the filter and the credits name them. DiffusionDB's two dumps are one dataset here. */
export const PROMPT_SOURCES = [
  {
    id: "diffusiondb",
    name: "DiffusionDB",
    license: "CC0 1.0",
    href: "https://huggingface.co/datasets/poloclub/diffusiondb",
    licenseHref: "https://creativecommons.org/publicdomain/zero/1.0/",
    match: ["diffusiondb", "diffusiondb-large"],
  },
  {
    id: "midjourney",
    name: "succinctly/midjourney-prompts",
    license: "Apache 2.0",
    href: "https://huggingface.co/datasets/succinctly/midjourney-prompts",
    licenseHref: "https://www.apache.org/licenses/LICENSE-2.0",
    match: ["midjourney"],
  },
  {
    id: "open-image-preferences",
    name: "data-is-better-together/open-image-preferences-v1",
    license: "Apache 2.0",
    href: "https://huggingface.co/datasets/data-is-better-together/open-image-preferences-v1",
    licenseHref: "https://www.apache.org/licenses/LICENSE-2.0",
    match: ["open-image-preferences"],
  },
  {
    id: "pickapic",
    name: "Pick-a-Pic",
    license: "MIT",
    href: "https://huggingface.co/datasets/yuvalkirstain/pickapic_v1",
    licenseHref: "https://opensource.org/license/mit",
    match: ["pickapic"],
  },
] as const;

export type PromptSourceId = (typeof PROMPT_SOURCES)[number]["id"];

/** Prompts a page. */
export const PROMPTS_PER_PAGE = 24;
/** The longest search the page takes at face value. */
export const PROMPT_QUERY_MAX = 80;

/**
 * The seed, with every tag checked against the catalog on the way in: an unknown id is dropped, and so is an NSFW tag
 * on anything youth-coded (the seed never keeps such a prompt; this holds even if a hand edit slipped one in).
 */
export const ALL_PROMPTS: readonly LibraryPrompt[] = (LIBRARY as LibraryPrompt[]).map((p) => ({
  ...p,
  tags: p.tags.filter((id) => {
    const tag = TAG_BY_ID.get(id);
    return tag && !(tag.nsfw && YOUNG.test(p.prompt));
  }),
}));

/** Whether any prompt has an NSFW tag at all: when none does, the page never needs to ask who's looking. */
export const HAS_NSFW_TAGS = ALL_PROMPTS.some((p) => p.tags.some((id) => TAG_BY_ID.get(id)?.nsfw));

/** The tags a viewer sees on a prompt: NSFW ones only for an After Dark viewer. */
export function visibleTags(p: LibraryPrompt, showNsfw: boolean): PromptTag[] {
  return p.tags.map((id) => TAG_BY_ID.get(id)!).filter((t) => t && (showNsfw || !t.nsfw));
}

/** A `?tag=` param as a tag this viewer may filter by, else null. */
export function parseTag(raw: string | string[] | undefined, showNsfw: boolean): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const tag = v ? TAG_BY_ID.get(v) : undefined;
  return tag && (showNsfw || !tag.nsfw) ? tag.id : null;
}

/** The tags the filter offers, with how many prompts carry each, in catalog order; none that no prompt has. */
export function tagCounts(showNsfw: boolean, all: readonly LibraryPrompt[] = ALL_PROMPTS): (PromptTag & { count: number })[] {
  const counts = new Map<string, number>();
  for (const p of all) for (const t of visibleTags(p, showNsfw)) counts.set(t.id, (counts.get(t.id) ?? 0) + 1);
  return PROMPT_TAGS.filter((t) => counts.has(t.id)).map((t) => ({ ...t, count: counts.get(t.id)! }));
}

/** A `?source=` param as one of the datasets, else null (all of them). */
export function parseSource(raw: string | string[] | undefined): PromptSourceId | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return PROMPT_SOURCES.find((s) => s.id === v)?.id ?? null;
}

/** A `?q=` param trimmed and capped. */
export function parseQuery(raw: string | string[] | undefined): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (v ?? "").replace(/\s+/g, " ").trim().slice(0, PROMPT_QUERY_MAX);
}

/** The dataset a prompt came from, as PROMPT_SOURCES lists it. */
export function sourceOf(p: LibraryPrompt) {
  return PROMPT_SOURCES.find((s) => (s.match as readonly string[]).includes(p.source)) ?? PROMPT_SOURCES[0];
}

export type PromptFilter = { query?: string; source?: PromptSourceId | null; tag?: string | null; showNsfw?: boolean };

/**
 * The prompts that hold every word of the search (any order, any case) in their text or in a tag they show, from one
 * dataset or all of them, carrying one tag or any.
 */
export function findPrompts({ query = "", source = null, tag = null, showNsfw = false }: PromptFilter, all: readonly LibraryPrompt[] = ALL_PROMPTS): LibraryPrompt[] {
  const words = query.toLowerCase().split(" ").filter(Boolean);
  return all.filter((p) => {
    if (source && sourceOf(p).id !== source) return false;
    const tags = visibleTags(p, showNsfw);
    if (tag && !tags.some((t) => t.id === tag)) return false;
    const text = `${p.prompt} ${tags.map((t) => t.label).join(" ")}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}
