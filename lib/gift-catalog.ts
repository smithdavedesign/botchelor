/**
 * Small gifts between characters: the catalogue and the rules (2026-11-16; docs/relationship-graph.md "Gifts"). Pure:
 * no database, no clock, no model. lib/character-gifts.ts loads the facts and writes what these decide.
 *
 * A gift is fiction between two characters: a named, concrete little thing with a one-line note, and the receiver's
 * one-line reaction. Nobody pays for one and no person can send one: the show writes it, by seeded rules, after one of
 * the pair's dates aired publicly. It is never read by the engine and never moves points, odds, pairings, an ending or
 * a relationship's stage; nothing here implies a milestone either (no rings, no key to anyone's door).
 *
 *  - WHEN (`giftChance`): rarely after a first date, more often the steadier the pair, seldom between friends, and
 *    after a disaster only as a peace offering from the one who caused it. Dealt by the date's id, so the same date
 *    always gives the same answer.
 *  - WHO (`giftGiver`): never the side that was turned down or walked out on; otherwise dealt by the date.
 *  - WHAT (`pickGift`): from what the giver knows of the other, all of it public: where the date was, the other's
 *    public sheet (traits, bio, hobbies, job), and a line of theirs from the aired date that stuck (lib/memory.ts).
 *  - HOW IT LANDS (`giftReaction`): touched, amused or unimpressed, by the occasion, how the pair stands and the
 *    receiver's tone (lib/sheet-tone.ts: its public sheet, never its private soul).
 *
 * CHARACTER_GIFTS=0 turns it off without a deploy of code: none is written, and none is shown. CHARACTER_GIFTS_RATE
 * makes them rarer or more frequent (`giftRate`).
 */
import { seedFrom } from "./engine";
import type { Ending } from "./rules";
import type { Tone } from "./sheet-tone";
import type { GiftReaction } from "./text-chain-shared";

/** CHARACTER_GIFTS: on unless it is "0". */
export const characterGiftsOn = (env: Record<string, string | undefined> = process.env): boolean => env.CHARACTER_GIFTS?.trim() !== "0";

/**
 * Whether airing a date may bring a gift at all (lib/character-gifts.ts giftOnAir): on in production, off in tests
 * unless one turns it on (tests/setup-no-live-checks.ts), because a gift is dealt by the date's random id.
 */
let onAir = true;
export function setGiftsOnAirForTests(on: boolean): void {
  onAir = on;
}
export const giftsOnAir = (): boolean => onAir;

/** At most one gift a pair in this many days. */
export const GIFT_EVERY_DAYS = 7;
export const GIFT_NAME_MAX = 80;
export const GIFT_NOTE_MAX = 160;
/** A line of theirs is quoted on a card only when it is this short. */
export const GIFT_QUOTE_MAX = 70;

/** sweet: between two who are seeing each other. token: a first date, or friends. peace: after a disaster. */
export type GiftOccasion = "sweet" | "token" | "peace";

export type GiftItem = {
  id: string;
  /** What it is, with its article, as anyone would say it: "a jar of wildflower honey". Never "you". */
  name: string;
  /** The giver's note. `{line}` is a line of the receiver's from the date (only on an item that quotes one). */
  note: string;
  /** The same note in another tone, where the plain one wouldn't sound like them. */
  tones?: Partial<Record<Tone, string>>;
  /** The places it comes from (venue ids): it is only ever given after a date there. */
  venues?: readonly string[];
  /** Words on the receiver's public sheet that make it fit: it is only given to someone whose sheet has one. */
  likes?: RegExp;
  /** The occasions it suits. Left out: sweet and token. */
  occasions?: readonly GiftOccasion[];
  /** Needs a line of the receiver's to quote. */
  quotes?: true;
};

const PEACE: readonly GiftOccasion[] = ["peace"];

