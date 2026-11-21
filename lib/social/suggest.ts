/**
 * "Might know" (docs/PRDs/social-network.md section 6.3): who a character might know and has no tie with yet, each
 * with a score and why, in words. Link prediction over the public network, from four signals:
 *
 *  - **Common friends** (`common_friends`): the characters both are tied to, by Adamic-Adar (each shared one counts
 *    1 / ln(their degree), so a friend of everyone says little). Only ties that mean knowing someone carry it: active,
 *    positive, and not the show's own encounters (`ENCOUNTERS`) or a date (a date's other dates aren't friends of
 *    friends). The character's own ties may be its owner's (`owner`), since only its owner sees suggestions; the hop
 *    beyond is public only.
 *  - **A shared place** (`shared_place`): coworkers, classmates, neighbours, regulars, people from the same town, from
 *    current public memberships (lib/social/read.ts SHARED, the rule "X's world" uses), weighted by the role and
 *    1 / ln(how many share it).
 *  - **The same event** (`same_event`): what aired already put them in the same room, a group night, a scene, the
 *    show, as one of derive's encounter ties (lib/social/derive.ts). An encounter isn't knowing someone, so it never
 *    rules a suggestion out; it's the reason for one.
 *  - **A friend of an ex** (`friend_of_ex`): the friends, family and coworkers of someone the character used to date.
 *
 * A suggestion is never a tie (PRD section 4). It never names: someone the character already has a tie with (any
 * kind but an encounter, any status, so a declined proposal isn't suggested again), a house character (people can't
 * declare a tie to one: PRD section 6.2), a private character the viewer doesn't own, a deleted account's or a
 * persona, or someone the viewer dismissed in the last DISMISSED_DAYS days. Shown suggestions and what came of them go
 * to social_suggestion_log (`logShown`, `dismissSuggestion`, `settleSuggestions`), /admin/social's hit rate.
 */
import type { Db } from "../db";
import { shortName } from "../names";
import { portraitPathSql } from "../portrait-sql";
import { ourIdsCached, showCharacterIds } from "./circles";
import { otherEnd, TIE_KINDS } from "./kinds";
import { listedSql, SHARED, sharedSql } from "./read";
import { socialTiesOn } from "./switch";
import { SHARED_ROLES, type SharedRole, type TieKindId } from "./types";

type Env = Record<string, string | undefined>;

/** Why a suggestion was made: social_suggestion_log.reason (PRD section 5.5), the strongest signal. */
export const SUGGESTION_REASONS = ["common_friends", "shared_place", "same_event", "friend_of_ex"] as const;
export type SuggestionReason = (typeof SUGGESTION_REASONS)[number];

/** How many suggestions a character gets, by default and at most. */
export const SUGGEST_LIMIT = 5;
export const SUGGEST_LIMIT_MAX = 10;
/** Below this, a candidate isn't worth showing (one housemate, a big hometown). */
export const MIN_SCORE = 0.3;
/** A dismissed suggestion stays away this long. */
export const DISMISSED_DAYS = 90;
/** An open suggestion with nothing come of it is `ignored` after this long. */
export const IGNORED_AFTER_DAYS = 30;
/** How many of a friend's own ties the friend-of-a-friend hop reads (its closest); its degree counts them all. */
export const HOP_KEPT = 200;
/** How many others sharing a place and role are read (the most recently active). */
export const PLACE_KEPT = 50;

/**
 * The show's encounters (derive's acquaintance and communication kinds): being in the same room isn't knowing someone.
 * They never carry a friend of a friend and never rule a suggestion out; between the two, they're `same_event`.
 */
export const ENCOUNTERS = ["housemate", "met_at_group_night", "met_on_show", "told", "talked_about"] as const satisfies readonly TieKindId[];
/** Ties that never carry a friend of a friend: the encounters, and a date (the other people someone dated). */
const NOT_A_BRIDGE: readonly string[] = [...ENCOUNTERS, "dated"];
/** What an encounter is worth, and what it says. */
const ENCOUNTER_WEIGHT: Record<(typeof ENCOUNTERS)[number], number> = { housemate: 0.15, met_at_group_night: 0.5, met_on_show: 0.4, told: 0.35, talked_about: 0.3 };
/** A shared place by role, before 1 / ln(how many share it): working together says most, a hometown least. */
const ROLE_WEIGHT: Record<SharedRole, number> = { works: 1, studied: 0.8, lives: 0.8, regular: 0.6, from: 0.5 };
/** A friend of an ex. */
const EX_WEIGHT = 0.6;
/** Someone's ex: an `ex` tie, a date whose public stage is over, or one of these that ended. */
const EX_STAGES = ["exes", "broke_up", "divorced"];
const EX_WHEN_ENDED = ["partner", "engaged", "spouse", "situationship"];
/** The layers a friend of an ex counts on. */
const EX_FRIEND_LAYERS = ["friendship", "kin", "work"];

