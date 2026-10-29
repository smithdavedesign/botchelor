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
import { cameraWords } from "./camera-moves";
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
  /** Filthy's own (the "filthy" group): open only at the Filthy studio intensity, never at Explicit. */
  filthy?: true;
  /** A first-person act with the viewer: the viewer may show at the frame's edge (never their face). */
  withViewer?: true;
};

export const GROUP_IDS = ["filthy", "pose", "framing", "angle", "pov", "wardrobe", "accessories", "place", "light", "expression"] as const;
export type GroupId = (typeof GROUP_IDS)[number];
export type StudioGroup = { id: GroupId; title: string; /** How many may be picked (1 when unset). */ multi?: number; options: readonly StudioOption[] };

const o = (id: string, label: string, words: string, level: Level = 0, more: Partial<StudioOption> = {}): StudioOption => ({ id, label, words, level, ...more });

/** A Filthy option: explicit, and open only at the Filthy studio intensity. */
const f = (id: string, label: string, words: string, more: Partial<StudioOption> = {}): StudioOption => ({ id, label, words, level: 3, filthy: true, ...more });

export const STUDIO_GROUPS: readonly StudioGroup[] = [
  {
    // David, 2026-10-24: "a filthy section for explicit", after seduced.com's and candy.ai's menus. One act, in place of
    // the pose; locked until their studio intensity is Filthy.
    id: "filthy",
    title: "Filthy",
    options: [
      f("spread_close", "Spread, up close", "lying back with her legs spread wide, her pussy on full display, the camera close between her thighs", {
        man: "lying back with his legs apart, his hard cock on full display, the camera close",
        person: "lying back with legs spread wide, everything on full display, the camera close between the thighs",
      }),
      f("fingering", "Fingers inside", "lying back, legs spread, two fingers inside herself, flushed and wet", {
        man: "lying back, gripping and stroking his hard cock, close and explicit",
        person: "lying back, legs spread, touching themselves explicitly, flushed",
      }),
      f("spreading", "Spreading open", "lying back, spreading her pussy open with her fingers for the camera", {
        man: "lying back, holding his hard cock up for the camera",
        person: "lying back, spreading themselves open with their fingers for the camera",
      }),
      f("dripping", "Dripping wet", "legs spread, glistening and dripping wet between her thighs", { man: "lying back, hard and leaking, glistening with oil", person: "legs spread, glistening and dripping wet" }),
      f("all_fours", "On all fours, from behind", "on all fours on the bed, back arched and ass raised, looking back at the camera, everything on show from behind", {
        man: "on all fours on the bed, back arched, looking back at the camera, everything on show from behind",
        person: "on all fours on the bed, back arched, looking back at the camera, everything on show from behind",
      }),
      f("face_down", "Face down, ass up", "face down on the bed, ass up high, back deeply arched, her pussy on show from behind", {
        man: "face down on the bed, hips raised high, back arched, on show from behind",
        person: "face down on the bed, hips raised high, back deeply arched, on show from behind",
      }),
      f("spread_behind", "Spread from behind", "kneeling face down, reaching back to spread her ass cheeks wide for the camera", {
        man: "kneeling face down, reaching back to spread his cheeks for the camera",
        person: "kneeling face down, reaching back to spread their cheeks wide for the camera",
      }),
      f("nipple_play", "Nipple play", "topless, pinching and teasing her hard nipples, lips parted", { man: "shirtless, teasing his own nipples, lips parted", person: "topless, teasing their hard nipples, lips parted" }),
      f("panties_down", "Panties coming off", "pulling her lace panties down her thighs, bent slightly forward, looking at the camera", {
        man: "pulling his briefs down, hard cock springing free, looking at the camera",
        person: "pulling their underwear down their thighs, looking at the camera",
      }),
      f("orgasm", "Mid-orgasm", "mid-orgasm, back arched, mouth open, eyes squeezed shut, one hand between her legs", {
        man: "mid-orgasm, back arched, mouth open, cumming over his stomach",
        person: "mid-orgasm, back arched, mouth open, eyes squeezed shut, one hand between the legs",
      }),
      f("squirting", "Squirting", "lying back with legs spread, squirting as she comes, legs shaking", { only: "woman" }),
      f("dildo_ride", "Riding a dildo", "squatting over a dildo fixed to the floor, sinking down onto it", {
        man: "lying back, using a sex toy on himself, explicit",
        person: "squatting over a dildo fixed to the floor, sinking down onto it",
        hardNos: ["toys"],
      }),
      f("plug", "With a plug", "on all fours, a jewelled butt plug in her ass, looking back at the camera", {
        man: "on all fours, a butt plug in his ass, looking back at the camera",
        person: "on all fours, a jewelled butt plug in, looking back at the camera",
        hardNos: ["anal", "toys"],
      }),
      f("cum_covered", "Covered in cum", "kneeling, cum across her chest and lips, licking her lips, looking up into the lens", {
        man: "lying back, his own cum across his stomach and chest, looking into the lens",
        person: "kneeling, cum across their chest and lips, looking up into the lens",
        hardNos: ["degradation"],
      }),
      f("pov_blowjob", "Sucking you (POV)", "a first-person view looking down: she has the viewer's cock in her mouth, looking up into the lens", {
        man: "a first-person view looking down: he has the viewer's cock in his mouth, looking up into the lens",
        person: "a first-person view looking down: they have the viewer in their mouth, looking up into the lens",
        hardNos: ["oral"],
        withViewer: true,
      }),
      f("pov_riding", "Riding you (POV)", "a first-person view from below: she rides the viewer's cock, hands on the viewer's chest, looking down into the lens", {
        man: "a first-person view from below: he rides the viewer, hands on the viewer's chest, looking down into the lens",
        person: "a first-person view from below: they ride the viewer, hands on the viewer's chest, looking down into the lens",
        withViewer: true,
      }),
      f("pov_behind", "From behind you (POV)", "a first-person view from behind: she's on all fours being fucked by the viewer, looking back over her shoulder", {
        only: "woman",
        withViewer: true,
      }),
      f("pov_under", "Under you (POV)", "a first-person view from above: she lies back with her legs wrapped round the viewer as they fuck, looking up into the lens", {
        man: "a first-person view from above: he lies back with his legs wrapped round the viewer as they fuck, looking up into the lens",
        person: "a first-person view from above: they lie back with legs wrapped round the viewer as they fuck, looking up into the lens",
        withViewer: true,
      }),
    ],
  },
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

/**
 * A shoot's choices: one option per group (accessories: up to three), each optional. `custom` is the owner's own words
 * (docs/PRDs/reel-storyboard.md; David, 2026-10-24: "need it to actually use the input"): a freeform direction that
 * leads the prompt, so a picked act or look actually happens. `extra` adds the owner's words to a single section on top
 * of its tile. Both are held to the same lines as the tiles (crossesTaboo, checkAdultText) and the output is still
 * age-checked.
 */
export type ShootChoices = Partial<Record<Exclude<GroupId, "accessories">, string>> & {
  accessories?: string[];
  custom?: string;
  extra?: Partial<Record<GroupId, string>>;
  /** A short line for a speech bubble on the picture (David, 2026-10-24: "another if we want dialog"); how it reads depends on the model. */
  dialog?: string;
};

/** The most the owner's own words can run, in each custom field. */
export const CUSTOM_MAX = 400;
export const EXTRA_MAX = 120;
export const DIALOG_MAX = 200;
export const TRANSCRIPT_MAX = 600;
/** The owner's words, trimmed and capped; empty becomes nothing. */
export const cleanCustom = (s: string | undefined, max: number): string | undefined => {
  const t = (s ?? "").trim().replace(/\s+/g, " ").slice(0, max);
  return t || undefined;
};

/**
 * The Together tab's sections, each with the owner's own words on top of its chip (David, 2026-10-25: "a custom prompt
 * to each field like we do for the shoot tab"), named the way the prompt reads them.
 */
export const PAIR_SECTIONS = { act: "what they're doing", outfit: "what they wear", framing: "framing", place: "place", light: "light" } as const;
export type PairSection = keyof typeof PAIR_SECTIONS;
export type PairExtra = Partial<Record<PairSection, string>>;

/** A pair shoot's per-section words as one line for the prompt, like the Shoot tab's ("Also — place: …; light: …."). */
export function pairExtraWords(extra: PairExtra | undefined): string {
  const parts = (Object.keys(PAIR_SECTIONS) as PairSection[]).map((k) => {
    const w = cleanCustom(extra?.[k], EXTRA_MAX);
    return w ? `${PAIR_SECTIONS[k]}: ${w.replace(/[.\s]*$/, "")}` : "";
  });
  const said = parts.filter(Boolean);
  return said.length ? `Also — ${said.join("; ")}.` : "";
}

/** What a shoot is held to: the highest level it may reach, its hard nos, and the options switched off. */
export type ShootLimits = { maxLevel: Level; hardNos: readonly string[]; disabled: ReadonlySet<string>; pov: boolean; /** The Filthy intensity: Filthy's own options open. */ filthy?: boolean };

/** Why an option isn't on the menu for this viewer (null: it is). */
export function optionLocked(group: GroupId, opt: StudioOption, limits: ShootLimits, noun: Noun): string | null {
  if (limits.disabled.has(`${group}.${opt.id}`)) return "Switched off in the settings.";
  if (group === "pov" && !limits.pov) return "POV is switched off in the settings.";
  if (opt.only && noun !== "person" && opt.only !== noun) return `Only for a ${opt.only}.`;
  if (opt.level > limits.maxLevel) return `Past ${LEVEL_LABEL[limits.maxLevel].toLowerCase()}: their studio limit.`;
  if (opt.filthy && !limits.filthy) return "Filthy only: set their studio intensity to Filthy (Identity).";
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
export type ShootPlan = { level: Level; place: string | null; placePublic: boolean; parts: { group: GroupId; words: string; /** A first-person act with the viewer. */ viewer?: true }[]; custom?: string; extra?: Partial<Record<GroupId, string>>; dialog?: string };

export type PlanResult = { ok: true; plan: ShootPlan } | { ok: false; error: string; message: string };

/**
 * Plans a shoot from its choices: every option known and on the viewer's menu, the level the highest choice's, nothing
 * past suggestive in a public place, at most three accessories, and nude needs a private place. A place of their own
 * (`ownPlace`, the name of a drawn set) is private unless `ownPublic`.
 */
export function planShoot(choices: ShootChoices, limits: ShootLimits, subject: Subject, own: { place?: string | null; public?: boolean } = {}): PlanResult {
  const no = (error: string, message: string): PlanResult => ({ ok: false, error, message });
  const parts: ShootPlan["parts"] = [];
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
    parts.push(opt.withViewer ? { group, words, viewer: true } : { group, words });
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
  // The owner's own words: the overall direction, and anything added to a single section. Taboo in them is caught by the
  // caller's wordsOk, like the tiles', and the picture is still age-checked.
  const custom = cleanCustom(choices.custom, CUSTOM_MAX);
  const extraEntries = Object.entries(choices.extra ?? {})
    .map(([g, v]) => [g, cleanCustom(v, EXTRA_MAX)] as const)
    .filter(([g, v]) => Boolean(v) && (GROUP_IDS as readonly string[]).includes(g));
  const extra = extraEntries.length ? (Object.fromEntries(extraEntries) as Partial<Record<GroupId, string>>) : undefined;
  const dialog = cleanCustom(choices.dialog, DIALOG_MAX);
  return { ok: true, plan: { level, place, placePublic, parts, ...(custom ? { custom } : {}), ...(extra ? { extra } : {}), ...(dialog ? { dialog } : {}) } };
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
export function shootPrompt(plan: ShootPlan, subject: Subject, refs: { body: boolean; set: boolean; angle?: number }, strength: Strength = "balanced"): string {
  const who = subject.noun === "person" ? "person" : subject.noun;
  const pictures = [
    `Make one photograph of the ${who} from Picture 1`,
    refs.body ? ", with the body from Picture 2" : "",
    refs.set ? `, in the place from Picture ${refs.body ? 3 : 2}` : "",
    ".",
    // An extra angle of the face (their identity pack, lib/studio/identity-views.ts): the same person, never a second.
    refs.angle ? ` Picture ${refs.angle} is the same ${who}'s face from another angle: the same person, not someone else in the picture.` : "",
  ].join("");
  const age = Math.max(IMAGE_MIN_AGE, Math.round(subject.age || IMAGE_MIN_AGE));
  const person = `A ${age}-year-old adult ${who}${subject.look ? `, ${subject.look}` : ""}.`;
  const by = (g: GroupId) => plan.parts.filter((p) => p.group === g).map((p) => p.words);
  const wardrobe = by("wardrobe")[0] ?? CLOTHES_BY_LEVEL[plan.level];
  // Picture 1 is the face to keep (David, 2026-10-24: "the face wasn't quite the baseline; provide a headshot as context,
  // then let the rest override"): the directions change the pose, body, clothes and scene, never the face.
  const keep = `${KEEP[strength]} Not their clothes: ${wardrobe}. Picture 1 is the face to keep: the very same face, features and likeness, unchanged — the directions change the pose, body, clothes and scene, never the face.`;
  // A Filthy act is the pose (it wins over one picked too); a first-person one may show the viewer at the edge.
  const act = plan.parts.find((p) => p.group === "filthy");
  const pose = act?.words ?? by("pose")[0];
  const camera = by("pov")[0] ?? [by("framing")[0], by("angle")[0]].filter(Boolean).join(", ");
  const accessories = by("accessories");
  // The owner's own words added to a single section (studio-catalog.ts ShootChoices.extra), each named by its section.
  const extras = GROUP_IDS.map((g) => (plan.extra?.[g] ? `${groupById(g).title.toLowerCase()}: ${plan.extra[g]}` : "")).filter(Boolean);
  const middle = [
    // The owner's own words lead, so what they asked for actually happens (David, 2026-10-24: "use the input").
    plan.custom ? `Most important, do exactly this: ${plan.custom.replace(/[.\s]*$/, "")}.` : "",
    pose ? `${act ? "What's happening" : "Pose"}: ${pose}.` : "",
    camera && !act?.viewer ? `Camera: ${camera}.` : "",
    accessories.length ? `Wearing ${accessories.join(", ")}.` : "",
    plan.place ? `The place: ${plan.place}.` : "",
    by("light")[0] ? `Light: ${by("light")[0]}.` : "",
    by("expression")[0] ? `Expression: ${by("expression")[0]}.` : "",
    plan.dialog ? `A speech bubble near them reads: "${plan.dialog.replace(/"/g, "'")}".` : "",
    extras.length ? `Also — ${extras.join("; ")}.` : "",
    act?.viewer
      ? "Only this one person in full: of the viewer, at most hands, hips or legs at the edge of the frame, never a face. Their face clearly visible."
      : "Only this one person in the picture, the face clearly visible.",
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

/** What makes each picture of "More like this" differ from the one it's like, in turn. */
export const VARIATION_HINTS = [
  "the pose shifted slightly",
  "the camera moved slightly to one side",
  "a moment later, the expression changed slightly",
  "the camera slightly closer",
] as const;

/**
 * "More like this": the person from Picture 1 (with the body from Picture 2, when it's sent) as in the picture it's like,
 * the last one sent, slightly different. The level is that picture's, so the closing words are the same.
 */
export function variationPrompt(subject: Subject, level: Level, refs: { body: boolean }, hint: string, strength: Strength = "balanced"): string {
  const who = subject.noun === "person" ? "person" : subject.noun;
  const like = refs.body ? 3 : 2;
  const age = Math.max(IMAGE_MIN_AGE, Math.round(subject.age || IMAGE_MIN_AGE));
  return fit(
    [`Make one photograph of the ${who} from Picture 1${refs.body ? ", with the body from Picture 2" : ""}, like Picture ${like}.`, `A ${age}-year-old adult ${who}${subject.look ? `, ${subject.look}` : ""}.`, KEEP[strength]],
    `The same clothes (or none), place, light and framing as Picture ${like}, with ${hint}. Only this one person in the picture, the face clearly visible.`,
    [TAIL[level]],
  );
}

/**
 * A carousel (the creator suite, 2026-10-26): the very moment of one of their pictures from six camera angles, a set to
 * post together. Angles a photographer walks round to, never a new pose: the pose, clothes (or none), place and light
 * stay that picture's.
 */
export const CAROUSEL_ANGLES = [
  "in a wide shot from across the room, the whole scene in frame",
  "from the side, at eye level",
  "in a close-up from just above, the face and shoulders",
  "from a low angle, looking up",
  "from behind and to one side, looking back over the shoulder at the camera",
  "in a medium shot, the camera turned slightly, natural and candid",
] as const;

/** One of a carousel's pictures: the person from Picture 1 (the body from Picture 2) at the moment in the last one, seen from `angle`. */
export function carouselPrompt(subject: Subject, level: Level, refs: { body: boolean }, angle: string, strength: Strength = "balanced"): string {
  const who = subject.noun === "person" ? "person" : subject.noun;
  const like = refs.body ? 3 : 2;
  const age = Math.max(IMAGE_MIN_AGE, Math.round(subject.age || IMAGE_MIN_AGE));
  return fit(
    [`Make one photograph of the ${who} from Picture 1${refs.body ? ", with the body from Picture 2" : ""}, at the very moment in Picture ${like}.`, `A ${age}-year-old adult ${who}${subject.look ? `, ${subject.look}` : ""}.`, KEEP[strength]],
    `The same pose, clothes (or none), place and light as Picture ${like}, seen ${angle}. Only this one person in the picture, the face clearly visible.`,
    [TAIL[level]],
  );
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

/**
 * A face anchor's prompt: a tight head-and-shoulders close-up of the person from Picture 1, the same face unchanged, so
 * it can lead every shoot as the identity to keep (lib/adult/studio.ts ensureFaceCrop; David, 2026-10-24). Made once.
 */
export function headshotPrompt(subject: Subject): string {
  const who = subject.noun === "person" ? "person" : subject.noun;
  const age = Math.max(IMAGE_MIN_AGE, Math.round(subject.age || IMAGE_MIN_AGE));
  return [
    `Make one photograph of the ${who} from Picture 1, a ${age}-year-old adult: the very same face, features, hair and skin tone, unchanged.`,
    "A tight head-and-shoulders close-up, the face filling the frame, looking straight at the camera, sharp focus on the face, a plain light-grey studio backdrop, soft even light.",
    "Dressed. Photorealistic. Everyone shown is an adult.",
  ].join(" ");
}

/* ------------------------------------------------- animate (v3) ------------------------------------------------- */

/** How a picture moves when it's animated (v3): one chip, fixed words, nothing typed. `disabled_options` takes "motion.<id>". */
export const ANIMATE_MOTIONS: readonly { id: string; label: string; words: string }[] = [
  { id: "breathe", label: "Just breathing", words: "stays where they are, breathing slowly, a small smile, hair moving slightly" },
  { id: "sway", label: "Sway", words: "sways slowly, shifting their weight from one hip to the other" },
  { id: "turn", label: "Turn to camera", words: "turns slowly to face the camera and holds its gaze" },
  { id: "walk", label: "Walk toward you", words: "walks slowly toward the camera, eyes on it" },
  { id: "spin", label: "A slow spin", words: "turns in one slow, full spin, then faces the camera again" },
  { id: "lie_back", label: "Lie back", words: "lies back slowly and settles, looking at the camera" },
];
export const ANIMATE_SECONDS = [5, 10] as const;
export type AnimateSeconds = (typeof ANIMATE_SECONDS)[number];

/** The owner's guidance for a clip (David, 2026-10-24: "guide it again if it messed up"). */
export type AnimateGuide = { guide?: string; dialog?: string; transcript?: string };
/**
 * A Studio picture's clip prompt: the one person in it, kept exactly as they are, one steady shot; the level is the
 * picture's. The owner can guide it (David, 2026-10-24): `guide` leads, so what they ask for happens; `dialog` is what
 * they say (their lips move); `transcript` is the lines around this moment, for the mood. A motion chip is optional once
 * there's a guide. The guide, dialog and transcript are held to the lines by the caller and the clip is Hive-checked.
 */
export function animatePrompt(subject: Pick<Subject, "noun">, level: Level, motion: string, g: AnimateGuide = {}, opts: { pair?: boolean; camera?: string | null } = {}): string {
  const who = subject.noun === "person" ? "person" : subject.noun;
  const them = opts.pair ? "two people" : who;
  const guide = cleanCustom(g.guide, CUSTOM_MAX);
  const dialog = cleanCustom(g.dialog, DIALOG_MAX);
  const transcript = cleanCustom(g.transcript, TRANSCRIPT_MAX);
  const middle = [
    guide ? `Most important, do exactly this: ${guide.replace(/[.\s]*$/, "")}.` : "",
    motion ? `The ${them} in the picture ${motion}.` : guide ? "" : `The ${them} in the picture ${opts.pair ? "move together slowly" : "breathe slowly, a small smile"}.`,
    dialog ? `They say, their lips moving: "${dialog.replace(/"/g, "'")}".` : "",
    transcript ? `For the mood, this is what's being said around this moment: ${transcript}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return fit(
    [],
    middle,
    [
      opts.pair
        ? "Only these two people, exactly as in the picture: the same two faces, bodies and clothes (or none), together, in the same place and light."
        : "Only this one person, exactly as in the picture: the same face, body and clothes (or none), in the same place and light.",
      // Keep the face steady through the clip (David, 2026-10-24: the face drifted from the baseline in the video).
      `Keep the ${opts.pair ? "same two faces" : "same face"} throughout, frame to frame — the very same features, never changing or morphing.`,
      // How the camera moves (lib/adult/camera-moves.ts): steady unless a move was picked.
      `One continuous shot, ${cameraWords(opts.camera)}: no cuts, nobody new comes in. Realistic, unhurried motion.`,
      TAIL[level],
    ],
  );
}

/** The studio intensity's highest level (the pair limits' intensities, lib/adult/limits.ts INTENSITIES). */
export const LEVEL_FOR_INTENSITY: Record<string, Level> = { slow_burn: 0, flirty: 1, spicy: 2, explicit: 3, filthy: 3 };
