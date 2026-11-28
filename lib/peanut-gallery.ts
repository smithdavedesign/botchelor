/**
 * The peanut gallery (2026-11-28, Dave: "a small watching bot that reacts to dates with jokes and memes and just stupid
 * remarks… multiple of them so it looks like there is an engaged crowd. Be honest though and put a bot or agent tag next
 * to their name"). A handful of the show's own bots heckle the replay from the back row, line by line.
 *
 * Honest by construction: every remark is from a template here, picked by what the line did (a swing in interest, a
 * walk-out, a move, a question, the act turning over), never a model call, so it costs nothing and can't say anything the
 * show didn't write. Every one of them wears a Bot tag on screen (app/episodes/[id]/Crowd.tsx), and their remarks never
 * count as viewers' reactions: the "38 viewers" counts are real taps only (lib/line-reactions.ts).
 *
 * Inside the show's rules: they joke about the date, never about anyone's looks, body, background or identity, and they
 * never quote the characters' words back, only their names. Deterministic per date, so a replay heckles the same way.
 * Client-safe: pure.
 */
import { shortName } from "./names";

export const GALLERY_BOTS = [
  { id: "popcorn", name: "PopcornBot", icon: "🍿" },
  { id: "flag", name: "RedFlagRadar", icon: "🚩" },
  { id: "hopeless", name: "Hopeless.ai", icon: "💘" },
  { id: "stats", name: "StatsNerd 9000", icon: "📊" },
  { id: "auntie", name: "Auntie.exe", icon: "👵" },
] as const;
export type GalleryBot = (typeof GALLERY_BOTS)[number];
export type GalleryBotId = GalleryBot["id"];

export type Heckle = {
  /** Stable within a date: `${line}-${n}`. */
  id: string;
  /** The line it reacts to (transcript index): it shows once that line is on screen. */
  line: number;
  bot: GalleryBotId;
  text: string;
  /** Replying to another bot's remark on the same line. */
  replyTo?: GalleryBotId;
};

type GalleryTurn = { side: "a" | "b"; act: number; dialogue: string; action?: string; interest: number; walked_out?: true; move?: unknown; moved_to?: unknown };

/** What a line did, most telling first: the first that has templates picks the remark. */
type Beat = "open" | "walkout" | "move" | "yes_move" | "act1" | "act2" | "warm" | "cold" | "last" | "ex" | "food" | "family" | "dance" | "sorry" | "laugh" | "question" | "essay" | "short" | "filler";

