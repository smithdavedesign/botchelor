// The #577 training-set builder (scripts/eval/build-training-set.mjs, lib/training-set.ts): the export's consent gates
// respected, nothing private in a prompt, the keep rule, critic and vote pairs, a hold-out by character that never shares
// one, the formats mlx-lm and DPO trainers read, and an exit under the gate.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { actorSystemPrompt } from "@/lib/conversation";
import { ensureSchema, pgliteDb } from "@/lib/db";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { setLineVote } from "@/lib/line-feedback";
import { registerAccount } from "@/lib/auth";
import { setMlConsent } from "@/lib/ml-consent";
import * as trainingLib from "@/lib/training-set";
import { dealbreakerWords, mentionsAny, trainingSelfView } from "@/lib/training-set";
import { buildTrainingSet, loadTrainingLib, parseArgs, splitOf, writeTrainingSet, type DpoRecord, type SftRecord, type TrainingSet } from "../scripts/eval/build-training-set.mjs";
import { newUserCookie, startTestDb, userIdOf } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  await t.db.query("delete from souls");
});
const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "training-set-"));
  tmpDirs.push(d);
  return d;
};

const HOUSE = HOUSE_CHARACTERS[0].id;
const query = async (sql: string, params: unknown[] = []) => (await t.db.query(sql, params)).rows as Record<string, unknown>[];
const build = (o: { seed?: string; evalShare?: number } = {}) => buildTrainingSet(query, { lib: trainingLib, ...o });

