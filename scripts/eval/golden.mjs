#!/usr/bin/env node
/**
 * The golden set and its side-by-side judge (David, 2026-10-21: "self-improvement that actually moves"). The simulated
 * visitors rate the product 8 to 8.5 whatever changes, so this compares two configs on a fixed set instead. Every case in
 * scripts/eval/golden-cases.json runs on config A and on config B, and a LOCAL model (scripts/eval/local-judge.mjs: the
 * ai-stack's LiteLLM, never a paid or cloud model) reads the two transcripts side by side and says which is better, twice,
 * with the order swapped, because a judge favours whichever version it reads first. Out come B's win rate against A with a
 * sign test, the deterministic metrics' deltas, and a gate for prompt and model changes.
 *
 * After Dark: two configs of the After Dark writer on one deployment (POST /api/jobs/eval-after-dark, which builds the
 * scene in memory and stores nothing):
 *   export CRON_SECRET="$(security find-generic-password -s vault/botchelor/CRON_SECRET -w)"
 *   node scripts/eval/golden.mjs --suite after-dark --label ad-v1-v2 \
 *     --a '{"promptVersion":"v1"}' --b '{"promptVersion":"v2"}' [--base https://botchelor.com] [--steps 4] [--repeat 2]
 *   A config is {promptVersion, model?, temperature?, memory?} as JSON, or promptVersion=v2,temperature=0.8.
 *
 * Dates: two deployments, e.g. production and a preview (POST /api/jobs/eval on each, built in memory too):
 *   node scripts/eval/golden.mjs --suite dates --label prod-vs-pr580 \
 *     --base-a https://botchelor.com --base-b https://botchelor-git-<branch>-<team>.vercel.app [--repeat 2] [--shared-quota yes]
 *   CRON_SECRET_A / CRON_SECRET_B override CRON_SECRET per deployment; VERCEL_BYPASS_B (or _A) passes a preview's
 *   protection bypass.
 *
 * Options:
 *   --cases id,id          a subset of the suite's cases (default: all)
 *   --repeat N             samples per case, 1 to 5 (default 1)
 *   --steps N              After Dark scene steps per sample, 1 to 8 (default 4); direction[i] steers step i+1
 *   --memory live|none     After Dark memory for both configs unless a config sets its own (default live)
 *   --judge-model alias    a LOCAL LiteLLM alias (default local-uncensored for After Dark, local-qwen3 for dates)
 *   --judge-base url       LiteLLM's OpenAI-compatible base (default http://127.0.0.1:4000/v1); key from
 *                          $LITELLM_MASTER_KEY or the keychain's litellm-master-key, never printed
 *   --no-judge             metrics only
 *   --max-usd N            stop before the routes' spend would pass this (default 2); the estimate is printed first
 *   --step-usd N           After Dark's estimate per scene step (default 0.003)
 *   --gap seconds          pause between route calls (default 2 for After Dark, 20 for dates: the free tier's minute quota)
 *   --gate                 exit 1 when B loses (win rate under 0.45) or a deterministic metric regresses past its tolerance
 *   --thresholds k=v,…     override a tolerance (repeats=1, sheet_detail_rate=0.1, win=0.5, …)
 *   --post [--site url]    post the summary to /api/admin/quality (default https://botchelor.com; FRONTIER_PASSWORD from
 *                          the environment or the keychain's vault/botchelor/FRONTIER_PASSWORD, never printed)
 *   --db url | --pglite dir  read the After Dark characters' sheets for the judge (read-only; default $DATABASE_URL)
 *   --out-dir dir          where the report goes (default docs/eval): golden-<label>.json and golden-<label>.md
 *   --dry-run              print the plan and the estimate, call nothing
 *
 * Exit codes: 0 done (and the gate passed, if asked), 1 the gate failed or the run broke, 2 refused before spending
 * anything (no secret, an unsafe judge, a missing route, the estimate over --max-usd), 3 stopped early at --max-usd.
 * Secrets come from the environment and are never printed.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createLocalJudge, litellmKey, LocalJudgeError } from "./local-judge.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CASES_FILE = join(ROOT, "scripts", "eval", "golden-cases.json");
export const AD_ROUTE = "/api/jobs/eval-after-dark";
export const DATES_ROUTE = "/api/jobs/eval";
/** A scene step on the After Dark route's model is about $0.001 (docs/after-dark-costs.md): budgeted at three times that. */
export const AD_STEP_USD = 0.003;
/** A date on the paid default model is about 1.3¢ (docs/upgrade-cost.md): budgeted at 2¢. */
export const DATE_USD = 0.02;
export const DEFAULT_MAX_USD = 2;
/** Under this, B loses. */
export const MIN_WIN_RATE = 0.45;
export const JUDGE_MODELS = { after_dark: "local-uncensored", dates: "local-qwen3" };
/** Lines of each version the judge reads, and how long a line can be. */
const JUDGE_LINES = 60;
const JUDGE_LINE_CHARS = 320;

/** A refusal before anything is spent (exit 2). */
export class GoldenRefusal extends Error {
  constructor(message) {
    super(message);
    this.name = "GoldenRefusal";
  }
}

/* ------------------------------------------- the metrics and their gate ------------------------------------------- */

/**
 * The deterministic metrics compared per suite, the direction that's better, and the gate's tolerance: a mean per run
 * that moves the wrong way by more than this fails --gate. After Dark's come from the route's `metrics`
 * (lib/adult/quality.ts sceneQuality: sheet_detail_rate is a share of lines, 0 to 1; cliche_rate is stock phrases per 100
 * lines; repeats, invented_names and unfounded_citations are counts a run), matched by name whatever its casing
 * (sheetDetailRate, sheet_detail_rate); the dates' are lib/quality.ts's.
 */
export const METRICS = {
  after_dark: [
    { key: "sheet_detail_rate", label: "Sheet detail rate", better: "higher", gate: 0.05, aliases: ["sheetDetailRate", "sheetDetail"] },
    // Per 100 lines (2026-10-21's review: the five most-used stock words alone came to about 7 per 100 production lines):
    // 2 more is about one extra stock phrase every two 4-step runs of 24 lines, as a mean over every sample.
    { key: "cliche_rate", label: "Cliché rate (per 100 lines)", better: "lower", gate: 2, aliases: ["clicheRate", "clichéRate"] },
    { key: "repeats", label: "Repeated lines", better: "lower", gate: 0.5, aliases: ["repeatCount", "repeated", "repeatedLines", "repeatLines"] },
    { key: "invented_names", label: "Invented names", better: "lower", gate: 0.25, aliases: ["inventedNames", "namesInvented"] },
    { key: "unfounded", label: "Unfounded memory citations", better: "lower", gate: 0.25, aliases: ["unfoundedCitations", "unfoundedMemories", "unfoundedMemory"] },
    { key: "unprovoked_moves", label: "Unprovoked moves", better: "lower", aliases: ["unprovokedMoves"] },
    { key: "alternation_violations", label: "Alternation violations", better: "lower", aliases: ["alternationViolations", "alternation"] },
    { key: "memory_citation_share", label: "Lines citing a memory", better: "higher", aliases: ["memoryCitationShare", "memoryShare", "shareMemory"] },
    { key: "refusals", label: "Refusals", better: "lower", aliases: [] },
    { key: "dropped", label: "Lines dropped", better: "lower", aliases: [] },
    // Prompt v2.1's craft metrics (lib/adult/quality.ts), shown with their direction, not gated (yet).
    { key: "worn_phrase_rate", label: "Lines reusing a worn phrase", better: "lower", aliases: ["wornPhraseRate"] },
    { key: "question_ending_share", label: "Lines ending on a question", better: "lower", aliases: ["questionEndingShare"] },
    { key: "sensory_detail_share", label: "Lines with a sensory detail", better: "higher", aliases: ["sensoryDetailShare"] },
    { key: "limit_overridden", label: "Limits gone past", better: "lower", aliases: ["limitOverridden", "limitsOverridden"] },
    { key: "wrong_pronouns", label: "Possessives neither goes by", better: "lower", aliases: ["wrongPronouns"] },
    { key: "why_restates_trait", label: "Whys only restating a trait", better: "lower", aliases: ["whyRestatesTrait"] },
    { key: "generic_whys", label: "Generic whys", better: "lower", aliases: ["genericWhys"] },
  ],
  dates: [
    { key: "index", label: "Genuineness index (0-100)", better: "higher", gate: 5, aliases: [] },
    { key: "near_duplicates", label: "Near-duplicate lines", better: "lower", gate: 0.5, aliases: [] },
    { key: "voice_breaks", label: "Voice breaks", better: "lower", gate: 0.5, aliases: [] },
    { key: "profile_reading", label: "Profile reading", better: "lower", gate: 0.5, aliases: [] },
    { key: "misgendered", label: "Misgendering", better: "lower", gate: 0.25, aliases: [] },
    { key: "abrupt_flips", label: "Abrupt flips", better: "lower", aliases: [] },
    { key: "repeated_openers", label: "Repeated openers", better: "lower", aliases: [] },
    { key: "mirrored", label: "Mirrored lines", better: "lower", aliases: [] },
    { key: "catchphrases", label: "Catchphrase reuse", better: "lower", aliases: [] },
    { key: "responsiveness", label: "Responsiveness", better: "higher", aliases: [] },
    { key: "distinctness", label: "Distinct vocabulary", better: "higher", aliases: [] },
  ],
};

