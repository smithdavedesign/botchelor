/**
 * Where a couple stands, as a love life reads (2026-11-16, docs/relationship-graph.md "Stages"). Pure: no database, no
 * clock, no model.
 *
 * Two readings of the same public record, kept apart on purpose:
 *  - the BASE stage (`stageOf`): the seven the show has always had, from the endings alone. Every RULE reads this one
 *    and only this one: who is suggested again, the one-partner rule, the overnight milestone, an arc's settlement and
 *    its points, backing, group dates, who texts. Nothing in this file changes any of them.
 *  - the SHOWN stage (`shownStageOf`): what pages, notices, prompts and agents are told. It adds a casual state, more
 *    steps past going steady, breaking up and getting back together, and it keeps "bad blood" for pairs with real
 *    cause. DERIVED like the base stage from what the engine decided and what publicly happened: nobody chooses, buys
 *    or votes one, and the engine, odds and points never read it.
 *
 * `RELATIONSHIP_STAGES_V2=0` makes the shown stage the base stage everywhere, without a deploy of code.
 */
import type { Ending } from "./rules";

type Env = Record<string, string | undefined>;

/** On unless it is `0`: off, every reader shows exactly the seven base stages. */
export const stagesV2On = (env: Env = process.env): boolean => env.RELATIONSHIP_STAGES_V2?.trim() !== "0";

export const BASE_STAGES = ["just_met", "sparks", "dating", "going_steady", "friends", "exes", "bad_blood"] as const;
export type BaseStage = (typeof BASE_STAGES)[number];
export const MORE_STAGES = ["didnt_click", "casual", "official", "moved_in", "engaged", "married", "broke_up", "back_together", "divorced"] as const;
/** Every stage a reader can be handed: the base seven, and the ones only the shown reading has. */
export type Stage = BaseStage | (typeof MORE_STAGES)[number];
export const STAGES: readonly Stage[] = [...BASE_STAGES, ...MORE_STAGES];
export const isStage = (s: unknown): s is Stage => typeof s === "string" && (STAGES as readonly string[]).includes(s);

export const STAGE_LABELS: Record<Stage, string> = {
  just_met: "👋 Just met",
  sparks: "✨ Sparks",
  dating: "💞 Dating",
  going_steady: "💍 Going steady",
  friends: "🤝 Friends",
  exes: "💔 Exes",
  bad_blood: "🔥 Bad blood",
  didnt_click: "🤷 Didn't click",
  // The show's PG word for it, and the only one: never anything more explicit.
  casual: "🌙 Keeping it casual",
  official: "💑 Official",
  moved_in: "🏡 Moved in together",
  engaged: "💎 Engaged",
  married: "💒 Married",
  broke_up: "💔 Broke up",
  back_together: "🔁 Back together",
  divorced: "📄 Divorced",
};

/** A stage's label without its glyph ("Keeping it casual"), and mid-sentence ("keeping it casual"). */
export const stageName = (s: Stage): string => STAGE_LABELS[s].replace(/^\S+\s/, "");
export const stageWords = (s: Stage): string => stageName(s).toLowerCase();

/** Second dates in a row that make each step (the base stage's first three are these too). */
export const STAGE_RUNS = { sparks: 1, dating: 2, going_steady: 4, official: 6, moved_in: 10 } as const;

/** One line under the label on a couple's page: what on the record made it so. */
export const STAGE_LINES: Record<Stage, string> = {
  just_met: "One date so far, and it was friendly.",
  sparks: "Their last date ended with both wanting another.",
  dating: "Two dates in a row have ended in another.",
  going_steady: `${STAGE_RUNS.going_steady} dates in a row have ended in another: they're a fixture.`,
  friends: "Their last date ended as friends.",
  exes: "They had something, and then a date ended badly.",
  bad_blood: "There is history between them, and it went badly.",
  didnt_click: "One date, and it didn't click. Nothing more to it.",
  casual: "They left an overnight date together, and they aren't going steady.",
  official: `${STAGE_RUNS.official} dates in a row have ended in another: they're official.`,
  moved_in: `${STAGE_RUNS.moved_in} dates in a row have ended in another: they've moved in together.`,
  engaged: "They got engaged at a season's finale.",
  married: "They married at a season's finale.",
  broke_up: "They were going steady, and then a date ended badly.",
  back_together: "They split, and then agreed to another date.",
  divorced: "They were married, and then a date ended badly.",
};

