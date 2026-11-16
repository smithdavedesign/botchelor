/**
 * Talk of the house (2026-11-15): what a character's page says the house is saying about them, in place of the
 * Audience tab, which was star buttons and reviews on an almost always empty card. A dating show's viewer wants the
 * gossip: what was said about them, who they fell out with, who is after them.
 *
 * Everything here comes from what a stranger can already read somewhere else on the site, and nothing else:
 *
 *  - **Said about them:** lines of the house's scenes exactly as /house shows them (lib/house-scenes.ts listHouseScenes:
 *    a reported or removed line, a private speaker, a retelling of a date that is no longer public are already gone).
 *    Whether a retelling was true is never in that view, so it is never here.
 *  - **Friction:** confrontations and challenges with the result /house prints, the producer's public daily line when
 *    it is about a falling-out (story_beats.previously: what home and /watch showed that day), and bad blood on the
 *    PUBLIC layer of the relationship graph (aired public dates only, lib/relationships.ts).
 *  - **Who is after whom:** the producer's public "both set their sights on X" line, and the public graph's second
 *    dates and couples.
 *
 * Never read here: character_opinions, character_heard, character_wants (the story state is the owner's alone,
 * lib/story-state.ts), a beat's `why`, `evidence` or `wants`, a scene's `told` or `tension`, a hidden secret, anything
 * unaired or from After Dark. No model call: every line was checked when it was stored.
 *
 * The house's part is the same for every character, so it is read once and shared (lib/shared-cache.ts): a page of
 * many characters, or many visitors at once, costs the database one read. `shapeTalk` is pure: the reads hand it rows.
 */
import type { Db } from "./db";
import type { HouseSceneView, SceneFace } from "./house-scenes";
import { listHouseScenes, scenePath } from "./house-scenes";
import { shortName } from "./names";
import { producerOn } from "./producer";
import { PAIR_PHRASES, type Stage } from "./relationship-stages";
import { relationshipsOf, viewRelationship, type Relationship } from "./relationships";
import { inFlight, shared } from "./shared-cache";

type Env = Record<string, string | undefined>;

/** CHARACTER_TALK=0 puts the Audience tab back as it was (ratings and reviews in it, no talk). On by default. */
export const characterTalkOn = (env: Env = process.env): boolean => env.CHARACTER_TALK?.trim() !== "0";

/** How many of the house's newest scenes are searched for a character (up to three a day: a week and more). */
export const TALK_SCENES = 30;
/** How many days of the producer's daily lines are read. */
export const TALK_BEAT_DAYS = 30;
/** A handful of each, newest first. */
export const TALK_SAID = 5;
export const TALK_FRICTION = 5;
export const TALK_AFTER = 6;

const DAY_MS = 24 * 60 * 60 * 1000;
const dayOf = (d: Date): string => d.toISOString().slice(0, 10);
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A whole-word mention of a name, as the scenes' own checks read one (lib/house-scenes.ts). */
const mentions = (text: string, word: string): boolean => word.length > 1 && new RegExp(`(?<![\\p{L}])${escapeRe(word)}(?![\\p{L}])`, "iu").test(text);
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Someone a line of talk names: public, so linkable. */
export type TalkPerson = { id: string; name: string };

/** A producer's public daily line (story_beats), and who it is between. Only the columns a viewer was shown. */
export type TalkBeat = { day: string; tension: string; who: string[]; about: string | null; previously: string };

/** One of the character's ties on the PUBLIC layer of the graph. */
export type TalkEdge = { other: string; stage: Stage | null; last_at: string | null; path: string };

/** A line someone in the house said that names them. */
export type TalkSaid = {
  key: string;
  day: string;
  /** The scene on /house. */
  href: string;
  speaker: SceneFace;
  text: string;
  /** Where it was said, as it reads after a name: "on the stairs". */
  where: string;
};

export type TalkFriction = {
  key: string;
  /** `bad_blood` and `breakup` are standings on the public graph (the shown stage); the others happened on a day. */
  kind: "confrontation" | "challenge" | "story" | "bad_blood" | "breakup";
  day: string | null;
  /** The scene, the couple's page, or the house. */
  href: string;
  /** What happened, in one sentence. */
  text: string;
  /** How it came out, as /house prints it: only a confrontation and a challenge have one. */
  result: string | null;
  /** Who it was with, when it is one person. */
  other: TalkPerson | null;
};

