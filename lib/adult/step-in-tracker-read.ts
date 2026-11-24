/**
 * How a Step in scene's continuity sheet is read (the sheet itself is lib/adult/step-in-tracker.ts; the read is run by
 * lib/adult/step-in.ts stepInTrack): what the model is asked, how its answer is read, and how that answer is settled
 * into the sheet that's kept. Pure, and the server's own: the scene's page never loads it.
 *
 * The first live reads (2026-11-24, two scenes on After Dark's own model) showed what a model does when it's asked to
 * write the whole sheet again after every reply, and each of these is now ruled out here, by the code, whatever the
 * model answers:
 *
 *  1. "nothing on" for a character whose clothes the opening never mentioned, which the writer was then told as what
 *     she had on. What they have on starts as what they start in (their own clothes, or their part's costume) and
 *     changes only when the lines change it; "nothing", "unknown" and the like are never a state; undressed is only
 *     what the lines plainly say (undressSaid), and then it's said as what's off and what's on.
 *  2. Clothes swapped for hands ("nothing on" → "holding nothing" → "holding wooden spoon"). The model answers the two
 *     apart, the clothes always stay, and what's held is added only when something is.
 *  3. Things that stuck or vanished: a coat the viewer hung up stayed under what they had on, and a parcel they handed
 *     over was nowhere for three replies. A thing is in one place; put down or taken off, it goes to "around" with
 *     where it is; handed over, it's in the other's hands; and a thing the sheet had that no line mentions is exactly
 *     where it was, whatever the answer did with it. The lines themselves are read for the plainest of these
 *     (put-down, take-off, hand-over, pick-up), in the order they're said, and move the thing even when the model's
 *     answer didn't.
 *  4. People in "where" ("Juniper's kitchen, person sitting at table"). Only the place and the spot in it.
 *  5. A mark on the skin as something worn ("ink stain on thumb"). Only clothes and what's in their hands.
 *
 * And nothing gets onto the sheet that neither the lines nor the sheet so far mention (a model's guess, or a word from
 * the example it's shown).
 */
import type { ChatMessage } from "../model";
import { NO_SHEET, NOT_A_THING, sheetLine, TRACKER_FIELD_MAX, TRACKER_LINE_CHARS, TRACKER_REPLY_CHARS, type SceneSheet, type TrackerLine } from "./step-in-tracker";

/** The most things kept as in play around them. */
export const AROUND_MAX = 4;
/** What a line says once every piece has come off, by the lines' own account (never from silence). */
export const BARE_LINE = "nothing left on";

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const clean = (s: unknown): string => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().replace(/^["“]+|["”]+$/g, "").replace(/[\s.]+$/, "").trim() : "");

/** How a thing is now, said after it ("a coat, wet from the rain"): part of the thing before it, not a thing of its own. */
const DESCRIBES = /^(?:wet|damp|soaked|dry|open|unbuttoned|undone|unzipped|rolled|torn|still|slightly|half|now|freshly|pushed|hung|hanging|draped|left|lying|tied|wrapped|with|from|in|on|over|under|by|at|against|beside|across)\b/i;

/**
 * A line's things: split at its commas and semicolons, each tidied, the ones that only say "nothing" left out. A part
 * that only says how or where the thing before it is ("a coat, wet from the rain") stays with that thing; `parts`
 * keeps every part apart (a place and the spot in it: "the living room, on the sofa").
 */
export function things(line: unknown, parts = false): string[] {
  const out: string[] = [];
  for (const part of clean(line).split(/\s*[;,]\s*/).map(clean)) {
    if (!part) continue;
    if (!parts && out.length && DESCRIBES.test(part)) out[out.length - 1] = `${out[out.length - 1]} ${part}`;
    else out.push(part);
  }
  return out.filter((t) => !NOT_A_THING.test(t));
}

const HELD_AT = /(?:^|[;,]\s*|\s)(?:and\s+)?(?:holding|carrying)\b/i;
/** What's in someone's hands, as things ("a mug of tea and a parcel" is two). */
export const heldThings = (text: unknown): string[] =>
  things(text)
    .flatMap((t) => t.split(/\s+and\s+(?=(?:a|an|the|some|two|three|her|his|their|my|your)\b)/i))
    .map((t) => clean(t.replace(/^(?:and\s+)?(?:holding|carrying)\s+/i, "")))
    .filter((t) => t !== "" && !NOT_A_THING.test(t));

/** A person's line as its two parts: what they have on, and what's in their hands ("a cardigan, jeans; holding a glass"). */
export function wornAndHeld(line: unknown): { worn: string[]; held: string[] } {
  const text = clean(line);
  const at = text.search(HELD_AT);
  return at < 0 ? { worn: things(text), held: [] } : { worn: things(text.slice(0, at)), held: heldThings(text.slice(at).replace(/^[;,\s]+/, "")) };
}
/** The two parts as the one line the sheet keeps. */
export const personLine = (worn: readonly string[], held: readonly string[]): string => `${worn.join(", ")}${held.length ? `${worn.length ? "; " : ""}holding ${held.join(", ")}` : ""}`;