/** The gifts. Small, concrete, PG; nothing bought to impress, nothing that marks a milestone (tests/character-gifts.test.ts). */
export const GIFTS: readonly GiftItem[] = [
  // Where the date was.
  { id: "cocktail_umbrella", venues: ["rooftop_bar"], name: "a paper cocktail umbrella, pressed flat in an envelope", note: "Rescued this from your glass before they cleared the table.", tones: { wry: "Recovered from the scene. Yours, I believe." } },
  { id: "house_blend", venues: ["corner_cafe"], name: "a bag of the café's house blend", note: "They were closing, so I got the last bag. It's yours.", tones: { reserved: "The last bag before they closed. You should have it." } },
  { id: "prize_tickets", venues: ["retro_arcade"], name: "a strip of arcade prize tickets tied with a ribbon", note: "Forty tickets. Not enough for the bear. Enough to prove I tried." },
  { id: "potted_fern", venues: ["botanic_park"], name: "a small potted fern", note: "It was looking at you the whole walk. It lives with you now.", tones: { reserved: "From the park. It doesn't need much." } },
  { id: "proper_bread", venues: ["tasting_menu"], name: "a loaf of proper bread", note: "After eleven tiny courses, I thought you might want one big one." },
  { id: "beach_stone", venues: ["night_beach"], name: "a smooth grey stone from the beach", note: "It was under the blanket. It's been in my coat pocket ever since.", tones: { wry: "A rock. From the beach. I'm told it's the thought." } },
  { id: "mixtape", venues: ["karaoke_booth"], name: "a mixtape of the songs they didn't get to", note: "One hour was not enough. Side B is the ones you vetoed." },
  { id: "parachute_keyring", venues: ["skydive"], name: "a tiny toy parachute on a string", note: "For the next time you need reminding that you jumped." },
  { id: "surf_wax", venues: ["surf_lesson"], name: "a bar of surf wax", note: "For the wave you very nearly stood up on." },
  { id: "trivia_sheet", venues: ["dive_bar"], name: "the trivia answer sheet in a frame", note: "We came fourth. I'd like that on the record.", tones: { warm: "We came fourth, and I've never been prouder of fourth." } },
  { id: "earplugs", venues: ["nightclub"], name: "a pair of earplugs in a little tin", note: "So next time I can hear what you're saying." },
  { id: "giraffe_postcard", venues: ["safari"], name: "a postcard of a giraffe", note: "It stared at you first. I only noticed.", tones: { wry: "He asked for your number. I said I'd pass this on instead." } },
  { id: "brass_padlock", venues: ["escape_room"], name: "a tiny brass padlock with the key taped to it", note: "This one actually opens. I checked." },
  { id: "allen_key", venues: ["flat_pack"], name: "a spare allen key on a ribbon", note: "In case we ever have to find the exit again." },
  { id: "clay_cup", venues: ["pottery_class"], name: "a slightly lopsided clay cup", note: "The wheel won. I made this anyway. It holds most of a coffee.", tones: { reserved: "It leans. It still works." } },
  { id: "balloon_map", venues: ["hot_air_balloon"], name: "a paper map with a wrong turn drawn on it", note: "Roughly where we were meant to land, and where we did." },
  { id: "striped_socks", venues: ["bowling_alley"], name: "a pair of loud striped socks", note: "For league night. Yours were letting lane twelve down." },
  { id: "odd_sock", venues: ["laundromat"], name: "a single odd sock, washed and folded", note: "It came out of the dryer with my things. I think it picked a side." },
  { id: "mittens", venues: ["ice_rink"], name: "a pair of woolly mittens", note: "For next time, so the barrier isn't doing all the work." },
  { id: "scorched_spoon", venues: ["cooking_class"], name: "a wooden spoon with a scorch mark", note: "The smoke alarm sends its regards." },
  { id: "plastic_ghost", venues: ["haunted_house"], name: "a glow-in-the-dark plastic ghost", note: "The only one in there that didn't jump out a beat early." },
  { id: "handwritten_playlist", venues: ["silent_disco"], name: "a playlist written out by hand", note: "Both channels, in the order we got them wrong." },
  { id: "dinosaur_postcard", venues: ["museum_night"], name: "a postcard of the dinosaur", note: "He asked after you." },
  { id: "waterproof_matches", venues: ["rainy_campsite"], name: "a box of waterproof matches", note: "For the next tent. There will be a next tent.", tones: { reserved: "In case of another tent." } },
  { id: "felt_goat", venues: ["goat_yoga"], name: "a small felt goat", note: "It's the one that picked you. I'd know that stare anywhere." },
  { id: "rubber_duck", venues: ["swan_pedalo"], name: "a rubber duck in a sailor hat", note: "It pedals better than we did." },
  { id: "magnifying_glass", venues: ["murder_mystery"], name: "a joke-shop magnifying glass", note: "For next time. You were right about the butler, for the record." },
  { id: "dance_card", venues: ["ballroom_lesson"], name: "a dance card with one name on it", note: "Connection, as the instructor would say." },
  { id: "white_hankie", venues: ["paintball"], name: "a clean white handkerchief", note: "A flag of truce, in case we're ever on opposite teams." },
  { id: "sugar_lumps", venues: ["trail_ride"], name: "a little bag of sugar lumps", note: "For your horse. A bribe. Mine could use the example." },
  { id: "open_mic_flyer", venues: ["comedy_club"], name: "the open-mic flyer, folded in four", note: "Front row survivors. I kept the proof." },
  { id: "climbing_chalk", venues: ["climbing_wall"], name: "a little bag of climbing chalk", note: "You held the rope the whole time. This is for your turn." },
  { id: "pie_slice", venues: ["late_night_diner"], name: "a slice of pie in a paper box", note: "The waitress said it was the last one. I said it was yours." },
  { id: "paper_lantern", venues: ["night_market"], name: "a paper lantern, folded flat", note: "It hung over the stall where you couldn't choose." },
  { id: "ticket_stubs", venues: ["old_cinema"], name: "two torn ticket stubs in an envelope", note: "Yours and mine. You keep both." },
  { id: "star_chart", venues: ["stargazing_hill"], name: "a star chart with one star circled", note: "That's the one you pointed at. I looked it up." },
  { id: "pressed_leaf", venues: ["city_walk"], name: "a pressed leaf from the walk home", note: "It rode on your shoulder for about four streets." },
  { id: "seaside_rock", venues: ["pier_at_night"], name: "a stick of seaside rock", note: "The stall was shutting. I was quick." },
  { id: "drumstick", venues: ["jazz_bar"], name: "a drumstick the drummer dropped", note: "We sat close enough to earn it." },
  { id: "margin_paperback", venues: ["late_bookshop"], name: "a secondhand paperback with a note in the margin", note: "Page forty. Somebody underlined it before me. They were right." },

  // What the other one is like, from their public sheet.
  { id: "bookmark", likes: /\b(?:books?|read(?:s|er|ing)?|librar\w*|novels?|poet\w*|writ(?:er|es|ing))\b/i, name: "a bookmark made from a train ticket", note: "So you can stop folding the corners." },
  { id: "jam", likes: /\b(?:cook\w*|chef|bak(?:e|es|er|ing)|food\w*|recipes?|kitchen)\b/i, name: "a jar of homemade jam", note: "I made too much. That's my story." },
  { id: "seeds", likes: /\b(?:plants?|garden\w*|botan\w*|florist|flowers?|grow(?:s|ing)?)\b/i, name: "a packet of wildflower seeds", note: "Scatter them somewhere you walk past." },
  { id: "guitar_pick", likes: /\b(?:music\w*|guitar\w*|sing(?:s|er|ing)?|band|vinyl|records?|dj|piano|drum\w*|jazz)\b/i, name: "a guitar pick on a loop of string", note: "It was in a coat pocket. It seemed like yours." },
  { id: "loose_tea", likes: /\b(?:tea|coffee|barista|caf[eé]s?)\b/i, name: "a tin of loose tea", note: "For slow mornings.", tones: { wry: "For the mornings you claim not to have." } },
  { id: "tennis_ball", likes: /\b(?:dogs?|pupp\w*|cats?|kittens?|animals?|vet|rescue)\b/i, name: "a tennis ball with a bow on it", note: "Not for you. You know who it's for." },
  { id: "sketchbook", likes: /\b(?:art\w*|paint\w*|draw\w*|sketch\w*|illustrat\w*|photograph\w*|design\w*)\b/i, name: "a pocket sketchbook", note: "The first page is taken. The rest are yours." },
  { id: "trail_map", likes: /\b(?:hik\w*|trails?|climb\w*|outdoors?|cycl\w*|run(?:s|ner|ning)?|camp\w*|mountains?)\b/i, name: "a trail map with a route inked in", note: "No hurry. It's a loop. It'll wait." },
  { id: "ceiling_star", likes: /\b(?:stars?|astronom\w*|space|scien\w*|telescope|physic\w*|nerd\w*)\b/i, name: "a glow-in-the-dark star for the ceiling", note: "One. You can earn the rest." },
  { id: "chess_knight", likes: /\b(?:chess|games?|gamer|puzzles?|crosswords?|trivia|strateg\w*)\b/i, name: "a single chess knight", note: "It moves strangely and gets where it's going. It reminded me of someone." },
  { id: "stamped_postcard", likes: /\b(?:travel\w*|pilot|sail\w*|wander\w*|abroad|adventur\w*|explor\w*)\b/i, name: "a blank postcard, already stamped", note: "Send it from wherever you end up next." },
  { id: "honey", likes: /\b(?:honey|sweet|tea|bees?|bak(?:e|es|er|ing))\b/i, name: "a jar of wildflower honey", note: "Left this on your step. For your tea." },

  // Anyone, anywhere.
  { id: "paper_boat", name: "a note folded into a paper boat", note: "It floats. I tested it in the sink." },
  { id: "jam_jar_flower", name: "a single wildflower in a jam jar", note: "It was growing through a fence. It seemed determined.", tones: { reserved: "It was growing through a fence. I thought of you." } },
  { id: "bench_map", name: "a hand-drawn map to a park bench", note: "No reason. It's a good bench." },
  { id: "umbrella", name: "a spare umbrella", note: "For the next time the sky does that." },
  { id: "two_ended_pencil", name: "a pencil sharpened at both ends", note: "For when you can't decide." },
  { id: "card_deck", name: "a pack of cards with the joker missing", note: "I kept the joker. You'll have to win it back." },
  { id: "chipped_mug", occasions: ["sweet"], name: "a mug with a chipped handle", note: "It's the good one. I wanted you to have the good one." },
  { id: "quote_card", quotes: true, name: "a postcard with one line written on it", note: "“{line}” You said it. I wrote it down." },

  // After a disaster, from the one who caused it.
  { id: "shortbread", occasions: PEACE, name: "a box of shortbread", note: "That was mostly my doing. No reply needed." },
  { id: "paper_flag", occasions: PEACE, name: "a white paper flag on a cocktail stick", note: "Truce. Or at least a ceasefire.", tones: { reserved: "Truce." } },
  { id: "cactus", occasions: PEACE, name: "a small potted cactus", note: "Prickly, low maintenance, means well. An apology, of sorts." },
  { id: "sorry_card", occasions: PEACE, name: "a card with one word on it", note: "It says sorry. I checked the spelling twice." },
];

