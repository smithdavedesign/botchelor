/**
 * The prompts library (app/prompts): 2,000 openly licensed image prompts for portraits of adults, for anyone drawing
 * their character. The seed is lib/prompts-library.json, built by scripts/build-prompts-library.mjs from the open
 * prompt dump (Civitai left out; every prompt held to the show's own safety bar). Read on the server only, so the
 * whole list never ships to a browser: a page gets PER prompts.
 */
import LIBRARY from "./prompts-library.json";

export type LibraryPrompt = { prompt: string; source: string; license: string };

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

export const ALL_PROMPTS: readonly LibraryPrompt[] = LIBRARY as LibraryPrompt[];

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

/** The prompts that hold every word of the search (any order, any case), from one dataset or all of them. */
export function findPrompts(query: string, source: PromptSourceId | null, all: readonly LibraryPrompt[] = ALL_PROMPTS): LibraryPrompt[] {
  const words = query.toLowerCase().split(" ").filter(Boolean);
  return all.filter(
    (p) => (!source || sourceOf(p).id === source) && words.every((w) => p.prompt.toLowerCase().includes(w)),
  );
}