/** What the two of them ARE, after both names: "Nell and Sable are official." Null for a stage nobody announces that way. */
export const PAIR_PHRASES: Partial<Record<Stage, string>> = {
  sparks: "agreed to a second date",
  dating: "are together: dating",
  going_steady: "are together: going steady",
  casual: "are keeping it casual",
  official: "are official",
  moved_in: "have moved in together",
  engaged: "are engaged",
  married: "are married",
  back_together: "are back together",
  broke_up: "broke up",
  divorced: "divorced",
};

/** One character's own line about the other: "Keeping it casual with Sable". */
export const WITH_PHRASES: Partial<Record<Stage, (other: string) => string>> = {
  dating: (o) => `Dating ${o}`,
  going_steady: (o) => `Going steady with ${o}`,
  casual: (o) => `Keeping it casual with ${o}`,
  official: (o) => `Official with ${o}`,
  moved_in: (o) => `Living with ${o}`,
  engaged: (o) => `Engaged to ${o}`,
  married: (o) => `Married to ${o}`,
  back_together: (o) => `Back together with ${o}`,
  broke_up: (o) => `Broke up with ${o}`,
  divorced: (o) => `Divorced from ${o}`,
};

/** In a prompt, to the character itself, PG and nothing the record doesn't hold. */
export const STANDING_LINES: Record<Stage, string> = {
  just_met: "You met once; it was friendly, nothing more yet.",
  sparks: "Your last date ended with both of you wanting another.",
  dating: "You're dating.",
  going_steady: "You're going steady.",
  friends: "You're friends.",
  exes: "You had something once; it didn't last.",
  bad_blood: "There's bad blood between you.",
  didnt_click: "You met once; it didn't click, and that's all it was.",
  casual: "You're keeping it casual.",
  official: "You're official now.",
  moved_in: "You've moved in together.",
  engaged: "You're engaged.",
  married: "You're married.",
  broke_up: "You were going steady, and you broke up.",
  back_together: "You split up, and you're back together.",
  divorced: "You were married, and you divorced.",
};

/** A couple, as a viewer would say it: the stages a "together" line or tie stands for. */
export const TOGETHER_STAGES: readonly Stage[] = ["dating", "casual", "going_steady", "official", "moved_in", "engaged", "married", "back_together"];
/** Going steady or more: what "long-steady" and a breakup are measured from. */
export const STEADY_STAGES: readonly Stage[] = ["going_steady", "official", "moved_in", "engaged", "married"];
/** No longer a couple, having been one. */
export const APART_STAGES: readonly Stage[] = ["exes", "broke_up", "divorced"];
export const isTogether = (s: Stage | null | undefined): boolean => !!s && TOGETHER_STAGES.includes(s);

/**
 * How far along a romance a stage is, for "moved up a stage" and "strongest tie": higher is further. Friends, a date
 * that didn't click, bad blood and every way of being apart are 0: never a step up.
 */
export const STAGE_RANK: Record<Stage, number> = {
  just_met: 1,
  sparks: 2,
  back_together: 2,
  dating: 3,
  casual: 4,
  going_steady: 5,
  official: 6,
  moved_in: 7,
  engaged: 8,
  married: 9,
  friends: 0,
  exes: 0,
  bad_blood: 0,
  didnt_click: 0,
  broke_up: 0,
  divorced: 0,
};

/**
 * The base stage a shown stage stands in for, when only a stored shown value is at hand and the switch is off (a
 * character's stored memory). Where the base stage itself is stored (the graph), that is read instead.
 */
