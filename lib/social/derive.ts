/**
 * Ties and places derived from what aired (docs/PRDs/social-network.md section 6.1). Each derivation reads one public
 * record and works out the ties it makes whole (counts are counted, never incremented, and the evidence is the record's
 * newest), compares them with what is stored in one read, and writes only what differs, through lib/social/ties.ts
 * upsertTie, so every change is an event and running one twice changes nothing. A derived tie or membership the record
 * no longer has (a date made private, a line reported away, a character gone private) is removed with its history:
 * what is no longer public leaves no public trace.
 *
 *  - `dated`: a pair's public dates (the relationships row's public layer), its layer and valence by the shown stage.
 *  - The backstory links (character_links): rival, ex, fake couple, best friend, as the show's generator wrote them.
 *  - `met_at_group_night`: everyone on a group night's aired public dates, but the two of each date (they `dated`).
 *  - The house, as /house shows it (not reported, not removed, every name public): a confrontation is a `feud`, a
 *    challenge makes its winner a `rival` of each other contestant, each told line is `told` (speaker to listener) and
 *    `talked_about` (speaker to the two it's about); a rivals beat on the public record (story_beats) is a `rival` too.
 *  - `housemate`: each season's cast, with a `lives` membership of the house.
 *  - Venues: a character's aired public dates at a date venue make `visited` (with the count); three make `regular`.
 *  - Hometowns: a sheet's extras.hometown makes `from`.
 *
 * Never read: opinions, what a character heard, wants, souls, the private relationship layer, After Dark, a date that
 * isn't public, or a private character (a date with one in it counts for nobody). The site calls these through
 * lib/social/hook.ts (best effort, after the response); `backfillSocial` runs every one in batches from the hourly job.
 */
import type { Db } from "../db";
import { isLinkKind, linkBetween, linksOf, type CharacterLink, type LinkKind } from "../character-links";
import { publicDateSql } from "../date-number";
import { allHouseScenes, houseScenesOn, type HouseSceneView } from "../house-scenes";
import { storedRelationships, type HistoryItem, type Relationship, type Summary } from "../relationships";
import { checkShowText } from "../safety";
import { seasonIdOf, seasonWindow } from "../season-window";
import { SHOW_ID } from "../show-id";
import { DATE_VENUES } from "../venues";
import { layerOfDated, valenceOfDated } from "./kinds";
import { ensurePlaces, hometownOf, placeIdOf, REGULAR_AFTER_VISITS, removeMembership, setMembership, venueKey } from "./places";
import { socialDeriveOn } from "./switch";
import { planTieUpdate, STORY_MAX, tieIdOf, tiesByIds, upsertTie } from "./ties";
import { ensureWorld, HOUSE_PLACE } from "./world";
import { EVIDENCE_KEPT, type EvidenceIn, type MembershipInput, type PlaceRole, type TieInput, type TieKindId } from "./types";

type Env = Record<string, string | undefined>;

/** How a derivation runs: the switches' env, the moment it takes as now, and a deadline (epoch ms) after which it writes no more. */
export type DeriveOptions = { env?: Env; now?: Date; deadline?: number };

/**
 * What a derivation did: ties written (made or changed), refused (an exclusive kind already full), removed (ties and
 * memberships), memberships written; `partial` when the deadline stopped it (the next run carries on).
 */
export type Derived = { written: number; refused: number; removed: number; members: number; partial: boolean };
const nothing = (): Derived => ({ written: 0, refused: 0, removed: 0, members: 0, partial: false });
export const plus = (a: Derived, b: Derived): Derived => ({
  written: a.written + b.written,
  refused: a.refused + b.refused,
  removed: a.removed + b.removed,
  members: a.members + b.members,
  partial: a.partial || b.partial,
});

const on = (o: DeriveOptions): boolean => socialDeriveOn(o.env ?? process.env);
const past = (o: DeriveOptions): boolean => o.deadline !== undefined && Date.now() > o.deadline;
const iso = (v: string | Date): string => new Date(v).toISOString();
const atOf = (e: EvidenceIn): string => iso(e.at ?? new Date(0));
const newestFirst = (x: EvidenceIn, y: EvidenceIn): number => (atOf(x) < atOf(y) ? 1 : atOf(x) > atOf(y) ? -1 : 0);
const ordered = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x]);
const dayStart = (day: string): string => `${day}T00:00:00.000Z`;

/**
 * A derived tie's evidence (pure): the record's newest EVIDENCE_KEPT, marked whole (on a derived row it replaces what's
 * stored), and when the tie started: the earliest of all of it.
 */
function span(evidence: readonly EvidenceIn[]): Pick<TieInput, "evidence" | "wholeEvidence" | "started_at"> {
  const sorted = [...evidence].sort(newestFirst);
  return { evidence: sorted.slice(0, EVIDENCE_KEPT), wholeEvidence: true, ...(sorted.length ? { started_at: atOf(sorted[sorted.length - 1]) } : {}) };
}

/** Every pair of a list, lower id first. */
function pairsOf(ids: Iterable<string>): [string, string][] {
  const list = [...new Set(ids)].sort();
  const out: [string, string][] = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) out.push([list[i], list[j]]);
  return out;
}

