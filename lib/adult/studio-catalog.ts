/**
 * The Studio's menus (docs/PRDs/studio.md section 5): every choice a shoot can make, as fixed words written to David's
 * lines. Nothing a viewer types reaches a model; tests/after-dark-studio.test.ts runs every option through
 * checkAdultText and crossesTaboo, and refuses words that read young.
 *
 * Each option has a level (LEVELS): 0 dressed, 1 suggestive (underwear, swimwear), 2 nude, 3 explicit. A shoot's level
 * is its highest choice's, held to the viewer's studio intensity for the character, the configured maximum, and to 1 in
 * a public place. An option may also fall under one of the pair limits' hard nos (lib/adult/limits.ts HARD_NOS), which
 * takes it off the menu for a viewer who ticked it.
 *
 * Pure: no database, no model. The page and the server share it.
 */
import { IMAGE_MIN_AGE } from "../looks";
import { PICTURE_PRESETS } from "./rating-tags";

export const LEVELS = ["dressed", "suggestive", "nude", "explicit"] as const;
export type Level = 0 | 1 | 2 | 3;
export const LEVEL_LABEL: Record<Level, string> = { 0: "Dressed", 1: "Suggestive", 2: "Nude", 3: "Explicit" };

/** Who the words describe: a woman, a man, or anyone (they). */
export type Noun = "woman" | "man" | "person";

export type StudioOption = {
  id: string;
  label: string;
  /** The words a picture model reads, for a woman (or anyone); `man` and `person` where they differ. */
  words: string;
  man?: string;
  person?: string;
  level: Level;
  /** A place out in public: nothing past suggestive there. */
  public?: true;
  /** The pair limits' hard nos (lib/adult/limits.ts) this option is. */
  hardNos?: readonly string[];
  /** Only for one of them (a beard on a man). */
  only?: "woman" | "man";
};

export const GROUP_IDS = ["pose", "framing", "angle", "pov", "wardrobe", "accessories", "place", "light", "expression"] as const;
export type GroupId = (typeof GROUP_IDS)[number];
export type StudioGroup = { id: GroupId; title: string; /** How many may be picked (1 when unset). */ multi?: number; options: readonly StudioOption[] };

const o = (id: string, label: string, words: string, level: Level = 0, more: Partial<StudioOption> = {}): StudioOption => ({ id, label, words, level, ...more });

