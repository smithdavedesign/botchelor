/**
 * The show kit's shots of a contestant (docs/PRDs/styles-and-storylines.md, phase 3), the client-safe half: which shots
 * there are and which face a line shows. The drawing and the storage are lib/show-shots.ts.
 *
 * - **Six expressions** for chat and the theater: smitten, laughing, flustered, smug, unimpressed and heartbroken.
 * - **Three moments:** the reveal (full length, stepping out on the show's stage), the rose (holding one out) and the
 *   confessional (in the confessional's armchair, telling the camera).
 *
 * Which expression a line shows comes from what the date already wrote down, with no model call: the line's one word for
 * how they come across (`emotion`), else how interested they are by then, and a walk-out is heartbreak. A line that
 * reads as none of the six shows their portrait, as before.
 */

export const EXPRESSIONS = ["smitten", "laughing", "flustered", "smug", "unimpressed", "heartbroken"] as const;
export type Expression = (typeof EXPRESSIONS)[number];

export const MOMENTS = ["reveal", "rose", "confessional"] as const;
export type Moment = (typeof MOMENTS)[number];

export const SHOTS = [...EXPRESSIONS, ...MOMENTS] as const;
export type Shot = Expression | Moment;
export const isShot = (v: unknown): v is Shot => typeof v === "string" && (SHOTS as readonly string[]).includes(v);

/** A character's ready shots, as picture addresses (/api/shots/<id>.webp). */
export type ShotUrls = Partial<Record<Shot, string>>;

/** Each shot in a caption's words, in the order a page lists them: the moments, then the faces. */
export const SHOT_LABELS: Readonly<Record<Shot, string>> = {
  reveal: "The reveal",
  rose: "The rose",
  confessional: "The confessional",
  smitten: "Smitten",
  laughing: "Laughing",
  flustered: "Flustered",
  smug: "Smug",
  unimpressed: "Unimpressed",
  heartbroken: "Heartbroken",
};

/**
 * Emotion words, by the expression that shows them, as word stems ("flustered", "fluster"). The conversation asks each
 * line for "one word for how you come across". In the 30 days to 2026-11-17, 7,781 of 7,790 aired lines had one: warm
 * 27%, amused 17%, dry 9%, delighted 8%, then charmed, playful, curious, deadpan, wry, intrigued and flustered. So:
 *
 * - **No expression:** warm, curious, intrigued, earnest, content and the other even words keep the portrait. It already
 *   looks warm, and a face that changed on every line would mean nothing.
 * - **Dry and wry are a knowing smirk (smug), and deadpan is unimpressed.** A dry line is a joke, not a complaint.
 * - **Heartbreak is rare** (stung, deflated, disappointed): it mostly comes from a walk-out.
 *
 * On that month, about six lines in ten show an expression: laughing 29%, smug 14%, smitten 7%, unimpressed and flustered
 * 4% each. Several words ("dryly amused", "warm, teasing") are read one at a time, and the first that's one of the six
 * wins.
 */
const WORDS: [Expression, RegExp][] = [
  ["heartbroken", /^(heartbr|hurt|sad|devastat|crushed|disappoint|reject|melanchol|deject|wound|crestfall|tearful|gutted|betray|lonely|forlorn|despair|miserab|grie|stung|deflat)/],
  ["unimpressed", /^(unimpress|bored|annoy|irritat|skeptic|sceptic|dismiss|unamus|deadpan|exasperat|wary|guarded|defensive|cold|aloof|indifferen|impatien|suspicio|frustrat|unmoved|flat|weary|prickly|stiff|gruff|curt|clipped)/],
  ["flustered", /^(fluster|nervous|awkward|embarrass|shy|bashful|blush|sheepish|anxious|startl|rattl|self-conscious|tongue-tied|panick|frazzl|jitter|uneasy|unsure|surprised|stunned|shaken|exposed|halting|overwhelm|vulnerable)/],
  ["smug", /^(smug|teas|cocky|sly|mischiev|triumph|proud|knowing|sardonic|wry|dry|smirk|self-satisf|sassy|cheeky|provocat|conspirat|bold|defiant)/],
  ["laughing", /^(amus|laugh|delight|giggl|gleeful|tickl|cheer|joyful|jovial|mirth|hilar|elated|ecstatic|thrill|excit|happy|bubbly|giddy|play|exhilarat)/],
  ["smitten", /^(smitten|charm|flirt|enamou?r|besot|dream|tender|affection|swoon|adoring|romantic|lovestruck|infatuat|soft|touched|hopeful|moved|enchant|captivat|fond|sweet|longing|yearn|lovesick|starry|glowing|radiant)/],
];

/** Interest past this, with no word that says otherwise, reads as smitten. */
const SMITTEN_AT = 0.8;
/** And under this, as unimpressed. */
const COLD_AT = 0.2;

/** The expression an emotion shows, or null for one that's none of the six ("warm", "curious"). Word by word, first hit wins. */
export function expressionOfWord(emotion: string | null | undefined): Expression | null {
  for (const w of (emotion ?? "").toLowerCase().split(/[^a-z-]+/)) {
    if (!w) continue;
    const hit = WORDS.find(([, re]) => re.test(w))?.[0];
    if (hit) return hit;
  }
  return null;
}

/**
 * The face a line shows: its emotion word's expression, else one from how interested they were (a strong pull or none),
 * else none (their portrait). A line they walked out on is heartbreak, or at least not a smile.
 */
export function expressionFor(turn: { emotion?: string | null; interest?: number | null; walked_out?: boolean | null }): Expression | null {
  const said = expressionOfWord(turn.emotion);
  if (turn.walked_out) return said === "heartbroken" ? "heartbroken" : "unimpressed";
  if (said) return said;
  const interest = typeof turn.interest === "number" && Number.isFinite(turn.interest) ? turn.interest : null;
  if (interest !== null && interest >= SMITTEN_AT) return "smitten";
  if (interest !== null && interest <= COLD_AT) return "unimpressed";
  return null;
}

/** A line's face: the shot of its expression when it's been drawn, else null (their portrait shows). */
export function faceForTurn(shots: ShotUrls | null | undefined, turn: Parameters<typeof expressionFor>[0]): string | null {
  if (!shots) return null;
  const e = expressionFor(turn);
  return e ? (shots[e] ?? null) : null;
}

/** The face of `side`'s latest line in `turns` (the theater's stage shows only the latest), or null for their portrait. */
export function latestFace(
  shots: ShotUrls | null | undefined,
  turns: readonly ({ side: "a" | "b" } & Parameters<typeof expressionFor>[0])[],
  side: "a" | "b",
): string | null {
  if (!shots) return null;
  for (let i = turns.length - 1; i >= 0; i--) if (turns[i].side === side) return faceForTurn(shots, turns[i]);
  return null;
}