/** Which of these characters are public. */
async function publicOnes(db: Db, ids: readonly string[]): Promise<Set<string>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Set();
  const { rows } = await db.query<{ id: string }>(`select id from characters where id = any($1::text[]) and visibility = 'public'`, [unique]);
  return new Set(rows.map((r) => r.id));
}

/* ------------------------------------------------------ writing ------------------------------------------------------ */

/**
 * Writes the ties that differ from what is stored (one read for all of them), each through upsertTie, so an unchanged
 * tie costs nothing and a changed one logs its event. Stops at the deadline (`partial`).
 */
export async function writeTies(db: Db, desired: readonly TieInput[], o: DeriveOptions = {}): Promise<Derived> {
  const out = nothing();
  if (!desired.length) return out;
  const stored = await tiesByIds(db, desired.map((d) => tieIdOf(d)));
  for (const d of desired) {
    const before = stored.get(tieIdOf(d));
    if (before && !planTieUpdate(before, d, o.now).event) continue;
    if (past(o)) {
      out.partial = true;
      break;
    }
    const w = await upsertTie(db, d, o.env ?? process.env);
    if (!w.ok) out.refused++;
    else if (w.event) out.written++;
  }
  return out;
}

/** Deletes derived ties by id, with their history. */
async function dropTies(db: Db, ids: readonly string[]): Promise<number> {
  if (!ids.length) return 0;
  return (await db.query(`delete from social_ties where id = any($1::text[]) and source = 'derived' returning id`, [[...new Set(ids)]])).rows.length;
}

/**
 * Removes the derived ties of these kinds that the record no longer has (`keep`: the ids it has); `touching`, when
 * given, limits it to the ties with an end among those characters.
 */
async function dropStale(db: Db, kinds: readonly TieKindId[], keep: ReadonlySet<string>, touching?: readonly string[]): Promise<number> {
  if (touching && !touching.length) return 0;
  const { rows } = await db.query<{ id: string }>(
    `select id from social_ties where source = 'derived' and kind = any($1::text[]) and ($2::text[] is null or from_id = any($2) or to_id = any($2))`,
    [[...kinds], touching ? [...touching] : null],
  );
  return dropTies(db, rows.map((r) => r.id).filter((id) => !keep.has(id)));
}