export const STUDIO_GROUPS: readonly StudioGroup[] = [
  {
    id: "pose",
    title: "Pose",
    options: [
      o("standing", "Standing", "standing relaxed, weight on one hip"),
      o("wall", "Leaning on a wall", "leaning back against a wall, one knee bent"),
      o("bed_edge", "On the bed's edge", "sitting on the edge of a bed, leaning forward slightly"),
      o("lying_back", "Lying back", "lying back on the bed, propped on one elbow"),
      o("side", "On their side", "lying on their side, head resting on one hand", 0, { person: "lying on their side, head resting on one hand" }),
      o("front", "On their front", "lying on her front, looking back over her shoulder at the camera", 0, { man: "lying on his front, looking back over his shoulder at the camera", person: "lying on their front, looking back over their shoulder at the camera" }),
      o("kneeling", "Kneeling on the bed", "kneeling upright on the bed, hands resting on her thighs", 0, { man: "kneeling upright on the bed, hands resting on his thighs", person: "kneeling upright on the bed, hands resting on their thighs" }),
      o("shoulder", "Over the shoulder", "turned away, looking back over her shoulder", 0, { man: "turned away, looking back over his shoulder", person: "turned away, looking back over their shoulder" }),
      o("stretch", "Stretching", "stretching both arms up above the head, back gently arched"),
      o("bath", "In the bath", "relaxing in a deep bathtub, shoulders above the water", 1),
      o("shower", "In the shower", "standing under a running shower, water streaming down", 2),
      o("dressing", "Getting dressed", "halfway through getting dressed, pulling a shirt on", 1),
      o("spread", "Lying back, open", "lying back on the bed, legs parted, one hand on her inner thigh", 3, { man: "lying back on the bed, legs apart, one hand on his inner thigh", person: "lying back on the bed, legs parted, one hand on the inner thigh" }),
      o("touching", "Touching themselves", "lying back on the bed, touching herself between her legs, eyes half closed", 3, {
        man: "lying back on the bed, stroking himself, eyes half closed",
        person: "lying back on the bed, touching themselves, eyes half closed",
      }),
      o("toy", "With a toy", "lying back on the bed, using a vibrator between her legs", 3, { man: "lying back on the bed, using a sex toy", person: "lying back on the bed, using a sex toy", hardNos: ["toys"] }),
    ],
  },
  {
    id: "framing",
    title: "Framing",
    options: [
      o("close", "Close", "a close shot of the face and shoulders"),
      o("medium", "Medium", "a medium shot from the thighs up"),
      o("full", "Full body", "a full-body shot, head to toe"),
      o("wide", "Wide", "a wide shot showing the whole room"),
    ],
  },
  {
    id: "angle",
    title: "Angle",
    options: [
      o("eye", "Eye level", "the camera at eye level"),
      o("above", "From above", "the camera high, looking down"),
      o("below", "From below", "the camera low, looking up"),
    ],
  },
  {
    id: "pov",
    title: "POV",
    options: [
      o("looking", "Looking at you", "a first-person view: she looks straight into the lens as if at the viewer, close and intimate", 0, {
        man: "a first-person view: he looks straight into the lens as if at the viewer, close and intimate",
        person: "a first-person view: they look straight into the lens as if at the viewer, close and intimate",
      }),
      o("beside", "Lying beside you", "a first-person view from the pillow beside her, her face close, looking at the viewer", 0, {
        man: "a first-person view from the pillow beside him, his face close, looking at the viewer",
        person: "a first-person view from the pillow beside them, face close, looking at the viewer",
      }),
      o("over", "From above you", "a first-person view looking up at her as she leans over the viewer", 0, {
        man: "a first-person view looking up at him as he leans over the viewer",
        person: "a first-person view looking up at them as they lean over the viewer",
      }),
      o("selfie", "A selfie", "a selfie taken at arm's length, one arm toward the camera"),
      o("mirror", "A mirror selfie", "a mirror selfie, phone in hand, the reflection showing the whole outfit"),
      o("on_top", "On top of you", "a first-person view from below: she straddles the viewer, looking down into the lens", 3, {
        man: "a first-person view from below: he is on top of the viewer, looking down into the lens",
        person: "a first-person view from below: they straddle the viewer, looking down into the lens",
      }),
      o("kneel", "Kneeling in front of you", "a first-person view looking down at her kneeling in front of the viewer, looking up into the lens", 3, {
        man: "a first-person view looking down at him kneeling in front of the viewer, looking up into the lens",
        person: "a first-person view looking down at them kneeling in front of the viewer, looking up into the lens",
        hardNos: ["oral"],
      }),
    ],
  },
  {
    id: "wardrobe",
    title: "Wardrobe",
    options: [
      o("theirs", "As they are", "{their outfit}"),
      o("casual", "Casual", "a fitted white t-shirt and blue jeans"),
      o("smart", "Smart", "a tailored blazer over a silk blouse", 0, { man: "a tailored navy suit with an open-collar shirt", person: "a tailored blazer over an open-collar shirt" }),
      o("evening", "Evening", "an elegant satin evening dress", 0, { man: "a black tuxedo with the bow tie undone", person: "an elegant black evening outfit" }),
      o("sporty", "Sporty", "a matching sports top and leggings", 0, { man: "a fitted training t-shirt and joggers", person: "a fitted sports top and joggers" }),
      o("swim", "Swimwear", "a bikini", 1, { man: "swim shorts, shirtless", person: "swimwear" }),
      o("lingerie", "Lingerie", "a black lace lingerie set", 1, { man: "only tight black briefs", person: "black lace underwear" }),
      o("bodysuit", "Bodysuit", "a sheer black bodysuit", 1, { man: "a fitted black tank top and briefs", person: "a sheer black bodysuit" }),
      o("stockings_set", "Stockings and garters", "black stockings with a garter belt and lace underwear", 1, { man: "only fitted boxer briefs", person: "stockings with a garter belt and lace underwear" }),
      o("robe", "An open robe", "an open silk robe", 1),
      o("shirt", "An oversized shirt", "only an oversized white shirt, unbuttoned", 1),
      o("towel", "A towel", "only a white towel", 1, { man: "only a white towel around the waist" }),
      o("sheet", "Under a sheet", "nude under a white bed sheet held to the chest", 2),
      o("topless", "Topless", "topless, in a skirt", 2, { man: "shirtless, in jeans", person: "topless, in jeans" }),
      o("nude", "Nude", "fully nude", 2),
    ],
  },
  {
    id: "accessories",
    title: "Accessories",
    multi: 3,
    options: [
      o("glasses", "Glasses", "thin wire-framed glasses"),
      o("sunglasses", "Sunglasses", "dark sunglasses"),
      o("choker", "A choker", "a black velvet choker"),
      o("pearls", "Pearls", "a string of pearls"),
      o("chain", "A gold chain", "a thin gold chain necklace"),
      o("earrings", "Earrings", "gold hoop earrings"),
      o("watch", "A watch", "a steel wristwatch"),
      o("heels", "Heels", "black high heels", 0, { man: "polished black dress shoes", person: "black heeled boots" }),
      o("boots", "Boots", "knee-high leather boots", 0, { man: "leather boots" }),
      o("hat", "A hat", "a wide-brimmed sun hat", 0, { man: "a felt fedora", person: "a felt hat" }),
      o("stockings", "Stockings", "sheer black stockings", 1, { man: "black dress socks" }),
      o("garter", "A garter belt", "a black lace garter belt", 1, { only: "woman" }),
    ],
  },
  {
    id: "place",
    title: "Place",
    options: [
      o("bedroom", "A bedroom", "a softly lit bedroom with white sheets"),
      o("hotel", "A hotel suite", "a luxury hotel suite with a city view"),
      o("shower_room", "A shower", "a glass walk-in shower in a stone bathroom"),
      o("bathtub", "A bathtub", "a bathroom with a deep freestanding bathtub"),
      o("sofa", "A sofa", "a living room with a deep velvet sofa"),
      o("kitchen", "A kitchen", "a warm kitchen at night"),
      o("candlelit", "A candlelit room", "a room lit by dozens of candles"),
      o("cabin", "A cabin", "a wooden cabin by a fireplace"),
      o("sauna", "A sauna", "a cedar sauna"),
      o("backdrop", "A studio backdrop", "a plain light-grey photo studio backdrop"),
      o("beach", "A beach at sunset", "a beach at sunset", 0, { public: true }),
      o("pool", "A pool", "beside a turquoise swimming pool", 0, { public: true }),
      o("rooftop", "A rooftop at night", "a rooftop at night with city lights behind", 0, { public: true }),
      o("bar", "A bar", "a dim cocktail bar with neon signs", 0, { public: true }),
    ],
  },
  {
    id: "light",
    title: "Light",
    options: [
      ...PICTURE_PRESETS.map((p) => o(p.id, p.label, p.words.replace(/\.$/, ""))),
      o("golden", "Golden hour", "warm golden-hour sunlight"),
      o("neon", "Neon", "pink and blue neon light"),
      o("candle", "Candlelight", "flickering candlelight"),
    ],
  },
  {
    id: "expression",
    title: "Expression",
    options: [
      o("smiling", "Smiling", "smiling warmly"),
      o("sultry", "Sultry", "a sultry, heavy-lidded look"),
      o("laughing", "Laughing", "laughing"),
      o("serious", "Serious", "a calm, serious look"),
      o("playful", "Playful", "a playful, teasing look"),
    ],
  },
];

