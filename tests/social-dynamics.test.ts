// The living network (lib/social/dynamics.ts; docs/PRDs/social-network.md section 7): closeness replayed from a tie's
// log, lifted by aired contact on any of the pair's ties, decayed by its kind's half-life, and a friendship that fades
// below 0.15 ending as `decayed` with the pair made old friends. Idempotent per day; kin, dated and off-screen people
// stay as they are; the switch.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { HOUSE_CHARACTERS } from "@/lib/house";
import {
  CONTACT_GAIN,
  FADED_BELOW,
  fadedAt,
  lift,
  replayCloseness,
  replayEventsOf,
  runSocialDynamics,
  socialDynamicsOn,
  type ReplayEvent,
} from "@/lib/social/dynamics";
import { addPerson } from "@/lib/social/people";
import { findTie, getTie, tieEvents, upsertTie } from "@/lib/social/ties";
import type { Tie, TieWrite } from "@/lib/social/types";
import { startTestDb } from "./helpers";

const DAY = 24 * 60 * 60 * 1000;
const day = (iso: string) => new Date(`${iso}T12:00:00.000Z`);
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const half = (c: number, days: number, h: number) => c * 0.5 ** (days / h);

describe("replayCloseness (pure)", () => {
  const set = (at: string, closeness: number): ReplayEvent => ({ at: day(at).toISOString(), closeness, contact: false });
  const contact = (at: string): ReplayEvent => ({ at: day(at).toISOString(), closeness: null, contact: true });

  it("decays from the last value set by the kind's half-life, and kin never decays", () => {
    expect(replayCloseness([set("2026-01-01", 0.5)], 120, day("2026-05-01"))).toBe(0.25);
    expect(replayCloseness([set("2026-01-01", 0.7)], null, day("2027-01-01"))).toBe(0.7);
    expect(replayCloseness([], 120, day("2026-05-01"))).toBeNull();
  });

  it("lifts on contact, after the decay up to it, and a later set wins", () => {
    const after30 = half(0.5, 30, 120);
    expect(replayCloseness([set("2026-01-01", 0.5), contact("2026-01-31")], 120, day("2026-01-31"))).toBe(r3(lift(after30)));
    expect(lift(0.5)).toBeCloseTo(0.5 + CONTACT_GAIN * 0.5, 10);
    expect(replayCloseness([set("2026-01-01", 0.5), contact("2026-01-31"), set("2026-02-01", 0.9)], 120, day("2026-02-01"))).toBe(0.9);
    // A contact before anything set it does nothing.
    expect(replayCloseness([contact("2025-12-01"), set("2026-01-01", 0.5)], 120, day("2026-01-01"))).toBe(0.5);
  });

  it("reads the event rows: a set closeness, a contact, and a tie made with newer evidence", () => {
    expect(replayEventsOf({ event: "created", at: "2026-01-01T00:00:00Z", changes: { closeness: [null, 0.25], last_contact_at: [null, "2026-01-01T00:00:00.000Z"] } })).toEqual([
      { at: "2026-01-01T00:00:00.000Z", closeness: 0.25, contact: false },
    ]);
    expect(replayEventsOf({ event: "created", at: "2026-01-01T00:00:00Z", changes: { closeness: [null, 0.25], last_contact_at: [null, "2026-02-01T00:00:00.000Z"] } })).toEqual([
      { at: "2026-01-01T00:00:00.000Z", closeness: 0.25, contact: false },
      { at: "2026-02-01T00:00:00.000Z", closeness: null, contact: true },
    ]);
    expect(replayEventsOf({ event: "contact", at: "2026-03-01T00:00:00Z", changes: { last_contact_at: ["2026-02-01T00:00:00.000Z", "2026-03-01T00:00:00.000Z"] } })).toEqual([
      { at: "2026-03-01T00:00:00.000Z", closeness: null, contact: true },
    ]);
    // A derivation's rewrite that brought newer evidence is contact too; one that only dropped some isn't.
    expect(replayEventsOf({ event: "changed", at: "2026-03-01T00:00:00Z", changes: { evidence: [3, 2], last_contact_at: ["2026-02-01T00:00:00.000Z", "2026-03-01T00:00:00.000Z"] } })[0].contact).toBe(true);
    expect(replayEventsOf({ event: "changed", at: "2026-03-01T00:00:00Z", changes: { evidence: [3, 2] } })[0].contact).toBe(false);
    expect(replayEventsOf({ event: "contact", at: "2026-03-01T00:00:00Z", changes: { closeness: [0.4, 0.55], last_contact_at: [null, "2026-03-01T00:00:00.000Z"] } })[0]).toMatchObject({ closeness: 0.55, contact: true });
  });

  it("knows when a friendship faded: the moment it crossed, never one set below the line", () => {
    const crossed = fadedAt([set("2026-01-01", 0.5)], 120, day("2026-12-01"))!;
    const expected = day("2026-01-01").getTime() + 120 * Math.log2(0.5 / FADED_BELOW) * DAY;
    expect(Math.abs(crossed.getTime() - expected)).toBeLessThan(1000);
    expect(fadedAt([set("2026-01-01", 0.5)], 120, day("2026-03-01"))).toBeNull();
    expect(fadedAt([set("2026-01-01", 0.1)], 120, day("2026-12-01"))).toBeNull();
    expect(fadedAt([set("2026-01-01", 0.5)], null, day("2036-12-01"))).toBeNull();
  });
});