export type TalkAfter = {
  key: string;
  /** `them`: the other is after this character; `theirs`: this character is after the other; `both`: it is agreed. */
  direction: "them" | "theirs" | "both";
  other: TalkPerson;
  /** The public line or standing behind it. */
  text: string;
  href: string;
  day: string | null;
};

export type CharacterTalk = {
  said: TalkSaid[];
  friction: TalkFriction[];
  /** Who is after them, who they are after, and what is agreed, newest first. */
  after: TalkAfter[];
  /** Nothing public to tell yet: the page says so in one line. */
  empty: boolean;
};

/** The standings told as "who they are with": a second date agreed, and every way of being a couple. */
const TOLD_STAGES: ReadonlySet<Stage> = new Set(["sparks", "dating", "casual", "going_steady", "official", "moved_in", "engaged", "married", "back_together"]);

export const EMPTY_TALK: CharacterTalk = { said: [], friction: [], after: [], empty: true };

export type TalkInput = {
  /** The character the page is about. A private one has no talk: nothing public is ever attributed to it. */
  character: { id: string; name: string; private?: boolean };
  /** The house's scenes as /house shows them, newest first. */
  scenes: readonly HouseSceneView[];
  beats: readonly TalkBeat[];
  edges: readonly TalkEdge[];
  /** Everyone PUBLIC that a beat or an edge names, by id. Someone missing (private, deleted) drops the item that names them. */
  people: ReadonlyMap<string, TalkPerson>;
};

/** Everyone a scene is known to be about or between, by id: its room, the dates on its table, its result. */
function scenePeople(s: HouseSceneView): Set<string> {
  const ids = new Set<string>(s.cast.map((c) => c.id));
  for (const d of s.about) for (const id of [d.a_id, d.b_id]) if (id) ids.add(id);
  if (s.result?.kind === "confrontation") for (const id of [s.result.a_id, s.result.b_id]) if (id) ids.add(id);
  if (s.result?.kind === "challenge") ids.add(s.result.winner.id);
  return ids;
}

/** The producer's line without its "Previously: " lead. */
const beatText = (b: TalkBeat): string => b.previously.replace(/^Previously:\s*/i, "").trim();

/**
 * A character's talk from the public rows. Pure: no clock, no database. A line counts as said about them when someone
 * else said it and it retells a date of theirs, or names them in a scene they are part of (so a namesake elsewhere on
 * the site never collects another character's gossip).
 */
