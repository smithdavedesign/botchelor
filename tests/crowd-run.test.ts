/**
 * The crowd's launchd runner (scripts/crowd/run.sh) keeps its own clone on the newest main. On 2026-11-13 an `npm install`
 * inside that clone rewrote package.json, the checkout refused every tick after it, and every job (the crowd, the weekly
 * report, the daily clip and its web copy) ran Nov 13's code for six days without a word. Pinned here: a change made in the
 * clone is kept and set aside so the update happens, and a failed update reaches the system log.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const run = readFileSync("scripts/crowd/run.sh", "utf8");

describe("scripts/crowd/run.sh: the clone's update", () => {
  it("is valid zsh", () => {
    expect(() => execFileSync("zsh", ["-n", "scripts/crowd/run.sh"])).not.toThrow();
  });

  it("keeps a change made in the clone, sets it aside and updates anyway", () => {
    const plain = run.indexOf("git checkout -q --detach origin/main");
    const kept = run.indexOf('git diff > "$kept"');
    const forced = run.indexOf("git checkout -q -f --detach origin/main");
    expect(plain).toBeGreaterThan(0);
    expect(kept).toBeGreaterThan(plain);
    expect(forced).toBeGreaterThan(kept);
    expect(run).toContain('kept="$HOME_DIR/logs/');
  });

  it("tells the system log when it set something aside or couldn't update, and still never runs during a pass", () => {
    expect(run).toContain('EMIT="$HOME/ai-stack/bin/emit-event"');
    expect(run).toMatch(/note info "local changes in the crowd clone set aside/);
    expect(run).toMatch(/note fail "git fetch failed/);
    expect(run).toMatch(/note fail "the crowd clone can't move to origin\/main/);
    expect(run).toContain('if [ ! -f "$HOME_DIR/lock" ]; then');
  });
});
