/**
 * The people in a character's life, in its own date prompt (docs/PRDs/social-network.md section 7 "Dialogue"; Phase 2b,
 * SOCIAL_PEOPLE_IN_PROMPTS): one or two short lines each actor reads as `people_in_your_life`. Someone both of them know
 * comes first ("You both know Mira Vale: Mira is your coworker, and Bo's best friend."); otherwise one of its own
 * off-screen people who fits ("Priya, your sister: vets everyone you date."). Flavour, like an introduction's line: the
 * engine never reads it, and the other side's prompt never carries this side's lines.
 *
 * The lines use only what the date's audience may see of the network (lib/social/read.ts tieAccess's rule, with that
 * audience as the viewer), because what an actor is told it may say. A date that can air (public or unlisted, and any
 * date not known to be private) is anyone's to watch: public, active ties and people only, so an owner's "only you"
 * person or tie never reaches a date that airs, their own character's included. A private date never airs and only its
 * host sees it: it may also use the "only you" rows of a tie the host holds an end of (their own characters'), never
 * another owner's. Never a private row, a proposal or an ended tie, and never the story state (opinions, what it heard,
 * what it wants). Only the kinds a date can carry: family, friends, work, neighbours, rivals, and exes or first loves,
 * never a current partner (a date with one is a cheat), never what aired (the show's own history says that) and never
 * talk or met-on-the-show ties.
 */
import type { Db } from "../db";
import { seedFrom } from "../engine";
import { shortName } from "../names";
import { DELETED_OWNER } from "../rules";
import { isDerivedOnly, isTieKind, TIE_KINDS, type TieKindId } from "./kinds";
import { listedSql } from "./read";
import { socialTiesOn } from "./switch";
import type { Layer } from "./types";

type Env = Record<string, string | undefined>;

/** People lines in actors' prompts (Phase 2b). On unless "0"; off whenever SOCIAL_TIES is. */
export const socialPeopleInPromptsOn = (env: Env = process.env): boolean => socialTiesOn(env) && env.SOCIAL_PEOPLE_IN_PROMPTS?.trim() !== "0";

/** At most this many lines a side, each at most PEOPLE_LINE_CHARS: about a hundred tokens, whatever the network. */
export const PEOPLE_LINES_MAX = 2;
export const PEOPLE_LINE_CHARS = 180;
/** An off-screen person is picked among this many of the best fits, by the date's seed, so dates vary. */
const PERSON_PICK = 3;
/** Each side reads at most this many of its strongest ties (a house character's can run long). */
const TIES_READ = 200;

/** The layers a date's line can come from, the order an off-screen person fits in. */
const LINE_LAYERS: readonly Layer[] = ["kin", "friendship", "romance", "work", "place", "conflict"];
/** Of romance, only the past: a current partner on a date is a cheat, not a line. */
const PAST_ROMANCE: readonly TieKindId[] = ["ex", "first_love"];
/** Kinds whose words are a phrase ("their crush", "holds a grudge against them"), not a noun a line can use. */
const PHRASE = /^(their|has|holds|someone|talked|told|feuding|met|bad)\b/;

/** Whether a kind can be one of these lines. */
export function lineKind(kind: string): kind is TieKindId {
  if (!isTieKind(kind) || isDerivedOnly(kind)) return false;
  const k = TIE_KINDS[kind];
  if (!LINE_LAYERS.includes(k.layer)) return false;
  if (k.layer === "romance" && !PAST_ROMANCE.includes(kind)) return false;
  return !PHRASE.test(k.words.from) && !PHRASE.test(k.words.to);
}

type Gender = "she" | "he" | null;
const genderOf = (pronouns: string | null | undefined): Gender => (/^\s*she\b/i.test(pronouns ?? "") ? "she" : /^\s*he\b/i.test(pronouns ?? "") ? "he" : null);
/** The kin words with a she and a he form. */
const GENDERED: Record<string, [string, string]> = {
  parent: ["mother", "father"],
  child: ["daughter", "son"],
  sibling: ["sister", "brother"],
  "half-sibling": ["half-sister", "half-brother"],
  "step-sibling": ["stepsister", "stepbrother"],
  grandparent: ["grandmother", "grandfather"],
  grandchild: ["granddaughter", "grandson"],
  "aunt or uncle": ["aunt", "uncle"],
  "niece or nephew": ["niece", "nephew"],
};

/**
 * What someone is to a side, in the kind's words (pure): a tie from the side to them reads "they are the side's <to>",
 * one from them "the side's <from>". Kin by their pronouns ("mother", "brother"), else a title in the name ("Auntie
 * Meg" is an aunt).
 */
