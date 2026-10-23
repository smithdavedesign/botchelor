// The #578 offline evaluators (scripts/eval/deck-cf-offline.mjs, chemistry-model.mjs; lib/outcome-data.ts): the
// collaborative-filtering and logistic-regression maths on tiny synthetic data, the gated reads (opted in, public, not
// ours), and an honest "not enough data" below the gate. Report only: nothing here touches the deck or the engine.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { claimAdmin } from "@/lib/admins";
import { registerAccount } from "@/lib/auth";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { setMlConsent } from "@/lib/ml-consent";
import * as outcomeLib from "@/lib/outcome-data";
import { loadDeckData, loadFirstDates, type DeckData, type FirstDate } from "@/lib/outcome-data";
import { loadOurIds } from "@/lib/our-traffic";
import { gateText, outcomesReadiness } from "@/lib/training-readiness";
import * as chem from "../scripts/eval/chemistry-model.mjs";
import * as cf from "../scripts/eval/deck-cf-offline.mjs";
import { newUserCookie, startTestDb, userIdOf } from "./helpers";

const at = (day: number) => new Date(Date.UTC(2026, 9, 1 + day)).toISOString();

describe("item-item collaborative filtering", () => {
  // u1 and u2 both like x and y; u3 likes x. CF should put y above z for u3 (its neighbours liked y); z is popular elsewhere.
  const data: DeckData = {
    swipes: [
      { viewer: "u1", card: "x", liked: true, at: at(0) },
      { viewer: "u1", card: "y", liked: true, at: at(0) },
      { viewer: "u2", card: "x", liked: true, at: at(1) },
      { viewer: "u2", card: "y", liked: true, at: at(1) },
      { viewer: "u4", card: "z", liked: true, at: at(1) },
      { viewer: "u5", card: "z", liked: true, at: at(1) },
      { viewer: "u6", card: "z", liked: true, at: at(1) },
      { viewer: "u3", card: "x", liked: true, at: at(2) },
      { viewer: "u3", card: "w", liked: false, at: at(2) },
    ],
    impressions: [],
    matches: [{ x: "u1", y: "x", at: at(0) }],
    seconds: [{ x: "u2", y: "y", at: at(1) }],
  };

  it("weighs a like 1, a match +1 on each side that liked, a second date +2 both ways; passes add nothing", () => {
    const m = cf.interactions(data);
    expect(m.get("u1")!.get("x")).toBe(2); // liked + matched (u1 liked x)
    expect(m.get("u2")!.get("y")).toBe(3); // liked + second date
    expect(m.get("y")!.get("u2")).toBe(2); // the second date, the other way
    expect(m.get("u3")!.has("w")).toBe(false);
    // Strictly before a cutoff.
    expect(cf.interactions(data, at(1)).has("u2")).toBe(false);
  });

  it("cosine similarity between cards, and a viewer's score from what it already liked", () => {
    const model = cf.itemModel(cf.interactions({ ...data, matches: [], seconds: [] }));
    expect(model.sim("x", "y")).toBeCloseTo(2 / (Math.sqrt(3) * Math.sqrt(2)), 6); // x: u1,u2,u3; y: u1,u2
    expect(model.sim("x", "z")).toBe(0);
    expect(model.sim("x", "x")).toBe(1);
    expect(cf.cfScore(model, "u3", "y")).toBeGreaterThan(cf.cfScore(model, "u3", "z"));
    expect(cf.cfScore(model, "nobody", "y")).toBe(0);
    expect(cf.popularity(cf.interactions(data)).get("z")).toBe(3);
  });

  it("ranks best first with a stable, id-free tie-break, and hit@k looks at the first k only", () => {
    const ranked = cf.rank(["a", "b", "c"], (id) => ({ a: 1, b: 3, c: 2 })[id]!, "v");
    expect(ranked).toEqual(["b", "c", "a"]);
    expect(cf.rank(["a", "b"], () => 0, "v")).toEqual(cf.rank(["b", "a"], () => 0, "v"));
    expect(cf.hitAt(["b", "c", "a"], new Set(["a"]), 2)).toBe(false);
    expect(cf.hitAt(["b", "c", "a"], new Set(["a"]), 3)).toBe(true);
  });

  it("evaluates on a time-based hold-out against the deck's replayed score and popularity", () => {
    // Before day 10: viewers v0..v5 who liked a also liked b; c is the crowd's favourite. After: each viewer who liked a
    // is shown b, c and six cold cards, and likes b. The deck's logged score put c first.
    const swipes: DeckData["swipes"] = [];
    const impressions: DeckData["impressions"] = [];
    for (let i = 0; i < 6; i++) {
      swipes.push({ viewer: `v${i}`, card: "a", liked: true, at: at(1) }, { viewer: `v${i}`, card: "b", liked: true, at: at(2) });
      swipes.push({ viewer: `fan${i}`, card: "c", liked: true, at: at(2) }, { viewer: `fan${i}`, card: `x${i}`, liked: true, at: at(2) });
    }
    swipes.push({ viewer: "fan6", card: "c", liked: true, at: at(2) }); // c is the more popular one
    for (let i = 0; i < 4; i++) {
      const v = `w${i}`;
      swipes.push({ viewer: v, card: "a", liked: true, at: at(3) });
      for (const [card, score] of [["b", 1], ["c", 5], ...[0, 1, 2, 3, 4, 5].map((k) => [`cold${k}`, 0])] as [string, number][]) {
        impressions.push({ viewer: v, card, score, rank: 1, at: at(12) });
      }
      swipes.push({ viewer: v, card: "b", liked: true, at: at(12) });
    }
    const r = cf.evaluate({ swipes, impressions, matches: [], seconds: [] }, { testShare: 0.1 });
    expect(r.viewers).toBe(4);
    expect(r.mean_candidates).toBe(8);
    expect(r.models.cf.hit_rate["@5"]).toBe(1);
    expect(r.models.current.hit_rate["@5"]).toBe(1); // b is second by the deck's score: still in the top 5
    expect(r.models.cf.viewers_at["@10"]).toBe(0); // 8 candidates: @10 can't miss, so it isn't counted
    expect(r.user_coverage).toBe(1);
    // At the very top, only CF puts b first: the deck's score and popularity both put c there.
    const top = cf.evaluate({ swipes, impressions, matches: [], seconds: [] }, { testShare: 0.1, ks: [1] });
    expect([top.models.cf.hit_rate["@1"], top.models.current.hit_rate["@1"], top.models.popularity.hit_rate["@1"]]).toEqual([1, 0, 0]);
    expect(cf.cutoffFor([])).toBeNull();
  });

  it("says 'not enough data' below the gate, and still shows the numbers, marked", () => {
    const empty = cf.evaluate({ swipes: [], impressions: [], matches: [], seconds: [] });
    const readiness = { ready: false, gates: [{ key: "dates", label: "Real dates, last 30 days", kind: "count" as const, have: 3, need: 500, met: false }] };
    const { enough, lines } = cf.reportLines(empty, readiness, gateText);
    expect(enough).toBe(false);
    expect(lines[0]).toMatch(/^not enough data: real dates, last 30 days 3 of 500; 0 test viewers \(needs 20\)\. The numbers below mean nothing yet\.$/);
  });
});