describe("runSocialDynamics", () => {
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

  const [A, B, C, D] = HOUSE_CHARACTERS.map((c) => c.id);
  const ON = {};
  const ok = (w: TieWrite): Tie => {
    if (!w.ok) throw new Error(`refused: ${w.reason}`);
    return w.tie;
  };
  const closeness = async (id: string) => (await getTie(t.db, id))!.closeness;

  it("does nothing switched off", async () => {
    const friends = ok(await upsertTie(t.db, { from: A, to: B, kind: "friend", source: "house", started_at: "2026-01-01T00:00:00Z" }, ON));
    expect(socialDynamicsOn({ SOCIAL_DYNAMICS: "0" })).toBe(false);
    expect(socialDynamicsOn({ SOCIAL_TIES: "0" })).toBe(false);
    expect(await runSocialDynamics(t.db, { now: day("2026-05-01"), env: { SOCIAL_DYNAMICS: "0" } })).toMatchObject({ stopped: "off", ties: 0 });
    expect(await closeness(friends.id)).toBe(0.5);
  });

  it("decays by the kind's half-life, once a day however often it runs, and leaves kin, dated and off-screen people alone", async () => {
    const friends = ok(await upsertTie(t.db, { from: A, to: B, kind: "friend", source: "house", started_at: "2026-01-01T12:00:00Z" }, ON));
    const kin = ok(await upsertTie(t.db, { from: A, to: C, kind: "sibling", source: "house", started_at: "2026-01-01T12:00:00Z" }, ON));
    const dated = ok(await upsertTie(t.db, { from: B, to: C, kind: "dated", source: "derived", closeness: 0.6, evidence: { ref: "episode:e1", at: "2026-01-01T12:00:00Z" } }, ON));
    const sam = await addPerson(t.db, { holderId: A, name: "Sam", source: "house" }, ON);
    if (!sam.ok) throw new Error(sam.reason);
    const offscreen = ok(await upsertTie(t.db, { from: A, toPerson: sam.person.id, kind: "friend", source: "house", started_at: "2026-01-01T12:00:00Z" }, ON));
    const run = await runSocialDynamics(t.db, { now: day("2026-05-01"), env: ON });
    expect(run).toMatchObject({ stopped: null, moved: 1, faded: 0 });
    expect(await closeness(friends.id)).toBe(r3(half(0.5, 120, 120)));
    expect(await closeness(kin.id)).toBe(0.7);
    expect(await closeness(dated.id)).toBe(0.6);
    expect(await closeness(offscreen.id)).toBe(0.5);
    // The same day again writes nothing; the decay is never an event.
    expect(await runSocialDynamics(t.db, { now: day("2026-05-01"), env: ON })).toMatchObject({ moved: 0, contacts: 0 });
    expect((await tieEvents(t.db, friends.id)).map((e) => e.event)).toEqual(["created"]);
  });

  it("lifts a friendship with the pair's aired contact on their other ties, from when it started, once each", async () => {
    const friends = ok(await upsertTie(t.db, { from: A, to: B, kind: "friend", source: "house", started_at: "2026-03-01T12:00:00Z" }, ON));
    // Their dates: one before they were friends (doesn't count), one after. A line about B in a scene isn't contact.
    await upsertTie(t.db, { from: A, to: B, kind: "dated", source: "derived", evidence: { ref: "episode:before", at: "2026-02-01T12:00:00Z" } }, ON);
    await upsertTie(t.db, { from: A, to: B, kind: "dated", source: "derived", evidence: { ref: "episode:after", at: "2026-03-31T12:00:00Z" } }, ON);
    await upsertTie(t.db, { from: A, to: B, kind: "talked_about", source: "derived", evidence: { ref: "scene:s1", at: "2026-04-10T12:00:00Z" } }, ON);
    const run = await runSocialDynamics(t.db, { now: day("2026-04-30"), env: ON });
    expect(run.contacts).toBe(1);
    const lifted = lift(half(0.5, 30, 120));
    expect(await closeness(friends.id)).toBe(r3(r3(lifted) * 0.5 ** (30 / 120)));
    const tie = (await getTie(t.db, friends.id))!;
    expect(tie.evidence.map((e) => e.ref)).toEqual(["episode:after"]);
    expect(tie.last_contact_at).toBe("2026-03-31T12:00:00.000Z");
    const log = await tieEvents(t.db, friends.id);
    expect(log.map((e) => e.event)).toEqual(["created", "contact"]);
    expect(log[1].changes.closeness?.[1]).toBe(r3(lifted));
    // Again: the contact is already there, and the day's closeness already written.
    expect(await runSocialDynamics(t.db, { now: day("2026-04-30"), env: ON })).toMatchObject({ contacts: 0, moved: 0 });
  });

  it("lifts a derived tie from its own contact and adds nothing to it", async () => {
    const night = ok(await upsertTie(t.db, { from: C, to: D, kind: "met_at_group_night", source: "derived", evidence: { ref: "night:n1", at: "2026-04-01T12:00:00Z" } }, ON));
    await upsertTie(t.db, { from: C, to: D, kind: "met_at_group_night", source: "derived", evidence: { ref: "night:n2", at: "2026-04-15T12:00:00Z" } }, ON);
    await upsertTie(t.db, { from: C, to: D, kind: "dated", source: "derived", evidence: { ref: "episode:e9", at: "2026-04-20T12:00:00Z" } }, ON);
    await runSocialDynamics(t.db, { now: day("2026-04-15"), env: ON });
    expect(await closeness(night.id)).toBe(r3(lift(half(0.25, 14, 45))));
    expect((await getTie(t.db, night.id))!.evidence.map((e) => e.ref)).toEqual(["night:n2", "night:n1"]);
  });

  it("fades a friendship below the line into old friends, at the moment it crossed, once", async () => {
    const friends = ok(await upsertTie(t.db, { from: A, to: B, kind: "friend", source: "house", visibility: "owner", started_at: "2025-06-01T12:00:00Z" }, ON));
    const best = ok(await upsertTie(t.db, { from: A, to: C, kind: "best_friend", source: "house", started_at: "2025-06-01T12:00:00Z" }, ON));
    const run = await runSocialDynamics(t.db, { now: day("2026-05-01"), env: ON });
    expect(run.faded).toBe(1);
    const ended = (await getTie(t.db, friends.id))!;
    expect(ended.status).toBe("ended");
    const crossed = Date.parse("2025-06-01T12:00:00Z") + 120 * Math.log2(0.5 / FADED_BELOW) * DAY;
    expect(Math.abs(Date.parse(ended.ended_at!) - crossed)).toBeLessThan(1000);
    expect((await tieEvents(t.db, friends.id)).map((e) => e.event)).toEqual(["created", "decayed"]);
    const old = (await findTie(t.db, { from: A, to: B, kind: "old_friend" }))!;
    expect(old).toMatchObject({ source: "derived", visibility: "owner", status: "active", started_at: "2025-06-01T12:00:00.000Z", detail: { was: "friend" } });
    expect(old.closeness).toBeLessThan(FADED_BELOW);
    // A best friend fades slower (240 days): still a best friend, just less close.
    expect((await getTie(t.db, best.id))!).toMatchObject({ status: "active" });
    expect(await closeness(best.id)).toBe(r3(half(0.85, 334, 240)));
    expect(await runSocialDynamics(t.db, { now: day("2026-05-02"), env: ON })).toMatchObject({ faded: 0 });
    expect((await tieEvents(t.db, friends.id)).map((e) => e.event)).toEqual(["created", "decayed"]);
  });
});
