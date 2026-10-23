#!/usr/bin/env node
/**
 * Would collaborative filtering rank the swipe deck better? (ROADMAP #578 (a); docs/data-plan.md.) An offline report
 * only: it reads the gated record (lib/outcome-data.ts: opted-in, public, not ours, never After Dark), changes nothing,
 * calls no model and costs nothing.
 *
 *   node scripts/eval/deck-cf-offline.mjs [--db url | --pglite dir] [--test-share 0.2] [--json out.json]
 *
 * The model: item-item collaborative filtering. A character's taste is what it liked (1), the likes that became a
 * match (+1) and the pairs that went on to a second date (+2, both ways); two cards are alike when the same characters
 * were drawn to both (cosine over those weights); a card scores by how like it is to what the viewer already liked.
 *
 * The test: a time-based hold-out. Everything before the cutoff (the last --test-share of likes, by time) trains; after
 * it, each viewer with some history is shown the cards it saw or swiped then, and each model ranks them:
 *  - current: the deck's own score for that card at the time (swipe_impressions.score, replayed). lib/dating.ts rankFor
 *    can't be re-run for the past: it reads today's relationships and trait statistics, which already include what
 *    happened after the cutoff. A card shown without a logged score ranks last;
 *  - cf: the model above, trained on the record before the cutoff;
 *  - popularity: how many likes, matches and second dates a card had before the cutoff (the obvious baseline).
 * Hit rate @5 and @10: the share of viewers with one of their after-cutoff likes in the top k (counted only over viewers
 * with more than k candidates, since with fewer every model "hits"). Coverage: the share of the candidate cards that ever
 * reach a top 10, and the share of viewers CF could score at all.
 *
 * Below #578's gate (500 real dates and 200 swipers in 30 days, lib/training-readiness.ts) it says "not enough data"
 * first, and still shows what little there is, marked as such.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openDb } from "./after-dark-observer.mjs";
import { hash32, libDb } from "./build-training-set.mjs";
import { loadLib } from "./export-preferences.mjs";

export const KS = [5, 10];
/** Fewer test viewers than this and the hit rates mean nothing, whatever the gate says. */
export const MIN_TEST_VIEWERS = 20;
export const WEIGHTS = { like: 1, match: 1, second: 2 };

export const loadOutcomeLib = () => loadLib("lib/outcome-data.ts");

/** user → item → weight, from what happened strictly before `cutoff` (ISO; null for everything). */
export function interactions({ swipes, matches, seconds }, cutoff = null) {
  const before = (at) => cutoff === null || at < cutoff;
  const m = new Map();
  const add = (u, i, w) => {
    if (u === i) return;
    const row = m.get(u) ?? new Map();
    row.set(i, (row.get(i) ?? 0) + w);
    m.set(u, row);
  };
  const liked = new Set();
  for (const s of swipes) {
    if (!s.liked || !before(s.at)) continue;
    add(s.viewer, s.card, WEIGHTS.like);
    liked.add(`${s.viewer}>${s.card}`);
  }
  // A match is a like both ways: the extra weight goes on each side that liked.
  for (const p of matches) {
    if (!before(p.at)) continue;
    if (liked.has(`${p.x}>${p.y}`)) add(p.x, p.y, WEIGHTS.match);
    if (liked.has(`${p.y}>${p.x}`)) add(p.y, p.x, WEIGHTS.match);
  }
  for (const p of seconds) {
    if (!before(p.at)) continue;
    add(p.x, p.y, WEIGHTS.second);
    add(p.y, p.x, WEIGHTS.second);
  }
  return m;
}

/** The item-item model: item → user → weight, each item's norm, and a cached cosine. */
export function itemModel(userItems) {
  const items = new Map();
  for (const [u, row] of userItems) {
    for (const [i, w] of row) {
      const col = items.get(i) ?? new Map();
      col.set(u, w);
      items.set(i, col);
    }
  }
  const norm = new Map([...items].map(([i, col]) => [i, Math.sqrt([...col.values()].reduce((s, w) => s + w * w, 0))]));
  const cache = new Map();
  const sim = (i, j) => {
    if (i === j) return 1;
    const key = i < j ? `${i}|${j}` : `${j}|${i}`;
    if (cache.has(key)) return cache.get(key);
    const a = items.get(i);
    const b = items.get(j);
    let dot = 0;
    if (a && b) {
      const [small, big] = a.size <= b.size ? [a, b] : [b, a];
      for (const [u, w] of small) if (big.has(u)) dot += w * big.get(u);
    }
    const d = (norm.get(i) ?? 0) * (norm.get(j) ?? 0);
    const s = d ? dot / d : 0;
    cache.set(key, s);
    return s;
  };
  return { items, sim, userItems };
}

