/**
 * Assembles a date from stored data and the owner's settings, runs the deterministic engine, and
 * keeps the persistent relationship between a pair up to date. The episodes route calls buildDate()
 * then getEngine().decide(), then narrateEpisode(). Souls and relationship memory live only here and
 * in the engine; they are never sent to spectators.
 */
import { endingWhy } from "./why";
import { shortName } from "./names";
import type { Db } from "./db";
import {
  CURRENT_ENGINE_VERSION,
  deriveSoulSignals,
  deterministicEngine,
  deterministicTraced,
  NEUTRAL_SIGNALS,
  seedFrom,
  type CharacterSheet,
  type DateHistory,
  type DateInput,
  type EngineTrace,
  type Outcome,
  type SideSetup,
  type SoulSignals,
} from "./engine";
import type { BoxScore, DateSetup } from "./game";
import { assembleCharacter, type Character } from "./character";
import type { CharacterExtras } from "./extras";
import { thisWeek, type StoredThisWeek } from "./life";
import { leanedOnWords, loadCharacterMemory, pairMemory, pendingReflections, withPairMemory, withPendingReflections, type CharacterMemory } from "./memory";
import { activeNudge, alsoSeeing } from "./between-dates";
import { agreedPlan, planLines, type AgreedPlan, type PlanText } from "./plans";
import { afterDarkNote, withAfterDark } from "./adult/memory";
import { engineHistory, loadRelationship, pairContext, pairKey, pairSharedWords, PUBLIC_ONLY, refreshRelationship, type End, type Relationship } from "./relationships";
import { planPlace } from "./places";
import { warnWhenSparksOut } from "./partners";
import { loadSoul, type StoredSoul } from "./souls";
import { isText, loadChain, promptTexts, type ChainItem, type PromptTexts } from "./text-chain";
import type { Turn } from "./conversation";
import { nextDateNumber } from "./date-number";
import {
  AGENDA_IDS,
  dateNumberOf,
  DEFAULT_AUTONOMY,
  DEFAULT_GAME_BUDGET,
  DEFAULT_STRATEGY,
  PRODUCER_IDS,
  type AgendaId,
  type Autonomy,
  type Ending,
  type GameBudget,
  type ProducerId,
  type SlidingDoorChange,
  type Strategy,
} from "./rules";
import { pickVenueAvoiding, type PlaceId } from "./venues";
import { DEFAULT_FORMAT, format as showFormat, type FormatId } from "./formats";
import { HOUSE_CHARACTERS } from "./house";

export type CharacterForDate = { id: string; sheet: CharacterSheet };

export type DateRequest = {
  autonomy: Autonomy;
  strategy: Strategy;
  gameBudget: GameBudget;
  /** The owner's chosen agenda for their side; null means the show deals one. */
  agendaId: AgendaId | null;
  note: string | null;
  /** The show format (lib/formats.ts): cosmetic framing only, never the engine. Defaults to classic. */
  format: FormatId;
};

export const DEFAULT_DATE_REQUEST: DateRequest = {
  autonomy: DEFAULT_AUTONOMY,
  strategy: DEFAULT_STRATEGY,
  gameBudget: DEFAULT_GAME_BUDGET,
  agendaId: null,
  note: null,
  format: DEFAULT_FORMAT,
};

const pickAgenda = (seed: number): AgendaId => AGENDA_IDS[seed % AGENDA_IDS.length];
const pickProducer = (seed: number): ProducerId => PRODUCER_IDS[seed % PRODUCER_IDS.length];

/** A real house regular to play the meet-the-parents chaperone: dealt by seed, never one of the two daters. */
function pickChaperone(seed: number, excludeIds: string[]): string {
  const pool = HOUSE_CHARACTERS.filter((c) => !excludeIds.includes(c.id));
  return (pool[seed % pool.length] ?? HOUSE_CHARACTERS[0]).name;
}

/**
 * The ex-returns format's real ex: A's most recent OTHER past partner from the relationship graph — one it once had a
 * second date with when there is one. Public edges only, so a private date's partner never turns up on air.
 */
async function findEx(db: Db, aId: string, bId: string): Promise<string | undefined> {
  const { rows } = await db.query<{ name: string }>(
    `select case when r.character_a = $1 then cb.name else ca.name end as name
       from relationships r
       join characters ca on ca.id = r.character_a
       join characters cb on cb.id = r.character_b
      where $1 in (r.character_a, r.character_b) and $2 not in (r.character_a, r.character_b) and r.public_dates > 0
      order by (r.public_second_dates > 0) desc, r.public_last_at desc nulls last limit 1`,
    [aId, bId],
  );
  return rows[0]?.name;
}