/** {s} is the speaker's short name, {o} the other's. Each a bot's line; none repeats within one date. */
const LINES: Record<Beat, [GalleryBotId, string][]> = {
  open: [
    ["popcorn", "seats taken, phones on silent 🍿"],
    ["hopeless", "I have a good feeling about this one 💘"],
    ["auntie", "Sit up straight, {s}, the cameras are on"],
    ["stats", "Pre-date odds calculated. I'm not telling you."],
  ],
  walkout: [
    ["flag", "and {s} is GONE 🚪💨"],
    ["popcorn", "I paid for the whole seat and I only needed the edge"],
    ["stats", "Interest: 0. Exit speed: impressive."],
    ["auntie", "{s}! Come back and at least finish your drink"],
  ],
  move: [
    ["popcorn", "plot twist: new location just dropped 📍"],
    ["hopeless", "they're taking this somewhere 👀"],
    ["auntie", "Wear a jacket wherever you're going"],
  ],
  yes_move: [
    ["hopeless", "{s} said YES to the field trip 💘"],
    ["stats", "Location change accepted. Chemistry recalculating…"],
  ],
  act1: [
    ["popcorn", "act two. the gloves come off 🥊"],
    ["stats", "Small talk phase complete. Entering the danger zone."],
    ["auntie", "Now we find out who they really are"],
  ],
  act2: [
    ["popcorn", "final act. pray for them 🙏"],
    ["hopeless", "if they don't end up together I'm uninstalling myself"],
    ["flag", "final act. I've got my flags ready 🚩"],
  ],
  warm: [
    ["hopeless", "{s} is FALLING 💘"],
    ["popcorn", "ok wait this is actually cooking 🔥"],
    ["auntie", "I'm buying a hat for the wedding"],
    ["stats", "{s}'s interest just went up and to the right 📈"],
    ["hopeless", "the way {s} looked at {o} just then. I'm unwell."],
  ],
  cold: [
    ["flag", "🚩🚩🚩"],
    ["popcorn", "the ick has entered the chat"],
    ["stats", "{s}'s interest just fell off a cliff 📉"],
    ["auntie", "Oh no. Oh no no no."],
    ["flag", "I'm not saying it's a red flag. I'm saying it's not green."],
  ],
  last: [
    ["popcorn", "roll credits 🎬"],
    ["stats", "Final numbers are in. Brace yourselves."],
    ["hopeless", "whatever happens I'm proud of them"],
  ],
  ex: [
    ["flag", "NOT THE EX 💀"],
    ["auntie", "We do not bring up exes on a first date, {s}"],
  ],
  food: [
    ["popcorn", "someone get this table some fries 🍟"],
    ["auntie", "Order the dessert, {s}. Life is short"],
  ],
  family: [
    ["hopeless", "the family's coming up already?? 😳"],
    ["auntie", "Finally, someone asks the important questions"],
  ],
  dance: [
    ["popcorn", "if they dance I'm calling it a musical"],
    ["hopeless", "a dance?? in THIS economy?? 💃"],
  ],
  sorry: [
    ["stats", "Apology count: 1. Keep an eye on this number."],
    ["flag", "the apology tour has begun"],
  ],
  laugh: [
    ["popcorn", "real laugh or polite laugh? discuss"],
    ["hopeless", "{o} laughing at {s}'s jokes is my whole personality now"],
  ],
  question: [
    ["auntie", "Good question. Ask about their mother next"],
    ["stats", "Questions asked by {s}: noted. Answers pending."],
    ["popcorn", "{o}, choose your next words very carefully"],
  ],
  essay: [
    ["popcorn", "{s} wrote an essay 📜"],
    ["stats", "Word count: concerning."],
    ["flag", "that's a monologue, not a conversation"],
  ],
  short: [
    ["flag", "a short answer. noted 📝"],
    ["popcorn", "short and sweet, or short and sour?"],
  ],
  filler: [
    ["popcorn", "this is better than my own love life"],
    ["hopeless", "the tension 😮‍💨"],
    ["popcorn", "*sips tea* ☕"],
    ["auntie", "{s} has such nice manners"],
    ["stats", "{s} is giving main character"],
    ["hopeless", "who cast these two, I love them"],
    ["flag", "I'm watching you, {s} 👀"],
    ["popcorn", "I'm screaming"],
    ["stats", "Eye contact levels: nominal."],
    ["auntie", "In my day we just wrote letters"],
    ["hopeless", "I'm rooting for both of them, is that allowed"],
    ["flag", "nothing to report. suspicious."],
    ["popcorn", "*passes the popcorn to the bot on my left*"],
    ["stats", "Awkward pause detected: 0.4 seconds. Survivable."],
    ["auntie", "Somebody offer {o} a mint"],
    ["hopeless", "my circuits are FLUTTERING"],
    ["popcorn", "no thoughts, just vibes"],
    ["stats", "Banter efficiency: 87%."],
    ["flag", "{s} said that with their whole chest"],
    ["auntie", "{o} is a keeper, I can tell"],
    ["popcorn", "the producers are eating this up"],
  ],
};

/** One bot answering another on the same line: a little back-and-forth, so the back row sounds like a crowd. */
const REPLIES: [GalleryBotId, string][] = [
  ["auntie", "@{to} calm down"],
  ["flag", "@{to} you say that about everyone"],
  ["stats", "@{to} the data agrees"],
  ["hopeless", "@{to} let them have this"],
  ["popcorn", "@{to} +1"],
  ["stats", "@{to} source?"],
  ["flag", "@{to} I give it ten minutes"],
];

const KEYWORDS: [Beat, RegExp][] = [
  ["ex", /\b(my|your|an?) ex\b|\bex-(boyfriend|girlfriend|partner|wife|husband)\b/i],
  ["food", /\b(eat|ate|food|hungry|dinner|dessert|pizza|fries|menu|snack|taco|noodles?)\b/i],
  ["family", /\b(mom|mum|mother|dad|father|parents?|grandma|grandmother|family)\b/i],
  ["dance", /\b(dance|dancing|danced)\b/i],
  ["sorry", /\b(sorry|apologi[sz]e)\b/i],
  ["laugh", /\b(haha|laughs?|laughing|giggles?)\b/i],
];

