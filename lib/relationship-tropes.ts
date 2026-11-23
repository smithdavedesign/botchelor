/**
 * The relationship trope generator (app/tools/relationship-trope-generator): romance tropes for a ship, six at a time,
 * by mood.
 *
 * Pure and deterministic, like the place and OC name generators (lib/place-names.ts, lib/oc-names.ts): no model, no
 * randomness, no database. A mood and a batch number always give the same six tropes, so every page is a link anyone
 * can share. Each trope is hand-written: its name (a generic genre term, never one book's, show's, film's, game's or
 * fandom's), how it goes in a line, its mood, and a first scene with {A} and {B} where the two characters go.
 *
 * Two names are optional. With them, every first scene reads with the names in; a name the content filter refuses
 * (lib/safety.ts), or one that isn't a name, is "A" or "B" instead and never shown back.
 *
 * Added 2026-11-23: the ship tools are the only pages search sends people to, and people who ship characters also
 * search for "relationship trope generator", "romance trope generator" and "random trope generator".
 */
import { seeded } from "./oc-name-pools";
import { checkFields } from "./safety";
import { readName, SHIP_NAME_MAX, shipHref } from "./ship-names";

export const TROPES_PATH = "/tools/relationship-trope-generator";
/** How many tropes one page shows. */
export const TROPES_SHOWN = 6;
/** The highest batch an address takes; past it the batch number wraps around. */
export const TROPES_MAX_BATCH = 999;
/** The longest name the form takes (the ship name generator's, so a name carries over to its ship names). */
export const TROPE_NAME_MAX = SHIP_NAME_MAX;

export const TROPE_MOODS = ["sweet", "slow-burn", "angsty", "funny", "flirty"] as const;
export type TropeMood = (typeof TROPE_MOODS)[number];

export type Trope = {
  /** Its address-safe name, unique across the pool. */
  id: string;
  name: string;
  /** How it goes, in a line. */
  how: string;
  mood: TropeMood;
  /** The first scene, with {A} and {B} where the two characters go. */
  scene: string;
};

export const TROPE_MOOD_INFO: Record<TropeMood, { label: string; title: string; blurb: string }> = {
  sweet: {
    label: "Sweet",
    title: "Sweet romance trope generator",
    blurb: "Soft, warm tropes for a ship that makes people smile: childhood friends, meet-cutes, pen pals and small towns.",
  },
  "slow-burn": {
    label: "Slow burn",
    title: "Slow burn trope generator",
    blurb: "Tropes that take their time: enemies to lovers, mutual pining, forced proximity and a great deal of almost.",
  },
  angsty: {
    label: "Angsty",
    title: "Angst trope generator",
    blurb: "Tropes that hurt in the best way: second chances, star-crossed lovers, hurt/comfort and the things left unsaid.",
  },
  funny: {
    label: "Funny",
    title: "Rom-com trope generator",
    blurb: "Tropes for a ship that bickers: fake dating, grumpy/sunshine, rival shops and a text sent to the wrong number.",
  },
  flirty: {
    label: "Flirty",
    title: "Flirty romance trope generator",
    blurb: "Spicy, but PG: only one bed, a cover kiss, a slow dance and a jealous look across a crowded room.",
  },
};

const t = (mood: TropeMood, name: string, how: string, scene: string): Trope => ({
  id: name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, ""),
  name,
  how,
  mood,
  scene,
});

