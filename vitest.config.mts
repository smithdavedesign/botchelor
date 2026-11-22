import { readFileSync } from "node:fs";
import { relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { BaseSequencer, type TestSpecification } from "vitest/node";
import { balanceShards } from "./tests/shards.mjs";

const root = fileURLToPath(new URL(".", import.meta.url)).replace(/\/$/, "");

/** `--shard=i/4` (CI): each shard takes its part of a split balanced by CI's file times (tests/shards.mjs). */
class TimedShards extends BaseSequencer {
  async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { index, count } = this.ctx.config.shard!;
    const times = JSON.parse(readFileSync(`${root}/tests/shard-times.json`, "utf8")) as Record<string, number>;
    const path = (f: TestSpecification) => relative(root, f.moduleId).split(sep).join("/");
    const mine = balanceShards(files.map(path), times, count)[index - 1];
    return files.filter((f) => mine.has(path(f)));
  }
}

export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: `${root}/` }],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Every test starts with the picture checkers' alternatives stubbed to refuse (tests/setup-no-live-checks.ts).
    setupFiles: ["tests/setup-no-live-checks.ts", "tests/setup-legacy-ids.ts"],
    sequence: { sequencer: TimedShards },
    // PGlite (WASM Postgres) boots in about a second; leave headroom on slow CI.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