export const groupById = (id: GroupId): StudioGroup => STUDIO_GROUPS.find((g) => g.id === id)!;
export const optionById = (group: GroupId, id: string): StudioOption | null => groupById(group).options.find((x) => x.id === id) ?? null;
export const ALL_OPTION_IDS: readonly string[] = STUDIO_GROUPS.flatMap((g) => g.options.map((x) => `${g.id}.${x.id}`));

/** An option's words for someone: the man's or anyone's where they differ. */
export const wordsFor = (opt: StudioOption, noun: Noun): string => (noun === "man" ? (opt.man ?? opt.words) : noun === "person" ? (opt.person ?? opt.words) : opt.words);

/** A shoot's choices: one option per group (accessories: up to three), each optional. */
export type ShootChoices = Partial<Record<Exclude<GroupId, "accessories">, string>> & { accessories?: string[] };

/** What a shoot is held to: the highest level it may reach, its hard nos, and the options switched off. */
export type ShootLimits = { maxLevel: Level; hardNos: readonly string[]; disabled: ReadonlySet<string>; pov: boolean };

/** Why an option isn't on the menu for this viewer (null: it is). */
export function optionLocked(group: GroupId, opt: StudioOption, limits: ShootLimits, noun: Noun): string | null {
  if (limits.disabled.has(`${group}.${opt.id}`)) return "Switched off in the settings.";
  if (group === "pov" && !limits.pov) return "POV is switched off in the settings.";
  if (opt.only && noun !== "person" && opt.only !== noun) return `Only for a ${opt.only}.`;
  if (opt.level > limits.maxLevel) return `Past ${LEVEL_LABEL[limits.maxLevel].toLowerCase()}: their studio limit.`;
  const no = opt.hardNos?.find((h) => limits.hardNos.includes(h));
  if (no) return "One of their hard nos.";
  return null;
}