/** What the receiver says back, by how it landed and by its own tone. Short enough for any gift. */
export const GIFT_REPLIES: Record<GiftReaction, Record<Tone, readonly string[]>> = {
  touched: {
    warm: ["You remembered. It's going where I can see it.", "That's the nicest thing anyone's done all week. Thank you."],
    wry: ["Well. Now I have to be nice to you. Thank you.", "I'd make a joke, but I actually love it."],
    reserved: ["Thank you. I mean that.", "I didn't expect this. It's staying on my shelf."],
    plain: ["Thank you. I love it.", "That made my day."],
  },
  amused: {
    warm: ["I laughed out loud on the doorstep. You're ridiculous. Thank you.", "This is absurd, and I'm keeping it forever."],
    wry: ["A bold choice. I respect it.", "I have questions. I'm keeping it anyway."],
    reserved: ["That's very odd. I like it.", "Unusual. It can stay."],
    plain: ["Ha. Okay, that's funny.", "You're ridiculous. It's on the shelf."],
  },
  unimpressed: {
    warm: ["That's kind of you. I'm not sure what to do with it.", "You didn't have to. I do mean that."],
    wry: ["Top marks for effort. The effort was visible.", "I'll put it with the others. There are no others."],
    reserved: ["Noted.", "You didn't have to. Really."],
    plain: ["Thanks, I suppose.", "Okay. Thank you."],
  },
};

