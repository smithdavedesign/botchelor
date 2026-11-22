/**
 * The prompts library (app/prompts): 2,000 openly licensed image prompts for portraits of adults, for anyone drawing
 * their character, each tagged with the Studio's own options where it matches one. The seed is lib/prompts-library.json,
 * built by scripts/build-prompts-library.mjs from the open prompt dump (Civitai left out; every prompt held to the show's
 * own safety bar and lib/prompt-library-rules.ts). Read on the server only, so the whole list never ships to a browser:
 * a page gets PROMPTS_PER_PAGE prompts.
 */
import { STUDIO_GROUPS } from "./adult/studio-catalog";
import { namesArtist } from "./prompt-artists";
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
 * The library's first page, picked by hand (2026-11-22: in the seed's order it opened on raw dataset lines, an onion man
 * and a snake-face lady three times over): 24 prompts that name no artist, a couple first, then women and men in turn,
 * across the Studio's framings, light, places and styles. They lead the list in this order, and lead any filter they
 * match (a tag page, a search); every other prompt keeps its place after them. tests/prompts-library.test.ts holds each
 * one to the seed, so a rebuilt seed that loses one fails there.
 */
export const LEAD_PROMPTS: readonly string[] = [
  "A still from a modern black and white French art house movie 1960’s. City street, car, man and woman in love, Cinematic lighting, highly detailed, close-up",
  "DSLR Photo of a woman with messy bun red hair and green eyes, choker, soft focus, Cinematic photography, high detailed skin, highly detailed face, 4k high quality",
  "Portrait of a mysterious man in a bar, leather jacket, long beard, blond hair, stylish, neck tattoo, 50mm lens, soft light, piano, Music, guitar",
  "A detailed and realistic portrait photography of a woman wearing a yellow raincoat with hoodie. Cinematic. Red neon lights and glow in the background. Lens flare. Portra 800 film. Helios 44m",
  "Blonde man with black eye-patch, close-up, enchanted forest background, volumetric lighting, fantasy cover art, digital painting, sharp focus.",
  "portrait of a woman, symmetrical face, brown hair, she has the beautiful calm face of her mother, slightly smiling, ambient light",
  "closeup photo of a man with smug smile who has dark green unkempt hair and brown eyes, wearing a casual blue suit, lush, 4k uhd, ambient light",
  "oil painting of a tall woman with a black sunhat in the desert, black and red jacket, beautiful face, pretty face, very detailed eyes, full body",
  "a romantic portrait of an old man, bathed in soft, golden light, with a backdrop of rolling hills and a setting sun, his weathered face and wise eyes conveying a lifetime of stories and serene wisdom",
  "a portrait photo of a woman in a dining room. soft lighting, photo, movie still, cinematic, detailed",
  "photo of a 50-year old white man, silver hair, neat beard, wearing a red gilet, thick-rimmed glasses, professional corporate portrait, from investor prospectus",
  "full portrait of lovely steampunk woman mechanic with dark hair in boiler suit",
  "a highly detailed portrait of a man, with a brown beard and hair, blue eyes, wearing a tuxedo, photo, hyperrealism, digital art",
  "a black and white photo of a woman with long, flowing hair. she has a serious expression on her face, and her eyes seem to follow you as you move.",
  "An old man taking a selfie with a loaf of bread, sharp details, natural light, vibrant colors.",
  "A woman with beautiful, long red hair wearing an ashen gray, full-length cloak with a large hood covering part of her face.",
  "Impressionist portrait of a dapper Indian gentleman with lilies, soft light, gentle brushstrokes, matte finish.",
  "close-up photo portrait of a Stunning mature lady wearing red dress, in forest, detailed eyes",
  "A high angle dramatic portrait of a man wearing red coat, walking in a black and white street. Cinematic lighting",
  "Highly detailed portrait of one extra happy adult brunette woman giggling, 40 years old, medium hair, wearing glasses, perfect face details, ultra realistic, cinematic, soft lights, unreal engine render, 30 mm, front facing",
  "3D portrait of a Victorian man in a suit, cinematic, intricate textures, dynamic lighting.",
  "portrait of a beautiful woman with sunlight streaming through her blinds, volumetric light, hyper realistic photograph",
  "Majestic fantasy portrait of a man in an ornate astronaut helmet, translucent visor reflecting a celestial event, intricate nebulae in the background, close-up, 8k, fantasy art, cinematic.",
  "close up portrait of a 20 year old man, his hair is brown and short, his eyes are green, his face is symmetric and friendly, he's proud to be where he is in life, ambient light, outdoor in a forest, 50 mm, f/1.8",
];
const LEAD_PLACE = new Map(LEAD_PROMPTS.map((p, i) => [p, i]));
const leadPlace = (p: LibraryPrompt): number => LEAD_PLACE.get(p.prompt) ?? LEAD_PROMPTS.length;