/** The engine's view of the pair's history, from the relationship graph (every date between them). */
async function loadHistory(db: Db, aId: string, bId: string): Promise<DateHistory | undefined> {
  return engineHistory(await loadRelationship(db, aId, bId));
}

export type BuiltDate = {
  input: DateInput;
  /** The two fully-assembled characters (identity + soul + learned memory): what the LLM prompts consume. */
  characters: [Character, Character];
  /** Always carries the venue: DateSetup.venue is only optional for episodes stored before it existed. */
  setup: DateSetup & { venue: PlaceId };
  seed: number;
};

/** Everything a date is assembled from, already loaded: the pure core of buildDate (no database). */
export type DateParts = {
  episodeId: string;
  a: CharacterForDate;
  b: CharacterForDate;
  req: DateRequest;
  seed: number;
  soulA: StoredSoul | null;
  soulB: StoredSoul | null;
  memoryA: CharacterMemory | null;
  memoryB: CharacterMemory | null;
  history: DateHistory | undefined;
  /** ex_returns: the name of A's real ex from the relationship graph, when there is one. */
  ex?: string;
  /** See buildDate: the snapshot a worker re-decides on. */
  signalsOverride?: { a: SoulSignals; b: SoulSignals };
  /** Each side's optional details (lib/extras.ts). Dialogue flavour only: the engine never reads them. */
  extrasA?: CharacterExtras | null;
  extrasB?: CharacterExtras | null;
  /** Words each side has leaned on across its recent aired dates (lib/memory.ts leanedOnWords): retire them. */
  overusedA?: string[];
  overusedB?: string[];
  /** What's new in each side's life this week (lib/life.ts). Dialogue flavour only. */
  thisWeekA?: string | null;
  thisWeekB?: string | null;
  /**
   * The pair's edge in the relationship graph (lib/relationships.ts), who set this date up (it decides which past
   * dates each side may bring in: the public record plus that creator's own), and, for a second date, the date
   * whose plan it is. All optional: without them a date is built exactly as before.
   */
  relationship?: Relationship | null;
  creatorId?: string;
  /** What each side remembers of After Dark with the other, in PG terms (lib/adult/memory.ts), or null. */
  afterDark?: { a: string | null; b: string | null };
  followupOf?: string | null;
  /** Which date this is for the couple (setup.date_number), for the words only: DateInput.date_number. */
  dateNumber?: number | null;
  /** Each owner's standing nudge about the other, and who else each is seeing (public). Flavour only. */
  nudges?: { a: string | null; b: string | null };
  alsoSeeing?: { a: string[]; b: string[] };
  /** Every text they've sent each other, as each side sees it (lib/text-chain.ts promptTexts). Flavour only. */
  texts?: { a: PromptTexts; b: PromptTexts };
  /** Venues to deal past: where either person's character had its last dates (buildDate snapshots them). */
  avoidVenues?: PlaceId[];
  /** A stored date's venue, kept as booked: the library can grow, and a plan can change, after a date is booked. */
  venueOverride?: PlaceId;
  /** The plan the two agreed to by text that tonight is (lib/plans.ts): where it happens, and each side knows it. */
  agreedPlan?: AgreedPlan | null;
};

/**
 * Assembles a date from parts that are already loaded. Pure and deterministic: the same parts and seed give
 * the same date. buildDate loads the parts from the database; the quality eval (lib/eval.ts) passes them in
 * directly, so it can generate dates without touching any stored data.
 */