/* ------------------------------------------------ when, and who ------------------------------------------------ */

export type GiftFacts = {
  episode_id: string;
  ending: Ending;
  /**
   * How the pair stands on the public record after this date (lib/relationships.ts public stage). A plain string: the
   * stages grow, and one this file doesn't know is read by what its name says, or as an ordinary couple.
   */
  stage: string | null;
  /** Their public aired dates so far, this one included. */
  dates: number;
  /** The side that was turned down, or walked out on, when the date's public record says so. */
  injured: "a" | "b" | null;
};

const COLD_STAGE = /blood|^ex(?:es)?$|broke|split|divorc|feud/i;
const STEADY_STAGE = /steady|exclusive|moved|living|engag|married|partner/i;

/** The pair is on bad terms: no gifts but a peace offering. */
export const coldStage = (stage: string | null): boolean => Boolean(stage && COLD_STAGE.test(stage));
/** The pair is an established couple: gifts come most often, and land best. */
export const steadyStage = (stage: string | null): boolean => Boolean(stage && STEADY_STAGE.test(stage));

/** Which kind of gift this date could bring. */
export const giftOccasion = (f: Pick<GiftFacts, "ending" | "dates">): GiftOccasion =>
  f.ending === "disaster" ? "peace" : f.ending === "friends" || f.dates <= 1 ? "token" : "sweet";