export const baseOf = (s: Stage): BaseStage =>
  s === "didnt_click"
    ? "bad_blood"
    : s === "casual"
      ? "dating"
      : s === "official" || s === "moved_in" || s === "engaged" || s === "married"
        ? "going_steady"
        : s === "broke_up" || s === "divorced"
          ? "exes"
          : s === "back_together"
            ? "sparks"
            : s;

/**
 * The base stage, from a pair's endings (oldest first). Second dates in a row climb sparks → dating → going steady; a
 * friendly ending is friends; a disaster after something real is exes, and before it bad blood.
 */
export function stageOf(endings: readonly Ending[]): BaseStage | null {
  if (!endings.length) return null;
  const last = endings[endings.length - 1];
  let streak = 0;
  for (let i = endings.length - 1; i >= 0 && endings[i] === "second_date"; i--) streak++;
  if (last === "second_date") return streak >= STAGE_RUNS.going_steady ? "going_steady" : streak >= STAGE_RUNS.dating ? "dating" : "sparks";
  if (last === "friends") return endings.length === 1 ? "just_met" : "friends";
  return endings.includes("second_date") ? "exes" : "bad_blood";
}

/** One date between the pair, as the shown stage reads it. `overnight`: an overnight date (lib/overnight.ts). */
export type StageDate = { ending: Ending; at: string; overnight?: boolean };
/**
 * What happened to the pair besides their dates, on the public record:
 *  - `engaged_at`, `married_at`: a season finale named them (lib/season-finale.ts; relationship_events kind 'engaged',
 *    'married'). Never granted by a backfill.
 *  - `feud`: their latest confrontation in the house (lib/house-conflict.ts) that /house still shows did not clear the air.
 */
export type StageMarks = { engaged_at?: string | null; married_at?: string | null; feud?: boolean };

/**
 * The shown stage after each date (oldest first in, one stage out per date), and where they stand now (marks after
 * their last date included). The rules, in the order a couple meets them:
 *  - a date ends in ANOTHER DATE: the run of them makes sparks (1), dating (2), going steady (4), official (6), moved
 *    in together (10). A pair who had split (exes, broke up, divorced) and agree to another date are "back together"
 *    for that date, and climb again from dating. With an overnight date they left together behind them since their
 *    last bad ending, and short of going steady, they are "keeping it casual".
 *  - a date ends as FRIENDS: friends (their only date: just met); still keeping it casual when they have left an
 *    overnight date together; an engaged or married couple stays so (a flat night isn't the end of one).
 *  - a date ends in DISASTER: a married couple is divorced; an engaged couple, or one that had reached going steady
 *    since their last bad ending, broke up; a pair with a second date behind them are exes; a pair already apart stay
 *    as they were. With no second date ever: bad blood when they had history (any earlier date), and "didn't click"
 *    when it was their one and only date.
 *  - `feud` turns "didn't click" into bad blood: they had it out in the house, and it didn't clear the air.
 */