/** JSON with its keys sorted, so two values compare equal whatever order jsonb gave their keys in. */
const stable = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(stable).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
          .join(",")}}`
      : JSON.stringify(v ?? null);
const memberKey = (m: Pick<MembershipInput, "placeId" | "characterId" | "role">): string => `${m.placeId}|${m.characterId}|${m.role}`;
const isoOrNull = (v: string | Date | null | undefined): string | null => (v === null || v === undefined ? null : iso(v));

/**
 * Writes the memberships that differ from what is stored (one read), through setMembership. A declared membership only
 * takes a derived write's detail, so only that is compared for it. Stops at the deadline.
 */
async function writeMemberships(db: Db, desired: readonly MembershipInput[], o: DeriveOptions): Promise<Derived> {
  const out = nothing();
  if (!desired.length) return out;
  const { rows } = await db.query<{ place_id: string; character_id: string; role: string; detail: Record<string, unknown> | null; started_at: string | Date | null; ended_at: string | Date | null; source: string }>(
    `select place_id, character_id, role, detail, started_at, ended_at, source from social_place_members where character_id = any($1::text[]) and place_id = any($2::text[])`,
    [[...new Set(desired.map((d) => d.characterId))], [...new Set(desired.map((d) => d.placeId))]],
  );
  const have = new Map(rows.map((r) => [`${r.place_id}|${r.character_id}|${r.role}`, r]));
  for (const d of desired) {
    const h = have.get(memberKey(d));
    if (h) {
      const sameDetail = Object.entries(d.detail ?? {}).every(([k, v]) => stable((h.detail ?? {})[k]) === stable(v));
      const sameDates =
        h.source !== "derived" ||
        ((d.started_at === undefined || isoOrNull(d.started_at) === isoOrNull(h.started_at)) && (d.ended_at === undefined || isoOrNull(d.ended_at) === isoOrNull(h.ended_at)));
      if (sameDetail && sameDates) continue;
    }
    if (past(o)) {
      out.partial = true;
      break;
    }
    if (await setMembership(db, d, o.env ?? process.env)) out.members++;
  }
  return out;
}

/** Removes the derived memberships (of these characters and roles, at these places) that the record no longer has. */
async function dropMemberships(db: Db, ids: readonly string[], roles: readonly PlaceRole[], keep: ReadonlySet<string>, places: "venues" | "hometowns" | { id: string }): Promise<number> {
  if (!ids.length) return 0;
  const where = places === "venues" ? "p.venue_id is not null" : places === "hometowns" ? "p.kind = 'hometown'" : "p.id = $3";
  const { rows } = await db.query<{ place_id: string; character_id: string; role: PlaceRole }>(
    `select m.place_id, m.character_id, m.role from social_place_members m join social_places p on p.id = m.place_id
      where m.character_id = any($1::text[]) and m.role = any($2::text[]) and m.source = 'derived' and ${where}`,
    typeof places === "object" ? [[...ids], [...roles], places.id] : [[...ids], [...roles]],
  );
  let n = 0;
  for (const r of rows) if (!keep.has(`${r.place_id}|${r.character_id}|${r.role}`) && (await removeMembership(db, r.place_id, r.character_id, r.role))) n++;
  return n;
}

/* ------------------------------------------------------- dated ------------------------------------------------------- */

/** The public layer as `datedTie` reads it. */
export type PublicLayer = Pick<Summary, "dates" | "second_dates" | "stage" | "shown" | "tie">;

/**
 * The `dated` tie a pair's public record makes (pure), or null with no public date. Layer and valence by the shown
 * stage (kinds.ts layerOfDated), closeness their public tie strength (float4 in the relationships row, so read the same
 * way whichever path computed it), evidence their newest public dates, started at their first.
 */
export function datedTie(lo: string, hi: string, p: PublicLayer, history: readonly Pick<HistoryItem, "episode_id" | "at" | "aired_at" | "public">[]): TieInput | null {
  if (!p.dates) return null;
  const shown = p.shown ?? p.stage;
  return {
    from: lo,
    to: hi,
    kind: "dated",
    source: "derived",
    layer: layerOfDated(shown),
    valence: valenceOfDated(shown),
    closeness: Math.round(Math.fround(Number(p.tie) || 0) * 1000) / 1000,
    detail: { stage: p.stage, shown_stage: shown, dates: p.dates, second_dates: p.second_dates },
    ...span(history.filter((h) => h.public).map((h) => ({ ref: `episode:${h.episode_id}`, at: h.aired_at ?? h.at }))),
  };
}

/** The dated ties of these stored pairs (both public, a public date between them); the rest of theirs go. */
async function datedOf(db: Db, rels: readonly Relationship[], o: DeriveOptions): Promise<Derived> {
  if (!rels.length) return nothing();
  const open = await publicOnes(db, rels.flatMap((r) => [r.lo, r.hi]));
  const desired = rels.flatMap((r) => (open.has(r.lo) && open.has(r.hi) ? (datedTie(r.lo, r.hi, r.public, r.history) ?? []) : []));
  const done = await writeTies(db, desired, o);
  const keep = new Set(desired.map((d) => tieIdOf(d)));
  done.removed += await dropTies(db, rels.map((r) => tieIdOf({ from: r.lo, to: r.hi, kind: "dated" })).filter((id) => !keep.has(id)));
  return done;
}

/** A pair's `dated` tie as their relationships row stands now (refreshRelationship's hook): written, changed or gone. */
export async function deriveDatedPair(db: Db, x: string, y: string, o: DeriveOptions = {}): Promise<Derived> {
  if (!on(o) || x === y) return nothing();
  const [lo, hi] = ordered(x, y);
  const rels = await storedRelationships(db, `where character_a = $1 and character_b = $2`, [lo, hi], o.env);
  if (!rels.length) return { ...nothing(), removed: await dropTies(db, [tieIdOf({ from: lo, to: hi, kind: "dated" })]) };
  return datedOf(db, rels, o);
}

/** Dated ties whose pair has no public date left at all (no relationships row, or none public). */
async function orphanDated(db: Db): Promise<number> {
  const { rows } = await db.query<{ id: string }>(
    `select t.id from social_ties t where t.kind = 'dated' and t.source = 'derived'
        and not exists (select 1 from relationships r where r.character_a = t.from_id and r.character_b = t.to_id and r.public_dates > 0)`,
  );
  return dropTies(db, rows.map((r) => r.id));
}

/* ------------------------------------------------------- links ------------------------------------------------------- */

/** The tie each backstory link is (PRD section 6.1). */
export const LINK_TIES: Record<LinkKind, TieKindId> = { rivals: "rival", second_chance: "ex", fake_dating: "fake_couple", friends_to_more: "best_friend" };
const LINK_TIE_KINDS = [...new Set(Object.values(LINK_TIES))];
/** A link's evidence ref: the pair, lower id first. */
export const linkRef = (lo: string, hi: string): string => `link:${lo}:${hi}`;

/** A story for a tie: trimmed, short enough, and one the show's check passes; else none (the tie still stands). */
function storyOf(text: string): string | null {
  const t = text.trim();
  return t && t.length <= STORY_MAX && checkShowText({ story: t }).ok ? t : null;
}

/** The tie a link declares (pure): the show generator's (`house`) or an admin's, with the link's story. */
export function linkTie(link: CharacterLink): TieInput {
  return { from: link.lo, to: link.hi, kind: LINK_TIES[link.kind], source: link.source === "admin" ? "admin" : "house", story: storyOf(link.story), evidence: { ref: linkRef(link.lo, link.hi) } };
}

/**
 * Links' ties (addLink's write-through, a character's visibility, the backfill): a pair both public has its link's tie;
 * a link replaced by another kind, or with a private end, loses its tie (the link is the record, the tie its projection).
 */
export async function deriveLinks(db: Db, links: readonly CharacterLink[], o: DeriveOptions = {}): Promise<Derived> {
  if (!on(o) || !links.length) return nothing();
  const open = await publicOnes(db, links.flatMap((l) => [l.lo, l.hi]));
  const usable = links.filter((l) => open.has(l.lo) && open.has(l.hi));
  const done = await writeTies(db, usable.map(linkTie), o);
  const keep = new Set(usable.map((l) => tieIdOf(linkTie(l))));
  const { rows } = await db.query<{ id: string }>(
    `select t.id from social_ties t join unnest($1::text[], $2::text[]) as l(lo, hi) on t.from_id = l.lo and t.to_id = l.hi
      where t.kind = any($3::text[]) and t.source in ('house', 'admin')
        and t.evidence @> jsonb_build_array(jsonb_build_object('ref', 'link:' || l.lo || ':' || l.hi))`,
    [links.map((l) => l.lo), links.map((l) => l.hi), LINK_TIE_KINDS],
  );
  const gone = rows.map((r) => r.id).filter((id) => !keep.has(id));
  if (gone.length) done.removed += (await db.query(`delete from social_ties where id = any($1::text[]) returning id`, [gone])).rows.length;
  return done;
}

/** One pair's link as it stands (addLink's hook). */
export async function deriveLinkPair(db: Db, x: string, y: string, o: DeriveOptions = {}): Promise<Derived> {
  if (!on(o)) return nothing();
  const link = await linkBetween(db, x, y);
  return link ? deriveLinks(db, [link], o) : nothing();
}

async function allLinks(db: Db): Promise<CharacterLink[]> {
  const { rows } = await db.query<{ lo: string; hi: string; kind: string; story: string; source: string }>(
    `select character_a as lo, character_b as hi, kind, story, source from character_links order by character_a, character_b`,
  );
  return rows.flatMap((r) => (isLinkKind(r.kind) ? [{ lo: r.lo, hi: r.hi, kind: r.kind, story: r.story, source: r.source }] : []));
}

/* ---------------------------------------------------- group nights ---------------------------------------------------- */

/** One aired public date of a group night: the night, its two, and when it aired. */
export type NightDate = { night: string; a: string; b: string; at: string | Date };

/**
 * Who met whom at group nights (pure): everyone on a night's aired public dates met everyone else on them, except the
 * two of each date (they dated). A tie a pair, with how many nights they shared.
 */
export function groupNightTies(dates: readonly NightDate[]): TieInput[] {
  const people = new Map<string, Set<string>>();
  const couples = new Set<string>();
  const when = new Map<string, string>();
  for (const d of dates) {
    people.set(d.night, (people.get(d.night) ?? new Set<string>()).add(d.a).add(d.b));
    couples.add(`${d.night}|${ordered(d.a, d.b).join("|")}`);
    const at = iso(d.at);
    if (!when.has(d.night) || at > when.get(d.night)!) when.set(d.night, at);
  }
  const shared = new Map<string, string[]>();
  for (const [night, set] of people) {
    for (const [lo, hi] of pairsOf(set)) {
      if (couples.has(`${night}|${lo}|${hi}`)) continue;
      shared.set(`${lo}|${hi}`, [...(shared.get(`${lo}|${hi}`) ?? []), night]);
    }
  }
  return [...shared].map(([key, nights]): TieInput => {
    const [lo, hi] = key.split("|");
    return { from: lo, to: hi, kind: "met_at_group_night", source: "derived", detail: { nights: nights.length }, ...span(nights.map((n) => ({ ref: `night:${n}`, at: when.get(n)! }))) };
  });
}

/**
 * Group nights (doubles and mixers). `nights`: the ones that just changed; then everyone who was at one has their ties
 * worked out again over every night they were at (so a date gone private takes its two out of the count). Without it,
 * every night, and ties no night has any more go.
 */
export async function deriveGroupNights(db: Db, scope: { nights?: readonly string[] } = {}, o: DeriveOptions = {}): Promise<Derived> {
  if (!on(o)) return nothing();
  let people: string[] | null = null;
  if (scope.nights) {
    if (!scope.nights.length) return nothing();
    const { rows } = await db.query<{ id: string }>(
      `select distinct x.id from episodes n cross join lateral (values (n.character_a), (n.character_b)) as x(id) where n.group_id = any($1::text[])`,
      [[...scope.nights]],
    );
    people = rows.map((r) => r.id);
    if (!people.length) return nothing();
  }
  const { rows } = await db.query<NightDate>(
    `select e.group_id as night, e.character_a as a, e.character_b as b, coalesce(e.revealed_at, e.created_at) as at
       from episodes e join characters ca on ca.id = e.character_a join characters cb on cb.id = e.character_b
      where e.group_id is not null and e.show_id = $2 and ${publicDateSql("e")} and ca.visibility = 'public' and cb.visibility = 'public'
        and ($1::text[] is null or e.group_id in (
              select g.group_id from episodes g where g.group_id is not null and (g.character_a = any($1::text[]) or g.character_b = any($1::text[]))))`,
    [people, SHOW_ID],
  );
  const mine = people ? new Set(people) : null;
  const desired = groupNightTies(rows).filter((d) => !mine || mine.has(d.from) || (d.to !== undefined && mine.has(d.to)));
  const done = await writeTies(db, desired, o);
  done.removed += await dropStale(db, ["met_at_group_night"], new Set(desired.map((d) => tieIdOf(d))), people ?? undefined);
  return done;
}

/** The group nights a character was at. */
async function nightsOf(db: Db, id: string): Promise<string[]> {
  const { rows } = await db.query<{ night: string }>(`select distinct group_id as night from episodes where group_id is not null and $1 in (character_a, character_b)`, [id]);
  return rows.map((r) => r.night);
}

/* ------------------------------------------------------ the house ------------------------------------------------------ */

/** A feud's valence and status by how its latest confrontation came out (PRD section 6.1). */
const FEUD: Record<string, { valence: -2 | -1 | 0; status: "active" | "ended" }> = {
  cleared_the_air: { valence: 0, status: "ended" },
  agreed_to_disagree: { valence: -1, status: "active" },
  worse_than_before: { valence: -2, status: "active" },
};

/** A scene as /house shows it, with what the stored scene says each shown retelling was told to (house_scenes.told). */
export type ShownScene = Pick<HouseSceneView, "id" | "written_at" | "cast" | "lines" | "result"> & { told: { line: number; by: string; to: readonly string[] }[] };
/** A rivals beat on the public record (story_beats): its day and the two who want the same person. */
export type RivalBeat = { day: string; a: string; b: string };

/**
 * Everything the house's public record says (pure): feuds (from the latest confrontation's outcome), the challenges'
 * and the beats' rivals, who told whom and who talked about whom, each with its count. `open`: the public characters;
 * a line's listener or a beat's two who aren't public are left out (the page leaves out the rest already).
 */
export function houseTies(scenes: readonly ShownScene[], beats: readonly RivalBeat[], open: ReadonlySet<string>): TieInput[] {
  type Tally = { n: number; evidence: EvidenceIn[]; outcome?: { at: string; is: string } };
  const tallies = new Map<string, Tally>();
  const count = (key: string, ev: EvidenceIn, outcome?: string) => {
    const t = tallies.get(key) ?? { n: 0, evidence: [] };
    t.n++;
    t.evidence.push(ev);
    if (outcome && (!t.outcome || atOf(ev) >= t.outcome.at)) t.outcome = { at: atOf(ev), is: outcome };
    tallies.set(key, t);
  };
  const rivals = new Map<string, { challenges: number; beats: number; evidence: EvidenceIn[] }>();
  const rival = (x: string, y: string, ev: EvidenceIn, what: "challenges" | "beats") => {
    if (x === y || !open.has(x) || !open.has(y)) return;
    const key = ordered(x, y).join("|");
    const r = rivals.get(key) ?? { challenges: 0, beats: 0, evidence: [] };
    r[what]++;
    r.evidence.push(ev);
    rivals.set(key, r);
  };
  for (const s of scenes) {
    const shown = new Set(s.lines.map((l) => l.n));
    for (const l of s.lines) {
      if (!l.about || !open.has(l.id)) continue;
      for (const subject of new Set(l.about)) if (subject !== l.id && open.has(subject)) count(`talked_about|${l.id}|${subject}`, { ref: `scene:${s.id}#${l.n}`, at: s.written_at });
    }
    for (const t of s.told) {
      if (!shown.has(t.line) || !open.has(t.by)) continue;
      for (const to of new Set(t.to)) if (to !== t.by && open.has(to)) count(`told|${t.by}|${to}`, { ref: `scene:${s.id}#${t.line}`, at: s.written_at });
    }
    const r = s.result;
    if (r?.kind === "confrontation" && r.a_id && r.b_id && r.a_id !== r.b_id && open.has(r.a_id) && open.has(r.b_id)) {
      count(`feud|${ordered(r.a_id, r.b_id).join("|")}`, { ref: `scene:${s.id}`, at: s.written_at }, r.outcome);
    }
    if (r?.kind === "challenge") for (const c of s.cast) rival(r.winner.id, c.id, { ref: `scene:${s.id}`, at: s.written_at }, "challenges");
  }
  for (const b of beats) rival(b.a, b.b, { ref: `beat:${b.day}`, at: dayStart(b.day) }, "beats");

  const out: TieInput[] = [];
  for (const [key, t] of tallies) {
    const [kind, from, to] = key.split("|") as [TieKindId, string, string];
    if (kind === "feud") {
      const how = FEUD[t.outcome?.is ?? ""] ?? FEUD.agreed_to_disagree;
      out.push({ from, to, kind, source: "derived", valence: how.valence, status: how.status, detail: { outcome: t.outcome?.is ?? null, confrontations: t.n }, ...span(t.evidence) });
    } else out.push({ from, to, kind, source: "derived", detail: { count: t.n }, ...span(t.evidence) });
  }
  for (const [key, r] of rivals) {
    const [lo, hi] = key.split("|");
    out.push({ from: lo, to: hi, kind: "rival", source: "derived", detail: { challenges: r.challenges, beats: r.beats }, ...span(r.evidence) });
  }
  return out;
}