export function assembleDate(p: DateParts): BuiltDate {
  const { a, b, req, seed } = p;
  const charA = assembleCharacter({ id: a.id, sheet: a.sheet, soul: p.soulA, memory: p.memoryA, extras: p.extrasA, thisWeek: p.thisWeekA });
  const charB = assembleCharacter({ id: b.id, sheet: b.sheet, soul: p.soulB, memory: p.memoryB, extras: p.extrasB, thisWeek: p.thisWeekB });
  if (p.overusedA?.length) charA.overused = p.overusedA;
  if (p.overusedB?.length) charB.overused = p.overusedB;
  // The plan they agreed to by text is tonight (David, 2026-10-18: "honoring their discussion in the texting"): it's
  // where the date happens, and each side knows it kept the plan. One plan per date: with it, a second date's older
  // plan (from its morning after) stays out of the prompts, so the venue and the premise can't come from two plans.
  const agreed = p.agreedPlan ?? null;
  const [lo] = pairKey(a.id, b.id);
  const endOf = (id: string): End => (id === lo ? "lo" : "hi");
  if (agreed) {
    charA.tonightsPlan = planLines(agreed, endOf(a.id));
    charB.tonightsPlan = planLines(agreed, endOf(b.id));
  }
  // Each side's own view of the relationship (never the other's private wish), and the words both already know.
  if (p.relationship && p.creatorId !== undefined) {
    const followup = agreed ? null : (p.followupOf ?? null);
    charA.pair = pairContext(p.relationship, a.id, p.creatorId, followup);
    charB.pair = pairContext(p.relationship, b.id, p.creatorId, followup);
    charA.pairShared = charB.pairShared = pairSharedWords(p.relationship, p.creatorId);
  }
  // After Dark, only ever as its PG note (David's pick: on their public dates too).
  if (p.afterDark?.a) charA.pair = withAfterDark(charA.pair ?? null, p.afterDark.a);
  if (p.afterDark?.b) charB.pair = withAfterDark(charB.pair ?? null, p.afterDark.b);
  if (agreed) charA.pairShared = charB.pairShared = `${charA.pairShared ?? ""} ${agreed.texts.map((t) => t.text).join(" ")}`.trim();
  // Their texts go into the date (David: "the full text history going into the date"). Both of them sent and read every
  // one, so each side carries the whole thread, and its words are things both already know.
  if (p.texts) {
    if (p.texts.a.texts.length) charA.texts = p.texts.a;
    if (p.texts.b.texts.length) charB.texts = p.texts.b;
    const said = p.texts.a.texts.map((t) => t.text).join(" ");
    if (said) charA.pairShared = charB.pairShared = `${charA.pairShared ?? ""} ${said}`.trim();
  }
  if (p.nudges?.a) charA.nudge = p.nudges.a;
  if (p.nudges?.b) charB.nudge = p.nudges.b;
  if (p.alsoSeeing?.a.length) charA.alsoSeeing = p.alsoSeeing.a;
  if (p.alsoSeeing?.b.length) charB.alsoSeeing = p.alsoSeeing.b;
  // Without one, a second date happens where its morning after planned it, when the plan names a kind of place we have,
  // but never the same place twice in a row: a running joke about coffee kept Cass and Dex in the same café for 7 of
  // 15 dates. An agreed plan has no such rule: it takes a proposal and a yes, and that's what they asked for.
  const plans = !agreed && p.followupOf ? (p.relationship?.plans ?? []).filter((x) => x.episode_id === p.followupOf) : [];
  // 2.7.0 (#643): a plan that names a place the library has no set for ("the foundry") goes there, on the placeholder, as
  // an agreed plan or a move does; one of their homes too. A library venue the texts name still wins.
  const nameAt = (end: End) => (end === endOf(a.id) ? a.sheet.name : b.sheet.name);
  const planned = planPlace(plans.map((x) => ({ text: x.text, from: nameAt(x.by), to: nameAt(x.by === "lo" ? "hi" : "lo") })));
  const recentVenues = (p.relationship?.history ?? []).slice(-2).map((h) => h.venue);
  const plannedVenue: PlaceId | null = agreed?.place ?? (planned && recentVenues[recentVenues.length - 1] !== planned ? planned : null);
  // The effective engine signals this date runs on: the base soul/image signals nudged by the learned
  // memory's bounded drift (lib/character.ts), so a bot genuinely evolves across its dates. A worker
  // rebuilding a stored date passes the snapshot so it re-decides EXACTLY what POST stored.
  const signalsA = p.signalsOverride?.a ?? charA.signals;
  const signalsB = p.signalsOverride?.b ?? charB.signals;
  const agendaA = req.agendaId ?? pickAgenda(seedFrom(seed, "agenda-a"));
  const agendaB = pickAgenda(seedFrom(seed, "agenda-b"));
  const setup: DateSetup & { venue: PlaceId } = {
    autonomy: req.autonomy,
    strategy: req.strategy,
    agenda_a: agendaA,
    agenda_b: agendaB,
    game_budget_a: req.gameBudget,
    game_budget_b: DEFAULT_GAME_BUDGET,
    producer: pickProducer(seedFrom(seed, "producer")),
    venue: p.venueOverride ?? plannedVenue ?? pickVenueAvoiding(seedFrom(seed, "venue"), p.avoidVenues ?? []),
    ...(p.avoidVenues?.length ? { avoid_venues: p.avoidVenues } : {}),
    // They carried an After Dark memory into this date (lib/adult/memory.ts): its page shows 🌙 to whoever After Dark is open to.
    ...(p.afterDark?.a || p.afterDark?.b ? { after_dark: true } : {}),
    format: req.format,
    // Moves (lib/moves.ts): on for every date booked from now, unless the format keeps one table (the speed date).
    ...(showFormat(req.format).moves !== false ? { moves: true } : {}),
    // Snapshot the exact effective signals this date ran on, so a replay reproduces it even after memory drifts.
    signals_a: signalsA,
    signals_b: signalsB,
    // ...and the sheets it read, since a character can be edited after its date.
    sheet_a: a.sheet,
    sheet_b: b.sheet,
    // ...and the engine calibration that decides it, for the same reason.
    engine_version: CURRENT_ENGINE_VERSION,
    // ...and the pair's history as the engine read it, so a replay sees the relationship as it stood that night.
    ...(p.history ? { history: p.history } : {}),
    ...(agreed ? { agreed_plan: agreed } : {}),
    ...(p.followupOf ? { followup_of: p.followupOf, plan: agreed ? agreed.texts.map((t) => t.text) : plans.map((x) => x.text) } : {}),
    ...(p.nudges?.a ? { nudge_a: p.nudges.a } : {}),
    ...(p.nudges?.b ? { nudge_b: p.nudges.b } : {}),
    // Which date this is for the couple (lib/date-number.ts): stored, so its happy ending names the date after it.
    ...(p.dateNumber && p.dateNumber > 1 ? { date_number: p.dateNumber } : {}),
  };
  // Fill the format's cast from real data (flavour only, never the engine): a named house regular as the
  // meet-the-parents chaperone, and a real past partner as the returning ex when the graph has one.
  if (req.format === "meet_the_parents") setup.chaperone = pickChaperone(seedFrom(seed, "chaperone"), [a.id, b.id]);
  if (req.format === "ex_returns") setup.ex = p.ex;
  // The engine itself is unchanged (still deterministic given signals); only its input signals now carry
  // the learned drift, and setup.signals_a/b above snapshots exactly what it ran on for reproducible replays.
  const sideA: SideSetup = {
    sheet: a.sheet,
    signals: signalsA,
    autonomy: req.autonomy,
    strategy: req.strategy,
    agendaId: agendaA,
    note: req.note,
    gameBudget: req.gameBudget,
  };
  const sideB: SideSetup = {
    sheet: b.sheet,
    signals: signalsB,
    autonomy: DEFAULT_AUTONOMY,
    strategy: DEFAULT_STRATEGY,
    agendaId: agendaB,
    note: null,
    gameBudget: DEFAULT_GAME_BUDGET,
  };
  const input: DateInput = { a: sideA, b: sideB, history: p.history, ...(p.dateNumber && p.dateNumber > 1 ? { date_number: p.dateNumber } : {}) };
  return { input, characters: [charA, charB], setup, seed };
}

