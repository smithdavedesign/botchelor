/**
 * Where a pair stands, as the Constellation draws it (2026-11-20, the social network's first phase): the shown stages
 * (lib/relationship-stages.ts, docs/relationship-graph.md "Stages") folded into five groups. Each group has its own line
 * on the sky, and one chip that is both its legend entry and its filter. Pure and browser-safe: it takes nothing from
 * lib/graph.ts (tests/graph-teaser.test.ts), and lib/relationship-stages.ts imports only types.
 */
import { STAGE_LINES, stageWords, type Stage } from "@/lib/relationship-stages";

/** In the chips' order: the couples first, the faint majority last. */
export const STAGE_GROUPS = ["together", "sparks", "friends", "exes", "first"] as const;
export type StageGroup = (typeof STAGE_GROUPS)[number];

/** Every stage in exactly one group: a stage added to lib/relationship-stages.ts doesn't compile until it has one. */
const GROUP: Record<Stage, StageGroup> = {
  dating: "together",
  going_steady: "together",
  casual: "together",
  official: "together",
  moved_in: "together",
  engaged: "together",
  married: "together",
  back_together: "together",
  sparks: "sparks",
  friends: "friends",
  exes: "exes",
  broke_up: "exes",
  divorced: "exes",
  bad_blood: "exes",
  just_met: "first",
  didnt_click: "first",
};
const GROUP_OF = new Map<string, StageGroup>(Object.entries(GROUP) as [Stage, StageGroup][]);

/** A stage's group; null for none (a private pair, whose stage isn't public, or a stage this page doesn't know). */
export const stageGroup = (stage: string | null | undefined): StageGroup | null => (stage ? (GROUP_OF.get(stage) ?? null) : null);

export const GROUP_LABEL: Record<StageGroup, string> = {
  together: "Together",
  sparks: "Sparks",
  friends: "Friends",
  exes: "Exes & bad blood",
  first: "First date",
};

/**
 * What a group holds, for its chip's title: a one-stage group says what made it so (STAGE_LINES), a bigger one lists its
 * stages in their own words ("Dating, going steady, … or back together").
 */
export function groupHint(group: StageGroup): string {
  const stages = (Object.keys(GROUP) as Stage[]).filter((s) => GROUP[s] === group);
  if (stages.length === 1) return STAGE_LINES[stages[0]];
  const words = stages.map(stageWords);
  const list = `${words.slice(0, -1).join(", ")} or ${words.at(-1)}`;
  return group === "first" ? `One date so far: ${list}` : `${list[0].toUpperCase()}${list.slice(1)}`;
}

/**
 * How a group's line is drawn: its colour token (app/globals.css, the sky's line colours) and a dash pattern in
 * multiples of the line's width ([] is solid; 0 is a dot, drawn with round caps), so no group is told by colour alone:
 * together solid, sparks dashed, friends dotted, exes and bad blood dash-dot. First dates are most of the sky (a pair's
 * one date so far), so they're drawn thin and faint, and every other line stands out against them.
 */
export type LineStyle = { token: string; dash: readonly number[]; faint: boolean };
export const LINE_STYLE: Record<StageGroup, LineStyle> = {
  together: { token: "--constellation-together", dash: [], faint: false },
  sparks: { token: "--constellation-sparks", dash: [2.4, 2.6], faint: false },
  friends: { token: "--constellation-friends", dash: [0, 2.6], faint: false },
  exes: { token: "--constellation-exes", dash: [3, 2.4, 0, 2.4], faint: false },
  first: { token: "--constellation-first", dash: [], faint: true },
};

/** A null choice is every group: the default, which needs no parameter. */
export type StageChoice = ReadonlySet<StageGroup> | null;

const isGroup = (s: string): s is StageGroup => (STAGE_GROUPS as readonly string[]).includes(s);

/** ?stage=together,sparks: those groups. Null (every group) for none, all of them, or only words it doesn't know. */
export function parseStages(v: string | string[] | null | undefined): StageChoice {
  const raw = Array.isArray(v) ? v.join(",") : (v ?? "");
  const picked = new Set(raw.split(",").map((s) => s.trim().toLowerCase()).filter(isGroup));
  return picked.size === 0 || picked.size === STAGE_GROUPS.length ? null : picked;
}

/** The ?stage= value for a choice, in the chips' order; null when it's every group, or none (nothing worth sharing). */
export function stagesParam(stages: StageChoice): string | null {
  if (!stages || stages.size === 0 || stages.size >= STAGE_GROUPS.length) return null;
  return STAGE_GROUPS.filter((g) => stages.has(g)).join(",");
}

/** A chip pressed: its group off if it was on, on if it was off. Every group on again is the default, null. */
export function toggleStage(stages: StageChoice, group: StageGroup): StageChoice {
  const next = new Set<StageGroup>(stages ?? STAGE_GROUPS);
  if (next.has(group)) next.delete(group);
  else next.add(group);
  return next.size === STAGE_GROUPS.length ? null : next;
}

/** Whether a group's lines are drawn under a choice. */
export const stageOn = (stages: StageChoice, group: StageGroup): boolean => !stages || stages.has(group);
