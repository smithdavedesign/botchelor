/**
 * The After Dark observer's deterministic checks (David, 2026-10-21: "an observer for background testing"), run by
 * scripts/eval/after-dark-observer.mjs over saved nights and scenes, read-only. Free: no model. It calls out what it
 * sees, as line ranges and a note, for a night's chapters in order:
 *
 * - a place change nobody proposed and agreed to (a line that steps onto a balcony or into a car with no "shall we…?" /
 *   "lead the way" before it), and the moves the engine refused (lib/adult/continuity.ts logs them on the scene);
 * - "my place?" asked when they're already at that person's place;
 * - lines that repeat an earlier line of the night, word for word or nearly;
 * - each character's catchphrase, counted per chapter;
 * - set churn: distinct set names per chapter (and, when the script can see them, the sets requested meanwhile);
 * - a line whose private "why" cites a memory that isn't in what they can remember;
 * - the share of lines whose "why" draws on a memory, a trait, or just the moment;
 * - drift, per character (lib/adult/quality.ts): how much of their own sheet their lines use, and how often they reach
 *   for a stock romance phrase (David, 2026-10-21: sheet details in 2 of 977 lines; "symphony" 16 times), and (v2.1) how
 *   often they reuse a worn phrase or end on a question, and the phrases they lean on most;
 * - (v2.1, lib/adult/craft.ts) a limit the other side went past before a check-in and a yes; a possessive that fits
 *   neither character's pronouns, in the lines or the place; a chapter stuck at a threshold (a doorway, the car); the
 *   share of lines with a sensory detail; and private whys that only restate a trait.
 *
 * Lines saved before the private notes existed have no "why": the memory and share checks just count none.
 */
import { agreedMove, canonicalSet, HOME_ROOMS, homeProposed, placeIn, proposesMove, repeatOf, samePlace, saysCatchphrase, speechOf, type MoveLog } from "./continuity";
import { climaxIn, limitsIn, pronounKind, THRESHOLD_LINES, thresholdOf, wrongPossessives } from "./craft";
import { stageShown } from "./stage-floor";
import { driftOf, sensoryDetail, sideOfObserved, whyRestatesTrait, type Drift } from "./quality";

export type ObservedLine = { who: "a" | "b"; text: string; why?: string | null; memory?: string | null; moved_to?: string | null; stage?: number | null };
/**
 * v2.3: a step's flags as the observer reads them: a Direct steer's quoted lines, and whether each was said. v2.5: what
 * the owner asked for, so a move they ordered isn't one "nobody agreed to": the step's kind ("set_scene" for Set the
 * scene and a scenario's start, else a write), its lines, and a write's steer and mode.
 */
export type ObservedStep = {
  line_from: number | null;
  line_to?: number | null;
  kind?: string | null;
  direction?: string | null;
  steer_mode?: string | null;
  flags: { quotes?: { text: string; who: "a" | "b" | null; kept: boolean }[]; quote_kept?: boolean } | null;
};
export type ObservedChapter = {
  chapter: number; source: "night" | "scene"; id: string; lines: ObservedLine[]; set_place: string | null; place: string | null; moves?: MoveLog[] | null; sets_requested?: string[];
  steps?: ObservedStep[];
};
/**
 * One character's sheet as the observer reads it; `bio` and `details` (job, hobbies, quirk…) feed the drift section, and
 * `pronouns` (as the sheet gives them) the pronoun check.
 */
export type ObservedSide = { name: string; catchphrase: string | null; traits: string[]; tells: string[]; voice: string | null; want: string | null; bio?: string | null; details?: string[]; pronouns?: string | null };
export type ObserverInput = {
  a: ObservedSide;
  b: ObservedSide;
  /** Where the night started (their date's setting), when known. */
  start?: string | null;
  chapters: ObservedChapter[];
  /** Everything they could remember: the PG notes, the recaps, their date's transcript and ending. */
  memories: string[];
};

