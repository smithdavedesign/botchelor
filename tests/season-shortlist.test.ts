import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HIVE_VLM, setCheckFetchForTests } from "@/lib/adult/check";
import { setMediaFetchForTests } from "@/lib/adult/media";
import { saveAdultSettings } from "@/lib/adult/settings";
import { loadCharacter } from "@/lib/character";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { getDirectorModel, type Model } from "@/lib/model";
import { resetStoredSeasonCastForTests, setSeasonCastForTests } from "@/lib/season-cast";
import { draftMessages, listCandidates } from "@/lib/season-gen";
import { addShortlistCandidate, applySeed, seedOf, SHORTLIST_NAMES, shortlistSpark } from "@/lib/season-shortlist";
import { SPARKS } from "@/lib/sparks";
import { scriptedModel, startTestDb } from "./helpers";

// The producers' shortlist (lib/season-shortlist.ts): hand-written contestants put up beside the generated ones.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  setSeasonCastForTests(HOUSE_CHARACTERS.map((c) => c.id));
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  resetStoredSeasonCastForTests();
  vi.stubEnv("SESSION_SECRET", "a-test-session-secret-that-is-long-enough-0123456789");
});
afterEach(() => {
  vi.unstubAllEnvs();
  setMediaFetchForTests(null);
  setCheckFetchForTests(null);
});

const script = (outputs: string[]): Model => {
  scriptedModel(outputs);
  return getDirectorModel();
};

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString("base64");
function fakeProviders() {
  setMediaFetchForTests(async () => Response.json({ images: [PNG] }));
  setCheckFetchForTests(async (input: RequestInfo | URL) =>
    Response.json(
      String(input) === HIVE_VLM
        ? { choices: [{ message: { content: "ADULTS" } }] }
        : { output: [{ classes: [{ class: "yes_child_present", value: 0.01 }, { class: "no_child_present", value: 0.99 }] }] },
    ),
  );
}

/** What the model writes back: its own words for the producers' fields (which are put back), and the rest of the sheet. */
function modelDraft(name: string) {
  return JSON.stringify({
    name,
    age: 52,
    pronouns: "they/them",
    bio: "Something the model made up instead of the producers' bio, long enough to pass the check.",
    traits: ["loud", "brash", "sunny"],
    want: "Something else entirely",
    dealbreaker: "Something else again",
    archetype: "The quiet witness",
    voice: "A voice the model invented, which the producers' version replaces once it's saved.",
    appearance: "not what the producers wrote",
    look: "a person in their late twenties with pale skin, a dark bob and a long charcoal coat",
    hue: 10,
    signals: { warmth: 0.6, openness: 0.3, guardedness: 0.7, humor: 0.4 },
    soul: {
      values: "Honesty, even the uncomfortable kind.",
      insecurities: "That nothing they feel is their own.",
      humor: "Bone-dry, and late.",
      boundaries: "Don't ask them to cry for you.",
      romantic: "Wants one evening that isn't a performance.",
      communication: "Says little, means all of it.",
    },
    kit: { occupation: "Professional mourner", hobbies: ["Films", "Walks", "Letters"], lines: { hello: "Hello." }, tells: { nervous: "fold a tissue" }, never_says: ["whatever"] },
  });
}

describe("the shortlist", () => {
  it("is four of the builder's sparks, each a sheet the house can take", () => {
    expect(SHORTLIST_NAMES).toHaveLength(4);
    for (const name of SHORTLIST_NAMES) expect(SPARKS.some((s) => s.name === name), name).toBe(true);
    expect(shortlistSpark("Doloria Quick")).toBeNull();
    // A 900-year-old god is drawn as an adult the house allows.
    expect(seedOf(shortlistSpark("Hosmund")!).age).toBe(65);
    expect(seedOf(shortlistSpark("Hosmund")!).kind_label).toBe("Minor god");
  });

  it("hands the model the producers' sketch to keep", () => {
    const system = String(draftMessages([], { seed: seedOf(shortlistSpark("Maren Halloway")!) })[0]!.content);
    expect(system).toContain("The producers already sketched this contestant");
    expect(system).toContain("A professional mourner for hire");
  });

  it("puts one up as a pending candidate, keeping the producers' words, with a checked portrait", async () => {
    await saveAdultSettings(t.db, { venice_key: "placeholder-venice", hive_key: "placeholder-hive", moderation: { pg_via: "hive" } });
    fakeProviders();
    const spark = shortlistSpark("Maren Halloway")!;
    const r = await addShortlistCandidate(t.db, "2026-12-01", spark.name, script([modelDraft(spark.name)]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = await loadCharacter(t.db, r.id);
    expect(c?.name).toBe(spark.name);
    expect(c?.bio).toBe(spark.bio);
    expect(c?.voice).toBe(spark.voice);
    const cands = await listCandidates(t.db, "2026-12-01");
    expect(cands.map((x) => [x.name, x.status, x.archetype])).toEqual([[spark.name, "pending", "The quiet witness"]]);
    expect(r.portrait).toMatch(/^made/);
  });

  it("never puts the same one up twice, and refuses a name that isn't on it", async () => {
    const spark = shortlistSpark("Dash Moreno")!;
    const first = await addShortlistCandidate(t.db, "2026-12-01", spark.name, script([modelDraft(spark.name)]));
    expect(first.ok).toBe(true);
    const again = await addShortlistCandidate(t.db, "2026-12-01", spark.name, script([modelDraft(spark.name)]));
    expect(again).toEqual({ ok: false, reason: expect.stringContaining("already") });
    expect(await addShortlistCandidate(t.db, "2026-12-01", "Doloria Quick")).toEqual({ ok: false, reason: expect.stringContaining("isn't on the shortlist") });
  });

  it("puts the spark's own kit over the model's", () => {
    const spark = shortlistSpark("Hennie Okonkwo-Vale")!;
    const parsed = JSON.parse(modelDraft(spark.name));
    const d = applySeed(parsed, spark);
    expect(d.kit.lines).toEqual(spark.extras.lines);
    expect(d.kit.occupation).toBe("Professional mourner");
    expect(d.traits).toEqual([...spark.traits]);
  });
});