/** The house's public record: every scene /house shows (with its stored retellings), and the rivals beats whose day has come. */
async function houseRecord(db: Db, now: Date): Promise<{ scenes: ShownScene[]; beats: RivalBeat[]; open: Set<string> }> {
  const views = await allHouseScenes(db);
  const told = new Map<string, { line: number; by: string; to?: string[] }[]>();
  if (views.length) {
    const { rows } = await db.query<{ id: string; told: { line: number; by: string; to?: string[] }[] | null }>(`select id, told from house_scenes where id = any($1::text[])`, [views.map((v) => v.id)]);
    for (const r of rows) told.set(r.id, Array.isArray(r.told) ? r.told : []);
  }
  const scenes: ShownScene[] = views.map((v) => ({ ...v, told: (told.get(v.id) ?? []).map((t) => ({ line: t.line, by: t.by, to: Array.isArray(t.to) ? t.to : [] })) }));
  // A beat's line shows on its own day, not before (lib/story-map.ts reads them the same way).
  const { rows } = await db.query<{ day: string; who: unknown }>(
    `select day, who from story_beats where tension = 'rivals' and status in ('staged', 'played', 'missed') and day <= $1 and coalesce(btrim(previously), '') <> '' order by day`,
    [now.toISOString().slice(0, 10)],
  );
  const beats = rows.flatMap((r) => (Array.isArray(r.who) && r.who.length >= 2 && typeof r.who[0] === "string" && typeof r.who[1] === "string" ? [{ day: r.day, a: r.who[0], b: r.who[1] }] : []));
  const ids = [...scenes.flatMap((s) => s.told.flatMap((t) => [t.by, ...t.to])), ...beats.flatMap((b) => [b.a, b.b])];
  const open = await publicOnes(db, ids);
  // The page shows only public people, so everyone it names is public.
  for (const s of scenes) for (const id of [...s.cast.map((c) => c.id), ...s.lines.flatMap((l) => [l.id, ...(l.about ?? [])])]) open.add(id);
  for (const s of scenes) if (s.result?.kind === "confrontation") for (const id of [s.result.a_id, s.result.b_id]) if (id) open.add(id);
  return { scenes, beats, open };
}