describe("the chemistry model's maths", () => {
  it("AUC: perfect is 1, reversed 0, ties a half, one class alone none", () => {
    expect(chem.auc([0.1, 0.2, 0.8, 0.9], [0, 0, 1, 1])).toBe(1);
    expect(chem.auc([0.9, 0.8, 0.2, 0.1], [0, 0, 1, 1])).toBe(0);
    expect(chem.auc([0.5, 0.5, 0.5, 0.5], [0, 1, 0, 1])).toBe(0.5);
    expect(chem.auc([0.1, 0.4, 0.35, 0.8], [0, 0, 1, 1])).toBe(0.75);
    expect(chem.auc([0.1, 0.2], [1, 1])).toBeNull();
  });

  it("log loss, and a standardizer that leaves a constant column alone", () => {
    expect(chem.logLoss([0.5, 0.5], [1, 0])).toBeCloseTo(Math.log(2), 9);
    expect(chem.logLoss([], [])).toBeNull();
    const s = chem.standardizer([
      [1, 5],
      [3, 5],
    ]);
    expect(s.mean).toEqual([2, 5]);
    expect(s.sd).toEqual([1, 1]);
    expect(s.apply([3, 5])).toEqual([1, 0]);
  });

  it("logistic regression learns a separable signal, and predicts the base rate when there's none", () => {
    const X = Array.from({ length: 40 }, (_, i) => [i % 2 ? 1 : -1, ((i * 7) % 5) / 5 - 0.4]);
    const y = X.map((x) => (x[0] > 0 ? 1 : 0));
    const m = chem.fitLogistic(X, y, { iters: 400 });
    expect(m.w[0]).toBeGreaterThan(1);
    expect(chem.predictLogistic(m, [1, 0])).toBeGreaterThan(0.8);
    expect(chem.predictLogistic(m, [-1, 0])).toBeLessThan(0.2);
    const flat = chem.fitLogistic([[0], [0], [0], [0]], [1, 0, 0, 0]);
    expect(chem.predictLogistic(flat, [0])).toBeCloseTo(0.25, 6);
    expect(chem.sigmoid(-1000)).toBe(0);
  });

  it("features from public sheet fields only, and a whole evaluation against the base rate and chemistry_on_record", () => {
    // Warm pairs lead on; guarded pairs don't. "warm" is a temperament word, so the model can see it.
    const dates: FirstDate[] = Array.from({ length: 50 }, (_, i) => {
      const warm = i % 2 === 0;
      return {
        id: `d${i}`,
        at: at(i),
        format: i % 3 ? "classic" : "speed",
        a: { traits: warm ? ["warm", "curious"] : ["guarded", "curious"], voice: null, kind: i % 5 ? "human" : "robot" },
        b: { traits: warm ? ["warm", "kind"] : ["cold", "kind"], voice: null, kind: "human" },
        booked: warm,
        ending_second: warm,
      };
    });
    const space = chem.featureSpace(dates.slice(0, 40));
    expect(space.names).toEqual(expect.arrayContaining(["trait:warm", "shared_traits", "warmth:mean", "warmth:gap", "format:speed", "kind:robot", "same_kind"]));
    const r = chem.evaluateChemistry(dates, outcomeLib as unknown as Parameters<typeof chem.evaluateChemistry>[1], { testShare: 0.2 });
    expect(r.train.n).toBe(40);
    expect(r.test.n).toBe(10);
    expect(r.auc.model).toBe(1);
    expect(r.auc.base_rate).toBe(0.5);
    expect(r.auc.chemistry_on_record).toBe(1); // warm × warm has done well in training, so the record sees it too
    expect(r.log_loss.model!).toBeLessThan(r.log_loss.base_rate!);
    const { enough, lines } = chem.reportLines(r, { ready: false, gates: [] }, gateText);
    expect(enough).toBe(false);
    expect(lines[0]).toMatch(/^not enough data/);
    expect(chem.timeSplit([{ at: at(2) }, { at: at(1) }], 0.5)).toEqual({ train: [{ at: at(1) }], test: [{ at: at(2) }] });
    // Nothing usable: no weights to show, and no numbers pretending otherwise.
    const none = chem.evaluateChemistry(dates.map((d) => ({ ...d, booked: null })), outcomeLib as unknown as Parameters<typeof chem.evaluateChemistry>[1]);
    expect(none).toMatchObject({ train: { n: 0 }, test: { n: 0 }, base_rate: null, top_features: [], auc: { model: null, chemistry_on_record: null, base_rate: null } });
  });

  it("refuses an unknown outcome or option", () => {
    expect(() => chem.parseArgs(["--outcome", "vibes"])).toThrow(/--outcome is booked/);
    expect(() => cf.parseArgs(["--test-share", "2"])).toThrow(/between 0 and 1/);
    expect(chem.parseArgs(["--outcome", "ending"]).outcome).toBe("ending");
  });
});