export function roleWord(kind: TieKindId, fromSide: boolean, who: { name: string; pronouns?: string | null }): string {
  const words = TIE_KINDS[kind].words;
  const word = fromSide ? words.to : words.from;
  const forms = GENDERED[word];
  if (!forms) return word;
  const gender = genderOf(who.pronouns) ?? (/^(aunt|auntie|aunty|mum|mom|mother|gran|granny|grandma|nan|nana|sister|sis)\b/i.test(who.name) ? "she" : /^(uncle|dad|father|grandpa|gramps|brother|bro)\b/i.test(who.name) ? "he" : null);
  return gender === "she" ? forms[0] : gender === "he" ? forms[1] : word;
}

const clip = (s: string): string => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= PEOPLE_LINE_CHARS ? t : `${t.slice(0, PEOPLE_LINE_CHARS - 1).replace(/[\s,;:]+\S*$/, "")}…`;
};

/** The line for someone both know (pure): who, and what they are to each side. */
export function mutualLine(m: { name: string; pronouns?: string | null }, mine: { kind: TieKindId; fromSide: boolean }, partnerName: string, theirs: { kind: TieKindId; fromSide: boolean }): string {
  const who = shortName(m.name) || m.name;
  return clip(`You both know ${m.name}: ${who} is your ${roleWord(mine.kind, mine.fromSide, m)}, and ${shortName(partnerName) || partnerName}'s ${roleWord(theirs.kind, theirs.fromSide, m)}.`);
}

/** A sentence's end: its own, or a full stop. */
const ended = (s: string): string => (/[.!?…]$/.test(s) ? s : `${s}.`);

/** The line for one of a side's off-screen people (pure): their name, what they are to it, and its line about them. */
export function personLine(p: { name: string; pronouns?: string | null; note?: string | null; deceased?: boolean }, kind: TieKindId): string {
  const note = p.note?.trim();
  return clip(ended(`${p.name}, your ${p.deceased ? "late " : ""}${roleWord(kind, true, p)}${note ? `: ${note}` : ""}`));
}

/** One tie as read for the lines: its ends as their owners and visibility, the other end's name, a person's fields. */
export type LineTie = {
  id: string;
  from_id: string;
  to_id: string | null;
  kind: string;
  visibility: string;
  closeness: number;
  from_owner: string | null;
  from_public: boolean;
  to_owner: string | null;
  to_public: boolean | null;
  to_name: string | null;
  to_pronouns: string | null;
  from_name: string;
  from_pronouns: string | null;
  person_id: string | null;
  person_name: string | null;
  person_pronouns: string | null;
  person_note: string | null;
  person_deceased: boolean | null;
  person_visibility: string | null;
};

/** Whether anyone may see a tie (pure): a public tie between public ends, or to a public person. */
export function isOpen(t: LineTie): boolean {
  return t.visibility === "public" && t.from_public && (t.person_id ? t.person_visibility === "public" : t.to_public === true);
}

/**
 * Whether a viewer may see a tie (pure; lib/social/read.ts tieAccess's rule): an open one to anyone (a null viewer is
 * anyone: a date that can air), the rest only to the owner of an end. Never a private row.
 */
export function seenBy(t: LineTie, viewer: string | null): boolean {
  if (t.visibility === "private" || (t.person_id && (!t.person_name || t.person_visibility === "private"))) return false;
  const mine = viewer !== null && viewer !== DELETED_OWNER && (t.from_owner === viewer || t.to_owner === viewer);
  return isOpen(t) || mine;
}

/**
 * Each side's lines, the names both sides' lines share (the words both already know), and whether any line came from an
 * "only you" row (only ever on a private date: its host's own).
 */
export type DatePeople = { a: string[]; b: string[]; shared: string[]; only_you: boolean };

type Side = { id: string; name: string };

/**
 * One side's lines (pure), from the ties `viewer` may see (null: anyone, on a date that can air): someone both know
 * first, else one off-screen person who fits, by the date's seed. `onlyYou`: a line came from an "only you" row.
 */