/**
 * Builds the full engine input for one date. The seed comes from the episode id, so the outcome is
 * reproducible and a Sliding Doors replay can reuse it with one input changed. Side A is the owner's;
 * side B (a house character or another user's OC) plays on balanced defaults with a dealt agenda.
 */
export async function buildDate(
  db: Db,
  episodeId: string,
  a: CharacterForDate,
  b: CharacterForDate,
  req: DateRequest,
  seedOverride?: number,
  /**
   * The exact effective signals to run on, instead of recomputing them from current memory. The async
   * worker passes the snapshot POST stored (setup.signals_a/b) so it re-decides the SAME canonical outcome
   * even if a character's memory has since drifted (e.g. a concurrent template date). Omitted at POST time.
   */
  signalsOverride?: { a: SoulSignals; b: SoulSignals },
  /**
   * Who set the date up (the relationship layer each side may draw on), the date this is the second date of, and the
   * pair history to run on instead of today's (the worker passes the snapshot POST stored, like the signals).
   */
  opts: {
    creatorId?: string;
    followupOf?: string | null;
    /**
     * Which date this is for the couple (setup.date_number). A follow-up passes its own; a rebuild passes the stored one
     * (null for none). Left out, as on a fresh booking, it's 1 + the pair's public dates so far (lib/date-number.ts).
     */
    dateNumber?: number | null;
    historyOverride?: DateHistory | null;
    legacyHistory?: boolean;
    /** The nudges as booked (the worker passes the setup's snapshot: by then they've been used). */
    nudges?: { a: string | null; b: string | null };
    /**
     * Venues to deal past. Left out when a date is booked: then it's where either person's character had its last two
     * dates. A rebuild of a stored date passes the setup's snapshot (or [] for one from before), so the venue holds.
     */
    avoidVenues?: PlaceId[];
    /** A rebuild of a stored date passes its venue (DateSetup.venue), so it's written where it was booked. */
    venueOverride?: PlaceId;
    /**
     * The plan they agreed to by text (lib/plans.ts). Left out when a date is booked: then it's read from their texts.
     * A rebuild of a stored date passes the setup's snapshot, or null for none: a rebuild never reads the texts again,
     * so a text sent while an agent is playing the date can't turn it into a different one halfway through.
     */
    agreedPlan?: AgreedPlan | null;
  } = {},
): Promise<BuiltDate> {
  const [soulA, soulB, memoryA, memoryB, relationship, ex, extras, nudges, seeingA, seeingB] = await Promise.all([
    loadSoul(db, a.id),
    loadSoul(db, b.id),
    loadCharacterMemory(db, a.id),
    loadCharacterMemory(db, b.id),
    loadRelationship(db, a.id, b.id),
    req.format === "ex_returns" ? findEx(db, a.id, b.id) : Promise.resolve(undefined),
    // Loaded here, beside the soul and memory, so every path that builds a date gets the details.
    db.query<{ id: string; extras: CharacterExtras | null; this_week: StoredThisWeek | null }>(
      `select id, extras, this_week from characters where id = any($1)`,
      [[a.id, b.id]],
    ),
    opts.nudges
      ? Promise.resolve(opts.nudges)
      : Promise.all([activeNudge(db, a.id, b.id), activeNudge(db, b.id, a.id)]).then(([x, y]) => ({ a: x, b: y })),
    alsoSeeing(db, a.id, b.id).catch(() => []),
    alsoSeeing(db, b.id, a.id).catch(() => []),
  ]);
  const afterDark = { a: await afterDarkNote(db, a.id, b.id), b: await afterDarkNote(db, b.id, a.id) };
  // What each has leaned on across its recent aired dates (lib/memory.ts), so a voice tic doesn't recur every date.
  const [overusedA, overusedB] = await Promise.all([leanedOnWords(db, a.id).catch(() => []), leanedOnWords(db, b.id).catch(() => [])]);
  // The texts this date's creator may bring in: every text between dates, and the morning afters of the dates they can use.
  const chain = opts.creatorId !== undefined ? await loadChain(db, a.id, b.id, { usableBy: opts.creatorId }) : [];
  // Each side's own reflections on public dates still waiting to air, from that creator's dates (lib/memory.ts).
  const [pendingA, pendingB] =
    opts.creatorId !== undefined && opts.creatorId !== PUBLIC_ONLY
      ? await Promise.all([pendingReflections(db, a.id, opts.creatorId, episodeId), pendingReflections(db, b.id, opts.creatorId, episodeId)])
      : [[], []];
  // What each remembers about the other from every date between them this creator may use, private and unaired too.
  const [pairA, pairB] =
    opts.creatorId !== undefined && opts.creatorId !== PUBLIC_ONLY
      ? await Promise.all([pairMemory(db, a.id, b.id, opts.creatorId), pairMemory(db, b.id, a.id, opts.creatorId)]).catch(() => [null, null])
      : [null, null];
  const [lo] = pairKey(a.id, b.id);
  const texts = chain.some(isText) ? { a: promptTexts(chain, a.id === lo ? "lo" : "hi"), b: promptTexts(chain, b.id === lo ? "lo" : "hi") } : undefined;
  const names: Record<End, string> = a.id === lo ? { lo: a.sheet.name, hi: b.sheet.name } : { lo: b.sheet.name, hi: a.sheet.name };
  const agreed = opts.agreedPlan !== undefined ? opts.agreedPlan : await planFromChain(db, chain, lo, names).catch(() => null);
  const rowOf = (id: string) => extras.rows.find((r) => r.id === id);
  // A worker re-deciding a stored date passes its snapshot; a date stored before snapshots ran on dates + last ending.
  const current = engineHistory(relationship);
  const history =
    opts.historyOverride !== undefined && opts.historyOverride !== null
      ? opts.historyOverride
      : opts.historyOverride === null
        ? undefined
        : opts.legacyHistory && current
          ? { dates: current.dates, last_ending: current.last_ending }
          : current;
  const avoidVenues = opts.avoidVenues ?? (await recentVenues(db, [a.id, b.id], episodeId));
  return assembleDate({
    episodeId, a, b, req, seed: seedOverride ?? seedFrom(episodeId), avoidVenues, venueOverride: opts.venueOverride, agreedPlan: agreed,
    soulA, soulB, memoryA: withPairMemory(withPendingReflections(memoryA, pendingA), pairA), memoryB: withPairMemory(withPendingReflections(memoryB, pendingB), pairB), history, ex, signalsOverride,
    relationship, creatorId: opts.creatorId, followupOf: opts.followupOf ?? null,
    dateNumber: opts.dateNumber !== undefined ? opts.dateNumber : opts.followupOf ? null : await nextDateNumber(db, a.id, b.id, episodeId),
    nudges, alsoSeeing: { a: seeingA, b: seeingB }, texts, afterDark,
    extrasA: rowOf(a.id)?.extras ?? null, extrasB: rowOf(b.id)?.extras ?? null,
    overusedA, overusedB,
    thisWeekA: thisWeek(a.id, rowOf(a.id)?.this_week), thisWeekB: thisWeek(b.id, rowOf(b.id)?.this_week),
  });
}

