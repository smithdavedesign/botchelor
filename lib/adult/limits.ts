/**
 * The viewer's limits for a pair in After Dark (David, 2026-10-22, from the competitor analysis): an intensity dial and
 * a hard-no list, set per owner and pair (adult_scenes.intensity, .hard_nos) and held by every step, every steer
 * (Nudge, Direct and a whisper alike) and every suggested next move. Pure: no database, no model.
 *
 *  - Intensity: slow burn, flirty, spicy or explicit (the default, After Dark as it was). Each has a furthest stage (a
 *    line that shows more is dropped, and the stage never climbs past it, a Direct steer included) and a register for
 *    the prompt; below explicit, crude words are out too.
 *  - Hard nos: a curated set of common hard limits (HARD_NOS), each a never-cross rule for the prompt and a check on
 *    every line, plus up to OWN_MAX of the viewer's own (OWN_LEN characters each), matched by their words. A line that
 *    hits one is dropped and the step asked once more (lib/adult/scenes.ts writeSceneStep); a steer or whisper that asks
 *    for one is refused.
 */
import { STAGES } from "./stages";
import { stageShown } from "./stage-floor";

export const INTENSITIES = ["slow_burn", "flirty", "spicy", "explicit"] as const;
export type Intensity = (typeof INTENSITIES)[number];
export const DEFAULT_INTENSITY: Intensity = "explicit";

const KISSING = STAGES.indexOf("kissing");
const UNDRESSING = STAGES.indexOf("undressing");
const LAST = STAGES.length - 1;

export const INTENSITY: Record<Intensity, { label: string; blurb: string; maxStage: number; register: string | null }> = {
  slow_burn: {
    label: "Slow burn",
    blurb: "Looks, nerves and a kiss at most",
    maxStage: KISSING,
    register:
      "Keep it a slow burn: tender and suggestive, the heat in looks, pauses and what's left unsaid. Nothing explicit and no body parts named; it goes no further than kissing.",
  },
  flirty: {
    label: "Flirty",
    blurb: "Playful and teasing, as far as undressing",
    maxStage: UNDRESSING,
    register:
      "Keep it flirty: playful, teasing and sensual, never graphic and never crude. It can go as far as undressing; anything past that is only ever implied, never written.",
  },
  spicy: {
    label: "Spicy",
    blurb: "Steamy, sex included, nothing graphic or crude",
    maxStage: LAST,
    register: "Keep it spicy: steamy and sensual, sex included, written with heat but without graphic anatomical detail or crude words.",
  },
  explicit: { label: "Explicit", blurb: "Frank and explicit (the default)", maxStage: LAST, register: null },
};

export const intensityOf = (v: unknown): Intensity => (INTENSITIES.includes(v as Intensity) ? (v as Intensity) : DEFAULT_INTENSITY);

/** Crude words, out below explicit (and the "dirty talk" hard no, in what they say). */
const CRUDE = /\b(cocks?|dicks?|puss(y|ies)|cunts?|clits?|tits|cum|cumming|fuck(s|ed|ing|in)?|sluts?|whores?)\b/;