/**
 * The chance (0..1) that this date brings a gift.
 *  - a disaster: 0.15, and only when the record says who was wronged (the other one sends a peace offering); when
 *    it simply went badly for both, nobody sends anything;
 *  - a pair on bad terms otherwise: never;
 *  - friends: 0.12;
 *  - a second date wanted: 0.1 after a first date, 0.25 for a pair finding its feet, 0.4 dating, 0.6 steady.
 */
export function giftChance(f: GiftFacts): number {
  if (f.ending === "disaster") return f.injured ? 0.15 : 0;
  if (coldStage(f.stage)) return 0;
  if (f.ending === "friends") return 0.12;
  if (f.dates <= 1) return 0.1;
  if (steadyStage(f.stage)) return 0.6;
  return f.stage === "dating" ? 0.4 : 0.25;
}

/**
 * CHARACTER_GIFTS_RATE: how often gifts come, as a multiple of the chances above (1 when unset; 0.5 halves them, 2
 * doubles them, a large number makes one certain wherever the rules allow one at all). It never makes a gift where
 * the rules say never, and the weekly cap still holds. The visual gate sets it high so a seeded couple has one to show.
 */
export function giftRate(env: Record<string, string | undefined> = process.env): number {
  const raw = env.CHARACTER_GIFTS_RATE?.trim();
  const n = raw ? Number(raw) : 1;
  return Number.isFinite(n) && n >= 0 ? Math.min(1000, n) : 1;
}

/** Whether this date brings one: the chance (times the rate), dealt by the date's id (the same date, the same answer). */
export const giftHappens = (f: GiftFacts, env: Record<string, string | undefined> = process.env): boolean =>
  seedFrom("character-gift", f.episode_id) % 1000 < Math.round(Math.min(1, giftChance(f) * giftRate(env)) * 1000);

/** Who gives it: never the wronged side; otherwise dealt by the date. */
export function giftGiver(f: Pick<GiftFacts, "episode_id" | "injured">): "a" | "b" {
  if (f.injured) return f.injured === "a" ? "b" : "a";
  return seedFrom("character-gift-giver", f.episode_id) % 2 === 0 ? "a" : "b";
}

/* ------------------------------------------------ what ------------------------------------------------ */

export type GiftKnown = {
  /** Where the date was (a venue id, with or without a "@label"). */
  venue: string | null;
  /** The receiver's public sheet as one text: traits, bio, hobbies, job. */
  sheet: string;
  /** A line of the receiver's from the aired date that stuck with the giver (lib/memory.ts they_said), or null. */
  line: string | null;
};

