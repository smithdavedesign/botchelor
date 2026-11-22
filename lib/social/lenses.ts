/**
 * The Constellation's views (docs/PRDs/social-network.md section 9, Phase 3). Love is the Constellation as it always was
 * (lib/graph.ts, the show's dating track); Friends and family, Rivals, Gossip and Everything draw the social network's
 * public ties (lib/social/read.ts publicSky) on the same sky. This file is the views' vocabulary: their names and links,
 * each view's line groups (one chip each, which is both its legend entry and its filter), how a tie is drawn and which
 * group it's in, how a pair's ties fold into its lines, and each view's numbers line. Pure and browser-safe: it imports
 * the kinds registry and types only, so the page's client components use it as the server does.
 *
 * How the lines look (app/globals.css, the sky's social tokens): three hues, one per family of tie, the most a sky's
 * every pair can carry and stay apart for colour-blind eyes (the dataviz validator: green and red at ΔE 7.1 deutan, in
 * the band that needs a second cue): love green, as "Together" is in the Love view; friends, family, work and places
 * blue, as "Friends" is there; conflict red. Gossip and people who just met are the sky's neutrals. Within a family
 * every kind has its own dash, the same in its own view and in Everything, so no line is told by colour alone, and a
 * line keeps its look from view to view. A tie that feels bad (negative valence) is drawn red whatever its layer; a
 * conflict that cleared the air, and exes, are drawn grey.
 */
import type { GraphNode } from "../graph";
import { TIE_KINDS, type TieKindId } from "./kinds";
import type { Layer, PlaceKind, SharedRole, SkyLens, Valence } from "./types";

export const LENSES = ["love", "friends", "rivals", "gossip", "all"] as const;
export type Lens = (typeof LENSES)[number];

export const LENS_LABEL: Record<Lens, string> = { love: "Love", friends: "Friends and family", rivals: "Rivals", gossip: "Gossip", all: "Everything" };

export const isLens = (x: unknown): x is Lens => typeof x === "string" && (LENSES as readonly string[]).includes(x);

/** ?lens= (a shared view): Love, the Constellation, for anything it doesn't know. */
export function parseLens(v: unknown): Lens {
  const s = Array.isArray(v) ? v[0] : v;
  const lens = typeof s === "string" ? s.trim().toLowerCase() : "";
  return isLens(lens) ? lens : "love";
}

/** The address's ?lens=, or null for Love (the default needs none). */
export const lensParam = (lens: Lens): string | null => (lens === "love" ? null : lens);

/** A view's own link. */
export const lensHref = (lens: Lens): string => (lens === "love" ? "/graph" : `/graph?lens=${lens}`);

/* --------------------------------------------------- how lines look --------------------------------------------------- */

/** The sky's social line colours (app/globals.css): dark-sky colours, the same in both themes, as the sky is dark in both. */
export const SOCIAL_TOKENS = ["--social-love", "--social-friends", "--social-conflict", "--social-talk", "--social-met", "--social-calm"] as const;
export type SocialToken = (typeof SOCIAL_TOKENS)[number];

/**
 * Every way a social line is drawn. `dash` is in multiples of the line's width ([] is solid; 0 is a dot, drawn with
 * round caps), as the Love view's stages are (app/graph/stages.ts LINE_STYLE). `arrow`: a directed tie gets an arrowhead
 * from who did it to whom (who told whom, who talked about whom). `faint`: thin and dim, so it never hides the rest.
 */
export type LineStyle = { token: SocialToken; dash: readonly number[]; faint?: boolean; arrow?: boolean };

export const LINE_STYLES = {
  romance: { token: "--social-love", dash: [] },
  exes: { token: "--social-calm", dash: [3, 2.4, 0, 2.4] },
  kin: { token: "--social-friends", dash: [] },
  friendship: { token: "--social-friends", dash: [0, 2.6] },
  work: { token: "--social-friends", dash: [2.4, 2.6] },
  place: { token: "--social-friends", dash: [3, 2.4, 0, 2.4] },
  feud: { token: "--social-conflict", dash: [2.4, 2.6] },
  rival: { token: "--social-conflict", dash: [] },
  bad_blood: { token: "--social-conflict", dash: [3, 2.4, 0, 2.4] },
  enemy: { token: "--social-conflict", dash: [0, 2.6] },
  calm: { token: "--social-calm", dash: [2.4, 2.6] },
  met: { token: "--social-met", dash: [], faint: true },
  told: { token: "--social-talk", dash: [], arrow: true },
  talked_about: { token: "--social-talk", dash: [0, 2.6], arrow: true },
} as const satisfies Record<string, LineStyle>;
export type StyleKey = keyof typeof LINE_STYLES;