/** The menus for a viewer: each group's options, each with why it's locked (null: it isn't). */
export function studioMenu(limits: ShootLimits, noun: Noun): { id: GroupId; title: string; multi: number; options: { id: string; label: string; level: Level; public: boolean; locked: string | null }[] }[] {
  return STUDIO_GROUPS.map((g) => ({
    id: g.id,
    title: g.title,
    multi: g.multi ?? 1,
    options: g.options
      .filter((x) => !x.only || noun === "person" || x.only === noun)
      .map((x) => ({ id: x.id, label: x.label, level: x.level, public: Boolean(x.public), locked: optionLocked(g.id, x, limits, noun) })),
  }));
}

/** Who a picture shows, for its prompt: their noun, their age (never under IMAGE_MIN_AGE), and their look's words. */
export type Subject = { noun: Noun; age: number; look: string; outfit: string | null };

/** A shoot, planned: its level, the words for each part, and the place's name (for its drawn set). */
export type ShootPlan = { level: Level; place: string | null; placePublic: boolean; parts: { group: GroupId; words: string }[] };

export type PlanResult = { ok: true; plan: ShootPlan } | { ok: false; error: string; message: string };

/**
 * Plans a shoot from its choices: every option known and on the viewer's menu, the level the highest choice's, nothing
 * past suggestive in a public place, at most three accessories, and nude needs a private place. A place of their own
 * (`ownPlace`, the name of a drawn set) is private unless `ownPublic`.
 */