const venueIdOf = (venue: string | null): string | null => (venue ? venue.split("@")[0] : null);
const quotable = (line: string | null): string | null => {
  const l = line?.replace(/\s+/g, " ").replace(/["“”]/g, "").trim() ?? "";
  return l.length >= 8 && l.length <= GIFT_QUOTE_MAX ? l : null;
};

/**
 * The gifts that fit, each with its weight: one from the date's place 4, one for what the other is like 3, one that
 * quotes them 3, anything-anywhere 1. A gift tied to a place or a liking is never given without it.
 */
export function giftCandidates(occasion: GiftOccasion, known: GiftKnown, skip: readonly string[] = []): { item: GiftItem; weight: number }[] {
  const venue = venueIdOf(known.venue);
  const line = quotable(known.line);
  const out: { item: GiftItem; weight: number }[] = [];
  for (const item of GIFTS) {
    if (skip.includes(item.id)) continue;
    if (!(item.occasions ?? ["sweet", "token"]).includes(occasion)) continue;
    if (item.quotes) {
      if (line) out.push({ item, weight: 3 });
    } else if (item.venues) {
      if (venue && item.venues.includes(venue)) out.push({ item, weight: 4 });
    } else if (item.likes) {
      if (item.likes.test(known.sheet)) out.push({ item, weight: 3 });
    } else out.push({ item, weight: 1 });
  }
  return out;
}

export type PickedGift = { id: string; name: string; note: string };

/** The gift and its note in the giver's tone (pure), dealt by the date from what fits; null when nothing does. */
export function pickGift(episodeId: string, occasion: GiftOccasion, known: GiftKnown, giverTone: Tone, skip: readonly string[] = []): PickedGift | null {
  const fits = giftCandidates(occasion, known, skip);
  const total = fits.reduce((n, c) => n + c.weight, 0);
  if (!total) return null;
  let roll = seedFrom("character-gift-item", episodeId) % total;
  const chosen = fits.find((c) => (roll -= c.weight) < 0)!.item;
  const note = (chosen.tones?.[giverTone] ?? chosen.note).replace("{line}", quotable(known.line) ?? "");
  return { id: chosen.id, name: chosen.name, note };
}

/* ------------------------------------------------ how it lands ------------------------------------------------ */

/**
 * How the receiver takes it (pure), dealt by the date from weights: the occasion sets the base (a peace offering
 * mostly isn't enough, a gift between a couple mostly is), a steady pair is touched more easily and a first date
 * less, and the receiver's own tone leans it (warm: touched; wry: amused; reserved: unimpressed).
 */
export function giftReaction(f: { episode_id: string; occasion: GiftOccasion; stage: string | null; dates: number }, receiverTone: Tone): GiftReaction {
  const w: Record<GiftReaction, number> =
    f.occasion === "sweet" ? { touched: 5, amused: 3, unimpressed: 1 } : f.occasion === "token" ? { touched: 3, amused: 4, unimpressed: 2 } : { touched: 1, amused: 3, unimpressed: 5 };
  if (f.occasion !== "peace" && (steadyStage(f.stage) || f.dates >= 4)) w.touched += 3;
  if (f.dates <= 1) w.unimpressed += 1;
  if (receiverTone === "warm") w.touched += 2;
  if (receiverTone === "wry") w.amused += 3;
  if (receiverTone === "reserved") w.unimpressed += 2;
  let roll = seedFrom("character-gift-reaction", f.episode_id) % (w.touched + w.amused + w.unimpressed);
  return (roll -= w.touched) < 0 ? "touched" : (roll -= w.amused) < 0 ? "amused" : "unimpressed";
}

/** The receiver's line back (pure), dealt by the date from its tone's lines for that reaction. */
export function giftReply(episodeId: string, reaction: GiftReaction, receiverTone: Tone): string {
  const lines = GIFT_REPLIES[reaction][receiverTone];
  return lines[seedFrom("character-gift-reply", episodeId) % lines.length];
}

/** A gift as anyone who saw it would retell it ("Sable sent Juniper a postcard of a giraffe."): the public record's words. */
export const giftClaim = (giver: string, receiver: string, name: string): string => `${giver} sent ${receiver} ${name}.`;
