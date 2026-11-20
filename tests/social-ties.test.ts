import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { layerOfDated } from "@/lib/social/kinds";
import { addPerson } from "@/lib/social/people";
import { endTie, findTie, getTie, logContact, removeTie, reviveTie, safely, setStatus, tieEvents, tieIdOf, upsertTie } from "@/lib/social/ties";
import type { Tie, TieWrite } from "@/lib/social/types";
import { startTestDb } from "./helpers";

// The tie store's write layer (lib/social/ties.ts, docs/PRDs/social-network.md sections 4 and 5.2-5.3): one row a pair
// a kind, idempotent writes, evidence capped newest first, an event for every change, declared beats derived, the
// exclusive kinds, and the switch.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});

const [A, B, C, D, E] = HOUSE_CHARACTERS.map((c) => c.id);
const ON = {};
const at = (minute: number) => new Date(Date.UTC(2026, 10, 1, 12, minute)).toISOString();
const ok = (w: TieWrite): Tie => {
  if (!w.ok) throw new Error(`refused: ${w.reason}`);
  return w.tie;
};
const events = async (tie: Tie) => (await tieEvents(t.db, tie.id)).map((e) => e.event);

describe("upsertTie", () => {
  it("creates a tie with its kind's defaults, logs it, and does nothing the second time", async () => {
    const first = await upsertTie(t.db, { from: B, to: A, kind: "friend", source: "house", story: "Met at a pub quiz." }, ON);
    expect(first).toMatchObject({ ok: true, event: "created" });
    const tie = ok(first);
    expect(tie).toMatchObject({ from_id: [A, B].sort()[0], to_id: [A, B].sort()[1], kind: "friend", layer: "friendship", directed: false, valence: 1, closeness: 0.5, status: "active", visibility: "public", source: "house", story: "Met at a pub quiz.", evidence: [] });
    expect(tie.id).toBe(tieIdOf({ from: A, to: B, kind: "friend" }));
    const again = await upsertTie(t.db, { from: A, to: B, kind: "friend", source: "house", story: "Met at a pub quiz." }, ON);
    expect(again).toMatchObject({ ok: true, event: null });
    expect(await events(tie)).toEqual(["created"]);
    const log = await tieEvents(t.db, tie.id);
    expect(log[0]).toMatchObject({ source: "house", actor: "system" });
    expect(log[0].changes).toMatchObject({ layer: [null, "friendship"], valence: [null, 1], story: [null, "Met at a pub quiz."] });
    expect(await findTie(t.db, { from: B, to: A, kind: "friend" })).toEqual(tie);
    expect(await getTie(t.db, tie.id)).toEqual(tie);
  });

  it("keeps the newest twenty pieces of evidence, each once, and logs one that adds nothing else as contact", async () => {
    let tie = ok(await upsertTie(t.db, { from: A, to: B, kind: "dated", source: "derived", evidence: { ref: "episode:1", at: at(1) } }, ON));
    expect(tie).toMatchObject({ source_ref: "episode:1", last_contact_at: at(1), started_at: at(1) });
    for (let n = 2; n <= 25; n++) {
      const w = await upsertTie(t.db, { from: B, to: A, kind: "dated", source: "derived", evidence: { ref: `episode:${n}`, at: at(n) } }, ON);
      expect(w).toMatchObject({ ok: true, event: "contact" });
      tie = ok(w);
    }
    expect(tie.evidence).toHaveLength(20);
    expect(tie.evidence.map((e) => e.ref)).toEqual(Array.from({ length: 20 }, (_, i) => `episode:${25 - i}`));
    expect(tie).toMatchObject({ source_ref: "episode:25", last_contact_at: at(25) });
    // The same evidence again is a no-op; one older than the twenty kept is too.
    expect(await upsertTie(t.db, { from: A, to: B, kind: "dated", source: "derived", evidence: { ref: "episode:25", at: at(25) } }, ON)).toMatchObject({ event: null });
    expect(await upsertTie(t.db, { from: A, to: B, kind: "dated", source: "derived", evidence: { ref: "episode:0", at: at(0) } }, ON)).toMatchObject({ event: null });
    const log = await events(tie);
    expect(log).toEqual(["created", ...Array(24).fill("contact")]);
    // An older piece that still makes the twenty doesn't move the last contact back, and the ref is the newest one.
    const older = ok(await upsertTie(t.db, { from: A, to: B, kind: "dated", source: "derived", evidence: { ref: "scene:s1", at: new Date(Date.UTC(2026, 10, 1, 12, 10, 30)).toISOString() } }, ON));
    expect(older).toMatchObject({ last_contact_at: at(25), source_ref: "episode:25" });
    expect(older.evidence.map((e) => e.ref)).toContain("scene:s1");
    expect(older.evidence.map((e) => e.ref)).not.toContain("episode:6");
  });

  it("logs a change with each field's [from, to], merging detail key by key", async () => {
    const tie = ok(await upsertTie(t.db, { from: A, to: B, kind: "dated", source: "derived", layer: layerOfDated("dating"), valence: 1, detail: { stage: "dating", dates: 2 } }, ON));
    expect(tie.layer).toBe("romance");
    const w = await upsertTie(t.db, { from: A, to: B, kind: "dated", source: "derived", layer: layerOfDated("friends"), detail: { stage: "friends" }, closeness: 0.62 }, ON);
    expect(w).toMatchObject({ ok: true, event: "changed" });
    expect(ok(w)).toMatchObject({ layer: "friendship", closeness: 0.62, detail: { stage: "friends", dates: 2 } });
    const log = await tieEvents(t.db, tie.id);
    expect(log.map((e) => e.event)).toEqual(["created", "changed"]);
    expect(log[1].changes).toEqual({ layer: ["romance", "friendship"], closeness: [0.3, 0.62], "detail.stage": ["dating", "friends"] });
    // Another kind's layer is always its registry's, whatever a write says.
    expect(ok(await upsertTie(t.db, { from: A, to: C, kind: "friend", source: "house", layer: "conflict" }, ON)).layer).toBe("friendship");
  });

  it("never puts a person's id in the log's changes: the actor says who", async () => {
    const tie = ok(await upsertTie(t.db, { from: A, to: B, kind: "sibling", source: "owner", created_by: "user-1" }, ON));
    expect(tie.created_by).toBe("user-1");
    await upsertTie(t.db, { from: A, to: B, kind: "sibling", source: "owner", story: "Twins, by about ten minutes.", actor: "user-2" }, ON);
    const log = await tieEvents(t.db, tie.id);
    expect(log.map((e) => [e.event, e.actor])).toEqual([
      ["created", "user-1"],
      ["changed", "user-2"],
    ]);
    expect(JSON.stringify(log.map((e) => e.changes))).not.toMatch(/user-/);
  });

  it("keeps what someone declared when what aired writes over it, and makes a derived tie theirs when they declare it", async () => {
    // Declared first: a derived write brings its evidence and detail, never its own valence, story or visibility.
    const declared = ok(await upsertTie(t.db, { from: A, to: B, kind: "rival", source: "owner", valence: -2, story: "Same lighthouse, two bids.", visibility: "owner", created_by: "user-1" }, ON));
    const over = ok(await upsertTie(t.db, { from: A, to: B, kind: "rival", source: "derived", valence: -1, story: null, visibility: "public", status: "ended", detail: { beat: true }, evidence: { ref: "beat:b1", at: at(5) } }, ON));
    expect(over).toMatchObject({ source: "owner", valence: -2, story: "Same lighthouse, two bids.", visibility: "owner", status: "active", created_by: "user-1", detail: { beat: true } });
    expect(over.evidence.map((e) => e.ref)).toEqual(["beat:b1"]);
    expect(await events(declared)).toEqual(["created", "changed"]);
    // Derived first: a declaration takes it over, source and all.
    const aired = ok(await upsertTie(t.db, { from: A, to: C, kind: "rival", source: "derived", evidence: { ref: "beat:b2", at: at(6) } }, ON));
    const mine = ok(await upsertTie(t.db, { from: C, to: A, kind: "rival", source: "owner", story: "It started at school.", created_by: "user-1" }, ON));
    expect(mine).toMatchObject({ id: aired.id, source: "owner", created_by: "user-1", story: "It started at school." });
    expect(mine.evidence.map((e) => e.ref)).toEqual(["beat:b2"]);
  });

  it("refuses a kind past its cap, counting only the open ties, and lets an ended one come back only under it", async () => {
    ok(await upsertTie(t.db, { from: A, to: B, kind: "spouse", source: "house" }, ON));
    expect(await upsertTie(t.db, { from: A, to: C, kind: "spouse", source: "house" }, ON)).toEqual({ ok: false, reason: "exclusive" });
    expect(await upsertTie(t.db, { from: C, to: B, kind: "spouse", source: "house" }, ON)).toEqual({ ok: false, reason: "exclusive" });
    // A proposal counts too: two people can't both be asked to be someone's only spouse.
    expect(await upsertTie(t.db, { from: B, to: D, kind: "spouse", source: "owner", status: "proposed" }, ON)).toEqual({ ok: false, reason: "exclusive" });
    // An ended one doesn't count, and can't be revived while the end holds another.
    const first = (await findTie(t.db, { from: A, to: B, kind: "spouse" }))!;
    await endTie(t.db, first.id, { at: at(1) }, ON);
    const second = ok(await upsertTie(t.db, { from: A, to: C, kind: "spouse", source: "house" }, ON));
    expect(await reviveTie(t.db, first.id, {}, ON)).toEqual({ ok: false, reason: "exclusive" });
    expect(await upsertTie(t.db, { from: A, to: B, kind: "spouse", source: "house", status: "active" }, ON)).toEqual({ ok: false, reason: "exclusive" });
    await endTie(t.db, second.id, {}, ON);
    expect(await reviveTie(t.db, first.id, {}, ON)).toMatchObject({ ok: true, event: "revived" });
    // Three best friends, not four.
    for (const other of [B, C, D]) ok(await upsertTie(t.db, { from: A, to: other, kind: "best_friend", source: "house" }, ON));
    expect(await upsertTie(t.db, { from: A, to: E, kind: "best_friend", source: "house" }, ON)).toEqual({ ok: false, reason: "exclusive" });
    // A kind without a cap has none.
    for (const other of [B, C, D, E]) ok(await upsertTie(t.db, { from: A, to: other, kind: "friend", source: "house" }, ON));
  });

  it("refuses a tie to oneself, an unknown kind, too-long or unsafe words, and a person who isn't the holder's", async () => {
    expect(await upsertTie(t.db, { from: A, to: A, kind: "friend", source: "house" }, ON)).toEqual({ ok: false, reason: "self" });
    expect(await upsertTie(t.db, { from: A, to: B, kind: "archnemesis" as never, source: "house" }, ON)).toEqual({ ok: false, reason: "unknown_kind" });
    expect(await upsertTie(t.db, { from: A, to: B, kind: "friend", source: "owner", story: "x".repeat(241) }, ON)).toEqual({ ok: false, reason: "too_long" });
    expect(await upsertTie(t.db, { from: A, to: B, kind: "friend", source: "owner", since_text: "x".repeat(41) }, ON)).toEqual({ ok: false, reason: "too_long" });
    expect(await upsertTie(t.db, { from: A, to: B, kind: "friend", source: "owner", story: "She was only fifteen when they met." }, ON)).toEqual({ ok: false, reason: "unsafe" });
    const mum = await addPerson(t.db, { holderId: A, name: "Mum", source: "owner" }, ON);
    if (!mum.ok) throw new Error(mum.reason);
    expect(await upsertTie(t.db, { from: B, toPerson: mum.person.id, kind: "parent", source: "owner" }, ON)).toEqual({ ok: false, reason: "not_found" });
    const tie = ok(await upsertTie(t.db, { from: A, toPerson: mum.person.id, kind: "parent", source: "owner", since_text: "always" }, ON));
    expect(tie).toMatchObject({ from_id: A, to_id: null, to_person_id: mum.person.id, kind: "parent", directed: true, layer: "kin", since_text: "always" });
    expect((await t.db.query<{ n: number }>("select count(*)::int as n from social_ties")).rows[0].n).toBe(1);
  });

  it("writes nothing when the switch is off", async () => {
    expect(await upsertTie(t.db, { from: A, to: B, kind: "friend", source: "house" }, { SOCIAL_TIES: "0" })).toEqual({ ok: false, reason: "off" });
    expect(await addPerson(t.db, { holderId: A, name: "Mum", source: "owner" }, { SOCIAL_TIES: "0" })).toEqual({ ok: false, reason: "off" });
    expect((await t.db.query<{ n: number }>("select count(*)::int as n from social_ties")).rows[0].n).toBe(0);
    expect((await t.db.query<{ n: number }>("select count(*)::int as n from social_people")).rows[0].n).toBe(0);
  });

  it("lands both of two writes that race to make the same tie", async () => {
    const [x, y] = await Promise.all([
      upsertTie(t.db, { from: A, to: B, kind: "met_at_group_night", source: "derived", evidence: { ref: "night:n1", at: at(1) } }, ON),
      upsertTie(t.db, { from: B, to: A, kind: "met_at_group_night", source: "derived", evidence: { ref: "night:n2", at: at(2) } }, ON),
    ]);
    expect([x.ok, y.ok]).toEqual([true, true]);
    const tie = (await findTie(t.db, { from: A, to: B, kind: "met_at_group_night" }))!;
    expect(tie.evidence.map((e) => e.ref).sort()).toEqual(["night:n1", "night:n2"]);
    expect((await events(tie)).sort()).toEqual(["contact", "created"]);
  });
});