/** The kinds the house's record makes (a declared `rival`, from a link, keeps its own source and stays). */
const HOUSE_KINDS: readonly TieKindId[] = ["feud", "told", "talked_about", "rival"];

/**
 * The house's ties, worked out whole from what /house shows and the beats: after a scene is stored, a line is reported
 * away, reviewed or retracted, a rivals beat is staged or skipped, and from the backfill. What the record no longer has
 * goes. Nothing at all while the house is off (HOUSE_SCENES=0): its ties wait for it, rather than going with it.
 */
export async function deriveHouse(db: Db, o: DeriveOptions = {}): Promise<Derived> {
  if (!on(o) || !houseScenesOn(o.env ?? process.env)) return nothing();
  const { scenes, beats, open } = await houseRecord(db, o.now ?? new Date());
  const desired = houseTies(scenes, beats, open);
  const done = await writeTies(db, desired, o);
  done.removed += await dropStale(db, HOUSE_KINDS, new Set(desired.map((d) => tieIdOf(d))));
  return done;
}

/* ------------------------------------------------------ the season ------------------------------------------------------ */

/** Housemates (pure): each pair cast together in a season, with the seasons they shared. */
export function housemateTies(casts: readonly { season: string; ids: readonly string[] }[]): TieInput[] {
  const shared = new Map<string, string[]>();
  for (const c of casts) for (const [lo, hi] of pairsOf(c.ids)) shared.set(`${lo}|${hi}`, [...(shared.get(`${lo}|${hi}`) ?? []), c.season]);
  return [...shared].map(([key, list]): TieInput => {
    const [lo, hi] = key.split("|");
    const seasons = [...new Set(list)].sort();
    return { from: lo, to: hi, kind: "housemate", source: "derived", detail: { seasons }, ...span(seasons.map((s) => ({ ref: `season:${s}`, at: dayStart(s) }))) };
  });
}