/** Every trope, twelve a mood. Generic genre terms only. */
export const TROPES: readonly Trope[] = [
  // Sweet
  t("sweet", "Childhood friends to lovers", "They've known each other forever, and one day it's suddenly different.", "{A} finds the friendship bracelet {B} made them when they were nine, still in a drawer, and doesn't say a word."),
  t("sweet", "Friends to lovers", "The person who knows them best was right there the whole time.", "{B} falls asleep on {A}'s shoulder during movie night, and {A} doesn't move for two hours."),
  t("sweet", "Meet-cute", "A chance collision neither of them can stop thinking about.", "{A} and {B} reach for the last copy of the same book at the same second."),
  t("sweet", "Small-town romance", "A slower life, a nosy town, and someone worth staying for.", "{A} is new in town, and {B} is the only one at the bakery who doesn't already know their whole story."),
  t("sweet", "Secret admirer", "Someone has been leaving notes, and the handwriting looks familiar.", "{B} finds a third unsigned note in their locker and starts comparing handwriting, beginning with {A}'s."),
  t("sweet", "Found family", "A group of misfits who chose each other, and two of them falling for each other inside it.", "{A} and {B} are the last two awake after the group's holiday dinner, doing the dishes and not hurrying."),
  t("sweet", "Pen pals", "They fell for each other's words before they ever met.", "{A} finally meets their pen pal at the station, and it's {B}, who they already know and can't stand."),
  t("sweet", "Next-door neighbours", "They share a wall, then a hallway, then slowly everything else.", "{A}'s parcels keep turning up at {B}'s door, and {B} keeps bringing them over with two coffees."),
  t("sweet", "Holiday romance", "A festive season, one shared tradition, and a reason to stay.", "{A} and {B} are stuck judging the town's holiday cookie contest together, and they disagree on every cookie."),
  t("sweet", "Soft only for them", "Cold to the whole world, except the one person they're gentle with.", "Everyone is a little scared of {A}, right up until they watch {A} save the last slice of cake for {B}."),
  t("sweet", "Teach me", "One teaches the other a skill, and they both learn something else.", "{A} agrees to teach {B} to cook before {B}'s family visits, with three weeks to go and no talent at all."),
  t("sweet", "Soulmates", "The world keeps putting them in the same place until they notice.", "{A} and {B} keep turning up at the same places all week, until it stops looking like a coincidence."),
  // Slow burn
  t("slow-burn", "Slow burn", "A hundred small moments before anyone says a word.", "{A} and {B} have worked side by side for a year, and today {A} notices that {B} remembered how they take their tea."),
  t("slow-burn", "Mutual pining", "Both are hopelessly in love, and each is sure the other isn't.", "{A} and {B} each ask the same friend, on the same day, whether the other one is seeing anyone."),
  t("slow-burn", "Enemies to lovers", "They can't stand each other, until they can't stand being apart.", "{A} and {B} are made to share an office after years of trying to beat each other at everything."),
  t("slow-burn", "Coworkers to lovers", "They share a desk, a deadline and a growing problem.", "{A} and {B} are the last two left in the office the night before the big launch."),
  t("slow-burn", "Forced proximity", "Stuck together, with nowhere to go and nothing to do but talk.", "A storm closes the roads, and {A} and {B} are stranded at the same tiny inn for three days."),
  t("slow-burn", "Road trip", "A long drive, one shared playlist, and too many hours to avoid the truth.", "{A} needs a ride across the country, and {B} is the only one they know with a car."),
  t("slow-burn", "Bodyguard romance", "Keeping someone safe means never leaving their side.", "{B} is hired to protect {A}, who has made it very clear they don't want protecting."),
  t("slow-burn", "Will they, won't they", "Everyone can see it except the two of them.", "{A} and {B}'s friends start a betting pool on when the two of them will finally admit it."),
  t("slow-burn", "Long distance", "Miles apart, holding on through messages and late-night calls.", "{A} and {B} keep a call going across six time zones while one of them falls asleep."),
  t("slow-burn", "Marriage of convenience", "They said yes for practical reasons, and feelings were never part of the deal.", "{A} and {B} sign the papers on Monday and argue about the thermostat on Tuesday."),
  t("slow-burn", "Royal and commoner", "A crown on one side, an ordinary life on the other.", "{A} is a royal in disguise, spending one summer working at {B}'s family café."),
  t("slow-burn", "Secret identity", "One of them is hiding who they really are, and it's getting harder.", "{B} keeps getting rescued by a masked stranger who laughs exactly like {A}."),
  // Angsty
  t("angsty", "Second chance romance", "They loved each other once, it fell apart, and now they meet again.", "{A} walks into a friend's wedding and sees {B}, five years after they stopped calling each other."),
  t("angsty", "Star-crossed lovers", "Their families, sides or worlds say no.", "{A} and {B} meet at the peace talks between their two feuding families."),
  t("angsty", "Hurt/comfort", "One of them is hurting, and the other refuses to leave.", "{B} turns up at {A}'s door at two in the morning, soaked from the rain, and says they didn't know where else to go."),
  t("angsty", "Unrequited love", "One of them has loved the other for years without a word.", "{A} helps {B} plan a date with someone else, and smiles the whole way through."),
  t("angsty", "Secret relationship", "They're together, and nobody can know.", "{A} and {B} act like strangers at the company party, then meet on the fire escape."),
  t("angsty", "Amnesia", "One of them forgot everything, including the two of them.", "{A} wakes up in hospital and politely asks {B} who they are."),
  t("angsty", "Love triangle", "Two people, one heart, and a choice nobody wants to make.", "{A} has two tickets to the festival, and both {B} and {B}'s best friend think one of them is theirs."),
  t("angsty", "Noble sacrifice", "One of them walks away, sure it's the only way to keep the other safe.", "{B} leaves {A} a letter that says goodbye and doesn't say why."),
  t("angsty", "Misunderstanding", "One overheard sentence, taken the wrong way, and months of silence.", "{A} overhears half of {B}'s phone call and draws exactly the wrong conclusion."),
  t("angsty", "Redemption arc", "One of them did something hard to forgive, and is trying to earn the way back.", "{A} comes home to help rebuild the town {B} swore they'd never forgive them for leaving."),
  t("angsty", "Running out of time", "They meet with a deadline: someone has to leave at the end of summer.", "{A} and {B} count down the last week before {B}'s flight, and neither says what they want to."),
  t("angsty", "Right person, wrong time", "They keep meeting at the wrong moment, again and again.", "{A} and {B} meet on the day one of them moves away, for the third time in ten years."),
  // Funny
  t("funny", "Grumpy/sunshine", "One scowls at everything, the other is pure sunshine, and somehow it works.", "{B} cheerfully decorates {A}'s desk for the fifth time this week, and {A} hates decorations."),
  t("funny", "Fake dating", "They pretend to be a couple for a good reason, and it gets out of hand.", "{A} needs a date for their sister's wedding, and {B} owes them a favour."),
  t("funny", "Rivals to lovers", "Always competing, always keeping score, and slowly losing their heads.", "{A} and {B} enter the same baking competition, and both swear they're going to win."),
  t("funny", "Mistaken identity", "One of them is taken for someone else, and plays along.", "{A} is mistaken for {B}'s blind date, and decides not to correct anyone."),
  t("funny", "The bet", "It started as a bet. It was never supposed to be real.", "{A}'s friends bet them they can't get {B} to say yes to a date, and {B} says yes on the first try."),
  t("funny", "Opposites attract", "Night owl and early bird, chaos and order, and no reason it should work.", "{A} the planner and {B} the walking disaster are put in charge of the office party together."),
  t("funny", "Roommates", "Shared rent, shared kitchen, shared tension.", "{A} and {B} answer the same flat advert, and both refuse to back out."),
  t("funny", "Sworn off love", "One of them is done with dating. Completely. Absolutely.", "{A} has just announced they're finished with romance forever, and then {B} walks in."),
  t("funny", "Matchmaker in love", "Setting the other one up, and quietly making sure it never works.", "{A} keeps arranging dates for {B}, and keeps finding a reason each one is wrong."),
  t("funny", "Rival shops", "Two shops on the same street, and a feud the whole town follows.", "{A}'s coffee shop and {B}'s tea shop open on the same street on the same day."),
  t("funny", "Wrong number", "A message sent to the wrong person, and a conversation that won't stop.", "{A} texts a wrong number to complain about their awful day, and {B} texts back."),
  t("funny", "Bickering couple", "They argue about everything, and everyone else knows why.", "{A} and {B} spend the whole quiz night arguing about every answer, and somehow win."),
  // Flirty
  t("flirty", "Only one bed", "The hotel made a mistake, and there's exactly one bed.", "{A} offers to sleep in the armchair, and {B} says that's ridiculous."),
  t("flirty", "Jealousy", "One sees the other flirting with someone else, and suddenly understands.", "{A} watches someone flirt with {B} at the party, and has to leave the room."),
  t("flirty", "The cover kiss", "A kiss to blend in or sell a story. Just the one. It means nothing.", "{A} and {B} are about to be spotted, so {A} pulls {B} into a kiss to hide their faces."),
  t("flirty", "Undercover couple", "Two agents posing as a couple, and the cover is getting very convincing.", "{A} and {B} go undercover as newlyweds at a grand hotel, and the staff keep sending champagne."),
  t("flirty", "Banter", "Every insult they trade sounds a lot like flirting.", "{A} and {B} keep score of their best lines on a napkin across the bar."),
  t("flirty", "Summer fling", "A beach town, one summer, and a promise not to fall for each other.", "{A} and {B} agree to a summer fling with one rule: nobody falls in love."),
  t("flirty", "Who did this to you", "One look at the other one hurt, and they're ready to take on the world.", "{B} comes back with a scraped knee, and {A} goes very quiet: \"Who did this?\""),
  t("flirty", "First touch", "One small touch, and neither of them can think about anything else.", "{A}'s hand brushes {B}'s as they both reach for the popcorn, and neither of them moves."),
  t("flirty", "The rescue", "One saves the other, and the thank-you takes a while.", "{A} pulls {B} out of the lake after the boat tips over, and they're both laughing too hard to swim."),
  t("flirty", "Famous meets normal", "One of them is famous, and the other has no idea who they are.", "{A} asks the stranger at the coffee shop for help with the crossword, not knowing {B} is a famous actor."),
  t("flirty", "Stuck in a lift", "A broken lift, two strangers and a very long wait.", "{A} and {B} are stuck in a lift for two hours with one granola bar between them."),
  t("flirty", "One dance", "One slow dance, and nothing is quite the same afterwards.", "{A} needs a partner for the dance competition, and {B} is the only one who knows the steps."),
];