const RIVALRY = new Set<TieKindId>(["rival", "nemesis", "frenemy"]);
const ENMITY = new Set<TieKindId>(["enemy", "grudge"]);

/**
 * How one tie is drawn, in any view: romance green (exes and other cooled romance grey), friends and family blue by
 * layer, conflict red by kind (a conflict that cleared the air grey), the house's lines by who said what, and people who
 * just met faint. `dated` is drawn by the layer its stage put it on (lib/social/kinds.ts layerOfDated): a pair whose
 * dates ended in bad blood is on the conflict layer and draws as bad blood.
 */
export function styleOf(kind: TieKindId, layer: Layer, valence: number): StyleKey {
  switch (layer) {
    case "romance":
      return valence <= 0 ? "exes" : "romance";
    case "kin":
    case "friendship":
    case "work":
    case "place":
      return layer;
    case "conflict":
      if (valence >= 0) return "calm";
      if (kind === "feud") return "feud";
      if (kind === "bad_blood" || kind === "dated") return "bad_blood";
      if (ENMITY.has(kind)) return "enemy";
      return "rival";
    case "communication":
      return kind === "talked_about" ? "talked_about" : "told";
    default:
      return "met";
  }
}

/* ---------------------------------------------------- line groups ---------------------------------------------------- */

/** One of a view's chips: what it's called, what it holds (its title), and the line its swatch shows. */
export type LineGroup = { id: string; label: string; hint: string; style: StyleKey };

const FRIENDS_GROUPS: readonly LineGroup[] = [
  { id: "kin", label: "Family", hint: "Parents and children, siblings, cousins, in-laws", style: "kin" },
  { id: "friendship", label: "Friends", hint: "Best friends, friends, roommates, and pairs whose dates turned into friendship", style: "friendship" },
  { id: "work", label: "Work and school", hint: "Coworkers, classmates, teammates, bandmates, mentors", style: "work" },
  { id: "place", label: "Places", hint: "Neighbours, regulars at the same venue, people from the same town", style: "place" },
];

/**
 * Every view's chips, in order. Everything's are the layers (each drawn as its usual kind); the other views' are their
 * own kinds. Love has none here: its chips are the stage groups (app/graph/stages.ts).
 */
export const LENS_GROUPS: Record<SkyLens, readonly LineGroup[]> = {
  friends: FRIENDS_GROUPS,
  rivals: [
    { id: "feud", label: "Had it out", hint: "A confrontation in the house", style: "feud" },
    { id: "rival", label: "Rivals", hint: "Rivals, nemeses and frenemies: a challenge's winner, a story beat, a backstory", style: "rival" },
    { id: "bad_blood", label: "Bad blood", hint: "Dates that ended in bad blood", style: "bad_blood" },
    { id: "enemy", label: "Enemies and grudges", hint: "Enemies, and grudges held", style: "enemy" },
  ],
  gossip: [
    { id: "told", label: "Told", hint: "Told them something in an aired house scene (the arrow points at who heard it)", style: "told" },
    { id: "talked_about", label: "Talked about", hint: "Talked about them in an aired house scene (the arrow points at who was talked about)", style: "talked_about" },
  ],
  all: [
    { id: "romance", label: "Love", hint: "Dates, partners, crushes and exes", style: "romance" },
    ...FRIENDS_GROUPS,
    { id: "conflict", label: "Conflict", hint: "Feuds, rivals, bad blood, enemies", style: "rival" },
    { id: "acquaintance", label: "Met", hint: "Housemates, a group night together, a first date that went nowhere", style: "met" },
    { id: "communication", label: "Gossip", hint: "Who told whom, and who talked about whom, in aired house scenes", style: "told" },
  ],
};

/** The group a tie is in under a view, or null when the view doesn't draw it. */
export function groupOf(lens: SkyLens, kind: TieKindId, layer: Layer): string | null {
  if (lens === "all") return layer;
  if (lens === "friends") return layer === "kin" || layer === "friendship" || layer === "work" || layer === "place" ? layer : null;
  if (lens === "rivals") {
    if (layer !== "conflict") return null;
    if (kind === "feud") return "feud";
    if (kind === "bad_blood" || kind === "dated") return "bad_blood";
    if (ENMITY.has(kind)) return "enemy";
    return "rival";
  }
  if (layer !== "communication") return null;
  return kind === "talked_about" ? "talked_about" : "told";
}