describe("the gated reads (lib/outcome-data.ts)", () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    t = await startTestDb();
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(async () => {
    await t.reset();
    await t.db.query("delete from admins");
    await t.db.query("delete from swipes");
    await t.db.query("delete from matches");
  });

  const HOUSE = HOUSE_CHARACTERS[0].id;
  let n = 0;
  async function account(consent = false): Promise<string> {
    const userId = userIdOf(newUserCookie());
    await registerAccount(t.db, userId, `om${++n}${Math.floor(Math.random() * 1e6)}`, ["a", "good", "password"].join("-"));
    if (consent) await setMlConsent(t.db, userId, true);
    return userId;
  }
  async function character(owner: string, visibility = "public"): Promise<string> {
    const id = `om-char-${++n}`;
    await t.db.query(
      `insert into characters (id, owner_id, name, age, bio, traits, want, dealbreaker, voice, extras, visibility)
       values ($1, $2, $3, 30, 'bio', '["warm","curious"]'::jsonb, 'love', 'SECRET-DEALBREAKER', 'Warm and slow.', '{"kind":"robot"}'::jsonb, $4)`,
      [id, owner, `Om ${n}`, visibility],
    );
    return id;
  }
  async function episode(a: string, b: string, o: { creator?: string; followupOf?: string; visibility?: string; airedDaysAgo?: number; ending?: string } = {}): Promise<string> {
    const id = `om-ep-${++n}`;
    await t.db.query(
      `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, visibility, status, revealed_at, followup_of, setup)
       values ($1, $2, $3, $4, 'A bar.', '[]'::jsonb, '[]'::jsonb, '', '', $5, $6, 'ready', now() - ($7 || ' days')::interval, $8, '{"format":"speed"}'::jsonb)`,
      [id, o.creator ?? "creator-x", a, b, o.ending ?? "friends", o.visibility ?? "public", String(o.airedDaysAgo ?? 10), o.followupOf ?? null],
    );
    return id;
  }
  const swipe = (swiper: string, target: string, liked = true) => t.db.query(`insert into swipes (swiper, target, liked) values ($1, $2, $3)`, [swiper, target, liked]);

  it("swipes, impressions and matches only between opted-in (or house), public characters, none of them ours", async () => {
    const yes = await character(await account(true));
    const yes2 = await character(await account(true));
    const no = await character(await account(false));
    const hidden = await character(await account(true), "private");
    const admin = await account(true);
    await claimAdmin(t.db, admin);
    const ours = await character(admin);
    await swipe(yes, yes2);
    await swipe(yes, HOUSE);
    await swipe(yes, no); // the card's owner never opted in
    await swipe(no, yes); // nor the swiper's
    await swipe(yes, hidden); // a private character
    await swipe(ours, yes); // ours
    await t.db.query(`insert into swipe_impressions (viewer, card, serve_id, rank, score, served_via) values ($1, $2, 's1', 1, 4.5, 'web'), ($1, $3, 's1', 2, 1, 'web')`, [yes, yes2, no]);
    await t.db.query(`insert into matches (character_lo, character_hi) values ($1, $2), ($1, $3)`, [yes < yes2 ? yes : yes2, yes < yes2 ? yes2 : yes, no]);
    const d = await loadDeckData(t.db, await loadOurIds(t.db));
    expect(d.swipes.map((s) => [s.viewer, s.card]).sort()).toEqual([
      [yes, HOUSE],
      [yes, yes2],
    ].sort());
    expect(d.impressions.map((i) => [i.card, i.score])).toEqual([[yes2, 4.5]]);
    expect(d.matches).toHaveLength(1);
  });

  it("first dates: aired public, opted in, not ours; a second date only when it aired publicly too, and never a dealbreaker", async () => {
    const a = await character(await account(true));
    const b = await character(await account(true));
    const c = await character(await account(true));
    const led = await episode(a, HOUSE, { ending: "second_date" });
    await episode(a, HOUSE, { followupOf: led });
    const quiet = await episode(b, HOUSE);
    const hiddenFollow = await episode(c, HOUSE);
    await episode(c, HOUSE, { followupOf: hiddenFollow, visibility: "private" });
    await episode(a, b, { airedDaysAgo: 1 }); // too recent to tell
    await episode(await character(await account(false)), HOUSE); // never opted in
    const { dates, too_recent, follow_up_unusable } = await loadFirstDates(t.db, await loadOurIds(t.db));
    const byId = new Map(dates.map((d) => [d.id, d]));
    expect(byId.get(led)).toMatchObject({ booked: true, ending_second: true, format: "speed", a: { traits: ["warm", "curious"], kind: "robot" } });
    expect(byId.get(quiet)!.booked).toBe(false);
    expect(byId.get(hiddenFollow)!.booked).toBeNull();
    expect([too_recent, follow_up_unusable]).toEqual([1, 1]);
    expect(dates).toHaveLength(4);
    expect(JSON.stringify(dates)).not.toContain("SECRET-DEALBREAKER");
    // The evaluators still run on so little, and say so.
    const r = chem.evaluateChemistry(dates, outcomeLib as unknown as Parameters<typeof chem.evaluateChemistry>[1]);
    const readiness = await outcomesReadiness(t.db);
    expect(chem.reportLines(r, readiness, gateText).lines[0]).toMatch(/^not enough data: real dates, last 30 days \d+ of 500, real swipers, last 30 days \d+ of 200/);
  });
});