/**
 * Each season's cast (season_casts; public characters still on it, seasons that have begun): housemates, and one
 * `lives` membership of the house each, with their seasons, ended when their last season did. After a season's cast is
 * chosen, and from the backfill. Someone on no cast any more (or gone private) leaves the house.
 */
export async function deriveSeasonCasts(db: Db, o: DeriveOptions = {}): Promise<Derived> {
  if (!on(o)) return nothing();
  const now = o.now ?? new Date();
  const current = seasonIdOf(now);
  await ensureWorld(db, o.env ?? process.env);
  const { rows } = await db.query<{ season: string; id: string }>(
    `select s.season_id as season, s.character_id as id from season_casts s join characters c on c.id = s.character_id
      where c.visibility = 'public' and s.withdrawn_at is null and s.season_id <= $1 order by s.season_id, s.character_id`,
    [current],
  );
  const bySeason = new Map<string, string[]>();
  const byPerson = new Map<string, string[]>();
  for (const r of rows) {
    bySeason.set(r.season, [...(bySeason.get(r.season) ?? []), r.id]);
    byPerson.set(r.id, [...(byPerson.get(r.id) ?? []), r.season]);
  }
  const desired = housemateTies([...bySeason].map(([season, ids]) => ({ season, ids })));
  const done = await writeTies(db, desired, o);
  done.removed += await dropStale(db, ["housemate"], new Set(desired.map((d) => tieIdOf(d))));
  const house = placeIdOf(HOUSE_PLACE.key);
  const lives = [...byPerson].map(([id, list]): MembershipInput => {
    const seasons = [...new Set(list)].sort();
    const last = seasons[seasons.length - 1];
    return {
      placeId: house,
      characterId: id,
      role: "lives",
      source: "derived",
      detail: { seasons },
      started_at: dayStart(seasons[0]),
      ended_at: last >= current ? null : seasonWindow(new Date(`${last}T12:00:00.000Z`)).end,
    };
  });
  const members = await writeMemberships(db, lives, o);
  const { rows: had } = await db.query<{ character_id: string }>(`select character_id from social_place_members where place_id = $1 and role = 'lives' and source = 'derived'`, [house]);
  done.removed += await dropMemberships(db, had.map((h) => h.character_id), ["lives"], new Set(lives.map(memberKey)), { id: house });
  return plus(done, members);
}