/**
 * The plan they agreed to since their last date (lib/plans.ts, David 2026-10-18: "their plan could be an agreement
 * earlier in the conversation… if one agrees to do something, make it the plan"): the whole of the last date's own
 * conversation, then its morning after, then the texts after it. With no date yet, their whole chat (a match's first
 * texts plan the first date). Read newest first, so a later agreement wins, but an agreement made ON the date counts —
 * two characters who agree in act one to go back to someone's place no longer land somewhere random next time.
 */
export async function planFromChain(db: Db, chain: ChainItem[], lo: string, names: Record<End, string>): Promise<AgreedPlan | null> {
  const last = chain.reduce((at, item, i) => (item.kind === "date" ? i : at), -1);
  const since = (last < 0 ? chain : chain.slice(last + 1)).filter(isText).map((t) => ({ who: t.who, text: t.text }));
  const date = last < 0 ? null : chain[last];
  let said: PlanText[] = [];
  if (date?.kind === "date") {
    const row = (await db.query<{ transcript: Turn[] | null; character_a: string }>(`select transcript, character_a from episodes where id = $1`, [date.episode_id])).rows[0];
    said = (row?.transcript ?? []).map((t) => ({ who: ((t.side === "a") === (row!.character_a === lo) ? "lo" : "hi") as End, text: t.dialogue }));
  }
  const conversation = [...said, ...since];
  return agreedPlan(conversation, names, conversation.length);
}