export function stageSteps(dates: readonly StageDate[], marks: StageMarks = {}): { steps: Stage[]; now: Stage | null } {
  const pending = (
    [
      ["engaged", marks.engaged_at],
      ["married", marks.married_at],
    ] as const
  )
    .flatMap(([kind, at]) => (at && Number.isFinite(Date.parse(at)) ? [{ kind, at: Date.parse(at) }] : []))
    .sort((x, y) => x.at - y.at);
  let run = 0; // second dates in a row, up to this date
  let peak = 0; // the longest run since their last disaster
  let night = false; // left an overnight date together since their last disaster
  let bond: "engaged" | "married" | null = null;
  let apart: "exes" | "broke_up" | "divorced" | null = null;
  let stage: Stage | null = null;
  const steps: Stage[] = [];
  // A finale's mark holds only for a couple still together when it was given.
  const mark = (before: number) => {
    while (pending.length && pending[0].at < before) {
      const m = pending.shift()!;
      if (stage && STAGE_RANK[stage] >= STAGE_RANK.dating) {
        bond = m.kind;
        stage = m.kind;
      }
    }
  };
  dates.forEach((d, i) => {
    const at = Date.parse(d.at);
    mark(Number.isFinite(at) ? at : Infinity);
    if (d.ending === "second_date") {
      run++;
      peak = Math.max(peak, run);
      if (d.overnight) night = true;
      stage =
        bond ??
        (run >= STAGE_RUNS.moved_in
          ? "moved_in"
          : run >= STAGE_RUNS.official
            ? "official"
            : run >= STAGE_RUNS.going_steady
              ? "going_steady"
              : night
                ? "casual"
                : run >= STAGE_RUNS.dating
                  ? "dating"
                  : apart
                    ? "back_together"
                    : "sparks");
      // Back together is the one date that made it so: from here they climb like anyone.
      apart = null;
    } else if (d.ending === "friends") {
      run = 0;
      stage = bond ?? (night ? "casual" : i === 0 ? "just_met" : "friends");
    } else {
      if (bond === "married") stage = apart = "divorced";
      else if (bond === "engaged" || peak >= STAGE_RUNS.going_steady) stage = apart = "broke_up";
      else if (peak >= 1) stage = apart = "exes";
      else if (apart) stage = apart;
      else stage = i === 0 ? "didnt_click" : "bad_blood";
      run = 0;
      peak = 0;
      night = false;
      bond = null;
    }
    steps.push(stage);
  });
  mark(Infinity);
  if (stage === "didnt_click" && marks.feud) stage = "bad_blood";
  return { steps, now: stage };
}

/** Where a pair stands as it is shown: the fuller reading, or (switch off) the base stage. */
export function shownStageOf(dates: readonly StageDate[], marks: StageMarks = {}, env: Env = process.env): Stage | null {
  return stagesV2On(env) ? stageSteps(dates, marks).now : stageOf(dates.map((d) => d.ending));
}

/**
 * The stage to show from a stored pair of them: the shown one when the switch is on and it was stored, else the base.
 * `dates` (the layer's date count, where the reader has it) covers a row the backfill hasn't reached: one date that
 * ended badly reads "didn't click" from the first minute, never as a feud.
 */
export function shownStage(base: Stage | null | undefined, shown: Stage | null | undefined, env: Env = process.env, dates?: number): Stage | null {
  if (!stagesV2On(env)) return base ? baseOf(base) : null;
  if (shown && isStage(shown)) return shown;
  if (base === "bad_blood" && dates === 1) return "didnt_click";
  return base ?? null;
}

/** A step up worth telling: further along than before, and at least sparks. */
export const steppedUp = (before: Stage | null, after: Stage | null): boolean => after !== null && STAGE_RANK[after] >= 2 && STAGE_RANK[after] > (before ? STAGE_RANK[before] : 0);

/** A couple who were going steady or more has just split: the one piece of bad news a follower hears. */
export const justSplit = (before: Stage | null, after: Stage | null): boolean => (after === "broke_up" || after === "divorced") && before !== after;

/** What a notice says under a stage's label when a couple reaches it. */
export const STAGE_NEWS: Partial<Record<Stage, string>> = {
  sparks: "Their first date ended in a second date.",
  dating: "Two second dates in a row: they're dating.",
  going_steady: "They've become a fixture.",
  casual: "They left an overnight date together, and they're keeping it casual.",
  official: `${STAGE_RUNS.official} dates in a row have ended in another. They're official.`,
  moved_in: `${STAGE_RUNS.moved_in} dates in a row have ended in another. They've moved in together.`,
  engaged: "They got engaged at the season's finale.",
  married: "They married at the season's finale.",
  back_together: "They had split. Their latest date ended in another.",
  broke_up: "They were going steady. Their latest date ended badly.",
  divorced: "They were married. Their latest date ended badly.",
};