/** CF's score for `user` on `item`: how like it is to everything the user already liked, by weight. */
export function cfScore(model, user, item) {
  const row = model.userItems.get(user);
  if (!row) return 0;
  let s = 0;
  for (const [i, w] of row) if (i !== item) s += w * model.sim(i, item);
  return s;
}

/** Each item's weight received before the cutoff: likes, matches and second dates. */
export function popularity(userItems) {
  const p = new Map();
  for (const row of userItems.values()) for (const [i, w] of row) p.set(i, (p.get(i) ?? 0) + w);
  return p;
}

/** `ids` best first by `score` (higher first), ties broken by a stable hash of the viewer and the card (no id bias). */
export function rank(ids, score, viewer = "") {
  return [...ids].sort((x, y) => score(y) - score(x) || hash32(`${viewer}:${x}`) - hash32(`${viewer}:${y}`));
}

/** Whether any of `positives` is in the first k of `ranked`. */
export const hitAt = (ranked, positives, k) => ranked.slice(0, k).some((id) => positives.has(id));

/** The cutoff: the time at which the last `testShare` of likes begin (null when there are no likes). */
export function cutoffFor(swipes, testShare = 0.2) {
  const times = swipes.filter((s) => s.liked).map((s) => s.at).sort();
  if (!times.length) return null;
  return times[Math.min(times.length - 1, Math.floor(times.length * (1 - testShare)))];
}

/**
 * The evaluation: per test viewer, the candidates (cards seen or swiped after the cutoff that it hadn't touched before),
 * its after-cutoff likes, and each model's ranking; then hit rate @k and coverage per model.
 */
export function evaluate(data, { testShare = 0.2, ks = KS } = {}) {
  const cutoff = cutoffFor(data.swipes, testShare);
  const empty = { cutoff, viewers: 0, cold_viewers: 0, mean_candidates: null, unscored_current: 0, models: {} };
  if (!cutoff) return empty;
  const train = interactions(data, cutoff);
  const model = itemModel(train);
  const pop = popularity(train);
  // The deck's own score for a card it showed, the last one logged after the cutoff before the viewer swiped it.
  const deckScore = new Map();
  for (const i of data.impressions) if (i.at >= cutoff && i.score !== null) deckScore.set(`${i.viewer}>${i.card}`, i.score);

  const touched = new Map();
  for (const s of data.swipes) {
    if (s.at >= cutoff) continue;
    touched.set(s.viewer, (touched.get(s.viewer) ?? new Set()).add(s.card));
  }
  const after = new Map();
  const note = (viewer) => after.get(viewer) ?? after.set(viewer, { candidates: new Set(), positives: new Set() }).get(viewer);
  for (const i of data.impressions) if (i.at >= cutoff) note(i.viewer).candidates.add(i.card);
  for (const s of data.swipes) {
    if (s.at < cutoff) continue;
    const v = note(s.viewer);
    v.candidates.add(s.card);
    if (s.liked) v.positives.add(s.card);
  }

  const names = ["current", "cf", "popularity"];
  const tally = Object.fromEntries(names.map((n) => [n, { hits: Object.fromEntries(ks.map((k) => [k, 0])), n: Object.fromEntries(ks.map((k) => [k, 0])), top: new Set() }]));
  const allCandidates = new Set();
  let viewers = 0;
  let cold = 0;
  let candidateSum = 0;
  let unscored = 0;
  for (const [viewer, v] of after) {
    const seen = touched.get(viewer) ?? new Set();
    const candidates = [...v.candidates].filter((c) => !seen.has(c) && c !== viewer);
    const positives = new Set([...v.positives].filter((c) => !seen.has(c)));
    if (!positives.size || candidates.length < 2) continue;
    if (!train.has(viewer)) {
      cold++;
      continue;
    }
    viewers++;
    candidateSum += candidates.length;
    for (const c of candidates) allCandidates.add(c);
    unscored += candidates.filter((c) => !deckScore.has(`${viewer}>${c}`)).length;
    const scorers = {
      current: (c) => deckScore.get(`${viewer}>${c}`) ?? -Infinity,
      cf: (c) => cfScore(model, viewer, c),
      popularity: (c) => pop.get(c) ?? 0,
    };
    for (const name of names) {
      const ranked = rank(candidates, scorers[name], viewer);
      for (const c of ranked.slice(0, Math.max(...ks))) tally[name].top.add(c);
      for (const k of ks) {
        if (candidates.length <= k) continue;
        tally[name].n[k]++;
        if (hitAt(ranked, positives, k)) tally[name].hits[k]++;
      }
    }
  }
  const models = Object.fromEntries(
    names.map((name) => [
      name,
      {
        hit_rate: Object.fromEntries(ks.map((k) => [`@${k}`, tally[name].n[k] ? tally[name].hits[k] / tally[name].n[k] : null])),
        viewers_at: Object.fromEntries(ks.map((k) => [`@${k}`, tally[name].n[k]])),
        catalog_coverage: allCandidates.size ? tally[name].top.size / allCandidates.size : null,
      },
    ]),
  );
  return {
    cutoff,
    viewers,
    cold_viewers: cold,
    // CF scores a viewer only with some history before the cutoff; the rest go cold (they'd get the current deck).
    user_coverage: viewers + cold ? viewers / (viewers + cold) : null,
    mean_candidates: viewers ? candidateSum / viewers : null,
    unscored_current: unscored,
    models,
  };
}