describe("status, contact and removal", () => {
  it("logs a proposal, its answer, an ending and a revival, and treats the same status again as a no-op", async () => {
    const proposed = ok(await upsertTie(t.db, { from: A, to: B, kind: "sibling", source: "owner", status: "proposed", created_by: "user-1" }, ON));
    expect(proposed.status).toBe("proposed");
    const accepted = await setStatus(t.db, proposed.id, "active", { answeredBy: "user-2", source: "owner" }, ON);
    expect(accepted).toMatchObject({ ok: true, event: "accepted" });
    expect(ok(accepted)).toMatchObject({ status: "active", answered_by: "user-2", created_by: "user-1" });
    expect(await setStatus(t.db, proposed.id, "active", {}, ON)).toMatchObject({ ok: true, event: null });
    const ended = ok(await endTie(t.db, proposed.id, { at: at(9) }, ON));
    expect(ended).toMatchObject({ status: "ended", ended_at: at(9) });
    const revived = ok(await reviveTie(t.db, proposed.id, {}, ON));
    expect(revived).toMatchObject({ status: "active", ended_at: null });
    const log = await tieEvents(t.db, proposed.id);
    expect(log.map((e) => [e.event, e.actor])).toEqual([
      ["proposed", "user-1"],
      ["accepted", "user-2"],
      ["ended", "system"],
      ["revived", "system"],
    ]);
    expect(log[1].changes).toEqual({ status: ["proposed", "active"] });
    // A proposal turned down, or one that lapsed (nobody answered).
    const other = ok(await upsertTie(t.db, { from: A, to: C, kind: "sibling", source: "owner", status: "proposed", created_by: "user-1" }, ON));
    expect(await setStatus(t.db, other.id, "declined", { answeredBy: null }, ON)).toMatchObject({ ok: true, event: "declined", tie: { status: "declined", answered_by: null } });
    expect(await setStatus(t.db, "tie_nope", "ended", {}, ON)).toEqual({ ok: false, reason: "not_found" });
  });

  it("records a contact once, moving the last contact forward and the closeness when given", async () => {
    const tie = ok(await upsertTie(t.db, { from: A, to: B, kind: "friend", source: "house" }, ON));
    const w = await logContact(t.db, tie.id, { ref: "scene:s1", at: at(3), source: "derived", closeness: 0.66 }, ON);
    expect(w).toMatchObject({ ok: true, event: "contact" });
    expect(ok(w)).toMatchObject({ last_contact_at: at(3), closeness: 0.66, source_ref: "scene:s1" });
    expect(await logContact(t.db, tie.id, { ref: "scene:s1", at: at(3) }, ON)).toMatchObject({ ok: true, event: null });
    expect(ok(await logContact(t.db, tie.id, { ref: "scene:s0", at: at(1) }, ON)).last_contact_at).toBe(at(3));
    expect(await logContact(t.db, "tie_nope", { ref: "scene:s1" }, ON)).toEqual({ ok: false, reason: "not_found" });
    expect(await events(tie)).toEqual(["created", "contact", "contact"]);
  });

  it("removes a tie with its history", async () => {
    const tie = ok(await upsertTie(t.db, { from: A, to: B, kind: "dated", source: "derived", evidence: { ref: "episode:1", at: at(1) } }, ON));
    expect(await removeTie(t.db, tie.id)).toBe(true);
    expect(await getTie(t.db, tie.id)).toBeNull();
    expect(await tieEvents(t.db, tie.id)).toEqual([]);
    expect(await removeTie(t.db, tie.id)).toBe(false);
  });
});

describe("safely", () => {
  it("runs the work, and gives null when the switch is off or it throws", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await safely("x", async () => 7, ON)).toBe(7);
    expect(await safely("x", async () => 7, { SOCIAL_TIES: "0" })).toBeNull();
    expect(
      await safely(
        "boom",
        async () => {
          throw new Error("nope");
        },
        ON,
      ),
    ).toBeNull();
    expect(error).toHaveBeenCalledWith("[social] boom failed:", "nope");
    error.mockRestore();
  });
});