type Lists = { where: string; themWorn: string[]; themHeld: string[]; youWorn: string[]; youHeld: string[]; around: string[] };
function listsOf(s: SceneSheet): Lists {
  const them = wornAndHeld(s.them);
  const you = wornAndHeld(s.you);
  return { where: clean(s.where), themWorn: them.worn, themHeld: them.held, youWorn: you.worn, youHeld: you.held, around: things(s.around) };
}

/* ------------------------------------------------ what's asked ------------------------------------------------ */

export type TrackerInput = {
  /** The character's first name. */
  name: string;
  /** The sheet so far; null for a first read. */
  base: SceneSheet | null;
  /** Where the scene is set and what the character starts in: said while the sheet doesn't say. */
  seed?: { place: string; wearing: string | null } | null;
  /** The lines since the sheet was last read, oldest first. */
  lines: readonly TrackerLine[];
};

/**
 * What the read is asked: the sheet so far (a person's clothes apart from their hands, and the character already in
 * what they start in), the lines since, the changes those lines make, then the sheet after them. Listing the changes
 * first is what gets a put-down or a hand-over noticed; the example is of exactly that, with other people and other
 * things (and nothing of it can reach a sheet: settleSheet keeps only what the scene's own lines mention).
 */
export function trackerMessages(input: TrackerInput): ChatMessage[] {
  const { name } = input;
  const said = input.lines
    .map((l) => {
      const text = l.text.replace(/\s+/g, " ").trim();
      if (l.who === "moved") return `(The scene moves: the two of them are now at ${text}.)`;
      return l.who === "them" ? `The person: ${text.slice(0, TRACKER_LINE_CHARS)}` : `${name}: ${text.slice(0, TRACKER_REPLY_CHARS)}`;
    })
    .join("\n");
  const b = listsOf(input.base ?? NO_SHEET);
  const so = {
    where: b.where,
    character_wears: b.themWorn.length ? b.themWorn.join(", ") : clean(input.seed?.wearing),
    character_holds: b.themHeld.join(", "),
    person_wears: b.youWorn.join(", "),
    person_holds: b.youHeld.join(", "),
    around: b.around.join("; "),
  };
  return [
    {
      role: "system",
      content: `You keep the continuity sheet of a private scene of adult fiction between a person and ${name}, an AI character: where the two of them are, what each is wearing, what each has in their hands and where the things in play are, so that nothing in the scene appears, vanishes or changes without the story saying so. You go by what the lines say and nothing else: a thing stays exactly where the sheet has it until a line moves it. You answer with JSON and nothing else.`,
    },
    {
      role: "user",
      content: [
        `The sheet so far:\n${JSON.stringify(so)}`,
        !b.where && input.seed?.place ? `The scene is set at ${input.seed.place}.` : "",
        `The newest lines, oldest first ("The person" is the one ${name} is with):\n${said}`,
        [
          "First list what these lines changed, then write the sheet as it stands after them.",
          '"changes": each thing that was put on, taken off, picked up, put down or handed over in these lines, in order, each as "who: what, and where it is now" ("the person: coat, on the hook by the door"). An empty list when nothing was.',
          "Then the sheet, six lines. Copy a line from the sheet so far word for word unless one of the changes touches it:",
          '- "where": the place and the spot in it (the kitchen, by the counter). Only the place: nobody\'s name, and nobody sitting or standing in it.',
          `- "character_wears": the clothes ${name} has on, piece by piece. It never empties by itself: a piece leaves it only when a line takes it off, and then that piece goes to "around".`,
          `- "character_holds": what is in ${name}'s hands right now. "" when they are empty.`,
          '- "person_wears": the clothes the person has on, only from what the person\'s own lines say about themselves. "" until they have said.',
          '- "person_holds": what is in the person\'s hands right now. "" when they are empty.',
          '- "around": the things in play that nobody is wearing or holding, each with where it is (a coat on the hook by the door; a parcel on the windowsill). Four at most.',
          "Rules:",
          '- A thing is in one place only. Taken off or put down, it leaves its owner\'s line and goes to "around" with where it is. Handed to someone, it is in their hands from then on, unless a later line says where they put it.',
          "- Only clothes, accessories and objects: never a mark on the skin, hair, a look or a mood.",
          '- Plain words, a list of things: no names, and no "he", "she", "they" or "the person" inside a line. Never write "nothing", "none" or "unknown": leave the line "" instead.',
          `- Each line on one line, under ${TRACKER_FIELD_MAX} characters, with no comma inside a thing.`,
          "An example of changes and what they do to a sheet (other people, other things):",
          "The person: I shake the rain off my umbrella, leave it in the stand by the door and hand you the bottle of wine I brought.",
          "Mara: She took the bottle and set it on the counter.",
          '"changes": ["the person: umbrella, in the stand by the door", "the person: bottle of wine, handed to Mara", "Mara: bottle of wine, on the counter"], and so "person_holds": "", "character_holds": "", "around": "an umbrella in the stand by the door; a bottle of wine on the counter".',
          'Reply with a JSON object: {"changes": ["..."], "where": "...", "character_wears": "...", "character_holds": "...", "person_wears": "...", "person_holds": "...", "around": "..."}',
        ].join("\n"),
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];
}

/* ------------------------------------------------ the answer, read ------------------------------------------------ */

/** A read's answer as the model writes it: the sheet in six lines, a person's clothes apart from their hands. */
export type SheetRead = { where: string; themWears: string; themHolds: string; youWears: string; youHolds: string; around: string };

/**
 * The answer a read gave: its six lines (or the four the sheet is kept in, a person's clothes and hands on one line).
 * Null for anything else: no JSON, a line missing, a reply meant for the writer or the notes. What the lines say is
 * settleSheet's to judge; this only reads them.
 */
export function parseSheet(raw: string): SheetRead | null {
  const found = raw.match(/\{[\s\S]*\}/);
  if (!found) return null;
  let o: Record<string, unknown>;
  try {
    const parsed = JSON.parse(found[0]) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    o = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const where = str(o.where);
  const around = str(o.around);
  const them = str(o.character_wears) ?? str(o.character) ?? str(o.them);
  const you = str(o.person_wears) ?? str(o.person) ?? str(o.you);
  if (where === null || around === null || them === null || you === null) return null;
  return { where, themWears: them, themHolds: str(o.character_holds) ?? "", youWears: you, youHolds: str(o.person_holds) ?? "", around };
}

/* ------------------------------------------------ the answer, settled ------------------------------------------------ */

function stem(w: string): string {
  if (w.length <= 3 || /(?:ss|us|is)$/.test(w)) return w;
  if (w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (/(?:[sxz]|ch|sh)es$/.test(w)) return w.slice(0, -2);
  return w.endsWith("s") ? w.slice(0, -1) : w;
}
const LEAD = /^(?:(?:a|an|the|some|my|your|her|his|their|its|two|three|four|both|this|that)\s+|(?:a\s+)?(?:pair|couple) of\s+)+/;
const TAIL =
  /\s+(?:on|onto|over|by|in|into|inside|with|of|from|for|at|under|behind|beside|against|across|around|near|atop|tied|wrapped|filled|full|hung|hanging|draped|folded|left|lying|taken|put|set|propped|resting|wet|damp|soaked|dry|open|unbuttoned|undone|unzipped|rolled|torn|still|now)\b.*$|\s*\(.*$/;
/** The word a thing is known by: its noun, without what it's made of, where it is or how it is ("a small paper parcel tied with string" → "parcel"). */
export function head(item: string): string {
  const words = item.toLowerCase().trim().replace(LEAD, "").replace(TAIL, "").match(/[a-z][a-z'’-]*/g) ?? [];
  return stem((words[words.length - 1] ?? "").replace(/['’]s$/, ""));
}
const sameThing = (a: string, b: string): boolean => head(a).length > 1 && head(a) === head(b);
/** Whether a text mentions a thing, by the word it's known by. */
const saidIn = (text: string, item: string): boolean => head(item).length > 2 && new RegExp(`\\b${esc(head(item))}`, "i").test(text);

/** Not something worn or held: a mark on the skin, hair, a look, a mood (by the word the "thing" is known by). */
const NOT_WORN = new Set(
  "stain smudge smear scar freckle tattoo bruise scratch blush flush smile grin frown hair braid ponytail bun beard stubble moustache mustache eye lip cheek skin nail thumb finger knuckle palm hand expression look mood perfume scent sweat tan tear makeup".split(" "),
);
/** Part of someone, or nothing you can put down: what a put-down, a take-off or a hand-over is never about. */
const NOT_A_PROP = new Set(
  "hand arm head feet foot finger eye lip mouth face back leg knee weight gaze attention breath voice heart mind thumb palm cheek chin forehead shoulder hip waist body hair way time turn place seat elbow wrist ankle neck chest lap thigh skin ear nose brow throat side stomach rib jaw collarbone look smile kiss hug wink nod moment minute second chance nudge squeeze push shove call break space room grin glance wave shrug answer reason choice tour lift ride start fright scare piece word name number massage rub pat tap peck cuddle embrace taste sip bite compliment warning hint clue sign signal lecture lesson idea thought sense feeling impression".split(
    " ",
  ),
);
/** What goes with an outfit and doesn't replace one: mentioned alone, it's added to what they start in. */
const GOES_WITH = new Set(
  "barefoot feet foot shoe boot heel sneaker trainer sandal slipper loafer sock stocking tight scarf hat cap glove belt tie necklace bracelet ring watch glass earring apron lanyard earpiece mask crown circlet badge".split(" "),
);
/** A line that says someone is undressed, wholly or to what's named. */
const BARE = /\b(?:naked|nude|undressed|unclothed|topless|shirtless|bare[- ]chested|nothing (?:on|but|left on|at all|underneath)|wearing nothing|only (?:a|an|her|his|their|the)\b|in (?:just |only )?(?:(?:her|his|their|the) )?(?:underwear|bra|boxers|briefs|panties|lingerie|knickers))/i;
/** Words that plainly say someone is undressed, or undressing. */
const BARE_SAID = /\b(?:naked|nude|undress\w*|unbutton\w*|unzip\w*|unclasp\w*|unhook\w*|unfasten\w*|strip(?:s|ped|ping)?|topless|shirtless|bare (?:skin|chest|shoulders?|back|breasts?|legs?|thighs?)|nothing (?:on|underneath|under))\b/i;
/** Something coming off, out of or over a head: clothes only when the same lines name some (a spoon comes "out of" a pot too). */
const COMES_OFF =
  /\b(?:take|takes|took|taking|taken|pull|pulls|pulled|pulling|slip|slips|slipped|slipping|slide|slides|slid|sliding|shrug|shrugs|shrugged|kick|kicks|kicked|tug|tugs|tugged|lift|lifts|lifted|drop|drops|dropped|come|comes|came|coming|wriggle|wriggles|wriggled|peel|peels|peeled)\b[^.!?]{0,60}?\b(?:off|out of|over (?:her|his|their|my|your) head|to the floor)\b/i;
const CLOTHES = /\b(?:clothes|clothing|dress|shirt|top|blouse|jeans|trousers|pants|skirt|sweater|jumper|cardigan|bra|underwear|socks?|shoes?|boots?|jacket|coat|tee|t-shirt|robe|towel|shorts|stockings|tights|vest|waistcoat)\b/i;
/**
 * Whether the lines plainly have clothes coming off: the only thing that undresses anyone on the sheet. `pieces`: what
 * the sheet has them in, any of which the lines may name instead of a word for clothes.
 */
export const undressSaid = (said: string, pieces: readonly string[]): boolean => BARE_SAID.test(said) || (COMES_OFF.test(said) && (CLOTHES.test(said) || pieces.some((p) => saidIn(said, p))));
/** How a piece is worn now: said by the read, it replaces the sheet's wording for that piece. */
const WORN_HOW = /\b(?:open|unbuttoned|undone|unzipped|rolled|pushed up|hitched|loosened|half|off one shoulder|untucked|askew)\b/i;
/** A thing listed as worn or held that says it's somewhere else ("coat (hung on hook by door)"). */
const PLACED =
  /\((?=[^)]*\b(?:on|over|by|in|at|under|beside|against|across|off)\b)[^)]*\)|\b(?:hung|hanging|draped|folded|left|lying|dropped|discarded|tossed|set down|put down|placed|resting|propped)\b|\b(?:on|over|by) the (?:hook|chair|floor|table|sofa|couch|bed|counter|rack|peg|door|windowsill|shelf|desk|stool|bench|banister|hanger|stand|back of)\b/i;
const ON_SOMEONE = /\b(?:shoulders?|arms?|neck|waist|hips?|head|back|lap|wrists?|fingers?|ears?|feet|hair)\b/i;
/** A place that is somebody ("on your shoulder"): never where a thing was put. ("The arm of the sofa" is furniture.) */
const SOMEBODY = /\b(?:your|my|her|his|their)\s+(?:shoulders?|knees?|lap|chest|arms?|hands?|cheeks?|waist|hips?|back|neck|thighs?|legs?|face|hair|lips|mouth|head|skin|side|stomach|ribs|jaw|chin|collarbone|fingers?|palms?|wrists?|feet|foot|ears?|nose|brow|forehead|throat|body)\b/i;

const OBJ = `(it|them|(?:my|her|his|their|the|your)\\s+[^.,;!?"“”]{2,40}?)`;
const PLACE = `((?:on|onto|over|by|in|into|inside|across|beside|against|at|under|behind|next to|near|atop|on top of)\\s+[^.,;!?"“”]{2,50})`;
/** "hang it on the hook by the door", "set the parcel on the windowsill": a thing put somewhere. */
const PUT_DOWN = new RegExp(
  `\\b(?:hang|hangs|hung|drape|drapes|draped|leave|leaves|left|put|puts|set|sets|place|places|placed|drop|drops|dropped|toss|tosses|tossed|lay|lays|laid|fold|folds|folded|prop|props|propped|rest|rests|rested|tuck|tucks|tucked|slide|slides|slid|hook|hooks|hooked|park|parks|parked)\\s+${OBJ}\\s+(?:down\\s+|back\\s+|up\\s+|away\\s+)?${PLACE}`,
  "gi",
);
/** "take off my coat", "shrugged her cardigan off": a piece taken off, with nowhere said. */
const TAKE_OFF = new RegExp(
  `\\b(?:take|takes|took|taking|pull|pulls|pulled|slip|slips|slipped|shrug|shrugs|shrugged|kick|kicks|kicked|peel|peels|peeled|tug|tugs|tugged|slide|slides|slid|strip|strips|stripped)\\s+(?:off\\s+${OBJ}(?=\\s*(?:,|\\band\\b|\\bthen\\b|[.;!?"”]|$))|${OBJ}\\s+off\\b)`,
  "gi",
);
/** "I hand you a small paper parcel", "I pass the bottle to you": the viewer gives the character a thing. */
const HAND_OVER = new RegExp(
  `\\b(?:hand|hands|handed|give|gives|gave|pass|passes|passed|bring|brings|brought|toss|tosses|tossed)\\s+(?:you\\s+(?:back\\s+)?((?:a|an|the|my|your|some|two|three|this|that)\\s+[^.,;!?"“”]{2,60})|((?:a|an|the|my|some|two|three|this|that)\\s+[^.,;!?"“”]{2,60}?)\\s+(?:over\\s+)?(?:to|at)\\s+you\\b)`,
  "gi",
);
/** "picked her glass up again", "I take my coat from the hook": a thing that was somewhere around them, now in hand. */
const PICK_UP = new RegExp(
  `\\b(?:pick|picks|picked|grab|grabs|grabbed|lift|lifts|lifted|scoop|scoops|scooped|retrieve|retrieves|retrieved|take|takes|took|fetch|fetches|fetched)\\s+(?:up\\s+)?${OBJ}(?=\\s*(?:,|\\band\\b|\\bthen\\b|\\bup\\b|\\bfrom\\b|\\bagain\\b|[.;!?"”]|$))`,
  "gi",
);
/** A thing or a place without the clause that follows it ("on the hook by the door and turn to you" → "on the hook by the door"). */
const tail = (s: string): string => clean(s.split(/\s+(?:and|then|before|while|as|so|but|because|until|when|where|which|that)\s+|\s+(?:i|we|you|she|he|they)\s+/i)[0]);
const noOwner = (s: string): string => clean(s.replace(/\b(?:her|his|their|your|my)\s+(?:own\s+)?/gi, "the "));
const untagged = (item: string): string => clean(item.replace(/\s*\((?:taken off|put down)\)\s*$/i, ""));
/** A thing without where it was ("a glass on the side table" → "a glass"): how it's said once it's in a hand. */
const inHandNow = (item: string): string => clean(untagged(item).replace(/\s+(?:on|onto|over|by|in|into|inside|at|under|behind|beside|against|across|near|atop|hung|hanging|draped|folded|left|lying)\b.*$/i, ""));

export type SettleContext = {
  /** The character's first name. */
  name: string;
  /** The sheet so far; null for a first read. */
  base: SceneSheet | null;
  /** What the character starts in, while the sheet doesn't say what they have on. */
  seed?: { place: string; wearing: string | null } | null;
  /** The lines the read was shown, oldest first. */
  lines: readonly TrackerLine[];
};

/**
 * The sheet that's kept of a read's answer: the answer held to what the lines and the sheet so far allow (the header
 * has the five things it rules out). In order: each line is tidied into its things; what the character has on falls
 * back to the sheet's, or to what they start in, unless the lines change it; nothing new stays that the lines don't
 * mention; the lines' own put-downs, take-offs and hand-overs move what they name; a thing the sheet had and no line
 * touched goes back where it was; and a thing ends up in one place. A good answer comes through as it was written.
 */
export function settleSheet(read: SheetRead, ctx: SettleContext): SceneSheet {
  const { name } = ctx;
  const moved = ctx.lines.some((l) => l.who === "moved");
  const spoken = ctx.lines.filter((l) => l.who !== "moved");
  const said = spoken.map((l) => l.text).join(" \n ");
  const theirs = spoken.filter((l) => l.who === "them").map((l) => l.text).join(" \n ");
  const base = listsOf(ctx.base ?? NO_SHEET);
  // Until something has said what the character has on, what they start in stands in for it.
  const fromSeed = base.themWorn.length === 0;
  const themBefore = fromSeed ? things(ctx.seed?.wearing) : base.themWorn;
  const known = [...themBefore, ...base.themHeld, ...base.youWorn, ...base.youHeld, ...base.around];
  const undressing = undressSaid(said, [...themBefore, ...base.youWorn]);
  const who = new RegExp(`\\b${esc(name)}(?:'s|’s)?\\s+`, "gi");
  /** A thing in plain words: nobody's name, nobody's "her" or "the person's". */
  const plain = (item: string): string => clean(item.replace(who, "").replace(/\b(?:the )?person(?:'s|’s)?\s+/gi, "").replace(/\b(?:her|his|their|your|my)\s+(?:own\s+)?/gi, "the ").replace(/^(?:holding|carrying|wearing)\s+/i, ""));
  const tidy = (list: readonly string[], worn = true): string[] => list.map(plain).filter((t) => t !== "" && !NOT_A_THING.test(t) && !(worn && NOT_WORN.has(head(t))));
  const once = (list: string[]): string[] => list.filter((t, i) => list.findIndex((x) => x === t || sameThing(x, t)) === i);

  const l: Lists = { where: "", themWorn: [], themHeld: [], youWorn: [], youHeld: [], around: [] };
  const them = wornAndHeld(read.themWears);
  const you = wornAndHeld(read.youWears);
  l.themHeld = tidy([...heldThings(read.themHolds), ...them.held]);
  l.youHeld = tidy([...heldThings(read.youHolds), ...you.held]);
  // A thing "around" that says whose hand it's in is in that hand.
  const inHand = new RegExp(`\\s*\\(?\\b(?:in|held (?:in|by))\\s+(?:the\\s+)?(${esc(name)}|person)(?:'s|’s)?(?:\\s+(?:own\\s+)?(?:hands?|grip|lap|arms?))?\\)?`, "i");
  for (const t of things(read.around)) {
    const by = inHand.exec(t);
    if (!by) l.around.push(t);
    else (by[1].toLowerCase() === "person" ? l.youHeld : l.themHeld).push(clean(t.replace(inHand, "")));
  }
  l.around = tidy(l.around, false);
  l.themHeld = tidy(l.themHeld);
  l.youHeld = tidy(l.youHeld);

  // Where: the place and the spot in it, with nobody in it.
  const people = new RegExp(`\\b(?:${esc(name)}(?!'s|’s)|person|people|viewer|you|she|he|they|both|each other|together|two of them)\\b`, "i");
  const posture = /\b(?:sitting|seated|sat|sits|standing|stood|stands|leaning|leans|leaned|lying|lies|kneeling|kneels|perched|crouched|curled|waiting|facing|watching|looking|holding|wearing)\b/i;
  const where = things(read.where, true)
    .filter((part) => !people.test(part) && !posture.test(part))
    .map((part) => clean(part.replace(new RegExp(`\\b${esc(name)}(?:'s|’s)\\s+(?:own\\s+)?`, "gi"), "the ").replace(/\b(?:the )?person(?:'s|’s)\s+/gi, "the ").replace(/\b(?:her|his|their|your|my)\s+(?:own\s+)?/gi, "the ")))
    .filter(Boolean)
    .join(", ");
  l.where = where || (moved ? "" : base.where);

  /**
   * What someone has on: the read's answer when the lines bear it out, else what the sheet had. `ground`: the lines a
   * new piece has to be mentioned in (the viewer's own, for the viewer).
   */
  const worn = (raw: string, answer: string[], before: string[], ground: string, seeded: boolean): string[] => {
    const fresh = tidy(answer);
    const wasBare = BARE.test(before.join(", "));
    if (BARE.test(clean(raw))) {
      // Undressed is only what the lines plainly say: from silence it's whatever the sheet had.
      if (!wasBare && !undressing) return before;
      const left = fresh.filter((t) => !/^(?:naked|nude|undressed|unclothed)$/i.test(t));
      for (const piece of before) if (piece !== BARE_LINE && !left.some((t) => sameThing(t, piece)) && !l.around.some((t) => sameThing(t, piece))) l.around.push(`${piece} (taken off)`);
      return left.length ? left : [BARE_LINE];
    }
    const had = before.filter((t) => t !== BARE_LINE);
    const grounded = fresh.filter((t) => saidIn(ground, t) || had.some((b) => sameThing(b, t)));
    if (!grounded.length) return before;
    // What they start in was never said by a line: the first piece of clothing the lines do name replaces it, and
    // something that only goes with an outfit (bare feet, an apron) is added to it.
    if (seeded) return grounded.some((t) => !GOES_WITH.has(head(t))) ? grounded : [...had, ...grounded.filter((t) => !had.some((b) => sameThing(b, t)))];
    const out: string[] = [];
    for (const piece of had) {
      const now = grounded.find((t) => sameThing(t, piece));
      if (now) out.push(WORN_HOW.test(now) ? now : piece);
      // Left out by the read: off only when the lines name it and have clothes coming off; else it's still on.
      else if (saidIn(said, piece) && undressing) {
        if (!l.around.some((t) => sameThing(t, piece))) l.around.push(`${piece} (taken off)`);
      } else out.push(piece);
    }
    return [...out, ...grounded.filter((t) => !had.some((b) => sameThing(b, t)))];
  };
  // A thing listed as worn that says it's somewhere else isn't worn: it goes to "around" as it's written.
  const placedOut = (list: string[]): string[] =>
    list.filter((t) => {
      if (!PLACED.test(t) || ON_SOMEONE.test(t)) return true;
      l.around.push(plain(t.replace(/[()]/g, " ")));
      return false;
    });
  l.themWorn = worn(read.themWears, placedOut(them.worn), themBefore, `${said} ${themBefore.join(" ")}`, fromSeed);
  l.youWorn = worn(read.youWears, placedOut(you.worn), base.youWorn, theirs, false);
  l.themHeld = placedOut(l.themHeld);
  l.youHeld = placedOut(l.youHeld);

  // Nothing new that neither the lines nor the sheet so far mention.
  const grounded = (t: string) => saidIn(said, t) || known.some((k) => sameThing(k, t));
  l.themHeld = l.themHeld.filter(grounded);
  l.youHeld = l.youHeld.filter(grounded);
  l.around = l.around.filter(grounded);

  // A thing the sheet had that no line mentions is exactly where it was, whatever the answer did with it: back in the
  // hand or the place it was in, and out of anywhere else. (Not what was around them once the scene has moved, and
  // not the clothes of someone the lines have just undressed.)
  const all = () => [l.themWorn, l.themHeld, l.youWorn, l.youHeld, l.around];
  const stay = (list: string[], before: readonly string[]) => {
    for (const thing of before) {
      if (thing === BARE_LINE || saidIn(said, thing)) continue;
      for (const other of all()) {
        if (other === list) continue;
        for (let i = other.length - 1; i >= 0; i--) if (sameThing(other[i], thing)) other.splice(i, 1);
      }
      if (!list.some((t) => sameThing(t, thing))) list.push(thing);
    }
  };
  const bare = (list: readonly string[]) => BARE.test(list.join(", "));
  stay(l.themHeld, base.themHeld);
  stay(l.youHeld, base.youHeld);
  if (!moved) stay(l.around, base.around);
  if (!fromSeed && !bare(l.themWorn)) stay(l.themWorn, base.themWorn);
  if (!bare(l.youWorn)) stay(l.youWorn, base.youWorn);

  // The lines' own put-downs, take-offs, hand-overs and pick-ups, in the order they're said.
  const placedByLine = new Set<string>();
  for (const line of spoken) {
    const mine = line.who === "them";
    // What's done, not what's said: "Put your coat on the chair," she said, moves nothing.
    const text = line.text.replace(/“[^”]*”|"[^"]*"/g, " ");
    const nets: { at: number; kind: "down" | "off" | "over" | "up"; thing: string; place?: string }[] = [];
    for (const m of text.matchAll(PUT_DOWN)) nets.push({ at: m.index ?? 0, kind: "down", thing: String(m[1] ?? ""), place: String(m[2] ?? "") });
    for (const m of text.matchAll(TAKE_OFF)) nets.push({ at: m.index ?? 0, kind: "off", thing: String(m[1] ?? m[2] ?? "") });
    if (mine) for (const m of text.matchAll(HAND_OVER)) nets.push({ at: m.index ?? 0, kind: "over", thing: String(m[1] ?? m[2] ?? "") });
    for (const m of text.matchAll(PICK_UP)) nets.push({ at: m.index ?? 0, kind: "up", thing: String(m[1] ?? "") });
    nets.sort((x, y) => x.at - y.at);
    for (const net of nets) {
      const thing = tail(net.thing);
      const owner = /^(my|your|her|his|their|the)\s+/i.exec(thing)?.[1]?.toLowerCase() ?? null;
      const pronoun = /^(?:it|them)$/i.test(thing);
      // Whose thing it's likeliest to be: "my" is the speaker's, "your" the other's; "it" is whichever was last named.
      const first = owner === "my" ? mine : owner === "your" ? !mine : owner && owner !== "the" ? false : mine;
      const yours = [l.youWorn, l.youHeld];
      const hers = [l.themWorn, l.themHeld];
      const loose = l.around.filter((t) => /\((?:taken off|put down)\)$/i.test(t));
      const pools = net.kind === "off" ? (first ? [l.youWorn, l.themWorn] : [l.themWorn, l.youWorn]) : [...(first ? [...yours, ...hers] : [...hers, ...yours]), ...(net.kind === "down" ? [l.around] : [])];
      const before = text.slice(0, net.at).toLowerCase();
      let last = -1;
      if (net.kind === "up") {
        // Picked up: only a thing that was somewhere around them (now, or on the sheet before this read lost it).
        const on = [...l.around, ...base.around.filter((t) => !all().some((list) => list.some((x) => sameThing(x, t))))];
        let hit: string | null = null;
        for (const item of on) {
          const at = pronoun ? before.lastIndexOf(head(item)) : sameThing(item, thing) ? 0 : -1;
          if (head(item).length > 2 && at > last) {
            last = at;
            hit = item;
          }
        }
        if (!hit || NOT_A_PROP.has(head(hit))) continue;
        const picked = hit;
        l.around = l.around.filter((t) => t !== picked);
        const hands = mine ? l.youHeld : l.themHeld;
        if (!hands.some((t) => sameThing(t, picked))) hands.push(inHandNow(picked));
        continue;
      }
      let found: { list: string[]; item: string } | null = null;
      for (const list of pools) {
        for (const item of list) {
          if (list === l.around && !loose.includes(item)) continue;
          if (pronoun) {
            const at = before.lastIndexOf(head(item));
            if (head(item).length > 2 && at > last) {
              last = at;
              found = { list, item };
            }
          } else if (!found && sameThing(item, thing)) found = { list, item };
        }
      }
      // The viewer's own "my coat" is a thing even when the answer never listed it.
      let named: string | null = null;
      if (!found && mine) {
        const own = pronoun ? [...before.matchAll(/\bmy\s+([^.,;!?"“”]{2,40}?)(?=\s*(?:,|\band\b|\bthen\b|[.;!?]|$))/g)].pop()?.[1] : owner === "my" || net.kind === "over" ? thing.replace(/^my\s+/i, "") : null;
        if (own && !NOT_A_PROP.has(head(own))) named = clean(own);
      }
      if (NOT_A_PROP.has(head(found?.item ?? named ?? thing))) continue;
      if (net.kind === "over") {
        // Handed to the character: in their hands, unless it's already somewhere on the sheet that isn't the viewer's.
        const item = found && yours.includes(found.list) ? found.item : named;
        if (found && yours.includes(found.list)) found.list.splice(found.list.indexOf(found.item), 1);
        else if (!item || [...l.themWorn, ...l.themHeld, ...l.around].some((t) => sameThing(t, item))) continue;
        l.themHeld.push(item!);
        continue;
      }
      const item = found ? untagged(found.item) : named;
      // Nothing to move, or the answer already has it somewhere: it's left as the answer has it.
      if (!item || (!found && l.around.some((t) => sameThing(t, item)))) continue;
      if (net.kind === "down") {
        const place = tail(net.place ?? "");
        // Somewhere, not somebody, and not into or over other clothes: a shirt tucked into jeans, stockings "left on
        // as she…" and a cardigan put back on over a tee are all still worn.
        if (place.split(" ").length < 2 || SOMEBODY.test(place) || CLOTHES.test(place) || [...l.themWorn, ...l.youWorn].some((w) => saidIn(place, w))) continue;
        if (found) found.list.splice(found.list.indexOf(found.item), 1);
        l.around = [`${item} ${noOwner(place).slice(0, 60)}`, ...l.around.filter((t) => !sameThing(t, item))];
        placedByLine.add(head(item));
      } else {
        if (found) found.list.splice(found.list.indexOf(found.item), 1);
        if (!l.around.some((t) => sameThing(t, item))) l.around.unshift(`${item} (taken off)`);
        placedByLine.add(head(item));
      }
    }
  }

  // One place for each thing. Somewhere "around" wins over someone's hands or back, unless the lines have it picked
  // up, or the sheet had it on them and no line said otherwise.
  const pickedUp = (t: string) => new RegExp(`\\b(?:pick|picks|picked|picking|take|takes|took|taking|grab|grabs|grabbed|lift|lifts|lifted|reach|reaches|reached|scoop|scoops|scooped|retrieve|retrieves|retrieved)\\b[^.!?]{0,40}\\b${esc(head(t))}`, "i").test(said);
  for (const a of [...l.around]) {
    for (const [list, had] of [[l.themWorn, themBefore], [l.themHeld, base.themHeld], [l.youWorn, base.youWorn], [l.youHeld, base.youHeld]] as const) {
      const i = list.findIndex((t) => sameThing(t, a));
      if (i < 0) continue;
      const stays = !placedByLine.has(head(a)) && (pickedUp(a) || (had.some((t) => sameThing(t, a)) && !base.around.some((t) => sameThing(t, a)) && !saidIn(said, a)));
      if (stays) l.around = l.around.filter((t) => t !== a);
      else list.splice(i, 1);
    }
  }
  // Clothes never empty by themselves: with nothing left of an answer, what the sheet had stands.
  if (!l.themWorn.length && !undressing) l.themWorn = themBefore.filter((t) => !l.around.some((a) => sameThing(a, t)));

  return {
    where: sheetLine(l.where),
    them: sheetLine(personLine(once(l.themWorn), once(l.themHeld))),
    you: sheetLine(personLine(once(l.youWorn), once(l.youHeld))),
    around: sheetLine(once(l.around).slice(0, AROUND_MAX).join("; ")),
  };
}