export type Finding = { check: string; chapter: number; from: number; to: number; note: string };
export type ObserverReport = {
  pair: string;
  chapters: number;
  lines: number;
  findings: Finding[];
  summary: {
    unprovoked_moves: number;
    agreed_moves: number;
    refused_moves: number;
    my_place_when_there: number;
    verbatim_repeats: number;
    near_repeats: number;
    catchphrases: Record<string, Record<number, number>>;
    set_churn: Record<number, { final: string | null; distinct_sets: number; requested?: number; requested_places?: number }>;
    lines_with_why: number;
    unfounded_memories: number;
    share_memory: number;
    share_trait: number;
    share_moment: number;
    /** Per character (by name): how much of their sheet shows, and stock phrases per 100 of their lines. */
    drift: Record<string, Drift>;
    /** v2.1: limits voiced, and the ones the other side went past before a check-in and a yes. */
    limits: number;
    limit_overridden: number;
    /** v2.1: lines with a possessive that fits neither of them, on a place or a body ("his apartment", both she/her). */
    wrong_pronouns: number;
    /** v2.1: chapters that sat at a threshold (a doorway, the car) for more than THRESHOLD_LINES lines with no move in. */
    threshold_stalls: number;
    /** v2.1: the share of lines with a sensory detail of the place, and the whys that only restate a trait. */
    sensory_detail_share: number;
    why_restates_trait: number;
    /** The furthest stage the lines themselves show (stage-floor.ts stageShown), whatever the model claimed (the model simulation, 2026-10-22: a model claimed stage 4 for a night that never went past a kiss). */
    stage_shown_max: number;
    /** v2.3: a Direct steer's quoted lines (from the steps' flags), and the ones no line said nearly as written. */
    quotes_asked: number;
    quotes_dropped: number;
    /**
     * v2.3: chapters whose first lines went back below where the last chapter ended (it ended at undressing or further,
     * not in an afterglow, and the new one's first CHAPTER_START lines plainly show less): chapter 5 teasing again.
     */
    chapter_restarts: number;
  };
};

/** How many of a chapter's first lines the restart check reads. */
const CHAPTER_START = 12;

/**
 * v2.5: a line carrying an act on without the words stageShown reads it by (the restart check only, never the stage
 * floor): mid-sex, a chapter's first lines say "between her legs" and "moans" more than the act's own words. David's
 * Chud × Juniper night, replayed: chapter 2 carried straight on mid-sex and was read as stage 1.
 */