/* ------------------------------------------------------ venues ------------------------------------------------------ */

const VENUE_IDS = DATE_VENUES.map((v) => v.id);

/** The memberships a character's public dates at venues make (pure): `visited` with the count, and `regular` from REGULAR_AFTER_VISITS. */
export function venueMemberships(rows: readonly { character_id: string; venue: string; visits: number; first_at: string | Date }[]): MembershipInput[] {
  return rows.flatMap((r) => {
    const roles: PlaceRole[] = r.visits >= REGULAR_AFTER_VISITS ? ["visited", "regular"] : ["visited"];
    return roles.map((role): MembershipInput => ({ placeId: placeIdOf(venueKey(r.venue)), characterId: r.character_id, role, source: "derived", detail: { visits: r.visits }, started_at: iso(r.first_at) }));
  });
}

/**
 * Venues: these characters' aired public dates at each date venue (both people public; a place of their own, "home"
 * or one named after an "@", isn't a venue of the world) make `visited`, with the count, and enough of them `regular`;
 * a derived membership the record no longer has goes.
 */
export async function deriveVenues(db: Db, ids: readonly string[], o: DeriveOptions = {}): Promise<Derived> {
  if (!on(o) || !ids.length) return nothing();
  await ensureWorld(db, o.env ?? process.env);
  const { rows } = await db.query<{ character_id: string; venue: string; visits: number; first_at: string | Date }>(
    `select x.id as character_id, e.setup->>'venue' as venue, count(*)::int as visits, min(coalesce(e.revealed_at, e.created_at)) as first_at
       from episodes e join characters ca on ca.id = e.character_a join characters cb on cb.id = e.character_b
       cross join lateral (values (e.character_a), (e.character_b)) as x(id)
      where e.show_id = $3 and ${publicDateSql("e")} and ca.visibility = 'public' and cb.visibility = 'public'
        and e.setup->>'venue' = any($2::text[]) and x.id = any($1::text[])
      group by x.id, e.setup->>'venue'`,
    [[...new Set(ids)], VENUE_IDS, SHOW_ID],
  );
  const desired = venueMemberships(rows);
  const done = await writeMemberships(db, desired, o);
  done.removed += await dropMemberships(db, ids, ["visited", "regular"], new Set(desired.map(memberKey)), "venues");
  return done;
}

/* ------------------------------------------------------ hometowns ------------------------------------------------------ */

/**
 * Hometowns: a public character's extras.hometown (normalised: places.ts hometownOf) makes a `from` membership of that
 * place, made the first time anyone names it; a changed or cleared one, or a character gone private, loses the old one.
 */
export async function deriveHometowns(db: Db, ids: readonly string[], o: DeriveOptions = {}): Promise<Derived> {
  if (!on(o) || !ids.length) return nothing();
  const { rows } = await db.query<{ id: string; hometown: string | null; open: boolean }>(
    `select id, extras->>'hometown' as hometown, visibility = 'public' as open from characters where id = any($1::text[])`,
    [[...new Set(ids)]],
  );
  const towns = rows.flatMap((r) => {
    const town = r.open ? hometownOf(r.hometown) : null;
    return town ? [{ id: r.id, ...town }] : [];
  });
  await ensurePlaces(db, [...new Map(towns.map((t) => [t.key, { key: t.key, kind: "hometown" as const, name: t.name, source: "derived" as const }])).values()]);
  const desired = towns.map((t): MembershipInput => ({ placeId: placeIdOf(t.key), characterId: t.id, role: "from", source: "derived" }));
  const done = await writeMemberships(db, desired, o);
  done.removed += await dropMemberships(db, ids, ["from"], new Set(desired.map(memberKey)), "hometowns");
  return done;
}

/* ------------------------------------------------------ the hooks ------------------------------------------------------ */

/** A date aired, changed visibility, or was reported or moderated: its two's venues, and its group night. */
export async function onDate(db: Db, episodeId: string, o: DeriveOptions = {}): Promise<Derived> {
  if (!on(o)) return nothing();
  const e = (await db.query<{ a: string; b: string; night: string | null }>(`select character_a as a, character_b as b, group_id as night from episodes where id = $1`, [episodeId])).rows[0];
  if (!e) return nothing();
  const venues = await deriveVenues(db, [e.a, e.b], o);
  return e.night ? plus(venues, await deriveGroupNights(db, { nights: [e.night] }, o)) : venues;
}

/**
 * A character was saved: its hometown. When it went private or public (`visibility`), everything the public record
 * gives it, and what its dates gave the people it dated: dated ties, venues, group nights, the house, the season, links.
 */