/** The venues of each person's character's last two dates (house characters date everyone, so theirs don't count). */
async function recentVenues(db: Db, ids: string[], excludeEpisodeId: string): Promise<PlaceId[]> {
  const found = new Set<PlaceId>();
  for (const id of ids) {
    const { rows } = await db.query<{ venue: PlaceId }>(
      `select e.setup->>'venue' as venue
         from episodes e join characters c on c.id = $1 and not c.is_house
        where (e.character_a = $1 or e.character_b = $1) and e.id <> $2 and e.setup->>'venue' is not null
        order by e.created_at desc
        limit 2`,
      [id, excludeEpisodeId],
    );
    for (const r of rows) found.add(r.venue);
  }
  return [...found];
}

/* ------------------------------------- Sliding Doors ------------------------------------- */

function varySetup(setup: DateSetup, change: SlidingDoorChange): DateSetup {
  switch (change) {
    case "bolder":
      return { ...setup, autonomy: "unpredictable" };
    case "safer":
      return { ...setup, autonomy: "guided" };
    case "bigger_budget":
      return { ...setup, game_budget_a: 100 };
    case "long_game":
      return { ...setup, strategy: "long_term" };
  }
}

type DoorRow = {
  episode_id: string;
  seed: string | null;
  setup: DateSetup | null;
  note: string | null;
  ending: Ending;
  box_score: BoxScore | null;
  /** The wishes that may have tipped the stored ending; `engine` is the engine's own (lib/wishes.ts). */
  wishes: { engine?: Ending } | null;
  a_id: string;
  a_name: string;
  a_age: number;
  a_bio: string;
  a_traits: string[];
  a_want: string;
  a_dealbreaker: string;
  a_house: boolean;
  b_id: string;
  b_name: string;
  b_age: number;
  b_bio: string;
  b_traits: string[];
  b_want: string;
  b_dealbreaker: string;
  b_house: boolean;
};

const toSheet = (r: DoorRow, p: "a" | "b"): CharacterSheet => ({
  name: r[`${p}_name`],
  age: r[`${p}_age`],
  bio: r[`${p}_bio`],
  traits: r[`${p}_traits`],
  want: r[`${p}_want`],
  dealbreaker: r[`${p}_dealbreaker`],
  house: r[`${p}_house`],
});

export type SlidingDoorsResult = {
  change: SlidingDoorChange;
  /** In words: what was changed, and on whose side (always the side of the character whose owner booked it). */
  what_changed: string;
  base: { ending: Ending; box_score: BoxScore; why?: string };
  alternate: { ending: Ending; box_score: BoxScore; why?: string };
};

