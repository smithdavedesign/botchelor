/**
 * CI's four test shards (.github/workflows/ci.yml), balanced by how long each file took on CI (tests/shard-times.json).
 * vitest's own split gives each shard the same number of files, picked by a hash of their paths, so the slow files
 * bunch up by chance: on 2026-11-22 one shard took 9.4 minutes while another took 6.3, and every PR waited for the
 * slowest. Here the longest file goes first, each onto the shard with the least time so far; a file with no time yet
 * (a new one) counts as the median. Pure and deterministic: every shard works out the same split and keeps its part.
 * Plain JS so vitest.config.mts loads it as it is. `node scripts/shard-times.mjs` refreshes the times from main's CI.
 *
 * @param {readonly string[]} paths
 * @param {Readonly<Record<string, number>>} times
 * @param {number} count
 * @returns {Set<string>[]}
 */
export function balanceShards(paths, times, count) {
  const known = Object.values(times).sort((a, b) => a - b);
  const median = known.length ? known[Math.floor(known.length / 2)] : 1;
  const weight = (path) => times[path] ?? median;
  const longestFirst = [...new Set(paths)].sort((a, b) => weight(b) - weight(a) || (a < b ? -1 : a > b ? 1 : 0));
  const shards = Array.from({ length: Math.max(1, count) }, () => ({ load: 0, files: new Set() }));
  for (const path of longestFirst) {
    let least = shards[0];
    for (const s of shards) if (s.load < least.load) least = s;
    least.load += weight(path);
    least.files.add(path);
  }
  return shards.map((s) => s.files);
}
