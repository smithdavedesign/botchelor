#!/usr/bin/env node
/**
 * Could a small learned model say better than chemistry_on_record which first dates lead to a second? (ROADMAP #578
 * (c); docs/data-plan.md.) An offline report only: it reads the gated record (lib/outcome-data.ts: aired public dates,
 * opted-in characters, nobody ours, never After Dark), changes nothing, calls no model and costs nothing. The engine
 * stays deterministic: a model like this would only ever inform previews and who meets whom, never an ending.
 *
 *   node scripts/eval/chemistry-model.mjs [--db url | --pglite dir] [--outcome booked|ending] [--test-share 0.2] [--json out.json]
 *
 * The outcome (--outcome):
 *  - booked (the default): the couple booked a second date and it aired publicly, Real use's second-date rate on the
 *    usable part. Dates that aired under 7 days ago, or whose follow-up didn't air publicly, are left out;
 *  - ending: the engine's ending was a second date (what chemistry_on_record predicts today).
 *
 * The model: logistic regression in plain JS (batch gradient descent, L2, standardized features) on public sheet fields
 * only: each trait (seen at least 3 times in training) counted over both sides, the traits they share, the temperament
 * their traits and voice describe (lib/temperament.ts sheetSignals: each axis's mean and gap), the show format, and what
 * kind of being each is (extras.kind). Never a soul, a dealbreaker or the engine trace.
 *
 * The test: a time-based hold-out (the last --test-share of dates). Against it: the base rate (a constant: AUC 0.5) and
 * chemistry_on_record replayed as the preview computes it (lib/compatibility.ts buildTraitStats on the training dates'
 * engine endings, then compatibility(...).rate). AUC, and log loss against the base rate's.
 *
 * Below #578's gate (lib/training-readiness.ts) it says "not enough data" first, and still shows what there is, marked.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openDb } from "./after-dark-observer.mjs";
import { libDb } from "./build-training-set.mjs";
import { loadLib } from "./export-preferences.mjs";

/** Fewer of either outcome than this in the hold-out and AUC means nothing, whatever the gate says. */
export const MIN_PER_CLASS = 5;
export const MIN_TRAIT_COUNT = 3;
export const AXES = ["warmth", "openness", "guardedness", "humor"];

export const loadOutcomeLib = () => loadLib("lib/outcome-data.ts");

export const sigmoid = (z) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));
const dot = (w, x) => w.reduce((s, wi, i) => s + wi * x[i], 0);

/**
 * Logistic regression by batch gradient descent: weights start at zero and the bias at the base rate's log-odds, so with
 * no signal it predicts the base rate. L2 on the weights only. Deterministic.
 */
export function fitLogistic(X, y, { l2 = 0.01, lr = 0.5, iters = 800 } = {}) {
  const n = X.length;
  const d = n ? X[0].length : 0;
  const w = new Array(d).fill(0);
  const rate = n ? y.reduce((s, v) => s + v, 0) / n : 0.5;
  const clipped = Math.min(1 - 1e-6, Math.max(1e-6, rate));
  let b = Math.log(clipped / (1 - clipped));
  if (!n) return { w, b };
  for (let it = 0; it < iters; it++) {
    const gw = new Array(d).fill(0);
    let gb = 0;
    for (let r = 0; r < n; r++) {
      const err = sigmoid(b + dot(w, X[r])) - y[r];
      gb += err;
      for (let j = 0; j < d; j++) gw[j] += err * X[r][j];
    }
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / n + l2 * w[j]);
    b -= lr * (gb / n);
  }
  return { w, b };
}

export const predictLogistic = (m, x) => sigmoid(m.b + dot(m.w, x));

/** AUC (the chance a random positive scores above a random negative; ties count half), or null without both classes. */
export function auc(scores, labels) {
  const pairs = scores.map((s, i) => ({ s, y: labels[i] ? 1 : 0 })).sort((a, b) => a.s - b.s);
  const pos = pairs.filter((p) => p.y).length;
  const neg = pairs.length - pos;
  if (!pos || !neg) return null;
  let rankSum = 0;
  for (let i = 0; i < pairs.length; ) {
    let j = i;
    while (j < pairs.length && pairs[j].s === pairs[i].s) j++;
    const mid = (i + 1 + j) / 2; // the average 1-based rank of the tied run
    for (let t = i; t < j; t++) if (pairs[t].y) rankSum += mid;
    i = j;
  }
  return (rankSum - (pos * (pos + 1)) / 2) / (pos * neg);
}