/** The text as the checks read it: lower case, plain apostrophes. */
const norm = (text: string) => text.toLowerCase().replace(/[’‘`]/g, "'");
/** What a line says, its *actions* out. */
const said = (text: string) => norm(text).replace(/\*[^*]*\*/g, " ");

/** Why a text goes past the intensity (a stage further than it allows, or crude words below explicit), or null. */
export function overIntensity(text: string, intensity: Intensity): string | null {
  const level = INTENSITY[intensity];
  const shown = stageShown(text);
  if (shown !== null && shown > level.maxStage) return `went past ${STAGES[level.maxStage]} (the intensity is ${level.label.toLowerCase()})`;
  if (intensity !== "explicit" && CRUDE.test(norm(text))) return `too crude for ${level.label.toLowerCase()}`;
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Hard nos
// ---------------------------------------------------------------------------------------------------------------------

type HardNo = { id: string; label: string; rule: string; match: RegExp; speechOnly?: true };

/** Common hard limits in adult roleplay, each as the prompt says it and as a line shows it. */
export const HARD_NOS: readonly HardNo[] = [
  {
    id: "pain",
    label: "Pain",
    rule: "No pain: nobody is hit, slapped, spanked, whipped or hurt, and nobody asks to be.",
    match: /\b(slap(s|ped|ping)?|spank\w*|whip(s|ped|ping)?\b|smack(s|ed|ing)?|paddl\w*|flog\w*|hurt(s|ing)? (me|you|her|him)|make it hurt|pain(ful|fully)?)\b/,
  },
  {
    id: "choking",
    label: "Choking",
    rule: "No choking or breath play: no hand on a throat, nothing round a neck, nobody's breath held back.",
    match:
      /\b(chok(e|es|ed|ing)\b(?!\s+(back|up|on\s+(a|the|her|his|my|your)\s+(laugh|word|words|tears?|sob|drink|wine|tea|coffee|water)))|strangl\w*|throttl\w*|breath ?play|(hand|hands|fingers|grip)\b[^.!?*]{0,24}\bthroat\b|(squeez|press|grip|tighten)\w*\b[^.!?*]{0,16}\b(throat|neck)\b)/,
  },
  {
    id: "degradation",
    label: "Degradation",
    rule: "No degradation or humiliation: no insults, no being called names like slut or whore, nobody made small.",
    match: /\b(sluts?|slutty|whores?|bitch(es)?|worthless|humiliat\w*|degrad\w*|good for nothing|filthy (girl|boy|thing|little)|you're nothing|use me like)\b/,
  },
  {
    id: "anal",
    label: "Anal",
    rule: "Nothing anal.",
    match: /\b(anal|anus|assholes?|butt ?plugs?|rimm\w*|pegg\w*|(in|into|inside|up) (her|his|my|your) (ass|arse|butt)\b|fuck(s|ing|ed)? (her|his|my|your) (ass|arse))/,
  },
  {
    id: "oral",
    label: "Oral",
    rule: "No oral sex: nobody goes down on anyone.",
    match:
      /\b(oral|blow ?jobs?|go(es|ing)? down on|went down on|eat(s|ing)? (her|him|me|you) out|cunnilingus|fellatio|sixty-?nine|face ?sit\w*|sit(s|ting)? on (her|his|my|your) face|rid(e|es|ing) (her|his|my|your) face|(suck|sucks|sucking|lick|licks|licking|tongue|tongues) (his|her|my|your) (cock|dick|clit|pussy|length|shaft))\b/,
  },
  {
    id: "restraints",
    label: "Restraints",
    rule: "No restraints: nobody tied up, cuffed, gagged, blindfolded or pinned down by the wrists.",
    match:
      /\b(tie[sd]? (her|him|me|you|them) up|tied up|tying (her|him|me|you) up|handcuff\w*|cuffed|zip ?ties?|blindfold\w*|restrain\w*|bound (to|by)|ball gag|gag(s|ged|ging)? (her|him|me|you)|pin(s|ned|ning)? (her|his|my|your) (wrists|arms|hands))\b/,
  },
  {
    id: "rough",
    label: "Rough sex",
    rule: "Nothing rough: no pounding, slamming, manhandling or rough handling.",
    match: /\b(rough (sex|with (her|him|me|you))|manhandl\w*|pound(s|ed|ing)? (into|her|him|me|you)|slam(s|med|ming)? (her|him|me|you|into)|ram(s|med|ming)? (into|it in))\b/,
  },
  {
    id: "hair_pulling",
    label: "Hair pulling",
    rule: "No hair pulling.",
    match: /\b(pull(s|ed|ing)? (her|his|my|your) hair|hair[- ]pull\w*|yank\w* (her|his|my|your) hair|(fists?|fisting|fisted|twists?|twisting) (a hand )?(in|into) (her|his|my|your) hair|grab(s|bed|bing)? (a fistful of )?(her|his|my|your) hair)\b/,
  },
  {
    id: "biting",
    label: "Biting",
    rule: "No biting: not a neck, a shoulder, a lip or anywhere else.",
    match: /\b(bit(e|es|ing)|bitten|nip(s|ped|ping)?) (into |down on |at )?(his|her|my|your) (neck|shoulder|ear|earlobe|nipples?|thigh|skin|lip|lips|throat)\b/,
  },
  { id: "spitting", label: "Spitting", rule: "No spitting.", match: /\bspit(s|ting)?\b/ },
  {
    id: "dirty_talk",
    label: "Dirty talk",
    rule: "No dirty talk: what they say stays tender or playful, never crude or graphic, whatever they do.",
    match: CRUDE,
    speechOnly: true,
  },
  {
    id: "cheating",
    label: "Cheating talk",
    rule: "No cheating talk: no partners at home, no affairs, nobody betrayed or kept in the dark.",
    match: /\b(cheat(s|ing|ed|er|ers)?|affairs?|(my|your|her|his) (wife|husband|girlfriend|boyfriend|fianc[eé]e?)|behind (her|his|my|your) back|mistress|unfaithful|adulter\w*|home-?wreck\w*)\b/,
  },
  {
    id: "pregnancy",
    label: "Pregnancy talk",
    rule: "No pregnancy talk: nothing about getting anyone pregnant, breeding or going without protection.",
    match: /\b(pregnan\w*|breed(s|ing)?\b|knock(s|ed|ing)? (you|me|her) up|cream ?pie|without (a )?(condom|protection)|no condom)\b/,
  },
  {
    id: "toys",
    label: "Toys",
    rule: "No toys: no vibrators, dildos, plugs or straps.",
    match: /\b(sex toys?|vibrators?|dildos?|strap-?ons?|wand vibrator|butt plugs?)\b/,
  },
  {
    id: "dominance",
    label: "Dom and sub",
    rule: "No dominance or submission play: no orders to obey, no sir or master, no good girl or good boy.",
    match: /\b(good (girl|boy)|obey(s|ed|ing)?|on your knees|yes,? (sir|master|mistress|ma'am)|master\b|submissive|submit(s|ted)? to|dominat\w*|you'll do as (i say|you're told))\b/,
  },
  {
    id: "watched",
    label: "Being watched",
    rule: "Nothing exhibitionist: nobody watches them or could, and neither wants to be seen.",
    match: /\b(watch(es|ing)? us|being watched|let (them|people|everyone) (see|watch)|in front of (everyone|them all|people|strangers)|someone (might|could) (see|walk in)|exhibition\w*)\b/,
  },
];
export const HARD_NO_IDS = HARD_NOS.map((h) => h.id);

/** Own hard nos: this many, each this long, at most. */
export const OWN_MAX = 8;
export const OWN_LEN = 40;

export type HardNos = { chips: string[]; own: string[] };
export type PairLimits = { intensity: Intensity; hard_nos: HardNos };
export const NO_LIMITS: PairLimits = { intensity: DEFAULT_INTENSITY, hard_nos: { chips: [], own: [] } };

/** Hard nos as stored (adult_scenes.hard_nos): only known chips, only own items that fit. */
export function storedHardNos(v: unknown): HardNos {
  const x = (v && typeof v === "object" ? v : {}) as { chips?: unknown; own?: unknown };
  const chips = Array.isArray(x.chips) ? [...new Set(x.chips.filter((c): c is string => typeof c === "string" && HARD_NO_IDS.includes(c)))] : [];
  const own = Array.isArray(x.own) ? x.own.filter((o): o is string => typeof o === "string" && Boolean(o.trim())).map((o) => o.trim().slice(0, OWN_LEN)).slice(0, OWN_MAX) : [];
  return { chips, own };
}

/** Words that say nothing on their own in a hard no ("no", "being", "any"), so they're never what's matched. */
const FILLER = new Set(
  "no not never nothing none any anything being be been get gets getting got let lets about with without from into onto for the a an of to in on at my your his her their our me him them us it its this that these those some more less please don't dont do does doing done talk talking said say says".split(" "),
);

/** A light stem: spanking → spank, kissed → kiss, wrists → wrist, lashes → lash. */
export function stemOf(w: string): string {
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 4 && /(ss|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}
const wordsOf = (text: string) => norm(text).replace(/[^\p{L}\p{N}' ]+/gu, " ").split(/\s+/).filter(Boolean).map((w) => w.replace(/'s$/, ""));

/** The words of one of the viewer's own hard nos that a line has to show (filler out), as stems. */
export function ownWords(item: string): string[] {
  return [...new Set(wordsOf(item).filter((w) => !FILLER.has(w)).map(stemOf))];
}

/**
 * Whether a line shows one of the viewer's own hard nos: every word of it, by stem (biting → bite, bites, biting), and a
 * stem of four letters or more as the start of a word too (spank → spanked, spanking).
 */
export function hitsOwn(text: string, item: string): boolean {
  const words = ownWords(item);
  if (!words.length) return false;
  const line = wordsOf(text).map((w) => ({ w, stem: stemOf(w) }));
  return words.every((x) => {
    const forms = new Set([x, `${x}e`]);
    return line.some((l) => forms.has(l.stem) || forms.has(l.w) || (x.length >= 4 && l.w.startsWith(x)));
  });
}

/** The first hard no a text crosses: its label, or null. */
export function hardNoHit(text: string, limits: HardNos): string | null {
  for (const id of limits.chips) {
    const h = HARD_NOS.find((x) => x.id === id);
    if (h && h.match.test(h.speechOnly ? said(text) : norm(text))) return h.label;
  }
  for (const item of limits.own) if (hitsOwn(text, item)) return `"${item}"`;
  return null;
}

/** Why a text can't be used under these limits (a hard no it crosses, or past the intensity), or null. */
export function limitsHit(text: string, limits: PairLimits): string | null {
  const hard = hardNoHit(text, limits.hard_nos);
  if (hard) return `crossed a hard limit (${hard})`;
  return overIntensity(text, limits.intensity);
}

export const hasHardNos = (h: HardNos): boolean => h.chips.length + h.own.length > 0;

/** The hard nos as the prompt says them: never-cross rules that hold over every steer. Empty when there are none. */
export function hardNoLines(h: HardNos): string[] {
  if (!hasHardNos(h)) return [];
  return [
    "Hard limits the viewer has set for these two. They hold over every steer (a nudge, a direct steer, a whisper) and are never crossed, offered or asked for, in a line, an action or a suggestion:",
    ...h.chips.map((id) => `- ${HARD_NOS.find((x) => x.id === id)?.rule ?? id}`),
    ...h.own.map((o) => `- Never: ${o}.`),
  ];
}

/** The intensity as the prompt says it: its register and how far tonight goes. Null for explicit (the prompt as it was). */
export function intensityLine(intensity: Intensity): string | null {
  const level = INTENSITY[intensity];
  return level.register;
}