const pct = (x) => (x === null || x === undefined ? "—" : `${Math.round(x * 100)}%`);

/** The report as lines: the gate first, then the numbers (marked when there's too little behind them). */
export function reportLines(result, readiness, gateText) {
  const enough = readiness.ready && result.viewers >= MIN_TEST_VIEWERS;
  const out = [];
  if (!enough) {
    out.push(
      `not enough data: ${readiness.gates.map((g) => `${g.label.toLowerCase()} ${gateText(g)}`).join(", ")}; ${result.viewers} test viewer${result.viewers === 1 ? "" : "s"} (needs ${MIN_TEST_VIEWERS}).` +
        " The numbers below mean nothing yet.",
    );
  }
  out.push(`cutoff ${result.cutoff ?? "—"}; ${result.viewers} test viewers (${result.cold_viewers} with no history, left to the current deck); ${result.mean_candidates === null ? "—" : result.mean_candidates.toFixed(1)} candidates each`);
  for (const [name, m] of Object.entries(result.models)) {
    out.push(`  ${name.padEnd(10)} hit@5 ${pct(m.hit_rate["@5"])} (n=${m.viewers_at["@5"]}) · hit@10 ${pct(m.hit_rate["@10"])} (n=${m.viewers_at["@10"]}) · catalog coverage ${pct(m.catalog_coverage)}`);
  }
  if (result.user_coverage !== undefined) out.push(`  CF could score ${pct(result.user_coverage)} of the viewers; ${result.unscored_current} shown cards had no logged deck score (ranked last by "current").`);
  return { enough, lines: out };
}

export function parseArgs(argv) {
  const o = { testShare: 0.2 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--db") o.db = argv[++i];
    else if (a === "--pglite") o.pglite = argv[++i];
    else if (a === "--json") o.json = resolve(argv[++i]);
    else if (a === "--test-share") {
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
    const data = await lib.loadDeckData(ldb, ours);
    const result = evaluate(data, { testShare: o.testShare });
    const report = reportLines(result, readiness, lib.gateText);
    console.log(`[deck-cf-offline] ${data.swipes.length} usable swipes, ${data.impressions.length} impressions, ${data.matches.length} matches, ${data.seconds.length} second dates`);
    for (const line of report.lines) console.log(`[deck-cf-offline] ${line}`);
    if (o.json) writeFileSync(o.json, `${JSON.stringify({ readiness: { ready: readiness.ready, gates: readiness.gates }, enough: report.enough, ...result }, null, 2)}\n`);
  } finally {
    await db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(`[deck-cf-offline] ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
}