/** Mean log loss, probabilities clipped away from 0 and 1. */
export function logLoss(ps, ys) {
  if (!ps.length) return null;
  const eps = 1e-6;
  return -ps.reduce((s, p, i) => {
    const q = Math.min(1 - eps, Math.max(eps, p));
    return s + (ys[i] ? Math.log(q) : Math.log(1 - q));
  }, 0) / ps.length;
}

/** Column means and spreads from the training rows (a constant column keeps spread 1), and a function applying them. */
export function standardizer(X) {
  const d = X.length ? X[0].length : 0;
  const mean = new Array(d).fill(0);
  const sd = new Array(d).fill(0);
  for (const x of X) for (let j = 0; j < d; j++) mean[j] += x[j] / X.length;
  for (const x of X) for (let j = 0; j < d; j++) sd[j] += (x[j] - mean[j]) ** 2 / X.length;
  for (let j = 0; j < d; j++) sd[j] = Math.sqrt(sd[j]) || 1;
  return { mean, sd, apply: (x) => x.map((v, j) => (v - mean[j]) / sd[j]) };
}

const norm = (t) => String(t).trim().toLowerCase();

/** The features, from the training dates only: traits seen often enough, the formats and the kinds. */
export function featureSpace(train, { minTraitCount = MIN_TRAIT_COUNT } = {}) {
  const counts = new Map();
  for (const d of train) for (const t of new Set([...d.a.traits, ...d.b.traits].map(norm))) counts.set(t, (counts.get(t) ?? 0) + 1);
  const traits = [...counts].filter(([, c]) => c >= minTraitCount).map(([t]) => t).sort();
  const formats = [...new Set(train.map((d) => d.format))].sort();
  const kinds = [...new Set(train.flatMap((d) => [d.a.kind, d.b.kind]).filter(Boolean))].sort();
  const names = [
    ...traits.map((t) => `trait:${t}`),
    "shared_traits",
    ...AXES.flatMap((a) => [`${a}:mean`, `${a}:gap`]),
    ...formats.map((f) => `format:${f}`),
    ...kinds.map((k) => `kind:${k}`),
    "same_kind",
  ];
  return { traits, formats, kinds, names };
}

/** One date as a row of numbers in the feature space. `signals` is lib/temperament.ts sheetSignals. */
export function featurize(d, space, signals) {
  const a = new Set(d.a.traits.map(norm));
  const b = new Set(d.b.traits.map(norm));
  const sa = signals({ traits: d.a.traits, voice: d.a.voice });
  const sb = signals({ traits: d.b.traits, voice: d.b.voice });
  return [
    ...space.traits.map((t) => Number(a.has(t)) + Number(b.has(t))),
    [...a].filter((t) => b.has(t)).length,
    ...AXES.flatMap((x) => [(sa[x] + sb[x]) / 2, Math.abs(sa[x] - sb[x])]),
    ...space.formats.map((f) => Number(d.format === f)),
    ...space.kinds.map((k) => Number(d.a.kind === k) + Number(d.b.kind === k)),
    Number(Boolean(d.a.kind) && d.a.kind === d.b.kind),
  ];
}

/** The last `testShare` of dates by time are the hold-out. */
export function timeSplit(dates, testShare = 0.2) {
  const sorted = [...dates].sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
  const cut = Math.max(0, Math.min(sorted.length, Math.round(sorted.length * (1 - testShare))));
  return { train: sorted.slice(0, cut), test: sorted.slice(cut) };
}

const round = (x, d = 3) => (x === null || x === undefined ? null : Math.round(x * 10 ** d) / 10 ** d);

/**
 * The whole evaluation from the usable first dates. lib: buildTraitStats, compatibility, sheetSignals (lib/outcome-data.ts).
 */