export function linesFor(me: Side, partner: Side, ties: readonly LineTie[], seed: number, viewer: string | null = null): { lines: string[]; mutual: string[]; onlyYou: boolean } {
  const usable = ties.filter((t) => t.to_id !== null || t.person_id !== null).filter((t) => lineKind(t.kind) && seenBy(t, viewer));
  // Who each knows: the other end of every usable tie between characters, its kind and its side.
  type Known = { other: string; name: string; pronouns: string | null; kind: TieKindId; fromSide: boolean; closeness: number; open: boolean };
  const knows = (id: string): Map<string, Known> => {
    const out = new Map<string, Known>();
    for (const t of usable) {
      if (!t.to_id || (t.from_id !== id && t.to_id !== id)) continue;
      const fromSide = t.from_id === id;
      const other = fromSide ? t.to_id : t.from_id;
      const known: Known = { other, name: (fromSide ? t.to_name : t.from_name) ?? "", pronouns: fromSide ? t.to_pronouns : t.from_pronouns, kind: t.kind as TieKindId, fromSide, closeness: t.closeness, open: isOpen(t) };
      const was = out.get(other);
      if (known.name && (!was || known.closeness > was.closeness)) out.set(other, known);
    }
    return out;
  };
  const mine = knows(me.id);
  const theirs = knows(partner.id);
  const both = [...mine.values()]
    .filter((k) => k.other !== partner.id && k.other !== me.id && theirs.has(k.other))
    .map((k) => ({ k, t: theirs.get(k.other)!, strength: k.closeness * theirs.get(k.other)!.closeness }))
    .sort((x, y) => y.strength - x.strength || (x.k.other < y.k.other ? -1 : 1))
    .slice(0, PEOPLE_LINES_MAX);
  if (both.length) {
    return {
      lines: both.map(({ k, t }) => mutualLine({ name: k.name, pronouns: k.pronouns }, k, partner.name, t)),
      mutual: both.map(({ k }) => k.name),
      onlyYou: both.some(({ k, t }) => !k.open || !t.open),
    };
  }
  // No one both know: one of its own off-screen people, the best fits first (a line about them, the closer layers,
  // the living), picked among the first few by the date's seed.
  const people = usable
    .filter((t) => t.person_id && t.from_id === me.id)
    .sort(
      (x, y) =>
        Number(!x.person_note) - Number(!y.person_note) ||
        LINE_LAYERS.indexOf(TIE_KINDS[x.kind as TieKindId].layer) - LINE_LAYERS.indexOf(TIE_KINDS[y.kind as TieKindId].layer) ||
        Number(Boolean(x.person_deceased)) - Number(Boolean(y.person_deceased)) ||
        y.closeness - x.closeness ||
        (x.id < y.id ? -1 : 1),
    )
    .slice(0, PERSON_PICK);
  if (!people.length) return { lines: [], mutual: [], onlyYou: false };
  const p = people[seed % people.length];
  return { lines: [personLine({ name: p.person_name!, pronouns: p.person_pronouns, note: p.person_note, deceased: Boolean(p.person_deceased) }, p.kind as TieKindId)], mutual: [], onlyYou: !isOpen(p) };
}

/**
 * The lines for a date between a and b (null when switched off, or when neither has any): each side's own, and the names
 * of the people both sides' lines name (words both already know). `privateHost`: the host of a private date, which
 * never airs, so its lines may also use that host's own "only you" rows; left out (any date that can air, or one not
 * known to be private), public rows only. Deterministic for a date while the network stands, so a rebuild reads the same.
 */
export async function peopleForDate(db: Db, a: string, b: string, episodeId: string, o: { privateHost?: string | null } = {}, env: Env = process.env): Promise<DatePeople | null> {
  if (!socialPeopleInPromptsOn(env) || a === b) return null;
  const viewer = o.privateHost && o.privateHost !== DELETED_OWNER ? o.privateHost : null;
  const read = (id: string) =>
    db.query<LineTie>(
      `select t.id, t.from_id, t.to_id, t.kind, t.visibility, t.closeness::float8 as closeness,
              f.owner_id as from_owner, f.visibility = 'public' as from_public, f.name as from_name, f.pronouns as from_pronouns,
              o.owner_id as to_owner, o.visibility = 'public' as to_public, o.name as to_name, o.pronouns as to_pronouns,
              p.id as person_id, p.name as person_name, p.pronouns as person_pronouns, p.note as person_note, p.deceased as person_deceased,
              p.visibility as person_visibility
         from social_ties t
         join characters f on f.id = t.from_id and ${listedSql("f")}
         left join characters o on o.id = t.to_id and ${listedSql("o")}
         left join social_people p on p.id = t.to_person_id and p.holder_id = t.from_id
        where (t.from_id = $1 or t.to_id = $1) and t.status = 'active' and t.visibility <> 'private' and t.layer = any($2::text[])
          and (o.id is not null or p.id is not null)
        order by t.closeness desc, t.id
        limit $3`,
      [id, [...LINE_LAYERS], TIES_READ],
    );
  const [named, tiesA, tiesB] = await Promise.all([
    db.query<{ id: string; name: string }>(`select id, name from characters where id = any($1::text[])`, [[a, b]]),
    read(a),
    read(b),
  ]);
  const side = (id: string): Side | null => {
    const r = named.rows.find((x) => x.id === id);
    return r ? { id, name: r.name } : null;
  };
  const sa = side(a);
  const sb = side(b);
  if (!sa || !sb) return null;
  const ties = [...tiesA.rows, ...tiesB.rows];
  const la = linesFor(sa, sb, ties, seedFrom("people-lines", episodeId, "a"), viewer);
  const lb = linesFor(sb, sa, ties, seedFrom("people-lines", episodeId, "b"), viewer);
  if (!la.lines.length && !lb.lines.length) return null;
  const shared = la.mutual.filter((n) => lb.mutual.includes(n)).map((n) => shortName(n) || n);
  return { a: la.lines, b: lb.lines, shared, only_you: la.onlyYou || lb.onlyYou };
}