const squash = (k) => String(k).toLowerCase().replace(/[^a-z0-9]/g, "");
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const round = (x, d = 3) => (x === null || x === undefined ? null : Math.round(x * 10 ** d) / 10 ** d);
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/** A metric's number from whatever shape it came in: a number, a list (its length), or an object's count/total/rate or summed leaves. */
function metricValue(v) {
  if (num(v) !== null) return v;
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === "object") {
    for (const k of ["count", "total", "n", "rate", "share", "value"]) if (num(v[k]) !== null) return v[k];
    const leaves = Object.values(v).filter((x) => num(x) !== null);
    return leaves.length ? leaves.reduce((s, x) => s + x, 0) : null;
  }
  return null;
}

/**
 * The suite's metrics under their canonical keys, from a route's metrics object; any other numeric metric is kept under
 * its own name (shown, never gated).
 */
export function canonicalMetrics(raw, suite) {
  const src = raw && typeof raw === "object" ? raw : {};
  const out = {};
  const used = new Set();
  for (const spec of METRICS[suite] ?? []) {
    const names = new Set([spec.key, ...spec.aliases].map(squash));
    const hit = Object.keys(src).find((k) => names.has(squash(k)) && metricValue(src[k]) !== null);
    if (hit !== undefined) {
      out[spec.key] = metricValue(src[hit]);
      used.add(hit);
    }
  }
  for (const [k, v] of Object.entries(src)) if (!used.has(k) && num(v) !== null && !(k in out)) out[k] = v;
  return out;
}

/**
 * Mean per run of every metric, A against B, over the samples where both ran; `regressed` when a gated metric moved the
 * wrong way by more than its tolerance (`thresholds` overrides one: { repeats: 1 }).
 */
export function metricDeltas(pairs, suite, thresholds = {}) {
  const specs = METRICS[suite] ?? [];
  const keys = new Set();
  for (const p of pairs) for (const k of Object.keys(p.a.metrics ?? {})) if (k in (p.b.metrics ?? {})) keys.add(k);
  const ordered = [...specs.map((s) => s.key).filter((k) => keys.has(k)), ...[...keys].filter((k) => !specs.some((s) => s.key === k)).sort()];
  return ordered.map((key) => {
    const spec = specs.find((s) => s.key === key) ?? { key, label: key.replace(/_/g, " "), better: null };
    const both = pairs.filter((p) => num(p.a.metrics?.[key]) !== null && num(p.b.metrics?.[key]) !== null);
    const a = mean(both.map((p) => p.a.metrics[key]));
    const b = mean(both.map((p) => p.b.metrics[key]));
    const delta = a === null || b === null ? null : b - a;
    const gate = num(thresholds[key]) ?? spec.gate ?? null;
    const worse = delta === null || !spec.better ? 0 : spec.better === "lower" ? delta : -delta;
    return { key, label: spec.label, better: spec.better, a: round(a), b: round(b), delta: round(delta), n: both.length, gate, regressed: gate !== null && worse > gate + 1e-9 };
  });
}

/* --------------------------------------------- the judge's verdicts --------------------------------------------- */

/**
 * The exact two-sided sign test: with `k` of `n` decided samples won by B, the chance of a split at least that lopsided
 * if A and B were really as good as each other (ties left out). 1 when nothing was decided.
 */
export function signTest(k, n) {
  if (!n) return 1;
  const logFact = (m) => {
    let s = 0;
    for (let i = 2; i <= m; i++) s += Math.log(i);
    return s;
  };
  const pmf = (i) => Math.exp(logFact(n) - logFact(i) - logFact(n - i) - n * Math.LN2);
  let low = 0;
  let high = 0;
  for (let i = 0; i <= n; i++) {
    if (i <= k) low += pmf(i);
    if (i >= k) high += pmf(i);
  }
  return Math.min(1, 2 * Math.min(low, high));
}

/** "A", "B" or "tie" from however a small model wrote it ("Version B", "b.", "Tie"), else null. */
function pickPosition(v) {
  const s = String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/^(?:version|scene|transcript)\s+/, "")
    .replace(/[^a-z]/g, "");
  if (s === "a" || s === "first" || s === "versiona") return "A";
  if (s === "b" || s === "second" || s === "versionb") return "B";
  if (/^(tie|equal|neither|both|draw|same|even)/.test(s)) return "tie";
  return null;
}

