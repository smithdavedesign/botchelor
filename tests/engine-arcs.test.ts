// Five-date arcs across many random couples (docs/relationship-sim-evidence.md). A couple keeps dating only while both
// want another date, as on the show. Guards against later dates becoming a formality again: under engine v2 the
// familiarity bonus compounded until follow-up dates ended in another date ~100% of the time and trust rose for ~99% of
// five-date couples, whatever happened on them.
import { describe, expect, it } from "vitest";
import { deterministicEngine, type DateHistory, type DateInput, type EngineVersion } from "@/lib/engine";
import { RUNNING_WEIGHT } from "@/lib/relationships";
import { AGENDA_IDS, AUTONOMY_LEVELS, STRATEGIES, type Ending } from "@/lib/rules";

const TRAITS = ["warm", "curious", "stubborn", "calm", "funny", "guarded", "bold", "shy", "loyal", "sly", "precise", "dramatic", "patient", "loud", "tender", "wry"];
const rng = (seed: number) => {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
};
const pick = <T,>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
const side = (r: () => number, name: string) => ({
  sheet: { name, age: 30, bio: "A person.", traits: [pick(r, TRAITS), pick(r, TRAITS), pick(r, TRAITS)], want: "someone kind", dealbreaker: "rudeness", house: false },
  signals: { warmth: r(), openness: r(), guardedness: r(), humor: r() },
  autonomy: pick(r, AUTONOMY_LEVELS),
  strategy: pick(r, STRATEGIES),
  agendaId: pick(r, AGENDA_IDS),
  note: null,
  gameBudget: 25 as const,
});

function arc(seed: number, version: EngineVersion) {
  const r = rng(seed);
  const [a, b] = [side(r, "A"), side(r, "B")];
  const endings: Ending[] = [];
  const trusts: number[] = [];
  let chem: number | undefined;
  let trust: number | undefined;
  for (let n = 1; n <= 5; n++) {
    const history: DateHistory | undefined = n === 1 ? undefined : { dates: n - 1, last_ending: endings.at(-1) ?? null, chemistry: chem, trust };
    const out = deterministicEngine.decide({ a, b, history } as DateInput, seed * 10 + n, version);
    endings.push(out.ending);
    const [c, t] = [out.variables.chemistry.final, out.variables.trust.final];
    chem = chem === undefined ? c : chem + RUNNING_WEIGHT * (c - chem);
    trust = trust === undefined ? t : trust + RUNNING_WEIGHT * (t - trust);
    trusts.push(trust);
    if (!(out.sides[0].wants_another && out.sides[1].wants_another)) break;
  }
  return { endings, trusts };
}

function stats(version: EngineVersion, couples = 2000) {
  let fiveDaters = 0;
  let trustRose = 0;
  let laterDates = 0;
  let laterSecond = 0;
  for (let s = 1; s <= couples; s++) {
    const { endings, trusts } = arc(s, version);
    endings.slice(1).forEach((e) => {
      laterDates++;
      if (e === "second_date") laterSecond++;
    });
    if (trusts.length === 5) {
      fiveDaters++;
      if (trusts[4] > trusts[0]) trustRose++;
    }
  }
  return { fiveDaters: fiveDaters / couples, trustRose: trustRose / fiveDaters, laterSecond: laterSecond / laterDates };
}

describe("five-date arcs across 2,000 random couples", () => {
  const v2 = stats(2);
  const v3 = stats(3);

  it("v2 made later dates a formality (kept for replays only)", () => {
    expect(v2.trustRose).toBeGreaterThan(0.97);
    expect(v2.laterSecond).toBeGreaterThan(0.9);
  });

  it("v3: growth is likely for a couple that keeps choosing each other, but not guaranteed", () => {
    expect(v3.trustRose).toBeGreaterThan(0.7);
    expect(v3.trustRose).toBeLessThan(0.9);
    expect(v3.laterSecond).toBeLessThan(0.9);
  });

  it("v3 doesn't cut how many couples get to a fifth date", () => {
    expect(Math.abs(v3.fiveDaters - v2.fiveDaters)).toBeLessThan(0.03);
  });
});