const CARRYING_ON = /\b(moan(s|ed|ing)?|between (her|his|their|my|your|[\p{L}]+['’]s) (legs|thighs)|writh\w*|hips? (buck|rock|roll|grind)\w*|dripping)\b/iu;

/**
 * v2.5: the lines the owner ordered a move in, by their own hand: the write after a Set the scene (or a scenario's start)
 * arrives where they set it, and a Direct steer that names a place or a movement is done now. Neither is a move "nobody
 * agreed to". `arrivals` is where each Set the scene put them, by the line it starts at.
 */
export function ownerMoves(steps: readonly ObservedStep[], lines: number): { ordered: Set<number>; arrivals: Map<number, string> } {
  const ordered = new Set<number>();
  const arrivals = new Map<number, string>();
  const span = (s: ObservedStep) => {
    const from = s.line_from ?? null;
    if (from === null) return [];
    const to = Math.min(lines - 1, s.line_to ?? from);
    return Array.from({ length: Math.max(0, to - from + 1) }, (_, k) => from + k);
  };
  let set: string | null = null;
  for (const s of steps) {
    if (s.kind === "set_scene") {
      set = s.direction?.trim() || null;
      continue;
    }
    if (s.kind && s.kind !== "write") continue;
    const at = span(s);
    if (set) {
      for (const i of at) ordered.add(i);
      if (at.length) arrivals.set(at[0], set);
      set = null;
    }
    const steer = s.direction ?? "";
    if (s.steer_mode === "direct" && steer && (placeIn(steer) || MOVEMENT.test(steer) || proposesMove(steer))) for (const i of at) ordered.add(i);
  }
  return { ordered, arrivals };
}

/** A line that takes them somewhere: a movement in its action ("stepping onto the balcony", "opens the car door"). */
const MOVEMENT =
  /\b(steps?|stepping|walks?|walking|leads?|leading|carries|carrying|carry|pulls? (?:him|her|them) (?:into|toward|towards|onto|out|inside)|heads?|heading|stumbles?|backs? (?:him|her) (?:into|against|toward)|opens? the (?:car )?door|gets? into|climbs? into|arriv\w*|enters?|entering|out onto|toward the door|towards the door|through the door|into the|onto the)\b/i;
/** Arriving at someone's place: "Come on in", "welcome to my…", the door opening onto it. */
const ARRIVAL = /\b(come (?:on )?in\b|step inside|welcome to my|we're here|unlocks? the door|opens? (?:his|her|the) front door)/i;

const actionOf = (text: string): string => /^\*([^*]+)\*/.exec(text)?.[1] ?? "";
const range = (from: number, to: number) => (from === to ? `line ${from}` : `lines ${from}–${to}`);

/** Content words, for matching a cited memory against what they can remember. */
const content = (text: string): string[] => speechOf(text).split(" ").filter((w) => w.length >= 4 && !STOP.has(w));
const STOP = new Set("that this with from they them their there what when where which while your yours have been were will would could should about into onto just like know said says tell told then than very much more most also only even still some time back over here".split(" "));

/** Whether a cited memory is in what they can remember: half its words, or three of them, appear there. */
export function memoryFounded(memory: string, corpus: string): boolean {
  const ws = [...new Set(content(memory))];
  if (!ws.length) return true;
  const have = new Set(content(corpus));
  const hits = ws.filter((w) => have.has(w)).length;
  return hits >= Math.min(3, ws.length) || hits / ws.length >= 0.5;
}

const traitWords = (s: ObservedSide): Set<string> =>
  new Set([...s.traits, ...s.tells, s.voice ?? "", s.want ?? "", s.catchphrase ?? ""].flatMap((t) => content(t)).concat(["trait", "tell", "voice", "catchphrase", "wants", "goal", "nature", "personality"]));

/** Runs every deterministic check over a night's chapters (in order). */
export function observeNight(input: ObserverInput): ObserverReport {
  const findings: Finding[] = [];
  const add = (check: string, chapter: number, from: number, to: number, note: string) => findings.push({ check, chapter, from, to, note });
  const names = { a: input.a.name, b: input.b.name };
  const first = (who: "a" | "b") => names[who].split(/\s+/)[0];
  const side = (who: "a" | "b") => (who === "a" ? input.a : input.b);
  const corpusBase = input.memories.join("\n");
  const summary: ObserverReport["summary"] = {
    unprovoked_moves: 0,
    agreed_moves: 0,
    refused_moves: 0,
    my_place_when_there: 0,
    verbatim_repeats: 0,
    near_repeats: 0,
    catchphrases: { [names.a]: {}, [names.b]: {} },
    set_churn: {},
    lines_with_why: 0,
    unfounded_memories: 0,
    share_memory: 0,
    share_trait: 0,
    share_moment: 0,
    drift: {},
    limits: 0,
    limit_overridden: 0,
    wrong_pronouns: 0,
    threshold_stalls: 0,
    sensory_detail_share: 0,
    why_restates_trait: 0,
    stage_shown_max: 0,
    quotes_asked: 0,
    quotes_dropped: 0,
    chapter_restarts: 0,
  };
  const kinds = [pronounKind(input.a.pronouns), pronounKind(input.b.pronouns)] as const;
  const pronounsSaid = `${first("a")}: ${input.a.pronouns ?? "?"}, ${first("b")}: ${input.b.pronouns ?? "?"}`;
  let sensory = 0;

  // Where they are as the night goes (a place noun), and whose home they're in when they're in one.
  let loc: string | null = canonicalSet(input.start ?? null).head;
  let homeOf: "a" | "b" | null = null;
  const night: string[] = [];
  const whereSaid: { chapter: number; i: number }[] = [];
  let withWhy = 0;
  let withMemory = 0;
  let withTrait = 0;
  let withMoment = 0;
  let total = 0;

  for (const ch of input.chapters) {
    const lines = ch.lines;
    total += lines.length;
    // The chapter's set says whose home it is ("Chud's living room").
    const setOwner = canonicalSet(ch.set_place).owner;
    if (setOwner && setOwner === first("a").toLowerCase()) homeOf = homeOf ?? "a";
    if (setOwner && setOwner === first("b").toLowerCase()) homeOf = homeOf ?? "b";

    // Repeats, grouped into runs ("lines 102–106 repeat 84–88").
    let run: { from: number; to: number; ofChapter: number; ofFrom: number; ofTo: number; kind: string } | null = null;
    const flush = () => {
      if (!run) return;
      const r = run;
      const of = `${r.ofChapter === ch.chapter ? "" : `chapter ${r.ofChapter}'s `}${range(r.ofFrom, r.ofTo)}`;
      add(r.kind === "verbatim" ? "verbatim_repeat" : "near_repeat", ch.chapter, r.from, r.to, `${range(r.from, r.to)} repeat${r.from === r.to ? "s" : ""} ${of} ${r.kind === "verbatim" ? "word for word" : "nearly word for word"}`);
      run = null;
    };
    const chapterStart = night.length;
    lines.forEach((l, i) => {
      const rep = repeatOf(l.text, night);
      if (rep) {
        const where = whereSaid[night.lastIndexOf(rep.of)];
        if (rep.kind === "verbatim") summary.verbatim_repeats++;
        else summary.near_repeats++;
        if (run && run.to === i - 1 && run.kind === rep.kind && run.ofChapter === where.chapter) {
          run.to = i;
          run.ofTo = where.i;
        } else {
          flush();
          run = { from: i, to: i, ofChapter: where.chapter, ofFrom: where.i, ofTo: where.i, kind: rep.kind };
        }
      } else flush();
      night.push(l.text);
      whereSaid.push({ chapter: ch.chapter, i });
    });
    flush();

    // Catchphrases, per chapter.
    for (const who of ["a", "b"] as const) {
      const phrase = side(who).catchphrase;
      if (!phrase) continue;
      const at = lines.flatMap((l, i) => (l.who === who && saysCatchphrase(l.text, phrase) ? [i] : []));
      summary.catchphrases[names[who]][ch.chapter] = at.length;
      if (at.length > 1) add("catchphrase", ch.chapter, at[0], at[at.length - 1], `${first(who)} says the catchphrase ${phrase} ${at.length} times this chapter (lines ${at.join(", ")})`);
    }

    // Places: moves nobody agreed to, "my place?" at their place, and the engine's own log. v2.5: a move the owner
    // ordered (Set the scene, a Direct steer naming a place) is agreed, and a Set the scene puts them there.
    const owner = ownerMoves(ch.steps ?? [], lines.length);
    lines.forEach((l, i) => {
      const arrived = owner.arrivals.get(i);
      if (arrived) {
        const head = canonicalSet(arrived).head;
        if (head && !(loc && samePlace(loc, head))) {
          summary.agreed_moves++;
          loc = head;
          if (!HOME_ROOMS.has(head)) homeOf = null;
        }
      }
      const home = proposesMove(l.text) ? homeProposed(l.text, l.who) : null;
      if (home && homeOf === home) {
        summary.my_place_when_there++;
        add("my_place_when_there", ch.chapter, i, i, `${first(l.who)} asks "${home === l.who ? "my" : "your"} place?", but they're already at ${first(home)}'s ("${speechOf(l.text).slice(0, 60)}")`);
      } else if (home) {
        // A yes or an arrival within a few lines: they're at that home now.
        const next = lines.slice(i + 1, i + 5);
        if (next.some((n) => ARRIVAL.test(n.text)) || agreedMove(lines.slice(i, i + 5), 1)) homeOf = home;
      }
      const action = actionOf(l.text);
      const to = l.moved_to ? canonicalSet(l.moved_to).head : MOVEMENT.test(action) ? placeIn(action) : null;
      if (!to || (loc && samePlace(loc, to))) return;
      const agreed = Boolean(l.moved_to) || owner.ordered.has(i) || Boolean(agreedMove(lines.slice(Math.max(0, i - 6), i + 1), 0));
      if (agreed) summary.agreed_moves++;
      else {
        summary.unprovoked_moves++;
        add("unprovoked_move", ch.chapter, Math.max(0, i - 1), i, `they go ${loc ? `from the ${loc} ` : ""}to the ${to} ("${action.slice(0, 70)}") and nobody suggested it and got a yes first`);
      }
      loc = to;
      if (!HOME_ROOMS.has(to)) homeOf = null;
    });
    for (const m of ch.moves ?? []) {
      if (m.taken) continue;
      summary.refused_moves++;
      add("refused_move", ch.chapter, m.at, m.at, `the model put them at "${m.to}" (${m.reason.replace(/_/g, " ")}); the engine kept them at "${m.from ?? "where they were"}"`);
    }
    if (ch.set_place) loc = canonicalSet(ch.set_place).head ?? loc;

    // Set churn: the sets this chapter ended on or moved through, and (when known) the sets requested meanwhile.
    const sets = new Set([...(ch.moves ?? []).filter((m) => m.taken).map((m) => m.to), ...(ch.set_place ? [ch.set_place] : [])].map((s) => s.toLowerCase()));
    const requested = ch.sets_requested;
    summary.set_churn[ch.chapter] = {
      final: ch.set_place,
      distinct_sets: sets.size,
      ...(requested ? { requested: requested.length, requested_places: new Set(requested.map((r) => canonicalSet(r).canonical || r)).size } : {}),
    };
    if (requested && requested.length > 3) {
      add("set_churn", ch.chapter, 0, Math.max(0, lines.length - 1), `${requested.length} sets were asked for during this chapter, for ${summary.set_churn[ch.chapter].requested_places} distinct places once canonicalized (${requested.slice(0, 8).join(", ")}${requested.length > 8 ? ", …" : ""})`);
    }

    // The private notes: memories that aren't there, and what the lines draw on.
    lines.forEach((l, i) => {
      if (!l.why) return;
      withWhy++;
      const why = l.why.toLowerCase();
      if (l.memory) {
        withMemory++;
        const corpus = `${corpusBase}\n${night.slice(0, chapterStart + i).join("\n")}`;
        if (!memoryFounded(l.memory, corpus)) {
          summary.unfounded_memories++;
          add("unfounded_memory", ch.chapter, i, i, `${first(l.who)}'s line cites a memory that isn't in what they remember: "${l.memory.slice(0, 100)}"`);
        }
      }
      const tw = traitWords(side(l.who));
      if (content(why).some((w) => tw.has(w))) withTrait++;
      if (/\bthe moment\b/.test(why)) withMoment++;
      if (whyRestatesTrait(l.why, side(l.who), side(l.who === "a" ? "b" : "a").name)) summary.why_restates_trait++;
    });

    // v2.1: limits gone past before a check-in and a yes (lib/adult/craft.ts).
    const limits = limitsIn(lines, [names.a, names.b]);
    summary.limits += limits.limits.length;
    for (const o of limits.overridden) {
      summary.limit_overridden++;
      const other = o.limit.who === "a" ? "b" : "a";
      add(
        "limit_overridden",
        ch.chapter,
        o.limit.at,
        o.at,
        `${first(o.limit.who)} says "${o.limit.said}" at line ${o.limit.at}, and ${first(other)} goes further at line ${o.at} ("${lines[o.at].text.slice(0, 70)}") with no check-in and yes in between`,
      );
    }
    // Pronouns: a possessive that fits neither of them, in a line or in where the chapter says they are.
    lines.forEach((l, i) => {
      const wrong = wrongPossessives(l.text, kinds);
      if (!wrong.length) return;
      summary.wrong_pronouns++;
      add("wrong_pronoun", ch.chapter, i, i, `"${wrong[0]}", but neither of them goes by that (${pronounsSaid})`);
    });
    const placeWrong = ch.place ? wrongPossessives(ch.place, kinds) : [];
    if (placeWrong.length) add("wrong_pronoun", ch.chapter, 0, Math.max(0, lines.length - 1), `the chapter's place is "${ch.place}", but neither of them goes by that (${pronounsSaid})`);
    // A threshold they never got past: more than THRESHOLD_LINES lines there since they last moved.
    const threshold = thresholdOf(ch.place, ch.set_place);
    const since = lines.reduce((at, l, i) => (l.moved_to ? i + 1 : at), 0);
    if (threshold && lines.length - since > THRESHOLD_LINES) {
      summary.threshold_stalls++;
      add("threshold_stall", ch.chapter, since, lines.length - 1, `${lines.length - since} lines at ${threshold} with no move inside agreed (${ch.place ?? ch.set_place})`);
    }
    sensory += lines.filter((l) => sensoryDetail(l.text)).length;
    for (const l of lines) summary.stage_shown_max = Math.max(summary.stage_shown_max, stageShown(l.text) ?? 0);
  }

  // v2.3: the quoted lines Direct steers asked for, and the ones that never came (the steps' flags).
  for (const ch of input.chapters) {
    for (const s of ch.steps ?? []) {
      for (const q of s.flags?.quotes ?? []) {
        summary.quotes_asked++;
        if (q.kept) continue;
        summary.quotes_dropped++;
        const at = Math.max(0, s.line_from ?? 0);
        add("quote_dropped", ch.chapter, at, at, `a Direct steer's quoted line wasn't said nearly as written (${q.who ? `by ${first(q.who)}` : "by either"}): "${q.text.slice(0, 60)}"`);
      }
    }
  }
  // v2.3: a chapter that went back below where the last one ended, in its first lines (not after an afterglow).
  for (let i = 1; i < input.chapters.length; i++) {
    const before = input.chapters[i - 1].lines;
    const ch = input.chapters[i];
    const ended = before.at(-1)?.stage ?? null;
    if (ended === null || ended < 3 || before.slice(-12).some((l) => climaxIn(l.text)) || !ch.lines.length) continue;
    const start = ch.lines.slice(0, CHAPTER_START);
    // v2.5: a line carrying the act on counts as where the last chapter ended.
    const shown = Math.max(...start.map((l) => (CARRYING_ON.test(l.text) ? ended : (stageShown(l.text) ?? 0))));
    if (shown < ended) {
      summary.chapter_restarts++;
      add("chapter_restart", ch.chapter, 0, start.length - 1, `the last chapter ended at stage ${ended + 1}, but these first lines show no more than stage ${shown + 1}: it started over instead of carrying on`);
    }
  }

  summary.lines_with_why = withWhy;
  summary.share_memory = withWhy ? round(withMemory / withWhy) : 0;
  summary.share_trait = withWhy ? round(withTrait / withWhy) : 0;
  summary.share_moment = withWhy ? round(withMoment / withWhy) : 0;
  summary.sensory_detail_share = total ? round(sensory / total) : 0;
  const drift = driftOf(
    input.chapters.flatMap((c) => c.lines),
    sideOfObserved(input.a),
    sideOfObserved(input.b),
  );
  summary.drift = { [names.a]: drift.a, [names.b]: drift.b };
  return { pair: `${names.a} × ${names.b}`, chapters: input.chapters.length, lines: total, findings, summary };
}

const round = (x: number) => Math.round(x * 100) / 100;

/** The report as markdown: the summary, then every finding by chapter, then the judge's callouts when there are any. */
export function reportMarkdown(r: ObserverReport, judge?: { model: string; callouts: { chapter: number; lines: string; note: string }[]; drift: Record<string, { score: number | null; note: string }> } | null): string {
  const s = r.summary;
  const out: string[] = [];
  out.push(`## After Dark observer: ${r.pair}`, "", `${r.chapters} chapter${r.chapters === 1 ? "" : "s"}, ${r.lines} lines.`, "");
  out.push("| Check | Count |", "|---|---|");
  out.push(`| Place changes nobody proposed and agreed to | ${s.unprovoked_moves} |`);
  out.push(`| Agreed moves | ${s.agreed_moves} |`);
  out.push(`| Moves the engine refused | ${s.refused_moves} |`);
  out.push(`| "My place?" when already there | ${s.my_place_when_there} |`);
  out.push(`| Lines repeated word for word | ${s.verbatim_repeats} |`);
  out.push(`| Lines repeated nearly word for word | ${s.near_repeats} |`);
  for (const [who, per] of Object.entries(s.catchphrases)) if (Object.keys(per).length) out.push(`| ${who}'s catchphrase, per chapter | ${Object.entries(per).map(([c, n]) => `ch ${c}: ${n}`).join(", ")} |`);
  out.push(
    `| Set churn, per chapter | ${Object.entries(s.set_churn)
      .map(([c, x]) => `ch ${c}: ${x.distinct_sets} set${x.distinct_sets === 1 ? "" : "s"}${x.requested !== undefined ? ` (${x.requested} requested, ${x.requested_places} places)` : ""}`)
      .join("; ")} |`,
  );
  out.push(`| Lines with a private "why" | ${s.lines_with_why} of ${r.lines} |`);
  if (s.lines_with_why) {
    out.push(`| …citing a memory / a trait / the moment | ${pct(s.share_memory)} / ${pct(s.share_trait)} / ${pct(s.share_moment)} |`);
    out.push(`| Memories cited that aren't in what they remember | ${s.unfounded_memories} |`);
    out.push(`| Whys that only restate a trait ("Sable is warm") | ${s.why_restates_trait ?? 0} |`);
  }
  out.push(`| Limits voiced / gone past before a check-in and a yes | ${s.limits ?? 0} / ${s.limit_overridden ?? 0} |`);
  out.push(`| Lines with a possessive neither of them goes by ("his apartment", both she/her) | ${s.wrong_pronouns ?? 0} |`);
  out.push(`| Chapters stuck at a threshold (more than ${THRESHOLD_LINES} lines, no move in) | ${s.threshold_stalls ?? 0} |`);
  out.push(`| Lines with a sensory detail of the place | ${pct(s.sensory_detail_share ?? 0)} |`);
  out.push("");
  const drift = Object.values(s.drift ?? {});
  if (drift.length) {
    out.push(
      "### Drift: still themselves?",
      "",
      "| Character | Lines | Lines using their sheet | Stock phrases per 100 lines | Most used | Reusing a worn phrase | Ending on a question | Phrases leaned on |",
      "|---|---|---|---|---|---|---|---|",
    );
    for (const d of drift) {
      const top = Object.entries(d.cliches).sort((x, y) => y[1] - x[1]).slice(0, 5).map(([p, n]) => `${p} ×${n}`).join(", ");
      const phrases = (d.top_phrases ?? []).map((p) => `"${p.phrase}" ×${p.count}`).join(", ");
      out.push(`| ${d.name} | ${d.lines} | ${pct(d.sheet_detail_rate)} | ${d.cliche_rate} | ${top || "none"} | ${pct(d.worn_phrase_rate ?? 0)} | ${pct(d.question_ending_share ?? 0)} | ${phrases || "none"} |`);
    }
    out.push("");
  }
  const byChapter = new Map<number, Finding[]>();
  for (const f of r.findings) byChapter.set(f.chapter, [...(byChapter.get(f.chapter) ?? []), f]);
  for (const [c, fs] of [...byChapter.entries()].sort((x, y) => x[0] - y[0])) {
    out.push(`### Chapter ${c}`, "");
    for (const f of fs.sort((x, y) => x.from - y.from)) out.push(`- **${range(f.from, f.to)}** (${f.check.replace(/_/g, " ")}): ${f.note}`);
    out.push("");
  }
  if (judge) {
    out.push(`### The judge (${judge.model}, local)`, "");
    for (const c of judge.callouts) out.push(`- **ch ${c.chapter}, lines ${c.lines}**: ${c.note}`);
    for (const [who, d] of Object.entries(judge.drift)) out.push(`- **${who}, still in character?** ${d.score ?? "?"}/5: ${d.note}`);
    out.push("");
  }
  return out.join("\n");
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