export function shapeTalk(input: TalkInput): CharacterTalk {
  const { character: c, scenes, beats, edges, people } = input;
  if (c.private) return EMPTY_TALK;
  const me = shortName(c.name);
  const person = (id: string): TalkPerson | null => {
    const p = people.get(id);
    return p ? { id: p.id, name: shortName(p.name) } : null;
  };

  const said: TalkSaid[] = [];
  const friction: TalkFriction[] = [];
  const after: TalkAfter[] = [];

  for (const s of scenes) {
    const href = scenePath(s.id);
    const inScene = scenePeople(s).has(c.id);
    for (const l of s.lines) {
      if (l.id === c.id) continue;
      if (l.about?.includes(c.id) || (inScene && mentions(l.text, me))) {
        said.push({ key: `${s.id}#${l.n}`, day: s.day, href, speaker: { id: l.id, name: l.name, hue: l.hue, portrait: l.portrait, house: l.house }, text: l.text, where: s.place.at });
      }
    }
    if (s.result?.kind === "confrontation" && (s.result.a_id === c.id || s.result.b_id === c.id)) {
      const mineIsA = s.result.a_id === c.id;
      const otherId = mineIsA ? s.result.b_id : s.result.a_id;
      const otherName = mineIsA ? s.result.b : s.result.a;
      friction.push({
        key: `scene:${s.id}`,
        kind: "confrontation",
        day: s.day,
        href,
        text: `Had it out with ${otherName} ${s.place.at}.`,
        result: `${s.result.label}.`,
        other: otherId ? { id: otherId, name: otherName } : null,
      });
    } else if (s.result?.kind === "challenge" && (s.result.winner.id === c.id || s.cast.some((x) => x.id === c.id))) {
      const won = s.result.winner.id === c.id;
      friction.push({
        key: `scene:${s.id}`,
        kind: "challenge",
        day: s.day,
        href,
        text: won ? `Won ${lowerFirst(s.result.title)}.` : `Competed in ${lowerFirst(s.result.title)}.`,
        result: won ? `The prize: ${s.result.prize}.` : `${s.result.winner.name} won.`,
        other: won ? null : { id: s.result.winner.id, name: s.result.winner.name },
      });
    }
  }

  // A day's beat links to that day's scene on /house when one was written (the list leads each day with the scene
  // that mattered most: a challenge, then a confrontation, then the daily one); otherwise to the house itself.
  const sceneOfDay = new Map<string, string>();
  for (const s of scenes) if (!sceneOfDay.has(s.day)) sceneOfDay.set(s.day, s.id);
  for (const b of beats) {
    const [a, x] = b.who;
    const about = b.about && b.about !== a && b.about !== x ? b.about : null;
    const named = [a, x, about].filter((id): id is string => Boolean(id));
    if (!a || !x || !named.includes(c.id)) continue;
    // Every person the line names is still public, or the line isn't shown.
    if (named.some((id) => id !== c.id && !person(id))) continue;
    const text = beatText(b);
    if (!text) continue;
    const href = sceneOfDay.has(b.day) ? scenePath(sceneOfDay.get(b.day)!) : "/house";
    if (b.tension === "rivals") {
      if (!about) continue;
      if (about === c.id) {
        for (const id of [a, x]) after.push({ key: `beat:${b.day}:${id}`, direction: "them", other: person(id)!, text, href, day: b.day });
      } else {
        after.push({ key: `beat:${b.day}:${about}`, direction: "theirs", other: person(about)!, text, href, day: b.day });
      }
      continue;
    }
    const otherId = c.id === a ? x : c.id === x ? a : null;
    friction.push({ key: `beat:${b.day}`, kind: "story", day: b.day, href, text, result: null, other: otherId ? person(otherId) : null });
  }

  for (const e of edges) {
    const other = person(e.other);
    if (!other || !e.stage) continue;
    const day = e.last_at ? e.last_at.slice(0, 10) : null;
    // The stage is the SHOWN one (lib/relationship-stages.ts): bad blood only where there was cause, so a single
    // date that didn't click is no friction; a couple in whatever words fit them; a couple who were steady, split.
    if (e.stage === "bad_blood") {
      friction.push({ key: `edge:${e.other}`, kind: "bad_blood", day, href: e.path, text: `Bad blood with ${other.name}.`, result: null, other });
    } else if (e.stage === "broke_up" || e.stage === "divorced") {
      friction.push({ key: `edge:${e.other}`, kind: "breakup", day, href: e.path, text: e.stage === "divorced" ? `Divorced from ${other.name}.` : `Broke up with ${other.name}.`, result: null, other });
    } else if (TOLD_STAGES.has(e.stage)) {
      after.push({ key: `edge:${e.other}`, direction: "both", other, text: `${me} and ${other.name} ${PAIR_PHRASES[e.stage]}.`, href: e.path, day });
    }
  }

  const newest = <T extends { day: string | null }>(xs: T[]): T[] => xs.map((x, i) => ({ x, i })).sort((p, q) => (q.x.day ?? "").localeCompare(p.x.day ?? "") || p.i - q.i).map((p) => p.x);
  // One row per person and direction: the newest line stands for the week's repeats.
  const seen = new Set<string>();
  const afterOnce = newest(after).filter((x) => {
    const k = `${x.direction}:${x.other.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const out = { said: newest(said).slice(0, TALK_SAID), friction: newest(friction).slice(0, TALK_FRICTION), after: afterOnce.slice(0, TALK_AFTER) };
  return { ...out, empty: !out.said.length && !out.friction.length && !out.after.length };
}

/** A character's edges as a stranger sees them: the public layer only, whoever is asking. */
export function publicEdges(characterId: string, rels: readonly Relationship[], now: Date = new Date()): TalkEdge[] {
  return rels.flatMap((rel): TalkEdge[] => {
    const view = viewRelationship(rel, { userId: null, owner: false }, now);
    if (!view) return [];
    return [{ other: rel.lo === characterId ? rel.hi : rel.lo, stage: view.stage, last_at: view.last_at, path: `/couples/${rel.lo}/${rel.hi}` }];
  });
}

/** Public characters by id; a private or deleted one isn't in the list. */
async function publicPeople(db: Db, ids: readonly string[]): Promise<TalkPerson[]> {
  const wanted = [...new Set(ids)];
  if (!wanted.length) return [];
  return (await db.query<TalkPerson>(`select id, name from characters where id = any($1) and visibility = 'public'`, [wanted])).rows;
}

type HouseTalk = { scenes: HouseSceneView[]; beats: TalkBeat[]; people: TalkPerson[] };

/**
 * The house's part, the same for every character: the newest scenes as /house lists them, and the producer's public
 * lines up to today (tomorrow's beat is written the night before and isn't public until its day).
 */
async function loadHouseTalk(db: Db, now: Date, env: Env): Promise<HouseTalk> {
  const today = dayOf(now);
  const [scenes, beats] = await Promise.all([
    listHouseScenes(db, { limit: TALK_SCENES })
      .then((r) => r.scenes)
      .catch(() => [] as HouseSceneView[]),
    producerOn(env)
      ? db
          .query<{ day: string; tension: string | null; who: string[] | null; about: string | null; previously: string | null }>(
            `select day, tension, who, about, previously from story_beats
              where day <= $1 and day > $2 and status in ('staged', 'played', 'missed') and tension is not null and previously is not null
              order by day desc limit $3`,
            [today, dayOf(new Date(now.getTime() - TALK_BEAT_DAYS * DAY_MS)), TALK_BEAT_DAYS],
          )
          .then((r) => r.rows.map((b): TalkBeat => ({ day: b.day, tension: b.tension ?? "", who: Array.isArray(b.who) ? b.who : [], about: b.about, previously: b.previously ?? "" })))
          .catch(() => [] as TalkBeat[])
      : Promise.resolve([] as TalkBeat[]),
  ]);
  const people = await publicPeople(db, beats.flatMap((b) => [...b.who, ...(b.about ? [b.about] : [])])).catch(() => [] as TalkPerson[]);
  return { scenes, beats, people };
}

/** One read of the house's part for everyone asking at once, kept a few seconds for visitors (lib/shared-cache.ts). */
const houseTalk = (db: Db, now: Date, env: Env): Promise<HouseTalk> => inFlight(db, "talk:house", () => shared("talk:house", () => loadHouseTalk(db, now, env)));

/**
 * The page's one call (inside its Promise.all). `edges`: the character's relationships when the page already reads
 * them, so they are read once. Null when the switch is off; never throws (a failed read is an empty talk).
 */
export async function characterTalk(
  db: Db,
  character: { id: string; name: string; private?: boolean },
  opts: { edges?: Promise<readonly Relationship[]>; now?: Date; env?: Env } = {},
): Promise<CharacterTalk | null> {
  const env = opts.env ?? process.env;
  if (!characterTalkOn(env)) return null;
  if (character.private) return EMPTY_TALK;
  const now = opts.now ?? new Date();
  try {
    const [house, edges] = await Promise.all([
      houseTalk(db, now, env),
      (opts.edges ?? relationshipsOf(db, character.id))
        .then(async (rels) => {
          // Only the ties the talk tells (bad blood, a second date, a couple) need a name.
          const told = publicEdges(character.id, rels, now).filter((e) => e.stage === "bad_blood" || e.stage === "broke_up" || e.stage === "divorced" || (e.stage !== null && TOLD_STAGES.has(e.stage)));
          return { told, people: await publicPeople(db, told.map((e) => e.other)) };
        })
        .catch(() => ({ told: [] as TalkEdge[], people: [] as TalkPerson[] })),
    ]);
    const people = new Map<string, TalkPerson>([...house.people, ...edges.people].map((p) => [p.id, p]));
    return shapeTalk({ character, scenes: house.scenes, beats: house.beats, edges: edges.told, people });
  } catch {
    return EMPTY_TALK;
  }
}