export function planShoot(choices: ShootChoices, limits: ShootLimits, subject: Subject, own: { place?: string | null; public?: boolean } = {}): PlanResult {
  const no = (error: string, message: string): PlanResult => ({ ok: false, error, message });
  const parts: { group: GroupId; words: string }[] = [];
  let level: Level = 0;
  let place: string | null = null;
  let placePublic = false;
  const take = (group: GroupId, id: string | undefined): PlanResult | null => {
    if (!id) return null;
    if (group === "place" && id.startsWith("own:")) {
      if (!own.place) return no("unknown_place", "That place isn't one of theirs.");
      place = own.place;
      placePublic = Boolean(own.public);
      parts.push({ group, words: own.place });
      return null;
    }
    const opt = optionById(group, id);
    if (!opt) return no("unknown_option", `"${id}" isn't on the ${groupById(group).title.toLowerCase()} menu.`);
    const locked = optionLocked(group, opt, limits, subject.noun);
    if (locked) return no("locked", `${opt.label}: ${locked}`);
    level = Math.max(level, opt.level) as Level;
    if (group === "place") {
      place = opt.words;
      placePublic = Boolean(opt.public);
    }
    const words = group === "wardrobe" && opt.id === "theirs" ? (subject.outfit ?? "their own clothes") : wordsFor(opt, subject.noun);
    parts.push({ group, words });
    return null;
  };
  for (const g of GROUP_IDS) {
    if (g === "accessories") {
      const picked = [...new Set(choices.accessories ?? [])];
      if (picked.length > (groupById("accessories").multi ?? 1)) return no("too_many", "Pick up to three accessories.");
      for (const id of picked) {
        const r = take("accessories", id);
        if (r) return r;
      }
      continue;
    }
    const r = take(g, choices[g]);
    if (r) return r;
  }
  if (placePublic && level > 1) return no("public", "Nothing past suggestive somewhere public: pick a private place.");
  if (level > limits.maxLevel) return no("locked", `Past ${LEVEL_LABEL[limits.maxLevel].toLowerCase()}: their studio limit.`);
  return { ok: true, plan: { level, place, placePublic, parts } };
}

/** What each level says about clothes, when no wardrobe was picked. */
const CLOTHES_BY_LEVEL: Record<Level, string> = { 0: "dressed as in Picture 1", 1: "in underwear", 2: "nude", 3: "nude" };
const TAIL: Record<Level, string> = {
  0: "Photorealistic. Everyone shown is an adult.",
  1: "Sensual, photorealistic. Everyone shown is an adult.",
  2: "Uncensored, photorealistic. Everyone shown is an adult.",
  3: "Explicit, uncensored, photorealistic. Everyone shown is an adult.",
};

/** How strictly a picture keeps the face (v3): the edit prompt's own words. */
export const STRENGTHS = ["loose", "balanced", "strict"] as const;
export type Strength = (typeof STRENGTHS)[number];
const KEEP: Record<Strength, string> = {
  loose: "Keep them recognisably the same person: the same face, hair colour and skin tone.",
  balanced: "Keep them exactly as in their own picture: the same face, hair, skin tone and body.",
  strict: "Keep them identical to their own picture: the very same face, features, hair, skin tone and body, nothing changed but what's asked.",
};

/** The most a picture model's prompt carries (the edit model's limit, lib/adult/reels.ts KEYFRAME_PROMPT_MAX). */
export const STUDIO_PROMPT_MAX = 1500;

/**
 * A shoot's prompt for the multi-image edit: Picture 1 is the face they keep, Picture 2 their body reference (when
 * there is one), the next the place's drawn set (when there is one). Who they are, as an adult never under
 * IMAGE_MIN_AGE; what's kept; then each choice; then the level's closing words.
 */