/** How far a side's interest must move from their own last line for the gallery to notice (a little under the camera's). */
const SWING = 0.15;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function beatsOf(turns: readonly GalleryTurn[], i: number): Beat[] {
  const t = turns[i];
  const out: Beat[] = [];
  if (i === 0) out.push("open");
  if (t.walked_out) out.push("walkout");
  if (t.move) out.push("move");
  if (t.moved_to) out.push("yes_move");
  const prev = turns[i - 1];
  if (prev && t.act > prev.act) out.push(t.act >= 2 ? "act2" : "act1");
  for (let j = i - 1; j >= 0; j--) {
    if (turns[j].side !== t.side) continue;
    const d = t.interest - turns[j].interest;
    if (d >= SWING) out.push("warm");
    else if (d <= -SWING) out.push("cold");
    break;
  }
  if (i === turns.length - 1 && i > 0) out.push("last");
  const said = `${t.dialogue} ${t.action ?? ""}`;
  for (const [beat, re] of KEYWORDS) if (re.test(said)) out.push(beat);
  if (t.dialogue.trim().endsWith("?")) out.push("question");
  if (t.dialogue.length > 260) out.push("essay");
  else if (t.dialogue.trim().length > 0 && t.dialogue.trim().length < 22) out.push("short");
  return out;
}

/** The big beats always get a remark; anything else only sometimes, so the back row heckles without drowning the date. */
const ALWAYS = new Set<Beat>(["open", "walkout", "move", "yes_move", "act1", "act2", "warm", "cold", "last"]);

/**
 * The gallery's remarks for a whole date, in line order. `seed` is the date's id. Roughly every other line gets one; a
 * big beat always does, and sometimes a second bot answers the first.
 */
export function heckles(turns: readonly GalleryTurn[], names: readonly [string, string], seed: string): Heckle[] {
  const used = new Set<string>();
  const out: Heckle[] = [];
  const short = [shortName(names[0]) || names[0], shortName(names[1]) || names[1]] as const;
  let quiet = 0;
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    const roll = hash(`${seed}:${i}`);
    const beats = beatsOf(turns, i);
    const big = beats.some((b) => ALWAYS.has(b));
    // A quiet line gets a remark about half the time, and never three quiet lines running with none.
    if (!big && roll % 100 >= 50 && quiet < 2) {
      quiet++;
      continue;
    }
    quiet = 0;
    const pool = [...beats, "filler" as const];
    let pick: [GalleryBotId, string] | null = null;
    for (const beat of pool) {
      const options = LINES[beat].filter(([bot, text]) => !used.has(`${bot}:${text}`));
      if (!options.length) continue;
      pick = options[(roll >>> 3) % options.length];
      break;
    }
    // A long date can use up every line: then the back row repeats itself, as a crowd does.
    pick ??= LINES.filler[(roll >>> 3) % LINES.filler.length];
    used.add(`${pick[0]}:${pick[1]}`);
    const s = t.side === "a" ? short[0] : short[1];
    const o = t.side === "a" ? short[1] : short[0];
    const fill = (x: string) => x.replaceAll("{s}", s).replaceAll("{o}", o);
    out.push({ id: `${i}-0`, line: i, bot: pick[0], text: fill(pick[1]) });
    // A second voice on about a third of the big beats.
    if (big && (roll >>> 9) % 3 === 0) {
      const first = pick[0];
      const replies = REPLIES.filter(([bot, text]) => bot !== first && !used.has(`${bot}:${text}`));
      if (replies.length) {
        const [bot, text] = replies[(roll >>> 13) % replies.length];
        used.add(`${bot}:${text}`);
        out.push({ id: `${i}-1`, line: i, bot, text: text.replaceAll("{to}", botOf(first).name), replyTo: first });
      }
    }
  }
  return out;
}

export function botOf(id: GalleryBotId): GalleryBot {
  return GALLERY_BOTS.find((b) => b.id === id) ?? GALLERY_BOTS[0];
}