/** A view's group by id. */
export const groupDef = (lens: SkyLens, id: string): LineGroup | null => LENS_GROUPS[lens].find((g) => g.id === id) ?? null;

/** A null choice is every group: the default. */
export type GroupChoice = ReadonlySet<string> | null;

/** A chip pressed: its group off if it was on, on if it was off. Every group on again is the default, null. */
export function toggleGroup(lens: SkyLens, choice: GroupChoice, id: string): GroupChoice {
  const all = LENS_GROUPS[lens].map((g) => g.id);
  const next = new Set<string>(choice ?? all);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return all.every((g) => next.has(g)) ? null : next;
}

/** Whether a group's lines are drawn under a choice. */
export const groupOn = (choice: GroupChoice, id: string): boolean => !choice || choice.has(id);

/* -------------------------------------------------- the view's payload -------------------------------------------------- */

/**
 * One line between two characters: the ties of one group between them, folded (a directed kind keeps a line of its own,
 * so its direction is its own). `g` its group, `s` how it's drawn (its strongest tie's look), `k` its kinds (strongest
 * first), `v` the worst feeling among them (a negative one draws red), `d` the direction of a directed kind (1: a to b,
 * 2: b to a, 3: both ways, 0: not directed), `e` set when every one of them has ended. Short keys: a view's payload is
 * hundreds of these.
 */
export type LensLine = { g: string; s: StyleKey; k: TieKindId[]; v: Valence; d: 0 | 1 | 2 | 3; e?: 1 };

/**
 * A pair on a view's sky (a < b): its lines, and `w` its strongest tie's closeness (the line's weight on the sky). A
 * masked pair (Everything only: a private character is one of them) has no lines: that they're tied, nothing else.
 */
export type LensPair = { a: string; b: string; w: number; lines: LensLine[]; masked?: true };

/**
 * A place the view's characters share, drawn as one star with a spoke to each member (a group, never pairs): "Regulars
 * at the Dive Bar", "Both from Leeds". `id` is the place's and role's (one place can hold coworkers and regulars),
 * `group` the chip its spokes are under, `count` every member (`members` lists the ones on this sky).
 */
export type LensPlace = {
  id: string;
  place_id: string;
  name: string;
  words: string;
  kind: PlaceKind;
  role: SharedRole;
  group: string;
  /** How close sharing it makes two members (lib/social/read.ts SHARED): its spokes' weight on the sky. */
  w: number;
  count: number;
  members: string[];
  /** The cluster it's in, as its members' (null under none). */
  community: number | null;
};

/** One item of a view's numbers line: a count and its words ("12 feuds"), or a name and its count ("most talked about"). */
export type LensNumber = { n: number; words: string; who?: { id: string; name: string } };

/**
 * One view of the social sky, as /graph draws it (lib/social/lens-sky.ts builds it, /api/graph/lens serves it). Its
 * characters are the Constellation's nodes (a private one keeps its name and id only), `degree` counting their lines and
 * places in this view and `community` their cluster in it; `ties` is every public tie in the view, `shown` how many of
 * the strongest are drawn.
 */
export type LensSky = { lens: SkyLens; nodes: GraphNode[]; pairs: LensPair[]; places: LensPlace[]; numbers: LensNumber[]; ties: number; shown: number };

/** A tie as the fold needs it: the sky's ties are from and to characters (people aren't on the sky). */
export type FoldTie = { from: string; to: string; kind: TieKindId; layer: Layer; directed: boolean; valence: number; closeness: number; status: string };

/**
 * A view's ties folded into its pairs' lines: one line a pair and group, the pair's weight its strongest tie. Ties come
 * strongest first (publicSky's order), so a line's look and kinds are its strongest tie's first. Ties the view doesn't
 * draw are left out. Pairs come out in their strongest tie's order too.
 */