export async function onCharacter(db: Db, id: string, o: DeriveOptions & { visibility?: boolean } = {}): Promise<Derived> {
  if (!on(o)) return nothing();
  let out = await deriveHometowns(db, [id], o);
  if (!o.visibility) return out;
  out = plus(out, await datedOf(db, await storedRelationships(db, `where $1 in (character_a, character_b)`, [id], o.env), o));
  // Everyone it went on a date with: a date of theirs counts for them only while both of them are public.
  const { rows: partners } = await db.query<{ id: string }>(
    `select distinct case when character_a = $1 then character_b else character_a end as id from episodes where $1 in (character_a, character_b) and show_id = $2`,
    [id, SHOW_ID],
  );
  out = plus(out, await deriveVenues(db, [id, ...partners.map((p) => p.id)], o));
  out = plus(out, await deriveGroupNights(db, { nights: await nightsOf(db, id) }, o));
  out = plus(out, await deriveHouse(db, o));
  out = plus(out, await deriveSeasonCasts(db, o));
  out = plus(out, await deriveLinks(db, await linksOf(db, [id]), o));
  return out;
}

/* ------------------------------------------------------ the backfill ------------------------------------------------------ */

/** How long after a step finished the backfill goes round it again, catching what a hook missed. */
export const BACKFILL_EVERY_MS = 24 * 60 * 60 * 1000;
/** Pairs (dated) or characters (venues, hometowns) a batch. */
const BATCH = 50;
/** The steps, in order: the whole ones, then the ones that go in batches (pairs, then characters). */
export const BACKFILL_STEPS = ["world", "links", "seasons", "nights", "house", "dated", "venues", "hometowns"] as const;
export type BackfillStep = (typeof BACKFILL_STEPS)[number];
export type SocialBackfill = { steps: Partial<Record<BackfillStep, Derived & { done: boolean }>>; ms: number };

/**
 * The hourly job's part (app/api/jobs/lobby): every derivation over the whole public record, within `budgetMs`, picking
 * up where the last pass stopped (social_backfill keeps each step's cursor). A step that finished runs again
 * BACKFILL_EVERY_MS later, so whatever a hook missed is caught within a day. Idempotent: an unchanged record writes
 * nothing. Null with the switch off.
 */
export async function backfillSocial(db: Db, o: { now?: Date; budgetMs?: number; env?: Env } = {}): Promise<SocialBackfill | null> {
  const env = o.env ?? process.env;
  if (!socialDeriveOn(env)) return null;
  const now = o.now ?? new Date();
  const started = Date.now();
  const opts: DeriveOptions = { env, now, deadline: started + (o.budgetMs ?? 30_000) };
  const state = new Map(
    (await db.query<{ step: string; cursor: string | null; done_at: string | Date | null }>(`select step, cursor, done_at from social_backfill`)).rows.map((r) => [r.step, r]),
  );
  const due = (step: BackfillStep): boolean => {
    const s = state.get(step);
    return !s || s.cursor !== null || !s.done_at || now.getTime() - new Date(s.done_at).getTime() >= BACKFILL_EVERY_MS;
  };
  const save = (step: BackfillStep, cursor: string | null, finished: boolean) =>
    db.query(
      `insert into social_backfill (step, cursor, done_at, updated_at) values ($1, $2, case when $3::boolean then $4::timestamptz end, now())
       on conflict (step) do update set cursor = excluded.cursor, done_at = coalesce(excluded.done_at, social_backfill.done_at), updated_at = now()`,
      [step, cursor, finished, now.toISOString()],
    );
  const whole: Record<"world" | "links" | "seasons" | "nights" | "house", () => Promise<Derived>> = {
    world: async () => {
      await ensureWorld(db, env);
      return nothing();
    },
    links: async () => deriveLinks(db, await allLinks(db), opts),
    seasons: () => deriveSeasonCasts(db, opts),
    nights: () => deriveGroupNights(db, {}, opts),
    house: () => deriveHouse(db, opts),
  };
  const out: SocialBackfill = { steps: {}, ms: 0 };
  for (const step of BACKFILL_STEPS) {
    if (past(opts)) break;
    if (!due(step)) continue;
    if (step in whole) {
      const done = await whole[step as keyof typeof whole]();
      await save(step, null, !done.partial);
      out.steps[step] = { ...done, done: !done.partial };
      continue;
    }
    let cursor = state.get(step)?.cursor ?? "";
    let total = nothing();
    let finished = false;
    while (!past(opts)) {
      if (step === "dated") {
        const [lo, hi] = cursor ? cursor.split("|") : ["", ""];
        const rels = await storedRelationships(db, `where (character_a, character_b) > ($1, $2) order by character_a, character_b limit $3`, [lo, hi ?? "", BATCH], env);
        const done = await datedOf(db, rels, opts);
        total = plus(total, done);
        if (done.partial) break;
        if (rels.length < BATCH) {
          total.removed += await orphanDated(db);
          finished = true;
          break;
        }
        cursor = `${rels[rels.length - 1].lo}|${rels[rels.length - 1].hi}`;
      } else {
        const ids = (await db.query<{ id: string }>(`select id from characters where id > $1 order by id limit $2`, [cursor, BATCH])).rows.map((r) => r.id);
        const done = step === "venues" ? await deriveVenues(db, ids, opts) : await deriveHometowns(db, ids, opts);
        total = plus(total, done);
        if (done.partial) break;
        if (ids.length < BATCH) {
          finished = true;
          break;
        }
        cursor = ids[ids.length - 1];
      }
    }
    await save(step, finished ? null : cursor, finished);
    out.steps[step] = { ...total, done: finished };
  }
  out.ms = Date.now() - started;
  return out;
}