export function evaluateChemistry(dates, lib, { outcome = "booked", testShare = 0.2, minTraitCount = MIN_TRAIT_COUNT } = {}) {
  const labelOf = (d) => (outcome === "ending" ? d.ending_second : d.booked);
  const usable = dates.filter((d) => labelOf(d) !== null && labelOf(d) !== undefined);
  const { train, test } = timeSplit(usable, testShare);
  const ytr = train.map((d) => (labelOf(d) ? 1 : 0));
  const yte = test.map((d) => (labelOf(d) ? 1 : 0));
  const space = featureSpace(train, { minTraitCount });
  const raw = train.map((d) => featurize(d, space, lib.sheetSignals));
  const std = standardizer(raw);
  const model = fitLogistic(raw.map(std.apply), ytr);
  const p = test.map((d) => predictLogistic(model, std.apply(featurize(d, space, lib.sheetSignals))));
  const base = ytr.length ? ytr.reduce((s, v) => s + v, 0) / ytr.length : null;
  // chemistry_on_record as the preview computes it: trait-pair statistics from the training dates' engine endings.
  const stats = lib.buildTraitStats(train.map((d) => ({ a: d.a.traits, b: d.b.traits, second: d.ending_second })));
  const record = test.map((d) => lib.compatibility(stats, d.a.traits, d.b.traits).rate);
  // Nothing to learn from, nothing to show: with no training rows the model has no weights.
  const weights = train.length ? space.names.map((name, j) => ({ name, weight: round(model.w[j]) })).sort((x, y) => Math.abs(y.weight) - Math.abs(x.weight)) : [];
  return {
    outcome,
    train: { n: train.length, positives: ytr.reduce((s, v) => s + v, 0) },
    test: { n: test.length, positives: yte.reduce((s, v) => s + v, 0) },
    base_rate: round(base),
    features: space.names.length,
    auc: { model: round(auc(p, yte)), chemistry_on_record: round(auc(record, yte)), base_rate: test.length ? 0.5 : null },
    log_loss: { model: round(logLoss(p, yte)), base_rate: base === null ? null : round(logLoss(test.map(() => base), yte)) },
    top_features: weights.slice(0, 8),
  };
}

/** The report as lines: the gate first, then the numbers (marked when there's too little behind them). */
export function reportLines(r, readiness, gateText) {
  const enough = readiness.ready && r.test.positives >= MIN_PER_CLASS && r.test.n - r.test.positives >= MIN_PER_CLASS;
  const out = [];
  if (!enough) {
    out.push(
      `not enough data: ${readiness.gates.map((g) => `${g.label.toLowerCase()} ${gateText(g)}`).join(", ")}; the hold-out has ${r.test.positives} second dates and ${r.test.n - r.test.positives} without (needs ${MIN_PER_CLASS} of each).` +
        " The numbers below mean nothing yet.",
    );
  }
  const f = (x) => (x === null || x === undefined ? "—" : x.toFixed(3));
  out.push(`outcome "${r.outcome}": ${r.train.n} training dates (${r.train.positives} led on), ${r.test.n} held out (${r.test.positives}); base rate ${r.base_rate === null ? "—" : `${Math.round(r.base_rate * 100)}%`}; ${r.features} features`);
  out.push(`  AUC: model ${f(r.auc.model)} · chemistry_on_record ${f(r.auc.chemistry_on_record)} · base rate ${f(r.auc.base_rate)}`);
  out.push(`  log loss: model ${f(r.log_loss.model)} · base rate ${f(r.log_loss.base_rate)} (lower is better)`);
  if (r.top_features.length) out.push(`  weightiest features: ${r.top_features.map((w) => `${w.name} ${w.weight > 0 ? "+" : ""}${w.weight}`).join(", ")}`);
  return { enough, lines: out };
}

export function parseArgs(argv) {
  const o = { outcome: "booked", testShare: 0.2 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--db") o.db = argv[++i];
    else if (a === "--pglite") o.pglite = argv[++i];
    else if (a === "--json") o.json = resolve(argv[++i]);
    else if (a === "--outcome") {
      o.outcome = argv[++i];
      if (!["booked", "ending"].includes(o.outcome)) throw new Error("--outcome is booked (a second date booked and aired) or ending (the engine's second-date ending)");
    } else if (a === "--test-share") {
      o.testShare = Number(argv[++i]);
      if (!(o.testShare > 0 && o.testShare < 1)) throw new Error("--test-share is a share between 0 and 1, e.g. 0.2");
    } else throw new Error(`unknown option ${a}`);
  }
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const db = await openDb({ db: o.db, pglite: o.pglite });
  try {
    const lib = await loadOutcomeLib();
    const ldb = libDb(db.query);
    const ours = await lib.loadOurIds(ldb);
    const readiness = await lib.outcomesReadiness(ldb);
    const loaded = await lib.loadFirstDates(ldb, ours);
    const r = evaluateChemistry(loaded.dates, lib, { outcome: o.outcome, testShare: o.testShare });
    const report = reportLines(r, readiness, lib.gateText);
    console.log(`[chemistry-model] ${loaded.dates.length} usable first dates (${loaded.too_recent} aired under 7 days ago, ${loaded.follow_up_unusable} with a follow-up that didn't air publicly)`);
    for (const line of report.lines) console.log(`[chemistry-model] ${line}`);
    if (o.json) writeFileSync(o.json, `${JSON.stringify({ readiness: { ready: readiness.ready, gates: readiness.gates }, enough: report.enough, ...r }, null, 2)}\n`);
  } finally {
    await db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(`[chemistry-model] ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