export function foldTies(lens: SkyLens, ties: readonly FoldTie[]): LensPair[] {
  type Line = LensLine & { ended: boolean };
  const pairs = new Map<string, { a: string; b: string; w: number; lines: Line[] }>();
  const lines = new Map<string, Line>();
  for (const t of ties) {
    if (t.from === t.to) continue;
    const g = groupOf(lens, t.kind, t.layer);
    if (!g) continue;
    const [a, b] = t.from < t.to ? [t.from, t.to] : [t.to, t.from];
    const key = `${a}\u0000${b}`;
    let pair = pairs.get(key);
    if (!pair) {
      pair = { a, b, w: Math.max(0, Math.min(1, t.closeness)), lines: [] };
      pairs.set(key, pair);
    }
    const dir: 0 | 1 | 2 = t.directed ? (t.from === a ? 1 : 2) : 0;
    const ended = t.status === "ended";
    // A directed kind has a line of its own (who told whom isn't who talked about whom); the rest of a group fold together.
    const lineKey = t.directed ? `${key}\u0000${g}\u0000${t.kind}` : `${key}\u0000${g}`;
    const line = lines.get(lineKey);
    if (!line) {
      const made: Line = { g, s: styleOf(t.kind, t.layer, t.valence), k: [t.kind], v: clampValence(t.valence), d: dir, ended };
      lines.set(lineKey, made);
      pair.lines.push(made);
      continue;
    }
    if (!line.k.includes(t.kind)) line.k.push(t.kind);
    line.v = Math.min(line.v, clampValence(t.valence)) as Valence;
    line.d = (line.d | dir) as 0 | 1 | 2 | 3;
    line.ended = line.ended && ended;
  }
  // Lines in the view's chip order, and `e` only where every tie in a line has ended.
  const order = new Map(LENS_GROUPS[lens].map((g, i) => [g.id, i]));
  return [...pairs.values()].map((p) => ({
    ...p,
    lines: p.lines
      .sort((x, y) => (order.get(x.g) ?? 99) - (order.get(y.g) ?? 99))
      .map(({ ended, ...l }): LensLine => (ended ? { ...l, e: 1 } : l)),
  }));
}

const clampValence = (n: number): Valence => Math.max(-2, Math.min(2, Math.round(Number(n) || 0))) as Valence;

/* ------------------------------------------------------- words ------------------------------------------------------- */

/** A tie kind in words for a pair ("rivals", "best friends", "dated on the show"). */
export const kindPairWords = (kind: TieKindId): string => TIE_KINDS[kind]?.words.pair ?? kind;

/** The verbs of the directed kinds a page says as a sentence ("Ada told Bea"); the rest say what one is to the other. */
const VERBS: Partial<Record<TieKindId, string>> = { told: "told", talked_about: "talked about", crush: "has a crush on", grudge: "holds a grudge against" };

/**
 * What the other end of a tie is to one of its characters, for that character's list: "rival", "someone they told",
 * "told them something" (lib/social/kinds.ts words: the other end is `to` when they're `from`, and `from` when they're `to`).
 */
export function endWords(kind: TieKindId, theyAreFrom: boolean): string {
  const def = TIE_KINDS[kind];
  if (!def) return kind;
  return theyAreFrom ? def.words.to : def.words.from;
}

/**
 * A directed tie in words, from `from` to `to`: "Ada told Bea", "Ada has a crush on Bea", and for the rest what `to` is
 * to `from` (a directed tie reads "to is from's <kind>"): "Bea is Ada's mentor".
 */
export function directedWords(kind: TieKindId, from: string, to: string): string {
  const verb = VERBS[kind];
  return verb ? `${from} ${verb} ${to}` : `${to} is ${from}'s ${TIE_KINDS[kind]?.words.to ?? kind}`;
}

/** What each view says over an empty sky: what's coming, and how its ties get made. */
export const LENS_EMPTY: Record<SkyLens, string> = {
  friends:
    "No friends or family on the sky yet. Pairs whose dates turn into friendship show here, and so do characters who keep going back to the same venue or come from the same town. Owners will soon add their characters' family, friends and coworkers on their pages.",
  rivals:
    "Nobody's feuding yet. A confrontation in the house, a challenge's winner, a rivalry in a backstory or a date that ends in bad blood puts a line here.",
  gossip: "Nobody's talking yet. When a character tells another something, or talks about them, in an aired house scene, a line shows here, its arrow pointing from who said it.",
  all: "The wider network is still being drawn. Every tie the show records publicly shows here: dates, friendships, family, coworkers, rivals, housemates and the house's gossip.",
};

/** The line under each view's sky: what its marks mean. */
export const LENS_LEGEND: Record<SkyLens, string> = {
  friends: "Bigger stars have more ties here · a place's star links its regulars, coworkers or neighbours · a red line is a tie that turned sour",
  rivals: "Bigger stars have more rivals · a grey line cleared the air · each kind of conflict has its own dash",
  gossip: "Arrows point from who said it to whom · bigger stars have more lines · only aired house scenes count, never anyone's private opinions",
  all: "Each kind of tie has its own colour and dash · bigger stars have more ties · red is a bad feeling · grey dashes keep a pair private",
};

/* ---------------------------------------------------- the numbers ---------------------------------------------------- */