/** What each change does, said plainly (varySetup). */
const CHANGE_SAYS: Record<SlidingDoorChange, string> = {
  bolder: "made more unpredictable (its AI may go off-script)",
  safer: "made more guided (its AI sticks closer to what its owner would want)",
  bigger_budget: "given the biggest date budget",
  long_game: "playing for long-term compatibility (the ending is scored on trust most)",
};

const DOORS_SELECT = `
  select e.id as episode_id, e.seed::text as seed, e.setup, e.note, e.ending, e.box_score, e.wishes,
         a.id a_id, a.name a_name, a.age a_age, a.bio a_bio, a.traits a_traits, a.want a_want,
         a.dealbreaker a_dealbreaker, a.is_house a_house,
         b.id b_id, b.name b_name, b.age b_age, b.bio b_bio, b.traits b_traits, b.want b_want,
         b.dealbreaker b_dealbreaker, b.is_house b_house
    from episodes e
    join characters a on a.id = e.character_a
    join characters b on b.id = e.character_b`;

/**
 * A stored counterfactual (episode_variations): the engine's own replay of the date as booked, the alternate with one
 * thing changed, and whether the replay reproduced the engine's original ending (`faithful`; false when a character
 * was edited since, or the date predates the setup snapshots). The comparison that's fair is replay vs alternate —
 * the aired ending may also carry a wish's tip. Sides keep only booleans: no cue word (a dealbreaker is secret).
 */
type DoorsRecord = {
  engine_version: number;
  base_ending: Ending;
  stored_ending: Ending;
  alt_ending: Ending;
  alt_box_score: BoxScore;
  alt_sides: { wants_another: boolean; satisfied: boolean; agenda_met: boolean; dealbreaker_hit: boolean; want_met: boolean; note_followed: boolean | null }[];
  alt_trace: EngineTrace | null;
  faithful: boolean;
};

/** Recompute the one-thing-changed alternate for a loaded date row. No model call; deterministic. */
async function computeDoors(db: Db, row: DoorRow, change: SlidingDoorChange): Promise<SlidingDoorsResult | null> {
  return (await replayDoors(db, row, change))?.result ?? null;
}

async function replayDoors(db: Db, row: DoorRow, change: SlidingDoorChange): Promise<{ result: SlidingDoorsResult; record: DoorsRecord } | null> {
  if (!row.setup || row.seed === null || !row.box_score) return null;
  const seed = Number(row.seed);
  const setup = row.setup;
  const [soulA, soulB] = await Promise.all([loadSoul(db, row.a_id), loadSoul(db, row.b_id)]);
  // The relationship as it stood that night (snapshotted since the graph); older dates fall back to today's dates and
  // last ending only, which is all the engine read back then.
  // A date booked since the snapshot (it has engine_version, which landed with it) and without history was their first:
  // today's relationship already counts that very date, so reading it would replay a different night.
  const today = setup.history || setup.engine_version !== undefined ? undefined : await loadHistory(db, row.a_id, row.b_id);
  const history: DateHistory | undefined = setup.history ?? (today ? { dates: today.dates, last_ending: today.last_ending } : undefined);

  // Reproducibility: use the signals the date actually ran on (snapshotted on the setup in M14 part 2), so
  // an old date replays identically even after the character's learned memory has drifted since. Episodes
  // built before the snapshot fall back to deriving signals from the soul, exactly as they did then.
  const fromSoul = (soul: typeof soulA) => (soul ? (soul.signals ?? deriveSoulSignals(soul)) : NEUTRAL_SIGNALS);
  const sigA = setup.signals_a ?? fromSoul(soulA);
  const sigB = setup.signals_b ?? fromSoul(soulB);

  const build = (s: DateSetup): DateInput => ({
    a: {
      sheet: setup.sheet_a ?? toSheet(row, "a"),
      signals: sigA,
      autonomy: s.autonomy,
      strategy: s.strategy,
      agendaId: s.agenda_a,
      note: row.note,
      gameBudget: s.game_budget_a,
    },
    b: {
      sheet: setup.sheet_b ?? toSheet(row, "b"),
      signals: sigB,
      autonomy: DEFAULT_AUTONOMY,
      strategy: DEFAULT_STRATEGY,
      agendaId: s.agenda_b,
      note: null,
      gameBudget: s.game_budget_b,
    },
    history,
  });

  // Replay under the calibration the date was decided with (v1 for dates from before versioning).
  const version = setup.engine_version ?? 1;
  const varied = varySetup(setup, change);
  const { outcome: alt, trace: altTrace } = deterministicTraced(build(varied), seed, version);
  const baseWhy = endingWhy(row.ending, row.box_score, null, setup.strategy, undefined, undefined, dateNumberOf(setup));
  const altWhy = endingWhy(alt.ending, alt.variables, alt.sides, varied.strategy, setup.engine_version, undefined, dateNumberOf(setup));
  const result: SlidingDoorsResult = {
    change,
    what_changed: `${shortName(row.a_name)}'s side was ${CHANGE_SAYS[change]}; ${shortName(row.b_name)}'s stayed as it was. Same seed, so nothing else moved.`,
    base: { ending: row.ending, box_score: row.box_score, ...(baseWhy ? { why: baseWhy } : {}) },
    alternate: { ending: alt.ending, box_score: alt.variables, ...(altWhy ? { why: altWhy } : {}) },
  };
  const replay = deterministicEngine.decide(build(setup), seed, version);
  const record: DoorsRecord = {
    engine_version: version,
    base_ending: replay.ending,
    stored_ending: row.ending,
    alt_ending: alt.ending,
    alt_box_score: alt.variables,
    alt_sides: alt.sides.map((s) => ({
      wants_another: s.wants_another,
      satisfied: s.satisfied,
      agenda_met: s.agenda_met,
      dealbreaker_hit: s.dealbreaker_hit !== null,
      want_met: s.want_met !== null,
      note_followed: s.note_followed,
    })),
    alt_trace: altTrace,
    faithful: replay.ending === (row.wishes?.engine ?? row.ending),
  };
  return { result, record };
}