/** A trope's first scene with the two names in. */
export function firstScene(trope: Trope, names: { a: string; b: string }): string {
  return trope.scene.replace(/\{A\}/g, names.a).replace(/\{B\}/g, names.b);
}

/** The pool a mood draws from (every trope, moods taking turns, when there's no mood). */
function pool(mood: TropeMood | null): readonly Trope[] {
  return mood ? TROPES.filter((tr) => tr.mood === mood) : TROPES;
}

/** One round through the pool in a seeded order; with no mood, the moods take turns so a page mixes them. */
function round(mood: TropeMood | null, n: number): Trope[] {
  const rand = seeded(`tropes|${mood ?? "mixed"}|${n}`);
  const shuffle = <T,>(list: readonly T[]): T[] => {
    const out = [...list];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  if (mood) return shuffle(pool(mood));
  const byMood = TROPE_MOODS.map((m) => shuffle(pool(m)));
  const out: Trope[] = [];
  for (let i = 0; out.length < TROPES.length; i++) for (const list of byMood) if (list[i]) out.push(list[i]);
  return out;
}

/**
 * A page of tropes: TROPES_SHOWN of them, none twice. Batches walk through the pool in rounds (each round its own
 * order), so "Six more tropes" shows new ones until the pool runs out, then starts a fresh round. The same mood and
 * batch always give the same page.
 */
export function tropes({ mood = null, batch = 1 }: { mood?: TropeMood | null; batch?: number }): Trope[] {
  const size = pool(mood).length;
  const rounds = new Map<number, Trope[]>();
  const out: Trope[] = [];
  const seen = new Set<string>();
  for (let i = (batch - 1) * TROPES_SHOWN; out.length < Math.min(TROPES_SHOWN, size); i++) {
    const r = Math.floor(i / size);
    if (!rounds.has(r)) rounds.set(r, round(mood, r));
    const tr = rounds.get(r)![i % size];
    if (seen.has(tr.id)) continue;
    seen.add(tr.id);
    out.push(tr);
  }
  return out;
}

/** A mood from an address segment ("slow-burn", "Slow burn" and "slowburn" all read as slow burn), or null. */
export function readTropeMood(raw: unknown): TropeMood | null {
  if (typeof raw !== "string") return null;
  const s = raw.toLowerCase().replace(/[^a-z]/g, "");
  return TROPE_MOODS.find((m) => m.replace(/-/g, "") === s) ?? null;
}

/** A batch number from an address: a whole number from 1 to TROPES_MAX_BATCH, otherwise 1. */
export function readTropeBatch(raw: unknown): number {
  const n = typeof raw === "string" && /^\d{1,6}$/.test(raw) ? Number(raw) : 1;
  return n >= 1 ? ((n - 1) % TROPES_MAX_BATCH) + 1 : 1;
}

/**
 * The two names from the form: `typed` is what's shown back (empty when it wasn't a name, was too long, or the content
 * filter refused it, alone or read as a pair), `a`/`b` what the scenes use ("A" and "B" in place of an empty one).
 */
export type TropeNames = { a: string; b: string; typedA: string; typedB: string };

export function readTropeNames(rawA: unknown, rawB: unknown): TropeNames {
  const clean = (raw: unknown) => {
    if (typeof raw !== "string") return "";
    const text = raw.normalize("NFC").replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
    if (!text || text.length > TROPE_NAME_MAX || !readName(text)) return "";
    return checkFields({ name: text }).ok ? text : "";
  };
  let typedA = clean(rawA);
  let typedB = clean(rawB);
  // Two names fine apart can be a real person's together ("Taylor" and "Swift"): then neither is shown.
  if (typedA && typedB && !checkFields({ pair: `${typedA} ${typedB}` }).ok) typedA = typedB = "";
  return { a: typedA || "A", b: typedB || "B", typedA, typedB };
}

/** The ship name generator's page for the two typed names, or null without both. */
export function shipHrefFor(names: TropeNames): string | null {
  return names.typedA && names.typedB ? shipHref(names.typedA, names.typedB) : null;
}

/** The address of a page of tropes: the plain mood page is its first batch with no names. */
export function tropesHref(mood: TropeMood | null, batch = 1, names?: Pick<TropeNames, "typedA" | "typedB">): string {
  const base = mood ? `${TROPES_PATH}/${mood}` : TROPES_PATH;
  const q = new URLSearchParams();
  if (names?.typedA) q.set("a", names.typedA);
  if (names?.typedB) q.set("b", names.typedB);
  if (batch !== 1) q.set("batch", String(batch));
  const qs = q.toString();
  return qs ? `${base}?${qs}` : base;
}

/** The tropes the FAQ names as the most popular, each one in the pool (tests/relationship-tropes.test.ts holds them there). */
export const POPULAR_TROPES = ["Enemies to lovers", "Friends to lovers", "Fake dating", "Forced proximity", "Grumpy/sunshine", "Slow burn", "Second chance romance", "Only one bed"] as const;

const list = (items: readonly string[]) => `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/** What people ask about tropes, answered once: the page shows these words and its FAQPage data says the same. */
export const TROPE_FAQ: readonly { q: string; a: string }[] = [
  {
    q: "What is a relationship trope?",
    a:
      "A relationship trope is a familiar pattern a love story follows, one readers recognise from a few words: enemies to lovers, fake dating, only one bed. " +
      "A trope isn't a cliché on its own. It's a promise about the kind of story it will be, and the fun is in how your two characters keep it or break it.",
  },
  {
    q: "What are the most popular romance tropes?",
    a:
      `${list(POPULAR_TROPES.map((n, i) => (i === 0 ? n : n.toLowerCase())))} are the ones readers name most often, with mutual pining, rivals to lovers and childhood friends close behind. ` +
      `This generator has ${TROPES.length} of them, in ${TROPE_MOODS.length} moods: ${list(TROPE_MOODS.map((m) => TROPE_MOOD_INFO[m].label.toLowerCase()))}.`,
  },
  {
    q: "How do I pick a trope for my ship?",
    a:
      "Start with who they are. Two characters who argue about everything suit enemies to lovers or rivals; two who would never admit a feeling suit mutual pining or a slow burn; a ship with history suits a second chance. " +
      "Pick a mood, put your characters' names in to read each first scene with them in it, and keep the one you can't stop picturing. Tropes stack, too: fake dating and only one bed is a classic.",
  },
];