/**
 * What a view's numbers line is made from: the whole view's public ties by kind and status (publicSky's stats, so the
 * counts are never only the drawn ones), the drawn ties for the "most" (and for what only a drawn tie says, like a feud
 * that cleared the air), and the names of the public characters on the sky (a private one is never named here).
 */
export type NumbersInput = {
  byKind: Partial<Record<TieKindId, { active: number; ended: number }>>;
  ties: readonly (FoldTie & { detail?: Record<string, unknown> })[];
  names: ReadonlyMap<string, string>;
  places: number;
  characters: number;
};

const FRIENDSHIP_KINDS: TieKindId[] = ["best_friend", "close_friend", "friend", "childhood_friend", "old_friend", "roommate", "pen_pal", "dated"];
const layerKinds = (layer: Layer): TieKindId[] => (Object.keys(TIE_KINDS) as TieKindId[]).filter((k) => TIE_KINDS[k].layer === layer && k !== "dated");

/** How many times a told or talked-about tie happened (its lines), at least once. */
const times = (detail: Record<string, unknown> | undefined): number => {
  const n = Number(detail?.count);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
};

/** The public character with the most of something (ties to the same pair once each), as a numbers item; null for none. */
function most(tally: Map<string, number>, names: ReadonlyMap<string, string>, words: string): LensNumber | null {
  let best: { id: string; n: number } | null = null;
  for (const [id, n] of tally) {
    const name = names.get(id);
    if (!name || n <= 0) continue;
    if (!best || n > best.n || (n === best.n && name.localeCompare(names.get(best.id)!) < 0)) best = { id, n };
  }
  return best ? { n: best.n, words, who: { id: best.id, name: names.get(best.id)! } } : null;
}

const add = (tally: Map<string, number>, id: string, n = 1): void => {
  tally.set(id, (tally.get(id) ?? 0) + n);
};

/**
 * A view's numbers line ("12 feuds · 3 cleared the air · most at odds: Ada (4)"), counts first and zero counts left out,
 * then who stands out. Empty for an empty view (its empty sky says why).
 */
export function lensNumbers(lens: SkyLens, x: NumbersInput): LensNumber[] {
  const count = (kinds: readonly TieKindId[]) => kinds.reduce((sum, k) => sum + (x.byKind[k]?.active ?? 0) + (x.byKind[k]?.ended ?? 0), 0);
  const out: (LensNumber | null)[] = [];
  const item = (n: number, words: string): LensNumber | null => (n > 0 ? { n, words } : null);
  if (lens === "friends") {
    const friends = new Map<string, number>();
    for (const t of x.ties) {
      if (t.layer !== "friendship") continue;
      add(friends, t.from);
      add(friends, t.to);
    }
    out.push(
      item(count(FRIENDSHIP_KINDS), "friendships"),
      item(count(layerKinds("kin")), "family ties"),
      item(count(layerKinds("work")), "work and school ties"),
      item(count(layerKinds("place")) + x.places, "shared places"),
      most(friends, x.names, "most friends"),
    );
  } else if (lens === "rivals") {
    const odds = new Map<string, number>();
    let cleared = 0;
    for (const t of x.ties) {
      if (t.layer !== "conflict") continue;
      add(odds, t.from);
      add(odds, t.to);
      if (t.kind === "feud" && t.valence >= 0) cleared++;
    }
    out.push(
      item(count(["feud"]), "feuds"),
      item(cleared, "cleared the air"),
      item(count(["rival", "nemesis", "frenemy"]), "rivalries"),
      item(count(["bad_blood", "dated"]), "ended in bad blood"),
      item(count(["enemy", "grudge"]), "enemies and grudges"),
      most(odds, x.names, "most at odds"),
    );
  } else if (lens === "gossip") {
    const about = new Map<string, number>();
    const talkers = new Map<string, number>();
    let lines = 0;
    for (const t of x.ties) {
      if (t.layer !== "communication") continue;
      const n = times(t.detail);
      lines += n;
      add(talkers, t.from, n);
      if (t.kind === "talked_about") add(about, t.to, n);
    }
    out.push(item(lines, "lines of gossip"), most(about, x.names, "most talked about"), most(talkers, x.names, "biggest talker"));
  } else {
    const ties = new Map<string, number>();
    for (const t of x.ties) {
      add(ties, t.from);
      add(ties, t.to);
    }
    const total = Object.values(x.byKind).reduce((sum, k) => sum + (k?.active ?? 0) + (k?.ended ?? 0), 0);
    out.push(item(total, "ties"), item(x.characters, "characters"), item(x.places, "shared places"), most(ties, x.names, "most connected"));
  }
  return out.filter((n): n is LensNumber => n !== null);
}