/**
 * The seed, with every tag checked against the catalog on the way in: an unknown id is dropped, and so is an NSFW tag
 * on anything youth-coded (the seed never keeps such a prompt; this holds even if a hand edit slipped one in). The
 * hand-picked LEAD_PROMPTS come first; the sort is stable, so the rest keep the seed's order.
 */
export const ALL_PROMPTS: readonly LibraryPrompt[] = (LIBRARY as LibraryPrompt[])
  .map((p) => ({
    ...p,
    tags: p.tags.filter((id) => {
      const tag = TAG_BY_ID.get(id);
      return tag && !(tag.nsfw && YOUNG.test(p.prompt));
    }),
  }))
  .sort((a, b) => leadPlace(a) - leadPlace(b));

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

export type PromptFilter = { query?: string; source?: PromptSourceId | null; tag?: string | null; showNsfw?: boolean; artists?: "hide" | null };

/**
 * The prompts that hold every word of the search (any order, any case) in their text or in a tag they show, from one
 * dataset or all of them, carrying one tag or any.
 */
export function findPrompts({ query = "", source = null, tag = null, showNsfw = false, artists = null }: PromptFilter, all: readonly LibraryPrompt[] = ALL_PROMPTS): LibraryPrompt[] {
  const words = query.toLowerCase().split(" ").filter(Boolean);
  return all.filter((p) => {
    if (source && sourceOf(p).id !== source) return false;
    // Prompts that name a real artist (lib/prompt-artists.ts) can be left out; the texts themselves are never changed.
    if (artists === "hide" && namesArtist(p.prompt)) return false;
    const tags = visibleTags(p, showNsfw);
    if (tag && !tags.some((t) => t.id === tag)) return false;
    const text = `${p.prompt} ${tags.map((t) => t.label).join(" ")}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

/** A tag gets a page of its own (app/prompts/tag/[id]) from this many prompts: enough to be worth a search result. */
export const TAG_PAGE_MIN = 50;
/** The tag page's address. */
export const promptTagPath = (id: string): string => `/prompts/tag/${encodeURIComponent(id)}`;

/**
 * A tag page's heading, where "{label} portrait prompts" reads badly ("Close portrait prompts", "Man portrait prompts",
 * 2026-11-22). The rest keep the plain form. The title says it in lower case after the count.
 */
const TAG_HEADINGS: Record<string, string> = {
  "framing.close": "Close-up portrait prompts",
  "framing.medium": "Medium-shot portrait prompts",
  "framing.full": "Full-body portrait prompts",
  "accessories.glasses": "Portrait prompts with glasses",
  "light.warm": "Warm, moody portrait prompts",
  "light.studio": "Soft studio-light portrait prompts",
  "light.golden": "Golden-hour portrait prompts",
  "style:painting": "Painted portrait prompts",
  "style:3d": "3D-render portrait prompts",
  "style:illustration": "Illustrated portrait prompts",
  "subject:woman": "Portrait prompts of women",
  "subject:man": "Portrait prompts of men",
  "subject:couple": "Portrait prompts of couples",
};
export const promptTagHeading = (tag: Pick<PromptTag, "id" | "label">): string => TAG_HEADINGS[tag.id] ?? `${tag.label} portrait prompts`;
/**
 * The tags that get a page of their own (the 2026-11-11 growth plan: 2,000 prompts sat on one address): the PG ones
 * with at least TAG_PAGE_MIN prompts, in catalog order. Pure.
 */
export function indexablePromptTags(min = TAG_PAGE_MIN, all: readonly LibraryPrompt[] = ALL_PROMPTS): (PromptTag & { count: number })[] {
  return tagCounts(false, all).filter((t) => !t.nsfw && t.count >= min);
}