export type TieSuggestion = {
  id: string;
  name: string;
  portrait: string | null;
  hue: number | null;
  /** One of the viewer's own characters: a tie to it is live at once, any kind (Phase 2b); to anyone else's it's asked. */
  mine: boolean;
  /** The strongest signal: social_suggestion_log.reason. */
  reason: SuggestionReason;
  /** Why, in words: "Mira's best friend", "Knows Mira and Jo", "Regulars at the dive bar · Met at a group night". */
  words: string;
  score: number;
  signals: { common: number; adamic_adar: number; places: number; events: number; ex: boolean };
};

type Signal = { reason: SuggestionReason; weight: number; words: string };
type Candidate = { signals: Signal[]; common: { id: string; name: string; word: string; weight: number }[]; adamic: number; places: number; events: number; ex: boolean };

const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const other = (r: { from_id: string; to_id: string }, me: string): string => (r.from_id === me ? r.to_id : r.from_id);
const nameList = (names: string[]): string => (names.length <= 2 ? names.join(" and ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`);

/**
 * What the far end of a tie is to `me`, as a noun after "Mira's" ("best friend", "sister", "crush"): kinds.ts's word,
 * without a "their", and a directed kind's phrase ("has a crush on them") as its inverse ("admirer").
 */
export function roleWord(t: { from_id: string; to_id: string; kind: TieKindId }, me: string): string {
  const def = TIE_KINDS[t.kind];
  const word = otherEnd({ ...t, to_person_id: null }, me)?.word ?? def.words.pair;
  if (word.startsWith("their ")) return word.slice("their ".length);
  if (/\bthem\b/.test(word)) return def.inverse ? def.inverse.replace(/_/g, " ") : def.words.pair;
  return word;
}

/** What an encounter between `me` and the candidate says, from `me`'s side. */
function encounterWords(kind: (typeof ENCOUNTERS)[number], fromMe: boolean, me: string, count: number): string {
  switch (kind) {
    case "housemate":
      return "Housemates";
    case "met_at_group_night":
      return count > 1 ? `Met at ${count} group nights` : "Met at a group night";
    case "met_on_show":
      return "Met on the show";
    case "told":
      return fromMe ? `${me} told them something` : `Told ${me} something`;
    case "talked_about":
      return fromMe ? `${me} has talked about them` : `Has talked about ${me}`;
  }
}

/**
 * Who `characterId` might know, best first (at most `limit`), for `viewer`, its owner. Empty when SOCIAL_TIES is off or
 * the character isn't listed. Reads only; `logShown` records what was shown.
 */
export async function suggestTies(db: Db, characterId: string, o: { viewer?: string | null; limit?: number; env?: Env; now?: Date } = {}): Promise<TieSuggestion[]> {
  if (!socialTiesOn(o.env)) return [];
  const viewer = o.viewer ?? null;
  const limit = Math.max(1, Math.min(SUGGEST_LIMIT_MAX, Math.floor(o.limit ?? SUGGEST_LIMIT) || SUGGEST_LIMIT));
  const now = o.now ?? new Date();
  const me = (await db.query<{ name: string }>(`select c.name from characters c where c.id = $1 and ${listedSql("c")}`, [characterId])).rows[0];
  if (!me) return [];
  const myName = shortName(me.name);
  // A character the viewer may see as a link: listed, and public or the viewer's own.
  const seen = (c: string) => `${listedSql(c)} and (${c}.visibility = 'public' or ${c}.owner_id = $2::text)`;

  const [hopQ, placeQ, meetQ, exQ] = await Promise.all([
    // Friends of friends: the character's knowing ties (its own: public or its owner's), each friend's public ones.
    db.query<{ z: string; z_name: string; w: string; kind: TieKindId; from_id: string; to_id: string; degree: number }>(
      `with mine as (
         select distinct case when t.from_id = $1 then t.to_id else t.from_id end as z
           from social_ties t
          where (t.from_id = $1 or t.to_id = $1) and t.to_id is not null and t.status = 'active'
            and t.visibility in ('public', 'owner') and t.valence > 0 and t.kind <> all($3::text[])
       ), hop as (
         select m.z, z.name as z_name, t.id, t.kind, t.from_id, t.to_id, t.closeness,
                case when t.from_id = m.z then t.to_id else t.from_id end as w
           from mine m
           join characters z on z.id = m.z and ${seen("z")}
           join social_ties t on (t.from_id = m.z or t.to_id = m.z)
          where t.to_id is not null and t.status = 'active' and t.visibility = 'public' and t.valence > 0 and t.kind <> all($3::text[])
       ), deg as (
         select z, count(distinct w)::int as degree from hop group by z
       ), ranked as (
         select h.*, row_number() over (partition by h.z order by h.closeness desc, h.id) as n from hop h
       )
       select r.z, r.z_name, r.w, r.kind, r.from_id, r.to_id, d.degree
         from ranked r join deg d on d.z = r.z
        where r.n <= $4 and r.w <> $1`,
      [characterId, viewer, NOT_A_BRIDGE, HOP_KEPT],
    ),
    // The places it shares (the rule "X's world" uses), and how many share each.
    db.query<{ w: string; place_name: string; role: SharedRole; members: number }>(
      `with here as (
         select m.place_id, m.role, p.name as place_name from social_place_members m join social_places p on p.id = m.place_id
          where m.character_id = $1 and ${sharedSql("m", "p")}
       ), others as (
         select h.place_name, m.role, m.character_id as w,
                count(*) over (partition by m.place_id, m.role) as members,
                row_number() over (partition by m.place_id, m.role order by m.updated_at desc, m.character_id) as n
           from here h
           join social_place_members m on m.place_id = h.place_id and m.role = h.role
          where m.character_id <> $1 and m.ended_at is null and m.visibility = 'public'
       )
       select w, place_name, role, (members + 1)::int as members from others where n <= $2`,
      [characterId, PLACE_KEPT],
    ),
    // What aired put them together: its public encounter ties.
    db.query<{ from_id: string; to_id: string; kind: (typeof ENCOUNTERS)[number]; detail: unknown }>(
      `select t.from_id, t.to_id, t.kind, t.detail from social_ties t
        where (t.from_id = $1 or t.to_id = $1) and t.to_id is not null and t.kind = any($2::text[]) and t.status = 'active' and t.visibility = 'public'`,
      [characterId, ENCOUNTERS],
    ),
    // Its exes' friends, family and coworkers.
    db.query<{ e_name: string; e: string; w: string; kind: TieKindId; from_id: string; to_id: string }>(
      `with exes as (
         select distinct case when t.from_id = $1 then t.to_id else t.from_id end as e
           from social_ties t
          where (t.from_id = $1 or t.to_id = $1) and t.to_id is not null and t.visibility in ('public', 'owner') and t.status in ('active', 'ended')
            and (t.kind = 'ex' or (t.kind = 'dated' and t.detail->>'shown_stage' = any($3::text[])) or (t.kind = any($5::text[]) and t.status = 'ended'))
       )
       select x.e, e.name as e_name, t.kind, t.from_id, t.to_id, case when t.from_id = x.e then t.to_id else t.from_id end as w
         from exes x
         join characters e on e.id = x.e and ${seen("e")}
         join social_ties t on (t.from_id = x.e or t.to_id = x.e)
        where t.to_id is not null and t.status = 'active' and t.visibility = 'public' and t.valence > 0 and t.layer = any($4::text[])
          and t.kind <> 'dated'`,
      [characterId, viewer, EX_STAGES, EX_FRIEND_LAYERS, EX_WHEN_ENDED],
    ),
  ]);

  const cands = new Map<string, Candidate>();
  const cand = (w: string): Candidate => {
    let c = cands.get(w);
    if (!c) cands.set(w, (c = { signals: [], common: [], adamic: 0, places: 0, events: 0, ex: false }));
    return c;
  };

  // Adamic-Adar: each friend in common counts 1 / ln(how many they know); one who knows only the candidate in public
  // (the tie to this character is its owner's) counts as knowing two.
  for (const r of hopQ.rows) {
    if (r.w === characterId) continue;
    const c = cand(r.w);
    // Two ties to the same friend (coworkers and close friends) are one friend in common.
    if (c.common.some((x) => x.id === r.z)) continue;
    const weight = 1 / Math.log(Math.max(2, r.degree));
    const name = shortName(r.z_name);
    c.common.push({ id: r.z, name, word: `${name}'s ${roleWord(r, r.z)}`, weight });
    c.adamic += weight;
  }
  for (const c of cands.values()) {
    if (!c.common.length) continue;
    c.common.sort((x, y) => y.weight - x.weight || (x.name < y.name ? -1 : 1));
    c.signals.push({ reason: "common_friends", weight: c.adamic, words: c.common.length === 1 ? c.common[0].word : `Knows ${nameList(c.common.map((x) => x.name))}` });
  }

  for (const r of placeQ.rows) {
    if (!SHARED_ROLES.includes(r.role)) continue;
    const weight = ROLE_WEIGHT[r.role] / Math.log(Math.max(2, r.members));
    const c = cand(r.w);
    c.places += 1;
    c.signals.push({ reason: "shared_place", weight, words: SHARED[r.role].words(r.place_name) });
  }

  for (const r of meetQ.rows) {
    const w = other(r, characterId);
    const nights = r.kind === "met_at_group_night" ? Math.max(1, Number((r.detail as { nights?: unknown } | null)?.nights) || 1) : 1;
    const c = cand(w);
    c.events += nights;
    c.signals.push({ reason: "same_event", weight: ENCOUNTER_WEIGHT[r.kind] * Math.min(3, nights), words: encounterWords(r.kind, r.from_id === characterId, myName, nights) });
  }

  const exSeen = new Set<string>();
  for (const r of exQ.rows) {
    if (r.w === characterId || exSeen.has(r.w)) continue;
    exSeen.add(r.w);
    const ex = shortName(r.e_name);
    const c = cand(r.w);
    c.ex = true;
    c.signals.push({ reason: "friend_of_ex", weight: EX_WEIGHT, words: `${ex}'s ${roleWord(r, r.e)}, and ${ex} is ${myName}'s ex` });
  }

  cands.delete(characterId);
  if (!cands.size) return [];

  // Who they may be (listed, not the house's, public or the viewer's own), and who's ruled out.
  const ids = [...cands.keys()];
  const [whoQ, tiedQ, dismissedQ] = await Promise.all([
    db.query<{ id: string; name: string; hue: number | null; portrait: string | null; mine: boolean; created_via: string | null }>(
      `select c.id, c.name, c.avatar_hue as hue, ${portraitPathSql("c")} as portrait, coalesce(c.owner_id = $2::text, false) as mine, c.created_via
         from characters c
        where c.id = any($1::text[]) and not c.is_house and ${seen("c")}`,
      [ids, viewer],
    ),
    db.query<{ w: string }>(
      `select distinct case when t.from_id = $1 then t.to_id else t.from_id end as w from social_ties t
        where ((t.from_id = $1 and t.to_id = any($2::text[])) or (t.to_id = $1 and t.from_id = any($2::text[]))) and t.kind <> all($3::text[])`,
      [characterId, ids, ENCOUNTERS],
    ),
    db.query<{ w: string }>(
      `select distinct suggested_id as w from social_suggestion_log
        where character_id = $1 and viewer = $2::text and outcome = 'dismissed' and outcome_at > $3::timestamptz - make_interval(days => $4)`,
      [characterId, viewer, now.toISOString(), DISMISSED_DAYS],
    ),
  ]);
  const out = new Set([...tiedQ.rows.map((r) => r.w), ...dismissedQ.rows.map((r) => r.w)]);
  // The show's own agent cast takes its ties from the show, like the house (lib/social/circles.ts): no one can declare
  // one to them (Phase 2b), so they aren't suggested either. Only an agent-made one can be, so only those are looked up.
  const made = whoQ.rows.filter((w) => w.created_via === "mcp").map((w) => w.id);
  if (made.length) for (const id of (await showCharacterIds(db, made, { ours: await ourIdsCached(db) })).keys()) out.add(id);

  const suggestions: TieSuggestion[] = [];
  for (const who of whoQ.rows) {
    const c = cands.get(who.id);
    if (!c || out.has(who.id)) continue;
    const score = round3(c.signals.reduce((s, x) => s + x.weight, 0));
    if (score < MIN_SCORE) continue;
    const top = [...c.signals].sort((x, y) => y.weight - x.weight || (x.words < y.words ? -1 : 1));
    // Its two strongest reasons, each once ("Knows Mira and Jo · Regulars at the dive bar").
    const words = [...new Set(top.map((x) => x.words))].slice(0, 2).join(" · ");
    suggestions.push({
      id: who.id,
      name: who.name,
      portrait: who.portrait,
      hue: who.hue,
      mine: who.mine,
      reason: top[0].reason,
      words,
      score,
      signals: { common: c.common.length, adamic_adar: round3(c.adamic), places: c.places, events: c.events, ex: c.ex },
    });
  }
  return suggestions.sort((x, y) => y.score - x.score || (x.id < y.id ? -1 : 1)).slice(0, limit);
}

/* ------------------------------------------------------- the log ------------------------------------------------------- */

/**
 * Logs what was shown to `viewer`: one open row a suggestion (a suggestion still open from before keeps its row and its
 * first showing). Best effort: a failed write never costs the page its suggestions. Returns how many were new.
 */
export async function logShown(db: Db, viewer: string, characterId: string, shown: readonly Pick<TieSuggestion, "id" | "reason" | "score">[], now: Date = new Date()): Promise<number> {
  if (!shown.length) return 0;
  try {
    const { rows } = await db.query<{ n: number }>(
      `with x as (
         insert into social_suggestion_log (viewer, character_id, suggested_id, reason, score, shown_at)
         select $1, $2, s.id, s.reason, s.score, $4::timestamptz
           from jsonb_to_recordset($3::jsonb) as s(id text, reason text, score real)
          where not exists (select 1 from social_suggestion_log l
                             where l.viewer = $1 and l.character_id = $2 and l.suggested_id = s.id and l.outcome is null)
         returning 1
       ) select count(*)::int as n from x`,
      [viewer, characterId, JSON.stringify(shown.map((s) => ({ id: s.id, reason: s.reason, score: s.score }))), now.toISOString()],
    );
    return rows[0]?.n ?? 0;
  } catch (err) {
    console.error("[social] suggestion log failed:", err instanceof Error ? err.message : String(err));
    return 0;
  }
}

/**
 * "Not now": the viewer dismisses a suggestion. Its open row is marked (or one is written, when it was never logged),
 * and it stays away DISMISSED_DAYS days. False when there's nothing to dismiss (the same id as the character).
 */
export async function dismissSuggestion(db: Db, viewer: string, characterId: string, suggestedId: string, now: Date = new Date()): Promise<boolean> {
  if (!suggestedId || suggestedId === characterId) return false;
  const at = now.toISOString();
  const marked = await db.query(
    `update social_suggestion_log set outcome = 'dismissed', outcome_at = $4::timestamptz
      where viewer = $1 and character_id = $2 and suggested_id = $3 and outcome is null
      returning id`,
    [viewer, characterId, suggestedId, at],
  );
  if (marked.rows.length) return true;
  const exists = await db.query(`select 1 from characters where id = $1`, [suggestedId]);
  if (!exists.rows.length) return false;
  await db.query(
    `insert into social_suggestion_log (viewer, character_id, suggested_id, reason, score, shown_at, outcome, outcome_at)
     values ($1, $2, $3, 'common_friends', 0, $4::timestamptz, 'dismissed', $4::timestamptz)`,
    [viewer, characterId, suggestedId, at],
  );
  return true;
}

/**
 * What came of the open suggestions: `accepted` once a tie between the two (any kind but an encounter, any status:
 * a proposal counts, the owner acted on it; so does a tie the show made, the suggestion came true) was made after it
 * was shown, `ignored` once IGNORED_AFTER_DAYS days pass with neither. One character's (`characterId`, when its page
 * asks) or everyone's (the daily job). Idempotent.
 */
export async function settleSuggestions(db: Db, o: { characterId?: string; now?: Date } = {}): Promise<{ accepted: number; ignored: number }> {
  const at = (o.now ?? new Date()).toISOString();
  const one = o.characterId ? [o.characterId] : [];
  const accepted = await db.query(
    `update social_suggestion_log l set outcome = 'accepted', outcome_at = m.made
       from (select l2.id, min(t.created_at) as made
               from social_suggestion_log l2
               join social_ties t on ((t.from_id = l2.character_id and t.to_id = l2.suggested_id) or (t.from_id = l2.suggested_id and t.to_id = l2.character_id))
              where l2.outcome is null and t.created_at >= l2.shown_at and t.kind <> all($1::text[]) ${one.length ? "and l2.character_id = $2" : ""}
              group by l2.id) m
      where l.id = m.id and l.outcome is null
      returning l.id`,
    [ENCOUNTERS, ...one],
  );
  const ignored = await db.query(
    `update social_suggestion_log set outcome = 'ignored', outcome_at = $1::timestamptz
      where outcome is null and shown_at < $1::timestamptz - make_interval(days => $2) ${one.length ? "and character_id = $3" : ""}
      returning id`,
    [at, IGNORED_AFTER_DAYS, ...one],
  );
  return { accepted: accepted.rows.length, ignored: ignored.rows.length };
}