/** The judge's answer as { winner, sounds_like_sheet, reasons }, positions as shown ("A" = first); null when unreadable. */
export function parseVerdict(text) {
  const cleaned = String(text ?? "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:json)?/gi, "");
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let obj = null;
  try {
    obj = JSON.parse(m[0]);
  } catch {
    try {
      obj = JSON.parse(m[0].replace(/'/g, '"'));
    } catch {
      return null;
    }
  }
  const winner = pickPosition(obj?.winner);
  if (!winner) return null;
  return {
    winner,
    sounds_like_sheet: pickPosition(obj.sounds_like_sheet ?? obj.soundsLikeSheet ?? obj.sheet),
    reasons: String(obj.reasons ?? obj.reason ?? "").slice(0, 600),
  };
}

/** A position as shown ("A" first, "B" second) back to the config it was: order is [first arm, second arm]. */
export const armOf = (position, order) => (position === "A" ? order[0] : position === "B" ? order[1] : position === "tie" ? "tie" : null);

/**
 * One sample's verdict from its two passes (the same pair, the order swapped). Each pass scores B +1, A -1, tie 0, and
 * the sum decides: both for B, or B and a tie, is B; a split (each pass picked whichever it read first) is a tie, the
 * position bias cancelled out. Null until both passes have a verdict.
 */
export function combinePasses(passes) {
  const ok = passes.filter((p) => p.winner);
  if (ok.length < 2) return { winner: null, sounds_like_sheet: null, consistent: null };
  const score = (w) => (w === "b" ? 1 : w === "a" ? -1 : 0);
  const decide = (s) => (s > 0 ? "b" : s < 0 ? "a" : "tie");
  const sheets = ok.filter((p) => p.sheet);
  return {
    winner: decide(score(ok[0].winner) + score(ok[1].winner)),
    sounds_like_sheet: sheets.length === 2 ? decide(score(sheets[0].sheet) + score(sheets[1].sheet)) : null,
    consistent: ok[0].winner === ok[1].winner,
  };
}

/**
 * B against A over the judged samples: wins, losses and ties, B's win rate (a tie counts half), the sign test on the
 * decided ones, the same for "sounds like the sheet", and how often a pass picked whichever version it read first.
 */
export function aggregate(judgments) {
  const judged = judgments.filter((j) => j.winner);
  const tally = (key) => {
    const rows = judgments.filter((j) => j[key]);
    const b = rows.filter((j) => j[key] === "b").length;
    const a = rows.filter((j) => j[key] === "a").length;
    const ties = rows.length - a - b;
    return { n: rows.length, wins_b: b, wins_a: a, ties, win_rate_b: rows.length ? round((b + ties / 2) / rows.length) : null, p_value: round(signTest(b, a + b), 4) };
  };
  const passes = judgments.flatMap((j) => j.passes ?? []).filter((p) => p.position === "A" || p.position === "B");
  const first = passes.filter((p) => p.position === "A").length;
  return {
    ...tally("winner"),
    judged: judged.length,
    unjudged: judgments.length - judged.length,
    consistent: judged.filter((j) => j.consistent).length,
    sheet: tally("sounds_like_sheet"),
    position: { decided_passes: passes.length, picked_first: first, share_first: passes.length ? round(first / passes.length) : null },
  };
}

/**
 * The regression gate: B loses (win rate under the minimum), a gated metric regressed past its tolerance, B failed more
 * runs than A, or nothing ran. `judgeRequested` false (--no-judge) leaves the win rate out.
 */
export function gate({ summary, deltas, runs }, { minWinRate = MIN_WIN_RATE, judgeRequested = true } = {}) {
  const reasons = [];
  const fmt = (x) => (x === null || x === undefined ? "—" : String(round(x)));
  if (judgeRequested) {
    if (!summary?.judged) reasons.push("no sample was judged both ways round, so it can't tell whether B loses");
    else if (summary.win_rate_b < minWinRate) reasons.push(`B loses: its win rate is ${fmt(summary.win_rate_b)}, under ${minWinRate} (B ${summary.wins_b}, A ${summary.wins_a}, ties ${summary.ties})`);
  }
  for (const d of deltas ?? []) {
    if (d.regressed) reasons.push(`${d.label} regressed: ${fmt(d.a)} → ${fmt(d.b)} a run (${d.better === "lower" ? "up" : "down"} ${fmt(Math.abs(d.delta))}, tolerance ${d.gate})`);
  }
  const failed = (arm) => (runs ?? []).filter((r) => r.arm === arm && !r.ok).length;
  if (failed("b") > failed("a")) reasons.push(`B failed ${failed("b")} run${failed("b") === 1 ? "" : "s"} to A's ${failed("a")}`);
  if (!(runs ?? []).some((r) => r.ok)) reasons.push("no run succeeded");
  return { passed: reasons.length === 0, reasons };
}

/* ---------------------------------------------------- the judge ---------------------------------------------------- */

/** A character sheet as the judge reads it. */
export function sheetText(s) {
  if (!s) return "";
  const parts = [`${s.name}${s.age ? `, ${s.age}` : ""}${s.pronouns ? ` (${s.pronouns})` : ""}.`];
  if (s.names_only) parts.push("(No sheet: judge their voice from the scene alone.)");
  if (s.bio) parts.push(s.bio);
  if (s.traits?.length) parts.push(`Traits: ${s.traits.join(", ")}.`);
  if (s.want) parts.push(`Wants: ${s.want}`);
  if (s.dealbreaker) parts.push(`Dealbreaker: ${s.dealbreaker}`);
  if (s.voice) parts.push(`Voice: ${s.voice}`);
  if (s.tells?.length) parts.push(`Tells: ${s.tells.join("; ")}`);
  if (s.lines?.length) parts.push(`Sounds like: ${s.lines.slice(0, 4).map((q) => `"${q}"`).join(" / ")}`);
  if (s.catchphrase) parts.push(`Catchphrase: ${s.catchphrase}`);
  if (s.never?.length) parts.push(`Would never say: ${s.never.slice(0, 4).join("; ")}`);
  return parts.join("\n");
}

/** A database row or a code-defined sheet as the judge's sheet: the public sheet and voice kit, never a soul. */
export function sheetFromRow(c) {
  const parse = (v, fallback) => {
    if (typeof v !== "string") return v ?? fallback;
    try {
      return JSON.parse(v);
    } catch {
      return fallback;
    }
  };
  const extras = parse(c.extras, {}) ?? {};
  const traits = parse(c.traits, []);
  return {
    name: c.name,
    age: c.age ?? null,
    pronouns: c.pronouns ?? null,
    bio: c.bio ?? null,
    traits: Array.isArray(traits) ? traits : [],
    want: c.want ?? null,
    dealbreaker: c.dealbreaker ?? null,
    voice: c.voice ?? null,
    tells: Object.entries(extras.tells ?? {}).map(([when, does]) => `when ${when}: ${does}`),
    lines: Object.values(extras.lines ?? {}).filter((x) => typeof x === "string"),
    catchphrase: extras.catchphrase ?? null,
    never: Array.isArray(extras.never_says) ? extras.never_says : [],
  };
}

const clip = (s) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > JUDGE_LINE_CHARS ? `${t.slice(0, JUDGE_LINE_CHARS - 1)}…` : t;
};

/** A run's lines as "Name: *action* words", for the judge. */
export function transcriptLines(run, names) {
  if (Array.isArray(run.lines)) {
    return run.lines.slice(0, JUDGE_LINES).map((l) => {
      const text = String(l.text ?? "");
      const action = l.action && !text.trim().startsWith("*") ? `*${l.action}* ` : "";
      return `${names[l.who === "b" ? 1 : 0]}: ${clip(action + text)}`;
    });
  }
  return (run.transcript ?? []).slice(0, JUDGE_LINES).map((t) => `${names[t.side === "b" ? 1 : 0]}: ${clip(`${t.action ? `*${t.action}* ` : ""}${t.dialogue ?? ""}`)}`);
}

/** The judge's prompt for one pass: the two sheets, what the scene is, version A (shown first) and version B. */
export function judgeMessages({ suite, sheets, context, first, second }) {
  const system =
    suite === "after_dark"
      ? "You judge writing. Two versions of the same private scene between two fictional adult characters, from a dating show's after-hours tier, " +
        "were written by two versions of one writing system. Explicit content between the consenting adults is allowed and is not what you judge: " +
        "judge craft and character. Be decisive, and answer tie only when they're genuinely as good as each other."
      : "You judge writing. Two versions of the same date between two fictional characters on a dating show were written by two versions of one " +
        "writing system. Judge craft and character. Be decisive, and answer tie only when they're genuinely as good as each other.";
  const user = [
    "The two characters' show sheets:",
    "",
    sheetText(sheets[0]),
    "",
    sheetText(sheets[1]),
    "",
    context,
    "",
    "Version A:",
    ...first.map((l, i) => `${i + 1}. ${l}`),
    "",
    "Version B:",
    ...second.map((l, i) => `${i + 1}. ${l}`),
    "",
    "Which version is better? Weigh three things:",
    "1. Which stays truer to each character's sheet and voice: their traits, tells, way of talking and what they want.",
    "2. Which is more specific and less generic: details from their sheets and from the moment, not stock lines anyone could say.",
    "3. Which is the better scene: each line answers the one before it, it goes somewhere, nothing repeats.",
    'Reply with JSON only: {"winner": "A" | "B" | "tie", "sounds_like_sheet": "A" | "B" | "tie", "reasons": "two or three sentences naming specific lines"}',
    '"sounds_like_sheet" is point 1 alone: in which version do the characters sound more like their sheets?',
  ].join("\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** FNV-1a: a stable hash, so the order the judge sees a pair in is random but the same on a rerun of the same label. */
export function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The context line the judge reads: the scene's steers (After Dark) or the date's format, place and decided ending. */
function judgeContext(suite, kase, runA, runB, steps) {
  if (suite === "after_dark") {
    const steers = (kase.direction ?? []).slice(0, steps);
    return steers.length
      ? `Both versions were steered the same way, step by step:\n${steers.map((d, i) => `${i + 1}. ${d}`).join("\n")}`
      : "Both versions were left to run on their own, unsteered.";
  }
  const ending = runA.ending && runB.ending && runA.ending !== runB.ending ? `${runA.ending} (A) / ${runB.ending} (B)` : (runA.ending ?? runB.ending ?? "unknown");
  const setting = String(runA.setting ?? "").trim().replace(/[.!]+$/, "");
  return `The date: ${runA.format ?? "classic"} format${setting ? `, ${setting}` : ""}. The show decided how it ends, the same for both versions: ${ending}. Don't judge the ending itself, only how well each version gets there.`;
}

/** Judges one sample: two passes, the order swapped, each retried once if its answer can't be read. */
async function judgeSample({ judge, suite, kase, sample, runs, names, sheets, steps, seed }) {
  const firstArm = hash(`${seed}:${kase.id}:${sample}`) % 2 ? "b" : "a";
  const other = firstArm === "a" ? "b" : "a";
  const context = judgeContext(suite, kase, runs.a, runs.b, steps);
  const passes = [];
  for (const order of [
    [firstArm, other],
    [other, firstArm],
  ]) {
    const messages = judgeMessages({ suite, sheets, context, first: transcriptLines(runs[order[0]], names), second: transcriptLines(runs[order[1]], names) });
    let verdict = null;
    let raw = null;
    let error = null;
    for (let attempt = 0; attempt < 2 && !verdict; attempt++) {
      try {
        raw = await judge.complete(attempt ? [...messages, { role: "user", content: "Reply with the JSON object only, nothing else." }] : messages, { temperature: attempt ? 0 : 0.2 });
        verdict = parseVerdict(raw);
        if (!verdict) error = "unreadable answer";
      } catch (e) {
        if (e instanceof LocalJudgeError && e.fatal) throw e;
        error = e instanceof Error ? e.message : String(e);
      }
    }
    passes.push({
      order,
      position: verdict?.winner ?? null,
      winner: verdict ? armOf(verdict.winner, order) : null,
      sheet: verdict?.sounds_like_sheet ? armOf(verdict.sounds_like_sheet, order) : null,
      reasons: verdict?.reasons ?? null,
      error: verdict ? null : error,
      raw: raw === null ? null : String(raw).slice(0, 2000),
    });
  }
  return { case: kase.id, sample, first: firstArm, passes, ...combinePasses(passes) };
}

/* --------------------------------------------------- the routes --------------------------------------------------- */

const isJson = (res) => /json/i.test(res.headers.get("content-type") ?? "");

/** The After Dark route is on the deployment and the secret works: GET answers 405 (POST only) or 200. */
async function preflightAfterDark(base, secret, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(`${base}${AD_ROUTE}`, { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    throw new GoldenRefusal(`couldn't reach ${base}: ${e instanceof Error ? e.message : e}`);
  }
  if (res.ok || res.status === 405) return;
  if (res.status === 404 && !isJson(res)) throw new GoldenRefusal(routeMissing(base));
  if (res.status === 404 || res.status === 401 || res.status === 403) {
    throw new GoldenRefusal(`${base}${AD_ROUTE} said ${res.status}: CRON_SECRET doesn't match that deployment's (or the route isn't there yet)`);
  }
  throw new GoldenRefusal(`${base}${AD_ROUTE} answered HTTP ${res.status}`);
}

const routeMissing = (base) =>
  `the After Dark eval route (POST ${AD_ROUTE}) isn't on ${base} yet: it arrives with the ad-voice-memory PR. ` + "Deploy that first, or point --base at a preview that has it.";

/** The date eval route on one deployment: reachable, the secret works, the cases exist, and its quota is the eval's own. */
async function preflightDates(base, secret, opts, cases, fetchImpl, headers = {}) {
  let res;
  try {
    res = await fetchImpl(`${base}${DATES_ROUTE}`, { headers: { authorization: `Bearer ${secret}`, ...headers }, signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    throw new GoldenRefusal(`couldn't reach ${base}: ${e instanceof Error ? e.message : e}`);
  }
  if (!res.ok) throw new GoldenRefusal(`${base}${DATES_ROUTE} said ${res.status}: check that deployment's CRON_SECRET (CRON_SECRET_A / CRON_SECRET_B) and its protection bypass`);
  const info = await res.json().catch(() => ({}));
  const known = new Set(info.cases ?? []);
  const unknown = cases.filter((c) => known.size && !known.has(c.id)).map((c) => c.id);
  if (unknown.length) throw new GoldenRefusal(`${base} doesn't know the case${unknown.length === 1 ? "" : "s"} ${unknown.join(", ")}`);
  // An eval on production's key spends the live show's free daily quota: on 2026-10-15 back-to-back runs spent it and live
  // dates failed until the reset (docs/date-quality.md). The same rule as scripts/eval-dates.mjs.
  if (info.quota !== "eval" && !opts.sharedQuota) {
    throw new GoldenRefusal(
      `${base} has no EVAL_GOOGLE_API_KEY, so these dates would spend the live show's free daily quota. ` + "Set EVAL_GOOGLE_API_KEY on that deployment, or pass --shared-quota yes to accept that.",
    );
  }
}

/** POSTs one request, retrying once after `waitMs` on a network error or a 5xx. */
async function postJson(fetchImpl, url, body, headers, sleep, waitMs) {
  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(300_000) });
    } catch (e) {
      if (attempt === 0) {
        await sleep(waitMs);
        continue;
      }
      throw new Error(`no answer from ${url}: ${e instanceof Error ? e.message : e}`);
    }
    if (res.status >= 500 && attempt === 0) {
      await sleep(waitMs);
      continue;
    }
    return res;
  }
}

/** One After Dark sample on one config: the route's lines, metrics, drops, refusals and cost. */
async function callAfterDark({ base, secret, kase, config, opts, fetchImpl, sleep }) {
  const body = {
    a: kase.a,
    b: kase.b,
    promptVersion: config.promptVersion ?? "v1",
    ...(config.model ? { model: config.model } : {}),
    ...(num(config.temperature) !== null ? { temperature: config.temperature } : {}),
    steps: opts.steps,
    memory: config.memory ?? opts.memory ?? "live",
    ...(kase.direction?.length ? { direction: kase.direction.slice(0, opts.steps) } : {}),
  };
  const res = await postJson(fetchImpl, `${base}${AD_ROUTE}`, body, { authorization: `Bearer ${secret}` }, sleep, 30_000);
  if (res.status === 404 && !isJson(res)) throw new GoldenRefusal(routeMissing(base));
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const out = await res.json();
  const lines = (Array.isArray(out?.lines) ? out.lines : []).map((l) => ({
    who: l?.who === "b" ? "b" : "a",
    text: String(l?.text ?? ""),
    action: l?.action ?? null,
    why: l?.why ?? null,
    memory: l?.memory ?? null,
    stage: num(l?.stage),
  }));
  if (!lines.length) throw new Error("the route wrote no lines");
  const rawMetrics = out?.metrics && typeof out.metrics === "object" ? out.metrics : {};
  const extra = {};
  if (!("refusals" in rawMetrics) && out?.refusals !== undefined) extra.refusals = out.refusals;
  if (!("dropped" in rawMetrics) && out?.dropped !== undefined) extra.dropped = out.dropped;
  return {
    request: body,
    lines,
    metrics: canonicalMetrics({ ...rawMetrics, ...extra }, "after_dark"),
    raw_metrics: rawMetrics,
    dropped: out?.dropped ?? null,
    refusals: out?.refusals ?? null,
    usage: out?.usage ?? null,
    cost_usd: num(out?.usage?.cost_usd),
  };
}

/** One date on one deployment: its transcript, ending, metrics and cost (the route's paid-tier figure). */
async function callDate({ base, secret, kase, fetchImpl, sleep, headers = {} }) {
  const res = await postJson(fetchImpl, `${base}${DATES_ROUTE}`, { case: kase.id }, { authorization: `Bearer ${secret}`, ...headers }, sleep, 60_000);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const out = await res.json();
  const transcript = Array.isArray(out?.transcript) ? out.transcript : [];
  if (!transcript.length) throw new Error(`no conversation${out?.conversation_error ? `: ${out.conversation_error}` : ""}`);
  return {
    transcript,
    characters: Array.isArray(out?.characters) ? out.characters : null,
    ending: out?.ending ?? null,
    format: out?.format ?? null,
    setting: out?.recap?.setting ?? null,
    metrics: canonicalMetrics(out?.metrics ?? {}, "dates"),
    raw_metrics: out?.metrics ?? null,
    usage: out?.usage ?? null,
    cost_usd: num(out?.usage?.cost_usd),
    conversation_error: out?.conversation_error ?? null,
  };
}

/* --------------------------------------------------- the sheets --------------------------------------------------- */

const viteOpts = () => ({ configFile: false, root: ROOT, logLevel: "error", resolve: { alias: [{ find: /^@\//, replacement: `${ROOT}/` }] } });

/** House and eval characters' sheets and voice kits, from lib/eval.ts and lib/house-kits.ts. */
async function libSheets(ids) {
  const { runnerImport } = await import("vite");
  const { module: evalLib } = await runnerImport(join(ROOT, "lib/eval.ts"), viteOpts());
  const { module: kits } = await runnerImport(join(ROOT, "lib/house-kits.ts"), viteOpts());
  const out = new Map();
  for (const id of ids) {
    try {
      const c = evalLib.evalCharacter(id);
      out.set(id, sheetFromRow({ ...c.forDate.sheet, extras: kits.HOUSE_KITS?.[id] ?? {} }));
    } catch {
      /* not a house or eval character */
    }
  }
  return out;
}

/** Production characters' public sheets, read-only (the observer's connection: default_transaction_read_only). */
async function dbSheets(ids, opts) {
  const { openDb } = await import("./after-dark-observer.mjs");
  const db = await openDb({ db: opts.db, pglite: opts.pglite });
  try {
    const rows = await db.query(`select id, name, age, pronouns, bio, traits, want, dealbreaker, voice, extras from characters where id = any($1)`, [ids]);
    return new Map(rows.map((r) => [r.id, sheetFromRow(r)]));
  } finally {
    await db.close();
  }
}

/** Every case character's sheet: golden-cases.json's own, else lib/eval.ts's, else the database's, else the name alone. */
async function loadSheets(opts, cases, file, { log, env }) {
  const ids = [...new Set(cases.flatMap((c) => [c.a, c.b]))];
  const sheets = new Map(Object.entries(file.sheets ?? {}).filter(([id]) => ids.includes(id)));
  const missing = () => ids.filter((id) => !sheets.has(id));
  if (missing().length) {
    try {
      for (const [id, s] of await libSheets(missing())) sheets.set(id, s);
    } catch (e) {
      log(`golden: couldn't read the house sheets: ${e instanceof Error ? e.message : e}`);
    }
  }
  if (missing().length && (opts.db || opts.pglite || env.DATABASE_URL)) {
    try {
      for (const [id, s] of await dbSheets(missing(), { db: opts.db ?? env.DATABASE_URL, pglite: opts.pglite })) sheets.set(id, s);
    } catch (e) {
      log(`golden: couldn't read sheets from the database: ${e instanceof Error ? e.message : e}`);
    }
  }
  for (const id of missing()) {
    const kase = cases.find((c) => c.a === id || c.b === id);
    const name = kase?.names?.[kase.a === id ? 0 : 1] ?? id;
    sheets.set(id, { name, names_only: true });
    log(`golden: the judge only has ${name}'s name: pass --db (read-only) or add their sheet under "sheets" in golden-cases.json`);
  }
  return sheets;
}

/* ---------------------------------------------------- options ---------------------------------------------------- */

const BOOLEAN_FLAGS = new Set(["gate", "no-judge", "post", "dry-run"]);

/** A config as JSON ({"promptVersion":"v2"}) or k=v pairs (promptVersion=v2,temperature=0.8), checked. */
export function parseConfig(text, name = "config") {
  const raw = String(text ?? "").trim();
  if (!raw) throw new Error(`--${name} is empty`);
  let cfg;
  if (raw.startsWith("{")) {
    try {
      cfg = JSON.parse(raw);
    } catch {
      throw new Error(`--${name} isn't valid JSON`);
    }
  } else {
    cfg = {};
    for (const part of raw.split(",")) {
      const eq = part.indexOf("=");
      if (eq < 1) throw new Error(`--${name}: "${part}" isn't key=value`);
      const k = part.slice(0, eq).trim();
      const v = part.slice(eq + 1).trim();
      cfg[k] = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
    }
  }
  const allowed = new Set(["promptVersion", "model", "temperature", "memory"]);
  for (const k of Object.keys(cfg)) if (!allowed.has(k)) throw new Error(`--${name}: unknown key ${k} (one of ${[...allowed].join(", ")})`);
  if (cfg.promptVersion !== undefined && !/^v\d+$/.test(String(cfg.promptVersion))) throw new Error(`--${name}: promptVersion is v1, v2, …`);
  if (cfg.model !== undefined && (typeof cfg.model !== "string" || !cfg.model.trim() || cfg.model.length > 120)) throw new Error(`--${name}: model is a model name`);
  if (cfg.temperature !== undefined && !(num(cfg.temperature) !== null && cfg.temperature >= 0 && cfg.temperature <= 2)) throw new Error(`--${name}: temperature is 0 to 2`);
  if (cfg.memory !== undefined && !["live", "none"].includes(cfg.memory)) throw new Error(`--${name}: memory is live or none`);
  return cfg;
}

/** --thresholds repeats=1,sheet_detail_rate=0.1,win=0.5 → { repeats: 1, sheet_detail_rate: 0.1 } and the minimum win rate. */
export function parseThresholds(text) {
  const out = { metrics: {}, minWinRate: MIN_WIN_RATE };
  for (const part of String(text ?? "").split(",").filter(Boolean)) {
    const [k, v] = part.split("=").map((s) => s.trim());
    const n = Number(v);
    if (!k || !Number.isFinite(n) || n < 0) throw new Error(`--thresholds: "${part}" isn't name=number`);
    if (k === "win" || k === "min_win_rate") out.minWinRate = n;
    else out.metrics[k] = n;
  }
  return out;
}

const SUITES = { "after-dark": "after_dark", after_dark: "after_dark", ad: "after_dark", dates: "dates", date: "dates" };
const clampInt = (v, lo, hi, fallback) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : fallback;
};
const cleanBase = (u, name) => {
  try {
    const url = new URL(String(u));
    if (!/^https?:$/.test(url.protocol)) throw new Error();
    return url.origin + url.pathname.replace(/\/+$/, "");
  } catch {
    throw new Error(`--${name} isn't a URL`);
  }
};

/** The command line as options (throws with what's wrong). */
export function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`unexpected argument ${a}`);
    const eq = a.indexOf("=");
    const key = eq > 2 ? a.slice(2, eq) : a.slice(2);
    if (BOOLEAN_FLAGS.has(key)) {
      o[key] = true;
      continue;
    }
    const value = eq > 2 ? a.slice(eq + 1) : argv[++i];
    if (value === undefined) throw new Error(`--${key} needs a value`);
    o[key] = value;
  }
  const suite = SUITES[o.suite ?? ""] ?? (o.suite ? null : o["base-a"] || o["base-b"] ? "dates" : o.a || o.b ? "after_dark" : null);
  if (!suite) throw new Error("say which suite: --suite after-dark (with --a and --b) or --suite dates (with --base-a and --base-b)");
  if (!o.label || !/^[\w.-]{1,80}$/.test(o.label)) throw new Error("--label is required: letters, digits, dots, dashes (it names the report)");
  const thresholds = parseThresholds(o.thresholds);
  const opts = {
    suite,
    label: o.label,
    casesFile: o["cases-file"] ? resolve(o["cases-file"]) : CASES_FILE,
    cases: o.cases ? o.cases.split(",").map((s) => s.trim()).filter(Boolean) : null,
    repeat: clampInt(o.repeat ?? 1, 1, 5, null),
    steps: clampInt(o.steps ?? 4, 1, 8, null),
    memory: o.memory ?? "live",
    judge: !o["no-judge"],
    judgeModel: o["judge-model"] ?? JUDGE_MODELS[suite],
    judgeBase: o["judge-base"] ?? "http://127.0.0.1:4000/v1",
    maxUsd: o["max-usd"] !== undefined ? Number(o["max-usd"]) : DEFAULT_MAX_USD,
    stepUsd: o["step-usd"] !== undefined ? Number(o["step-usd"]) : AD_STEP_USD,
    gap: (o.gap !== undefined ? Number(o.gap) : suite === "dates" ? 20 : 2) * 1000,
    gate: Boolean(o.gate),
    thresholds: thresholds.metrics,
    minWinRate: thresholds.minWinRate,
    post: Boolean(o.post),
    site: cleanBase(o.site ?? "https://botchelor.com", "site"),
    db: o.db ?? null,
    pglite: o.pglite ?? null,
    outDir: o["out-dir"] ? (isAbsolute(o["out-dir"]) ? o["out-dir"] : resolve(o["out-dir"])) : join(ROOT, "docs", "eval"),
    sharedQuota: o["shared-quota"] === "yes",
    dryRun: Boolean(o["dry-run"]),
  };
  if (opts.repeat === null) throw new Error("--repeat is 1 to 5");
  if (opts.steps === null) throw new Error("--steps is 1 to 8");
  if (!["live", "none"].includes(opts.memory)) throw new Error("--memory is live or none");
  if (!(opts.maxUsd >= 0)) throw new Error("--max-usd is a number of dollars");
  if (!(opts.stepUsd >= 0)) throw new Error("--step-usd is a number of dollars");
  if (!(opts.gap >= 0)) throw new Error("--gap is a number of seconds");
  if (suite === "after_dark") {
    if (!o.a || !o.b) throw new Error("--suite after-dark compares --a and --b, each a config like {\"promptVersion\":\"v1\"}");
    opts.a = parseConfig(o.a, "a");
    opts.b = parseConfig(o.b, "b");
    opts.base = cleanBase(o.base ?? "https://botchelor.com", "base");
  } else {
    if (!o["base-a"] || !o["base-b"]) throw new Error("--suite dates compares two deployments: --base-a and --base-b");
    opts.baseA = cleanBase(o["base-a"], "base-a");
    opts.baseB = cleanBase(o["base-b"], "base-b");
  }
  return opts;
}

/** golden-cases.json. */
export function loadCases(file = CASES_FILE) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  return { after_dark: data.after_dark ?? [], dates: data.dates ?? [], sheets: data.sheets ?? {} };
}

function selectCases(file, suite, ids) {
  const all = file[suite] ?? [];
  if (!ids) return all;
  const unknown = ids.filter((id) => !all.some((c) => c.id === id));
  if (unknown.length) throw new GoldenRefusal(`unknown ${suite.replace("_", " ")} case${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")} (known: ${all.map((c) => c.id).join(", ")})`);
  return all.filter((c) => ids.includes(c.id));
}

function gitSha() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------- the run ---------------------------------------------------- */

/**
 * Runs the golden set: the judge is checked first (no transcripts are paid for that nobody can judge), then the route,
 * then the estimate against --max-usd; then every case and sample on A and B (in a seeded order), the side-by-side judge,
 * the aggregate, the metric deltas and the gate. Writes docs/eval/golden-<label>.json and .md unless deps.write is false.
 * deps (for tests): fetchImpl, judge, sheetsFor, env, log, sleep, now, write, sha.
 */
export async function runGolden(opts, deps = {}) {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const log = deps.log ?? ((m) => console.error(m));
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = deps.now ?? (() => new Date());
  const file = loadCases(opts.casesFile ?? CASES_FILE);
  const cases = selectCases(file, opts.suite, opts.cases);
  if (!cases.length) throw new GoldenRefusal(`no ${opts.suite} cases in ${opts.casesFile ?? CASES_FILE}`);
  const ad = opts.suite === "after_dark";

  const perCall = ad ? opts.steps * opts.stepUsd : DATE_USD;
  const calls = cases.length * opts.repeat * 2;
  const estimate = round(calls * perCall, 4);
  log(`golden: ${cases.length} case${cases.length === 1 ? "" : "s"} × ${opts.repeat} sample${opts.repeat === 1 ? "" : "s"} × 2 configs = ${calls} route calls, estimated $${estimate.toFixed(2)} (--max-usd $${opts.maxUsd})`);
  if (opts.dryRun) return { dry_run: true, suite: opts.suite, label: opts.label, cases: cases.map((c) => c.id), calls, estimate_usd: estimate };
  if (estimate > opts.maxUsd) throw new GoldenRefusal(`the estimate ($${estimate.toFixed(2)}) is over --max-usd ($${opts.maxUsd}): run fewer cases or samples, or raise --max-usd`);

  const secret = (arm) => (ad ? env.CRON_SECRET : (arm === "a" ? env.CRON_SECRET_A : env.CRON_SECRET_B) || env.CRON_SECRET);
  if (!secret("a") || !secret("b")) {
    throw new GoldenRefusal('CRON_SECRET must be set (it gates the eval routes): export CRON_SECRET="$(security find-generic-password -s vault/botchelor/CRON_SECRET -w)"');
  }
  const bypass = (arm) => {
    const token = arm === "a" ? env.VERCEL_BYPASS_A : env.VERCEL_BYPASS_B;
    return token ? { "x-vercel-protection-bypass": token } : {};
  };

  // The judge first: no point paying for transcripts nobody can judge.
  let judge = null;
  if (opts.judge) {
    try {
      judge = deps.judge ?? (await createLocalJudge({ baseUrl: opts.judgeBase, key: litellmKey(env), model: opts.judgeModel }));
    } catch (e) {
      throw new GoldenRefusal(`the local judge isn't usable: ${e instanceof Error ? e.message : e}`);
    }
  }

  if (ad) await preflightAfterDark(opts.base, secret("a"), fetchImpl);
  else for (const arm of ["a", "b"]) await preflightDates(arm === "a" ? opts.baseA : opts.baseB, secret(arm), opts, cases, fetchImpl, bypass(arm));

  const sheets = await (deps.sheetsFor ?? loadSheets)(opts, cases, file, { log, env });

  // Every case and sample on A and B, in a seeded order so neither config always goes first; the spend checked before each call.
  const runs = [];
  let spent = 0;
  let budgetStopped = false;
  outer: for (const kase of cases) {
    for (let sample = 0; sample < opts.repeat; sample++) {
      const order = hash(`${opts.label}:${kase.id}:${sample}:run`) % 2 ? ["b", "a"] : ["a", "b"];
      for (const arm of order) {
        const next = runs.length ? spent / runs.length : perCall;
        if (spent + next > opts.maxUsd + 1e-9) {
          budgetStopped = true;
          log(`golden: stopping: the next call would take the spend past $${opts.maxUsd} ($${spent.toFixed(3)} so far)`);
          break outer;
        }
        if (runs.length) await sleep(opts.gap);
        const t0 = Date.now();
        let run;
        try {
          const out = ad
            ? await callAfterDark({ base: opts.base, secret: secret(arm), kase, config: opts[arm], opts, fetchImpl, sleep })
            : await callDate({ base: arm === "a" ? opts.baseA : opts.baseB, secret: secret(arm), kase, fetchImpl, sleep, headers: bypass(arm) });
          run = { case: kase.id, sample, arm, ok: true, ms: Date.now() - t0, ...out };
        } catch (e) {
          if (e instanceof GoldenRefusal) throw e;
          run = { case: kase.id, sample, arm, ok: false, error: String(e instanceof Error ? e.message : e).slice(0, 300), ms: Date.now() - t0, cost_usd: null };
        }
        runs.push(run);
        // What the route says it cost; a failure or an unpriced answer counts as the estimate, to stay on the safe side.
        spent += run.cost_usd ?? perCall;
        log(
          `  ${kase.id} #${sample + 1} ${arm.toUpperCase()}: ${run.ok ? `${(run.lines ?? run.transcript).length} lines` : `failed (${run.error})`}` +
            `${run.cost_usd !== null && run.cost_usd !== undefined ? ` $${run.cost_usd.toFixed(4)}` : ""} · spent $${spent.toFixed(3)}`,
        );
      }
    }
  }

  // The judge: each sample both ways round.
  const judgments = [];
  let judgeStopped = null;
  if (judge) {
    judging: for (const kase of cases) {
      for (let sample = 0; sample < opts.repeat; sample++) {
        const pick = (arm) => runs.find((r) => r.case === kase.id && r.sample === sample && r.arm === arm && r.ok);
        const pair = { a: pick("a"), b: pick("b") };
        if (!pair.a || !pair.b) continue;
        const sheetPair = [sheets.get(kase.a) ?? { name: kase.names?.[0] ?? "A", names_only: true }, sheets.get(kase.b) ?? { name: kase.names?.[1] ?? "B", names_only: true }];
        const names = ad ? sheetPair.map((s) => s.name) : (pair.a.characters ?? sheetPair.map((s) => s.name));
        try {
          const j = await judgeSample({ judge, suite: opts.suite, kase, sample, runs: pair, names, sheets: sheetPair, steps: opts.steps, seed: opts.label });
          judgments.push(j);
          log(`  judge ${kase.id} #${sample + 1}: ${j.winner ? (j.winner === "tie" ? "tie" : `${j.winner.toUpperCase()} wins`) : "no verdict"}${j.consistent === false ? " (the passes split)" : ""}`);
        } catch (e) {
          judgeStopped = e instanceof Error ? e.message : String(e);
          log(`golden: the judge stopped: ${judgeStopped}`);
          break judging;
        }
      }
    }
  }

  const pairs = cases.flatMap((kase) =>
    Array.from({ length: opts.repeat }, (_, sample) => {
      const pick = (arm) => runs.find((r) => r.case === kase.id && r.sample === sample && r.arm === arm && r.ok);
      return pick("a") && pick("b") ? [{ case: kase.id, sample, a: pick("a"), b: pick("b") }] : [];
    }).flat(),
  );
  const summary = aggregate(judgments);
  const deltas = metricDeltas(pairs, opts.suite, opts.thresholds);
  const verdict = gate({ summary, deltas, runs }, { minWinRate: opts.minWinRate, judgeRequested: opts.judge });
  if (judgeStopped && opts.judge) {
    verdict.reasons.push(`the judge stopped: ${judgeStopped}`);
    verdict.passed = false;
  }
  if (budgetStopped) {
    verdict.reasons.push("stopped early at --max-usd, so not every case ran");
    verdict.passed = false;
  }
  const costOf = (arm) => round(runs.filter((r) => r.arm === arm).reduce((s, r) => s + (r.cost_usd ?? 0), 0), 4);

  const result = {
    label: opts.label,
    suite: opts.suite,
    ran_at: now().toISOString(),
    sha: deps.sha !== undefined ? deps.sha : gitSha(),
    configs: ad ? { a: { ...opts.a, base: opts.base }, b: { ...opts.b, base: opts.base } } : { a: { base: opts.baseA }, b: { base: opts.baseB } },
    options: { repeat: opts.repeat, steps: ad ? opts.steps : null, memory: ad ? opts.memory : null, judge: opts.judge ? opts.judgeModel : null, max_usd: opts.maxUsd, thresholds: opts.thresholds, min_win_rate: opts.minWinRate },
    cases: cases.map((c) => ({ ...c })),
    estimate_usd: estimate,
    // What the route reported; `unpriced` runs reported no cost (the budget counted them at the estimate: spent_usd).
    cost_usd: { a: costOf("a"), b: costOf("b"), total: round(costOf("a") + costOf("b"), 4), unpriced: runs.filter((r) => r.cost_usd === null || r.cost_usd === undefined).length },
    spent_usd: round(spent, 4),
    budget_stopped: budgetStopped,
    judge_stopped: judgeStopped,
    summary,
    deltas,
    gate: verdict,
    gate_requested: opts.gate,
    runs,
    judgments,
  };

  if (deps.write !== false) {
    mkdirSync(opts.outDir, { recursive: true });
    const base = join(opts.outDir, `golden-${opts.label}`);
    writeFileSync(`${base}.json`, `${JSON.stringify(result, null, 2)}\n`);
    writeFileSync(`${base}.md`, renderMarkdown(result));
    result.files = [`${base}.json`, `${base}.md`];
    log(`golden: wrote ${base}.json and .md`);
  }
  if (opts.post) result.posted = await postSummary(result, { site: opts.site, env, fetchImpl, log, password: deps.password });
  return result;
}

/* --------------------------------------------------- the report --------------------------------------------------- */

const fmt = (x, d = 2) => (x === null || x === undefined ? "—" : Number.isInteger(x) ? String(x) : x.toFixed(d));
const signed = (x) => (x === null || x === undefined ? "—" : `${x > 0 ? "+" : ""}${fmt(x)}`);
const configText = (c) =>
  Object.entries(c)
    .filter(([k]) => k !== "base")
    .map(([k, v]) => `${k} ${v}`)
    .join(", ") || "defaults";

/** The report as markdown: the verdict, the gate, the metric deltas and each sample's verdict and reasons. */
export function renderMarkdown(r) {
  const s = r.summary;
  const ad = r.suite === "after_dark";
  const out = [];
  out.push(`# Golden set: ${r.label}`, "");
  out.push(`${ad ? "After Dark" : "Dates"} · ${r.ran_at.slice(0, 16).replace("T", " ")} UTC${r.sha ? ` · commit \`${r.sha.slice(0, 7)}\`` : ""}`, "");
  if (ad) out.push(`- **A:** ${configText(r.configs.a)} on ${r.configs.a.base}`, `- **B:** ${configText(r.configs.b)} on ${r.configs.b.base}`);
  else out.push(`- **A:** ${r.configs.a.base}`, `- **B:** ${r.configs.b.base}`);
  out.push(
    `- ${r.cases.length} case${r.cases.length === 1 ? "" : "s"} × ${r.options.repeat} sample${r.options.repeat === 1 ? "" : "s"}${ad ? `, ${r.options.steps} steps each, memory ${r.options.memory}` : ""}`,
    `- Judge: ${r.options.judge ? `${r.options.judge} (local), every sample judged twice with the order swapped` : "none (--no-judge)"}`,
    `- Cost: A $${fmt(r.cost_usd.a, 3)} · B $${fmt(r.cost_usd.b, 3)} · total $${fmt(r.cost_usd.total, 3)} (estimate $${fmt(r.estimate_usd, 2)})${ad ? "" : ", the route's paid-tier figure"}` +
      `${r.cost_usd.unpriced ? `; ${r.cost_usd.unpriced} run${r.cost_usd.unpriced === 1 ? "" : "s"} reported no cost` : ""}`,
    "",
  );
  out.push("## Verdict", "");
  if (s.judged) {
    out.push(
      `**B against A: win rate ${fmt(s.win_rate_b)}** (B ${s.wins_b} · A ${s.wins_a} · tie ${s.ties}, n ${s.n}; a tie counts half). Sign test p = ${fmt(s.p_value, 3)} (two-sided, ties left out).`,
      "",
      `Sounds like the sheet: B ${fmt(s.sheet.win_rate_b)} (B ${s.sheet.wins_b} · A ${s.sheet.wins_a} · tie ${s.sheet.ties}).`,
      "",
      `Both passes agreed on ${s.consistent} of ${s.judged}. The judge picked the version it read first in ${s.position.picked_first} of ${s.position.decided_passes} decided passes${s.position.share_first !== null && s.position.share_first >= 0.75 ? ": a strong position bias, which the swapped order cancels" : ""}.`,
      "",
    );
  } else out.push(r.options.judge ? "No sample was judged both ways round." : "Not judged (--no-judge).", "");
  if (s.unjudged) out.push(`${s.unjudged} sample${s.unjudged === 1 ? "" : "s"} had no verdict from one of the passes.`, "");
  if (r.judge_stopped) out.push(`The judge stopped: ${r.judge_stopped}`, "");
  if (r.budget_stopped) out.push(`Stopped early: the next route call would have taken the spend past $${r.options.max_usd}.`, "");
  out.push(`**Gate:** ${r.gate.passed ? "passed" : "failed"}${r.gate_requested ? "" : " (not enforced: run with --gate)"}`);
  for (const why of r.gate.reasons) out.push(`- ${why}`);
  out.push("");
  out.push("## Deterministic metrics", "", "Mean per run over the samples where both configs ran.", "");
  if (r.deltas.length) {
    out.push("| Metric | A | B | B − A | Better | Tolerance | |", "|---|---|---|---|---|---|---|");
    for (const d of r.deltas) out.push(`| ${d.label} | ${fmt(d.a)} | ${fmt(d.b)} | ${signed(d.delta)} | ${d.better ?? "—"} | ${d.gate ?? "—"} | ${d.regressed ? "❌" : d.gate !== null ? "✓" : ""} |`);
  } else out.push("No metrics to compare.");
  out.push("");
  out.push("## Samples", "");
  const failed = r.runs.filter((x) => !x.ok);
  if (failed.length) {
    out.push("Failed runs:", "");
    for (const f of failed) out.push(`- ${f.case} #${f.sample + 1} ${f.arm.toUpperCase()}: ${f.error}`);
    out.push("");
  }
  if (r.judgments.length) {
    out.push("| Case | Sample | Winner | Sounds like the sheet | Passes agree | Reasons |", "|---|---|---|---|---|---|");
    const cell = (t) => String(t ?? "").replace(/\|/g, "/").replace(/\s+/g, " ").slice(0, 280);
    const name = (w) => (w ? (w === "tie" ? "tie" : w.toUpperCase()) : "—");
    for (const j of r.judgments) {
      const reasons = j.passes.map((p, i) => `${i + 1}: ${p.reasons ?? p.error ?? ""}`).join(" ");
      out.push(`| ${j.case} | ${j.sample + 1} | ${name(j.winner)} | ${name(j.sounds_like_sheet)} | ${j.consistent === null ? "—" : j.consistent ? "yes" : "no"} | ${cell(reasons)} |`);
    }
    out.push("");
  }
  out.push(`Every transcript, metric, cost and judgment is in golden-${r.label}.json.`, "");
  return out.join("\n");
}

/** The summary posted to /api/admin/quality: numbers only, never transcripts (the endpoint takes at most 10 KB). */
export function summaryForPost(r) {
  const s = r.summary;
  return {
    suite: r.suite,
    configs: { a: r.configs.a, b: r.configs.b },
    cases: r.cases.length,
    repeat: r.options.repeat,
    judge: r.options.judge,
    judged: s.judged,
    n: s.n,
    wins_b: s.wins_b,
    wins_a: s.wins_a,
    ties: s.ties,
    win_rate_b: s.win_rate_b,
    p_value: s.judged ? s.p_value : null,
    sheet_win_rate_b: s.sheet.win_rate_b,
    position_first_share: s.position.share_first,
    gate: { passed: r.gate.passed, reasons: r.gate.reasons.slice(0, 5).map((x) => x.slice(0, 200)) },
    cost_usd: r.cost_usd.total,
    deltas: Object.fromEntries(r.deltas.slice(0, 24).map((d) => [d.key, { a: d.a, b: d.b, delta: d.delta, regressed: d.regressed }])),
  };
}

function adminPassword(env) {
  if (env.FRONTIER_PASSWORD) return env.FRONTIER_PASSWORD;
  try {
    return execFileSync("security", ["find-generic-password", "-s", "vault/botchelor/FRONTIER_PASSWORD", "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() || null;
  } catch {
    return null;
  }
}

/** Posts the summary to the site's quality runs (kind golden, this label). Never throws: says what happened. */
export async function postSummary(r, { site, env = process.env, fetchImpl = globalThis.fetch, log = () => {}, password } = {}) {
  const key = password ?? adminPassword(env);
  if (!key) {
    log("golden: not posted: no FRONTIER_PASSWORD in the environment or the keychain");
    return { ok: false, why: "no admin password" };
  }
  try {
    const res = await fetchImpl(`${site}/api/admin/quality`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-frontier-key": key },
      body: JSON.stringify({ kind: "golden", label: r.label, sha: r.sha, at: r.ran_at, metrics: summaryForPost(r) }),
      signal: AbortSignal.timeout(30_000),
    });
    log(res.ok ? `golden: posted to ${site}/admin/analytics` : `golden: posting failed (HTTP ${res.status})`);
    return { ok: res.ok, status: res.status };
  } catch (e) {
    log(`golden: posting failed: ${e instanceof Error ? e.message : e}`);
    return { ok: false, why: "network" };
  }
}

/* ------------------------------------------------------ main ------------------------------------------------------ */

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`golden: ${e.message}\nusage: see the comment at the top of scripts/eval/golden.mjs`);
    process.exit(2);
  }
  try {
    const r = await runGolden(opts);
    if (r.dry_run) {
      console.log(JSON.stringify(r, null, 2));
      return;
    }
    const s = r.summary;
    console.log(
      `${r.label}: ${s.judged ? `B win rate ${fmt(s.win_rate_b)} (B ${s.wins_b} · A ${s.wins_a} · tie ${s.ties}, p ${fmt(s.p_value, 3)})` : "not judged"}; ` +
        `gate ${r.gate.passed ? "passed" : `failed: ${r.gate.reasons.join("; ")}`}; cost $${fmt(r.cost_usd.total, 3)}`,
    );
    if (r.budget_stopped) process.exit(3);
    if (opts.gate && !r.gate.passed) process.exit(1);
  } catch (e) {
    if (e instanceof GoldenRefusal) {
      console.error(`golden: refusing: ${e.message}`);
      process.exit(2);
    }
    console.error(`golden: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