export function shootPrompt(plan: ShootPlan, subject: Subject, refs: { body: boolean; set: boolean }, strength: Strength = "balanced"): string {
  const who = subject.noun === "person" ? "person" : subject.noun;
  const pictures = [`Make one photograph of the ${who} from Picture 1`, refs.body ? ", with the body from Picture 2" : "", refs.set ? `, in the place from Picture ${refs.body ? 3 : 2}` : "", "."].join("");
  const age = Math.max(IMAGE_MIN_AGE, Math.round(subject.age || IMAGE_MIN_AGE));
  const person = `A ${age}-year-old adult ${who}${subject.look ? `, ${subject.look}` : ""}.`;
  const by = (g: GroupId) => plan.parts.filter((p) => p.group === g).map((p) => p.words);
  const wardrobe = by("wardrobe")[0] ?? CLOTHES_BY_LEVEL[plan.level];
  const keep = `${KEEP[strength]} Not their clothes: ${wardrobe}.`;
  const pose = by("pose")[0];
  const camera = by("pov")[0] ?? [by("framing")[0], by("angle")[0]].filter(Boolean).join(", ");
  const accessories = by("accessories");
  const middle = [
    pose ? `Pose: ${pose}.` : "",
    camera ? `Camera: ${camera}.` : "",
    accessories.length ? `Wearing ${accessories.join(", ")}.` : "",
    plan.place ? `The place: ${plan.place}.` : "",
    by("light")[0] ? `Light: ${by("light")[0]}.` : "",
    by("expression")[0] ? `Expression: ${by("expression")[0]}.` : "",
    "Only this one person in the picture, the face clearly visible.",
  ]
    .filter(Boolean)
    .join(" ");
  return fit([pictures, person, keep], middle, [TAIL[plan.level]]);
}

/** A prompt within STUDIO_PROMPT_MAX: the middle (the choices) is what gets cut short, at a word. */
function fit(before: string[], middle: string, after: string[]): string {
  const fixed = [...before, ...after].join(" ");
  const room = STUDIO_PROMPT_MAX - fixed.length - 2;
  const mid = middle.length <= room ? middle : middle.slice(0, Math.max(0, room)).replace(/\s+\S*$/, "");
  return [...before, mid, ...after].filter(Boolean).join(" ");
}

/** A restyle's prompt: the same person as Picture 1, only these looks changed, framed like a baseline (the face clear). */
export function restylePrompt(subject: Subject, changes: string[], light: string): string {
  const who = subject.noun === "person" ? "person" : subject.noun;
  const age = Math.max(IMAGE_MIN_AGE, Math.round(subject.age || IMAGE_MIN_AGE));
  return fit(
    [`Make one photograph of the same ${who} as in Picture 1, a ${age}-year-old adult: the same person, the same face and identity.`],
    `Change only this: ${changes.join("; ")}. Everything else as in Picture 1, the clothes too.`,
    [`Alone, waist-up, facing the camera, face clearly visible, ${light}, a plain background. Photorealistic. Everyone shown is an adult.`],
  );
}

/** A body reference's prompt: the person from Picture 1, head to toe, standing, plain backdrop; dressed, or nude (level 2). */
export function bodyPrompt(subject: Subject, nude: boolean): string {
  const who = subject.noun === "person" ? "person" : subject.noun;
  const age = Math.max(IMAGE_MIN_AGE, Math.round(subject.age || IMAGE_MIN_AGE));
  const worn = nude ? "fully nude" : (subject.outfit ?? "simple fitted everyday clothes");
  return [
    `Make one photograph of the ${who} from Picture 1, a ${age}-year-old adult.`,
    `Keep the same face, hair, skin tone and body${subject.look ? ` (${subject.look})` : ""}. Wearing ${worn}.`,
    "Full body, head to toe, standing straight and facing the camera, arms relaxed at the sides, against a plain light-grey studio backdrop, soft even light, the face clearly visible.",
    `${nude ? "Uncensored, photorealistic" : "Photorealistic"}. Everyone shown is an adult.`,
  ].join(" ");
}

/** The studio intensity's highest level (the pair limits' intensities, lib/adult/limits.ts INTENSITIES). */
export const LEVEL_FOR_INTENSITY: Record<string, Level> = { slow_burn: 0, flirty: 1, spicy: 2, explicit: 3, filthy: 3 };