/** Keeps one owner's Sliding Doors run (episode_variations); asking again counts, never duplicates. Best effort. */
async function saveDoors(db: Db, episodeId: string, change: SlidingDoorChange, r: DoorsRecord): Promise<void> {
  await db
    .query(
      `insert into episode_variations (varies_episode_id, variation, engine_version, base_ending, stored_ending, alt_ending,
                                       alt_box_score, alt_sides, alt_trace, faithful)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10)
       on conflict (varies_episode_id, variation) do update set requests = episode_variations.requests + 1`,
      [episodeId, change, r.engine_version, r.base_ending, r.stored_ending, r.alt_ending, JSON.stringify(r.alt_box_score), JSON.stringify(r.alt_sides), r.alt_trace ? JSON.stringify(r.alt_trace) : null, r.faithful],
    )
    .catch(() => {});
}

/**
 * Replays an owner's date with exactly one input changed, reusing the stored seed so the only
 * difference is the change (PRD "Sliding doors"). No model call: the engine recomputes the outcome
 * deterministically, so the two timelines are a fair, reproducible comparison. Owner-only.
 */
export async function slidingDoors(
  db: Db,
  episodeId: string,
  userId: string,
  change: SlidingDoorChange,
): Promise<SlidingDoorsResult | null> {
  const row = (await db.query<DoorRow>(`${DOORS_SELECT} where e.id = $1 and e.creator_id = $2`, [episodeId, userId])).rows[0];
  if (!row) return null;
  const doors = await replayDoors(db, row, change);
  // The owner's what-if is kept as a counterfactual (data plan Tier 1). The chaos replay below never is: a watch party
  // polls it constantly, and it isn't anyone's question about their own date.
  if (doors) await saveDoors(db, row.episode_id, change, doors.record);
  return doors?.result ?? null;
}

/**
 * The chaos button's "chaos timeline" (lib/watch.ts): the same deterministic one-thing-changed replay, but
 * NOT owner-gated — it's a public, clearly-non-canon "what if the audience's curveball had hit" for a watch
 * party. Predictions still resolve on the canonical ending (row.ending / base), so this changes nothing real.
 */
export async function chaosReplay(db: Db, episodeId: string, change: SlidingDoorChange): Promise<SlidingDoorsResult | null> {
  const row = (await db.query<DoorRow>(`${DOORS_SELECT} where e.id = $1`, [episodeId])).rows[0];
  return row ? computeDoors(db, row, change) : null;
}

/**
 * Remembers that a pair dated: recomputes their edge in the relationship graph from all their dates
 * (lib/relationships.ts), which feeds the next date's engine run and the couple's page. Idempotent.
 */
export async function rememberDate(db: Db, aId: string, bId: string): Promise<void> {
  const [lo, hi] = pairKey(aId, bId);
  const rel = await refreshRelationship(db, aId, bId);
  // 2.7.0 sent exclusive_soon here, when the date that made a couple Sparks was written, which ran ahead of its airing
  // (the 2026-10-22-0610 run). 2.9.0: it goes out when that date airs (lib/relationship-events.ts), once; here only for a
  // private date, which never airs and whose owners see its ending now (lib/partners.ts warnWhenSparksOut).
  await warnWhenSparksOut(db, lo, hi, rel).catch(() => 0);
}