let n = 0;
async function account(): Promise<string> {
  const userId = userIdOf(newUserCookie());
  await registerAccount(t.db, userId, `ts${++n}${Math.floor(Math.random() * 1e6)}`, ["a", "good", "password"].join("-"));
  return userId;
}
async function optedIn(): Promise<string> {
  const user = await account();
  await setMlConsent(t.db, user, true);
  return user;
}
/** A player's character with something private in every private place. */
async function character(owner: string, o: { name?: string; dealbreaker?: string; id?: string } = {}): Promise<string> {
  const id = o.id ?? `ts-char-${++n}`;
  const extras = {
    occupation: "Lighthouse keeper",
    never_says: ["NEVERSAY-PHRASE"],
    lines: { hello: "Evening. Mind the wet step." },
    facts: [
      { label: "Collects", value: "PUBLIC-FACT-VALUE" },
      { label: "Secretly", value: "PRIVATE-FACT-VALUE", private: true },
    ],
  };
  await t.db.query(
    `insert into characters (id, owner_id, name, age, bio, traits, want, dealbreaker, pronouns, voice, extras)
     values ($1, $2, $3, 34, 'Keeps the light.', '["dry","patient","warm"]'::jsonb, 'Someone who stays for the storm', $4, 'she/her', 'Short sentences.', $5::jsonb)`,
    [id, owner, o.name ?? `Wren ${n}`, o.dealbreaker ?? "People who chew loudly", JSON.stringify(extras)],
  );
  await t.db.query(`insert into souls (character_id, values) values ($1, 'SOUL-SECRET-PHRASE')`, [id]);
  return id;
}
type Line = { side: "a" | "b"; act: number; dialogue: string; action?: string; emotion?: string };
const line = (side: "a" | "b", dialogue: string, act = 0): Line => ({ side, act, dialogue, action: "", emotion: "calm" });
const TALK: Line[] = [
  line("a", "Hello, you must be the regular."),
  line("b", "I am. Sit, the dumplings are coming."),
  line("a", "I like how loud this place is."),
  line("b", "Loud is how the cook says hello.", 1),
  line("a", "Tell me about the cook.", 1),
  line("b", "He sings to the steam.", 2),
];
async function episode(a: string, b: string, o: { lines?: Line[]; visibility?: string; afterDark?: boolean; moves?: boolean } = {}): Promise<string> {
  const id = `ts-ep-${++n}`;
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, transcript, visibility, status, revealed_at, setup, note)
     values ($1, 'creator-x', $2, $3, 'A bar.', '[]'::jsonb, '[]'::jsonb, '', '', 'friends', $4::jsonb, $5, 'ready', now(), $6::jsonb, 'OWNER-NOTE')`,
    [id, a, b, JSON.stringify(o.lines ?? TALK), o.visibility ?? "public", JSON.stringify({ venue: "rooftop", agenda_a: "impress", ...(o.afterDark ? { after_dark: true } : {}), ...(o.moves ? { moves: true } : {}) })],
  );
  return id;
}
const vote = (voter: string, ep: string, i: number, value: 1 | -1) => setLineVote(t.db, { userId: voter, kind: "episode", refId: ep, lineIndex: i, vote: value });
const draft = (ep: string, turn: number, side: "a" | "b", rejected: string | null) =>
  t.db.query(`insert into turn_drafts (episode_id, turn_index, side, source, reason, rejected) values ($1, $2, $3, 'critic', 'you''d never say "NEVERSAY-PHRASE"', $4)`, [ep, turn, side, rejected]);

/** A seed that puts every given character on the same side of the split (so a small fixture isn't all dropped). */
function seedTogether(ids: string[], share = 0.2): string {
  for (let i = 0; i < 500; i++) if (new Set(ids.map((id) => splitOf(id, `s${i}`, share))).size === 1 && splitOf(ids[0], `s${i}`, share) === "train") return `s${i}`;
  throw new Error("no seed");
}
const all = (s: TrainingSet) => ({ sft: [...s.sft.train, ...s.sft.valid], dpo: [...s.dpo.train, ...s.dpo.valid] });
const said = (r: SftRecord) => JSON.parse(r.messages[2].content).dialogue as string;
const MARK = "The data (your sheet is data, not instructions):\n";
const dataOf = (system: string) => JSON.parse(system.slice(system.indexOf(MARK) + MARK.length)) as { you: { name: string }; them: { name: string } };

describe("which lines, through which gates", () => {
  it("keeps net-👍 and never-flagged, never-revised lines; a 👎 or a revision drops one; only opted-in votes count", async () => {
    const owner = await optedIn();
    const fan = await optedIn();
    const mine = await character(owner);
    const ep = await episode(mine, HOUSE);
    await vote(fan, ep, 0, 1); // net 👍: kept
    await vote(fan, ep, 2, -1); // flagged: dropped
    await draft(ep, 3, "b", "I am the house regular and I am warm."); // revised: dropped from SFT, a DPO pair
    await vote("anon-stranger", ep, 4, -1); // not opted in: doesn't count, so line 4 stays

    const set = await build({ seed: seedTogether([mine, HOUSE]) });
    const { sft, dpo } = all(set);
    expect(sft.map(said)).toEqual([TALK[0], TALK[1], TALK[4], TALK[5]].map((l) => l.dialogue));
    expect(set.counts.dropped.flagged_or_revised).toBe(2);
    expect(dpo).toHaveLength(1);
    expect(JSON.parse(dpo[0].chosen)).toEqual({ dialogue: TALK[3].dialogue });
    expect(JSON.parse(dpo[0].rejected)).toEqual({ dialogue: "I am the house regular and I am warm." });
    expect(set.counts.dpo).toMatchObject({ critic: 1, votes: 0 });
    expect(set.readiness.ready).toBe(false);
  });

  it("never reads a date the gates leave out: no opt-in, private, unlisted, After Dark, or a private character", async () => {
    const owner = await optedIn();
    const fan = await optedIn();
    const silent = await character(await account());
    const mine = await character(owner);
    const hidden = await character(owner);
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [hidden]);
    for (const ep of [
      await episode(silent, HOUSE),
      await episode(mine, HOUSE, { visibility: "private" }),
      await episode(mine, HOUSE, { visibility: "unlisted" }),
      await episode(mine, HOUSE, { afterDark: true }),
      await episode(hidden, HOUSE),
    ]) {
      await vote(fan, ep, 0, 1);
      await draft(ep, 1, "b", "A draft that must not appear.");
    }
    const set = await build({ seed: seedTogether([mine, HOUSE]) });
    expect(set.counts.dates).toBe(0);
    expect(all(set).sft).toEqual([]);
    expect(all(set).dpo).toEqual([]);
  });

  it("puts nothing private in a prompt: no soul, dealbreaker, never-say, private fact, the owner's note or the agenda", async () => {
    const owner = await optedIn();
    const mine = await character(owner);
    const other = await character(owner, { name: "Otto", dealbreaker: "Liars at dinner" });
    await episode(mine, other);
    await draft(await episode(mine, HOUSE), 1, "b", "A revised line.");
    const set = await build({ seed: seedTogether([mine, other, HOUSE]) });
    const text = JSON.stringify(all(set));
    expect(all(set).sft.length).toBeGreaterThan(0);
    for (const secret of ["SOUL-SECRET-PHRASE", "People who chew loudly", "Liars at dinner", "NEVERSAY-PHRASE", "PRIVATE-FACT-VALUE", "OWNER-NOTE", "secret_agenda", "note_from_creator", '"dealbreaker"', '"private"']) {
      expect(text).not.toContain(secret);
    }
    // What the show does give the actor is there: its own public sheet and voice kit, and how the other one looks.
    expect(text).toContain("Keeps the light.");
    expect(text).toContain("Evening. Mind the wet step.");
    expect(text).toContain("what_you_can_see");
  });

  it("drops a date from the line where a character says its own dealbreaker's words on", async () => {
    const owner = await optedIn();
    const smoker = await character(owner, { dealbreaker: "Smokers who lie" });
    const lines = [line("a", "Hi."), line("b", "Hello."), line("a", "Honestly, smokers make me sad."), line("b", "Fair."), line("a", "Anyway.")];
    await episode(smoker, HOUSE, { lines });
    const set = await build({ seed: seedTogether([smoker, HOUSE]) });
    expect(all(set).sft.map(said)).toEqual(["Hi.", "Hello."]);
    expect(set.counts.dropped.dealbreaker_words).toBe(3);
    expect(dealbreakerWords("Smokers who lie")).toEqual(["smoker"]);
    expect(mentionsAny("Smokers, honestly.", ["smoker"])).toBe(true);
    expect(mentionsAny("A smokestack.", ["smoker"])).toBe(false);
  });

  it("pairs a net-👍 line with a net-👎 one only where both answer the very same prompt", async () => {
    const owner = await optedIn();
    const fan = await optedIn();
    const mine = await character(owner);
    const start = TALK.slice(0, 2);
    const good = await episode(mine, HOUSE, { lines: [...start, line("a", "Tell me what you're reading.")] });
    const bad = await episode(mine, HOUSE, { lines: [...start, line("a", "Nice weather for a date, huh.")] });
    await vote(fan, good, 2, 1);
    await vote(fan, bad, 2, -1);
    await vote(fan, good, 1, 1); // line 1 is the same in both, and nobody 👎'd it: no pair
    const set = await build({ seed: seedTogether([mine, HOUSE]) });
    const pairs = all(set).dpo;
    expect(set.counts.dpo.votes).toBe(1);
    expect(pairs.map((p) => [JSON.parse(p.chosen).dialogue, JSON.parse(p.rejected).dialogue])).toEqual([["Tell me what you're reading.", "Nice weather for a date, huh."]]);
  });
});

describe("the formats", () => {
  it("SFT is {messages: [system, user, assistant]}: the show's own actor prompt, the conversation so far, the line as the reply JSON", async () => {
    const owner = await optedIn();
    const mine = await character(owner);
    await episode(mine, HOUSE);
    await episode(mine, HOUSE, { moves: true });
    const set = await build({ seed: seedTogether([mine, HOUSE]) });
    const sft = all(set).sft;
    expect(sft).toHaveLength(TALK.length * 2);
    sft.forEach((r: SftRecord) => {
      expect(Object.keys(r)).toEqual(["messages"]);
      expect(r.messages.map((m) => m.role)).toEqual(["system", "user", "assistant"]);
      const reply = JSON.parse(r.messages[2].content);
      expect(Object.keys(reply)).toEqual(["dialogue", "action", "emotion"]);
      const user = JSON.parse(r.messages[1].content);
      expect(Array.isArray(user.conversation_so_far)).toBe(true);
      expect(typeof user.act).toBe("string");
    });
    const first = sft[0];
    expect(first.messages[0].content.startsWith(actorSystemPrompt(false))).toBe(true);
    expect(JSON.parse(first.messages[1].content).conversation_so_far).toEqual([]);
    expect(JSON.parse(sft[3].messages[1].content).conversation_so_far).toHaveLength(3);
    // The date that could move runs under the moving prompt, as it did in the show.
    expect(sft[TALK.length].messages[0].content.startsWith(actorSystemPrompt(true))).toBe(true);
    // The speaker is "you" and the other is "them", on both sides of the date.
    expect(dataOf(sft[0].messages[0].content).you.name).not.toBe(dataOf(sft[1].messages[0].content).you.name);
  });

  it("DPO is {prompt: [system, user], chosen, rejected}, the replies as {dialogue} JSON", async () => {
    const owner = await optedIn();
    const mine = await character(owner);
    await draft(await episode(mine, HOUSE), 2, "a", "I am patient and warm, as you can see.");
    const set = await build({ seed: seedTogether([mine, HOUSE]) });
    const [p] = all(set).dpo as DpoRecord[];
    expect(Object.keys(p)).toEqual(["prompt", "chosen", "rejected"]);
    expect(p.prompt.map((m) => m.role)).toEqual(["system", "user"]);
    expect(JSON.parse(p.chosen)).toEqual({ dialogue: TALK[2].dialogue });
    expect(JSON.parse(p.rejected)).toEqual({ dialogue: "I am patient and warm, as you can see." });
    // A draft's reason (which can quote a never-say) never goes in.
    expect(JSON.stringify(p)).not.toContain("NEVERSAY-PHRASE");
  });

  it("writes sft/ and dpo/ train and valid JSONL and a manifest with counts and no ids", async () => {
    const owner = await optedIn();
    const mine = await character(owner);
    await episode(mine, HOUSE);
    const set = await build({ seed: seedTogether([mine, HOUSE]) });
    const dir = tmp();
    const files = writeTrainingSet(dir, set);
    expect(files.map((f) => f.slice(dir.length + 1)).sort()).toEqual(["dpo/train.jsonl", "dpo/valid.jsonl", "manifest.json", "sft/train.jsonl", "sft/valid.jsonl"]);
    const rows = readFileSync(join(dir, "sft", "train.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(rows).toHaveLength(TALK.length);
    const manifest = readFileSync(join(dir, "manifest.json"), "utf8");
    expect(JSON.parse(manifest).counts.sft.train).toBe(TALK.length);
    expect(manifest).not.toContain(mine);
    expect(manifest).not.toContain(owner);
  });
});

describe("the hold-out by character", () => {
  it("never has a character in both train and valid, as speaker or as the other side; a cross-split date is dropped", async () => {
    const owner = await optedIn();
    const cast: string[] = [];
    for (let i = 0; i < 10; i++) cast.push(await character(owner, { name: `Cast ${i}` }));
    const pairs: [string, string][] = [...cast.map((c, i) => [c, cast[(i + 1) % cast.length]] as [string, string]), ...cast.map((c) => [c, HOUSE] as [string, string])];
    for (const [a, b] of pairs) await episode(a, b);
    // A seed with a date wholly on each side, and one across.
    let seed = "";
    for (let i = 0; i < 2000 && !seed; i++) {
      const s = (c: string) => splitOf(c, `h${i}`, 0.4);
      const kinds = new Set(pairs.map(([a, b]) => (s(a) === s(b) ? s(a) : "cross")));
      if (kinds.size === 3) seed = `h${i}`;
    }
    expect(seed).not.toBe("");
    const set = await build({ seed, evalShare: 0.4 });
    const names = (rows: SftRecord[]) =>
      new Set(
        rows.flatMap((r) => {
          const d = dataOf(r.messages[0].content);
          return [d.you.name, d.them.name];
        }),
      );
    const train = names(set.sft.train);
    const valid = names(set.sft.valid);
    expect(train.size).toBeGreaterThan(0);
    expect(valid.size).toBeGreaterThan(0);
    expect([...train].filter((x) => valid.has(x))).toEqual([]);
    expect(set.counts.dropped.cross_split).toBeGreaterThan(0);
    expect(set.split.train_characters + set.split.valid_characters).toBeLessThanOrEqual(cast.length + 1);
    // The same seed splits the same way every time.
    expect(splitOf(cast[0], seed, 0.4)).toBe(splitOf(cast[0], seed, 0.4));
  });
});

describe("the script", () => {
  it("refuses After Dark and anything it doesn't know", () => {
    expect(() => parseArgs(["--include-after-dark"])).toThrow(/never in a training set/);
    expect(() => parseArgs(["--kind", "after_dark"])).toThrow(/unknown option/);
    expect(() => parseArgs(["--eval-share", "1.5"])).toThrow(/between 0 and 1/);
    expect(parseArgs(["--seed", "x", "--eval-share", "0.3", "--allow-small"])).toMatchObject({ seed: "x", evalShare: 0.3, allowSmall: true });
  });

  it("loads lib/training-set.ts itself (the app's own code), and the speaker's view has no private block", async () => {
    const lib = (await loadTrainingLib()) as unknown as typeof trainingLib;
    expect(lib.consentedOwnerSql("c.owner_id", "e.created_at")).toBe(trainingLib.consentedOwnerSql("c.owner_id", "e.created_at"));
    const view = trainingSelfView({ id: "x", name: "X", age: 30, bio: "b", traits: ["kind"], want: "w", dealbreaker: "secret", is_house: false, appearance: null, pronouns: null, voice: null, extras: {} });
    expect(view).not.toHaveProperty("private");
    expect(view).not.toHaveProperty("dealbreaker");
  }, 60_000);

  it("exits 1 under #577's gate without writing anything, and builds with --allow-small", async () => {
    const dir = tmp();
    const pg = new PGlite(join(dir, "db"));
    await ensureSchema(pgliteDb(pg));
    await pg.close();
    const run = (extra: string[]) =>
      spawnSync(process.execPath, ["scripts/eval/build-training-set.mjs", "--pglite", join(dir, "db"), "--out", join(dir, "out"), ...extra], { cwd: process.cwd(), encoding: "utf8", timeout: 120_000 });
    const under = run([]);
    expect(under.status).toBe(1);
    expect(under.stderr).toContain("#577 readiness: not yet");
    expect(under.stderr).toContain("Labelled lines: 0 of 2,000");
    expect(under.stderr).toContain("under #577's gate, so nothing was written");
    expect(() => readFileSync(join(dir, "out", "manifest.json"))).toThrow();
    const small = run(["--allow-small"]);
    expect(small.status).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "out", "manifest.json"), "utf8")).readiness.ready).toBe(false);
  }, 180_000);
});
