/** Types for tests/shards.mjs, plain JS so vitest.config.mts loads it with no build step. */
export function balanceShards(paths: readonly string[], times: Readonly<Record<string, number>>, count: number): Set<string>[];
