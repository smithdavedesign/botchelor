/** Types for scripts/eval/golden.mjs, which stays plain JS so it runs with no build step. */
import type { LocalJudge } from "./local-judge.mjs";

export type Suite = "after_dark" | "dates";
export type Arm = "a" | "b";
export type Position = "A" | "B" | "tie";

export const CASES_FILE: string;
export const AD_ROUTE: string;
export const DATES_ROUTE: string;
export const AD_STEP_USD: number;
export const DATE_USD: number;
export const DEFAULT_MAX_USD: number;
export const MIN_WIN_RATE: number;
export const JUDGE_MODELS: Record<Suite, string>;

export class GoldenRefusal extends Error {}

export type MetricSpec = { key: string; label: string; better: "higher" | "lower"; gate?: number; aliases: string[] };
export const METRICS: Record<Suite, MetricSpec[]>;

export type AfterDarkConfig = { promptVersion?: string; model?: string; temperature?: number; memory?: "live" | "none" };
export type GoldenCase = { id: string; a: string; b: string; names?: string[]; why?: string; direction?: string[] };
export type Sheet = {
  name: string;
  age?: number | null;
  pronouns?: string | null;
  bio?: string | null;
  traits?: string[];
  want?: string | null;
  dealbreaker?: string | null;
  voice?: string | null;
  tells?: string[];
  lines?: string[];
  catchphrase?: string | null;
  never?: string[];
  names_only?: boolean;
};

export type GoldenOptions = {
  suite: Suite;
  label: string;
  casesFile: string;
  cases: string[] | null;
  repeat: number;
  steps: number;
  memory: "live" | "none";
  judge: boolean;
  judgeModel: string;
  judgeBase: string;
  maxUsd: number;
  stepUsd: number;
  gap: number;
  gate: boolean;
  thresholds: Record<string, number>;
  minWinRate: number;
  post: boolean;
  site: string;
  db: string | null;
  pglite: string | null;
  outDir: string;
  sharedQuota: boolean;
  dryRun: boolean;
  a?: AfterDarkConfig;
  b?: AfterDarkConfig;
  base?: string;
  baseA?: string;
  baseB?: string;
};

export type Run = {
  case: string;
  sample: number;
  arm: Arm;
  ok: boolean;
  ms: number;
  error?: string;
  request?: Record<string, unknown>;
  lines?: { who: "a" | "b"; text: string; action: string | null; why: string | null; memory: string | null; stage: number | null }[];
  transcript?: { side: "a" | "b"; act?: number; dialogue: string; action?: string; emotion?: string }[];
  characters?: string[] | null;
  ending?: string | null;
  metrics?: Record<string, number>;
  raw_metrics?: unknown;
  usage?: unknown;
  cost_usd: number | null;
};
export type Pass = { order: [Arm, Arm]; position: Position | null; winner: Arm | "tie" | null; sheet: Arm | "tie" | null; reasons: string | null; error: string | null; raw: string | null };
export type Judgment = { case: string; sample: number; first: Arm; passes: Pass[]; winner: Arm | "tie" | null; sounds_like_sheet: Arm | "tie" | null; consistent: boolean | null };
export type Tally = { n: number; wins_b: number; wins_a: number; ties: number; win_rate_b: number | null; p_value: number };
export type Summary = Tally & {
  judged: number;
  unjudged: number;
  consistent: number;
  sheet: Tally;
  position: { decided_passes: number; picked_first: number; share_first: number | null };
};
export type Delta = { key: string; label: string; better: "higher" | "lower" | null; a: number | null; b: number | null; delta: number | null; n: number; gate: number | null; regressed: boolean };
export type GateResult = { passed: boolean; reasons: string[] };
export type GoldenResult = {
  label: string;
  suite: Suite;
  ran_at: string;
  sha: string | null;
  configs: { a: Record<string, unknown>; b: Record<string, unknown> };
  options: Record<string, unknown>;
  cases: GoldenCase[];
  estimate_usd: number;
  cost_usd: { a: number; b: number; total: number; unpriced: number };
  spent_usd: number;
  budget_stopped: boolean;
  judge_stopped: string | null;
  summary: Summary;
  deltas: Delta[];
  gate: GateResult;
  gate_requested: boolean;
  runs: Run[];
  judgments: Judgment[];
  files?: string[];
  posted?: { ok: boolean; status?: number; why?: string };
};

export function canonicalMetrics(raw: unknown, suite: Suite): Record<string, number>;
export function metricDeltas(pairs: { a: { metrics?: Record<string, number> }; b: { metrics?: Record<string, number> } }[], suite: Suite, thresholds?: Record<string, number>): Delta[];
export function signTest(k: number, n: number): number;
export function parseVerdict(text: string | null | undefined): { winner: Position; sounds_like_sheet: Position | null; reasons: string } | null;
export function armOf(position: Position | null, order: [Arm, Arm]): Arm | "tie" | null;
export function combinePasses(passes: Pick<Pass, "winner" | "sheet">[]): { winner: Arm | "tie" | null; sounds_like_sheet: Arm | "tie" | null; consistent: boolean | null };
export function aggregate(judgments: Pick<Judgment, "winner" | "sounds_like_sheet" | "consistent" | "passes">[]): Summary;
export function gate(input: { summary: Partial<Summary> | null; deltas: Delta[]; runs: Pick<Run, "arm" | "ok">[] }, opts?: { minWinRate?: number; judgeRequested?: boolean }): GateResult;
export function sheetText(s: Sheet | null | undefined): string;
export function sheetFromRow(c: Record<string, unknown>): Sheet;
export function transcriptLines(run: Pick<Run, "lines" | "transcript">, names: string[]): string[];
export function judgeMessages(input: { suite: Suite; sheets: Sheet[]; context: string; first: string[]; second: string[] }): { role: "system" | "user"; content: string }[];
export function hash(s: string): number;
export function parseConfig(text: string, name?: string): AfterDarkConfig;
export function parseThresholds(text: string | undefined): { metrics: Record<string, number>; minWinRate: number };
export function parseArgs(argv: string[]): GoldenOptions;
export function loadCases(file?: string): { after_dark: GoldenCase[]; dates: GoldenCase[]; sheets: Record<string, Sheet> };
export function runGolden(
  opts: GoldenOptions,
  deps?: {
    fetchImpl?: typeof fetch;
    judge?: LocalJudge;
    sheetsFor?: (opts: GoldenOptions, cases: GoldenCase[], file: unknown, ctx: unknown) => Promise<Map<string, Sheet>>;
    env?: Record<string, string | undefined>;
    log?: (m: string) => void;
    sleep?: (ms: number) => Promise<void>;
    now?: () => Date;
    write?: boolean;
    sha?: string | null;
    password?: string;
  },
): Promise<GoldenResult & { dry_run?: boolean; calls?: number }>;
export function renderMarkdown(r: GoldenResult): string;
export function summaryForPost(r: GoldenResult): Record<string, unknown>;
export function postSummary(
  r: GoldenResult,
  opts: { site: string; env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; log?: (m: string) => void; password?: string },
): Promise<{ ok: boolean; status?: number; why?: string }>;
