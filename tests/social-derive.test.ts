import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addLink } from "@/lib/character-links";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { reportSceneLine } from "@/lib/house-scenes";
import { refreshRelationship } from "@/lib/relationships";
import {
  backfillSocial,
  datedTie,
  deriveGroupNights,
  deriveHometowns,
  deriveHouse,
  deriveLinks,
  deriveSeasonCasts,
  deriveVenues,
  groupNightTies,
  housemateTies,
  houseTies,
  linkTie,
  onCharacter,
  onDate,
  venueMemberships,
  type ShownScene,
} from "@/lib/social/derive";
import { membershipsOf, placeIdOf } from "@/lib/social/places";
import { setSocialDerivingForTests } from "@/lib/social/switch";
import { findTie, planTieUpdate, tieEvents, tieIdOf, tiesByIds, upsertTie } from "@/lib/social/ties";
import type { Tie } from "@/lib/social/types";
import { HOUSE_PLACE } from "@/lib/social/world";
import { startTestDb } from "./helpers";

// The derivations (lib/social/derive.ts, docs/PRDs/social-network.md section 6.1): what aired makes ties and places,
// written only when they differ, gone with the record they came from, and never from anything private.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
  setSocialDerivingForTests(true);
});
afterAll(async () => {
  setSocialDerivingForTests(false);
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  await t.db.query(`delete from story_beats`);
});

const [A, B, C, D, E, F] = HOUSE_CHARACTERS.map((c) => c.id);
const NOW = new Date("2026-11-20T12:00:00.000Z");
const at = (day: number, hour = 20) => new Date(Date.UTC(2026, 10, day, hour)).toISOString();
const kindsOf = async (kind: string) =>
  (await t.db.query<{ from_id: string; to_id: string }>(`select from_id, to_id from social_ties where kind = $1 order by from_id, to_id`, [kind])).rows.map((r) => `${r.from_id}|${r.to_id}`);
const pair = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);
const tie = async (from: string, to: string, kind: Parameters<typeof findTie>[1]["kind"]): Promise<Tie | null> => findTie(t.db, { from, to, kind });

let seq = 0;
/** A date between two characters, aired (public) unless told otherwise. */
async function airDate(a: string, b: string, o: { day?: number; venue?: string; night?: string; visibility?: string; aired?: boolean; ending?: string } = {}) {
  const id = `sd-ep-${++seq}`;
  const when = at(o.day ?? 1);
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, status, sides, transcript, visibility, revealed_at, created_at, setup, group_id)
     values ($1, 'x', $2, $3, 's', '[]'::jsonb, '[]'::jsonb, 't', 'f', $4, 'ready', $5::jsonb, '[]'::jsonb, $6, $7, $8, $9::jsonb, $10)`,
    [id, a, b, o.ending ?? "second_date", JSON.stringify([{ wants_another: true }, { wants_another: true }]), o.visibility ?? "public", o.aired === false ? null : when, when, JSON.stringify(o.venue ? { venue: o.venue } : {}), o.night ?? null],
  );
  return id;
}
/** A person's character. */
async function person(id: string, o: { visibility?: string; hometown?: string } = {}) {
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility, extras)
     values ($1, $2, false, $3, 30, 'Bakes bread and argues with the radio.', '["kind"]'::jsonb, 'someone kind', 'liars', $4, $5::jsonb)`,
    [id, `owner-${id}`, `Person ${id}`, o.visibility ?? "public", JSON.stringify(o.hometown ? { hometown: o.hometown } : {})],
  );
  return id;
}
const setVisibility = (table: "episodes" | "characters", id: string, visibility: string) => t.db.query(`update ${table} set visibility = $2 where id = $1`, [id, visibility]);

/* ------------------------------------------------------------ pure ------------------------------------------------------------ */

describe("the pure derivations", () => {
  it("dated: the public dates only, newest first, the layer and valence by the shown stage, started at the first", () => {
    const history = [
      { episode_id: "e1", at: at(1, 18), aired_at: at(1), public: true },
      { episode_id: "e2", at: at(2, 18), aired_at: null, public: false },
      { episode_id: "e3", at: at(3, 18), aired_at: at(3), public: true },
    ];
    expect(datedTie(A, B, { dates: 0, second_dates: 0, stage: null, shown: null, tie: 0 }, history)).toBeNull();
    const d = datedTie(A, B, { dates: 2, second_dates: 1, stage: "dating", shown: "going_steady", tie: 0.123456789 }, history)!;
    expect(d).toMatchObject({ from: A, to: B, kind: "dated", source: "derived", layer: "romance", valence: 2, closeness: 0.123, wholeEvidence: true, started_at: at(1) });
    expect(d.detail).toEqual({ stage: "dating", shown_stage: "going_steady", dates: 2, second_dates: 1 });
    expect((d.evidence as { ref: string }[]).map((e) => e.ref)).toEqual(["episode:e3", "episode:e1"]);
    // Bad blood is conflict; without a shown stage, the base one decides.
    expect(datedTie(A, B, { dates: 1, second_dates: 0, stage: "bad_blood", shown: null, tie: 0.2 }, history)).toMatchObject({ layer: "conflict", valence: -2 });
  });

  it("group nights: everyone on the night's public dates met the rest, but each date's two", () => {
    const ties = groupNightTies([
      { night: "n1", a: A, b: B, at: at(1) },
      { night: "n1", a: C, b: D, at: at(1, 21) },
      { night: "n2", a: A, b: C, at: at(5) },
      { night: "n2", a: B, b: D, at: at(5) },
    ]);
    const byPair = new Map(ties.map((x) => [pair(x.from, x.to!), x]));
    // n1: A-C, A-D, B-C, B-D (A-B and C-D dated); n2: A-B, A-D, B-C, C-D (A-C and B-D dated).
    expect([...byPair.keys()].sort()).toEqual([pair(A, B), pair(A, C), pair(A, D), pair(B, C), pair(B, D), pair(C, D)].sort());
    expect(byPair.get(pair(A, D))).toMatchObject({ kind: "met_at_group_night", detail: { nights: 2 }, started_at: at(1, 21) });
    expect((byPair.get(pair(A, D))!.evidence as { ref: string }[]).map((e) => e.ref)).toEqual(["night:n2", "night:n1"]);
    expect(byPair.get(pair(A, B))).toMatchObject({ detail: { nights: 1 } });
  });

  it("the house: told and talked about with counts, a feud by its latest outcome, rivals from challenges and beats, nobody private", () => {
    const line = (id: string, n: number, about?: [string, string]) => ({ id, n, name: id, hue: null, portrait: null, house: true, text: "…", ...(about ? { about } : {}) });
    const face = (id: string) => ({ id, name: id, hue: null, portrait: null, house: true });
    const scenes: ShownScene[] = [
      { id: "s1", written_at: at(1), cast: [face(A), face(B)], lines: [line(A, 1, [C, D]), line(B, 2), line(A, 3, [C, "private-one"])], result: null, told: [{ line: 1, by: A, to: [B, "private-one"] }, { line: 9, by: A, to: [B] }] },
      { id: "s2", written_at: at(2), cast: [face(A), face(B)], lines: [line(A, 1, [C, D]), line(B, 2)], result: null, told: [{ line: 1, by: A, to: [B] }] },
      { id: "c1", written_at: at(3), cast: [face(A), face(B)], lines: [line(A, 1), line(B, 2)], result: { kind: "confrontation", a: "A", b: "B", a_id: A, b_id: B, outcome: "worse_than_before", label: "" }, told: [] },
      { id: "c2", written_at: at(4), cast: [face(A), face(B)], lines: [line(A, 1), line(B, 2)], result: { kind: "confrontation", a: "A", b: "B", a_id: A, b_id: B, outcome: "cleared_the_air", label: "" }, told: [] },
      { id: "ch", written_at: at(5), cast: [face(C), face(D), face(E)], lines: [line(C, 1), line(D, 2)], result: { kind: "challenge", title: "The Bake-Off", winner: face(C), prize: "" }, told: [] },
    ];
    const open = new Set([A, B, C, D, E, F]);
    const ties = houseTies(scenes, [{ day: "2026-11-06", a: D, b: E }, { day: "2026-11-07", a: E, b: "private-one" }], open);
    const find = (kind: string, from: string, to: string) => ties.find((x) => x.kind === kind && x.from === from && x.to === to);
    expect(find("talked_about", A, C)).toMatchObject({ detail: { count: 3 } });
    expect(find("talked_about", A, D)).toMatchObject({ detail: { count: 2 } });
    expect(find("told", A, B)).toMatchObject({ detail: { count: 2 } });
    expect((find("told", A, B)!.evidence as { ref: string }[]).map((e) => e.ref)).toEqual(["scene:s2#1", "scene:s1#1"]);
    // A feud reads its latest confrontation: they cleared the air, so it's over and neutral.
    expect(find("feud", ...([A, B].sort() as [string, string]))).toMatchObject({ valence: 0, status: "ended", detail: { outcome: "cleared_the_air", confrontations: 2 } });
    // The challenge's winner is a rival of each other contestant; the beat's two are rivals.
    const rival = (x: string, y: string) => find("rival", ...([x, y].sort() as [string, string]));
    expect(rival(C, D)).toMatchObject({ detail: { challenges: 1, beats: 0 } });
    expect(rival(C, E)).toMatchObject({ detail: { challenges: 1, beats: 0 } });
    expect(rival(D, E)).toMatchObject({ detail: { challenges: 0, beats: 1 } });
    expect((rival(D, E)!.evidence as { ref: string }[])[0].ref).toBe("beat:2026-11-06");
    // Nobody who isn't public, and nothing from a line the page doesn't show.
    expect(ties.some((x) => x.from === "private-one" || x.to === "private-one")).toBe(false);
    expect(ties.some((x) => (x.evidence as { ref: string }[]).some((e) => e.ref === "scene:s1#9"))).toBe(false);
  });

  it("housemates, venues and links", () => {
    const mates = housemateTies([
      { season: "2026-10-19", ids: [A, B, C] },
      { season: "2026-11-01", ids: [B, C, D] },
    ]);
    expect(mates.find((m) => m.from === [B, C].sort()[0] && m.to === [B, C].sort()[1])).toMatchObject({ kind: "housemate", detail: { seasons: ["2026-10-19", "2026-11-01"] }, started_at: "2026-10-19T00:00:00.000Z" });
    expect(mates).toHaveLength(5);
    expect(venueMemberships([{ character_id: A, venue: "dive_bar", visits: 3, first_at: at(1) }, { character_id: B, venue: "dive_bar", visits: 2, first_at: at(2) }]).map((m) => `${m.characterId}:${m.role}:${(m.detail as { visits: number }).visits}`)).toEqual([
      `${A}:visited:3`,
      `${A}:regular:3`,
      `${B}:visited:2`,
    ]);
    expect(linkTie({ lo: A, hi: B, kind: "second_chance", story: "They were engaged once.", source: "season_gen" })).toMatchObject({ from: A, to: B, kind: "ex", source: "house", story: "They were engaged once.", evidence: { ref: `link:${A}:${B}` } });
    expect(linkTie({ lo: A, hi: B, kind: "friends_to_more", story: "x".repeat(300), source: "admin" })).toMatchObject({ kind: "best_friend", source: "admin", story: null });
  });
});

/* --------------------------------------------------------- whole evidence --------------------------------------------------------- */

describe("a derivation's evidence is the record's", () => {
  it("replaces a derived row's evidence (a withdrawn ref goes), and only adds to a declared row's", async () => {
    const two = [
      { ref: "episode:e2", at: at(2) },
      { ref: "episode:e1", at: at(1) },
    ];
    const made = await upsertTie(t.db, { from: A, to: B, kind: "dated", source: "derived", evidence: two, wholeEvidence: true });
    expect(made).toMatchObject({ ok: true, event: "created" });
    const first = (made as { tie: Tie }).tie;
    expect(first).toMatchObject({ started_at: at(1), last_contact_at: at(2), source_ref: "episode:e2" });
    const plan = planTieUpdate(first, { from: A, to: B, kind: "dated", source: "derived", evidence: [two[1]], wholeEvidence: true });
    expect(plan.event).toBe("changed");
    expect(plan.next.evidence.map((e) => e.ref)).toEqual(["episode:e1"]);
    expect(plan.changes.evidence).toEqual([2, 1]);
    expect(plan.next.last_contact_at).toBe(at(1));
    // The same whole evidence again is nothing.
    expect(planTieUpdate(first, { from: A, to: B, kind: "dated", source: "derived", evidence: two, wholeEvidence: true }).event).toBeNull();
    // A declared row only gains.
    await upsertTie(t.db, { from: A, to: C, kind: "rival", source: "house", evidence: { ref: "link:x", at: at(1) } });
    const declared = (await tiesByIds(t.db, [tieIdOf({ from: A, to: C, kind: "rival" })])).get(tieIdOf({ from: A, to: C, kind: "rival" }))!;
    const onDeclared = planTieUpdate(declared, { from: A, to: C, kind: "rival", source: "derived", evidence: [{ ref: "scene:s1", at: at(3) }], wholeEvidence: true, valence: -2 });
    expect(onDeclared.next.evidence.map((e) => e.ref)).toEqual(["scene:s1", "link:x"]);
    expect(onDeclared.next.valence).toBe(declared.valence);
  });
});

/* ------------------------------------------------------------ dated ------------------------------------------------------------ */

describe("dated", () => {
  it("follows the pair's public record through refreshRelationship: made, counted, thinned, gone", async () => {
    const e1 = await airDate(A, B, { day: 1 });
    const e2 = await airDate(A, B, { day: 3 });
    await refreshRelationship(t.db, A, B);
    let dated = (await tie(A, B, "dated"))!;
    expect(dated).toMatchObject({ source: "derived", layer: "romance", started_at: at(1), last_contact_at: at(3) });
    expect(dated.detail).toMatchObject({ dates: 2 });
    expect(dated.evidence.map((e) => e.ref)).toEqual([`episode:${e2}`, `episode:${e1}`]);
    // Again: nothing new.
    await refreshRelationship(t.db, A, B);
    expect((await tieEvents(t.db, dated.id)).map((e) => e.event)).toEqual(["created"]);
    // The newer date goes private: its ref and its count go with it.
    await setVisibility("episodes", e2, "private");
    await refreshRelationship(t.db, A, B);
    dated = (await tie(A, B, "dated"))!;
    expect(dated.evidence.map((e) => e.ref)).toEqual([`episode:${e1}`]);
    expect(dated).toMatchObject({ last_contact_at: at(1), detail: { dates: 1 } });
    const changed = (await tieEvents(t.db, dated.id)).at(-1)!;
    expect(changed).toMatchObject({ event: "changed", actor: "system" });
    expect(changed.changes).toMatchObject({ evidence: [2, 1], "detail.dates": [2, 1] });
    // No public date left: the tie goes, with its history.
    await setVisibility("episodes", e1, "private");
    await refreshRelationship(t.db, A, B);
    expect(await tie(A, B, "dated")).toBeNull();
    expect(await tieEvents(t.db, dated.id)).toEqual([]);
  });

  it("never comes from a private character's dates, and is off in tests unless asked for", async () => {
    const hidden = await person("p-hidden", { visibility: "private" });
    await airDate(A, hidden);
    await refreshRelationship(t.db, A, hidden);
    expect(await tie(A, hidden, "dated")).toBeNull();
    setSocialDerivingForTests(false);
    try {
      await airDate(A, B);
      await refreshRelationship(t.db, A, B);
      expect(await tie(A, B, "dated")).toBeNull();
    } finally {
      setSocialDerivingForTests(true);
    }
  });
});

/* ------------------------------------------------------------ links ------------------------------------------------------------ */

describe("links", () => {
  it("writes a link's tie through, swaps it when the link changes kind, and drops it when an end goes private", async () => {
    await addLink(t.db, B, A, "rivals", "Same gym, same locker, same grudge.");
    const rival = (await tie(A, B, "rival"))!;
    expect(rival).toMatchObject({ source: "house", story: "Same gym, same locker, same grudge.", status: "active" });
    expect(rival.evidence.map((e) => e.ref)).toEqual([`link:${[A, B].sort().join(":")}`]);
    await addLink(t.db, A, B, "second_chance", "Engaged once, for a week.");
    expect(await tie(A, B, "rival")).toBeNull();
    expect(await tie(A, B, "ex")).toMatchObject({ source: "house", story: "Engaged once, for a week." });
    const p = await person("p-link");
    await addLink(t.db, C, p, "friends_to_more", "Grew up next door.");
    expect(await tie(C, p, "best_friend")).not.toBeNull();
    await setVisibility("characters", p, "private");
    await deriveLinks(t.db, [{ lo: [C, p].sort()[0], hi: [C, p].sort()[1], kind: "friends_to_more", story: "Grew up next door.", source: "season_gen" }]);
    expect(await tie(C, p, "best_friend")).toBeNull();
  });
});

/* --------------------------------------------------------- group nights --------------------------------------------------------- */

describe("group nights", () => {
  it("everyone on the night met the rest; a date gone private takes its two out", async () => {
    await airDate(A, B, { night: "night-1", day: 4 });
    const cd = await airDate(C, D, { night: "night-1", day: 4 });
    await airDate(E, F, { night: "night-1", day: 4 });
    await airDate(A, C, { day: 5 }); // not a group night
    await deriveGroupNights(t.db, { nights: ["night-1"] });
    expect(await kindsOf("met_at_group_night")).toHaveLength(12);
    expect(await tie(A, B, "met_at_group_night")).toBeNull();
    expect(await tie(A, C, "met_at_group_night")).toMatchObject({ detail: { nights: 1 } });
    await setVisibility("episodes", cd, "private");
    await onDate(t.db, cd);
    const left = await kindsOf("met_at_group_night");
    expect(left.sort()).toEqual([pair(A, E), pair(A, F), pair(B, E), pair(B, F)].sort());
  });
});

/* ------------------------------------------------------------ house ------------------------------------------------------------ */

describe("the house", () => {
  async function scene(id: string, o: { kind?: string; day: string; cast: string[]; lines: object[]; told?: object[]; result?: object | null }) {
    await t.db.query(
      `insert into house_scenes (id, day, season_id, kind, place, cast_ids, lines, told, result, source, created_at, written_at)
       values ($1, $2, '2026-11-01', $3, 'stairs', $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, 'template', $8, $8)`,
      [id, o.day, o.kind ?? "gossip", JSON.stringify(o.cast), JSON.stringify(o.lines), JSON.stringify(o.told ?? []), JSON.stringify(o.result ?? null), `${o.day}T19:00:00.000Z`],
    );
  }

  it("feuds, rivals, who told whom and who talked about whom, as /house shows them; a reported line takes its ties away", async () => {
    const date = await airDate(C, D, { day: 2 });
    const tell = { episode_id: date, about: C, about_b: D, claim: "They left together.", is_true: true };
    await scene("2026-11-10-gossip", {
      day: "2026-11-10",
      cast: [A, B, E],
      lines: [
        { character_id: A, text: "Guess who left together.", tell },
        { character_id: B, text: "No way." },
        { character_id: E, text: "I saw it too." },
      ],
      told: [{ ...tell, line: 1, by: A, to: [B, E], source: "scene" }],
    });
    await scene("2026-11-11-confrontation", {
      kind: "confrontation",
      day: "2026-11-11",
      cast: [A, B],
      lines: [
        { character_id: A, text: "We need to talk." },
        { character_id: B, text: "Fine." },
      ],
      result: { kind: "confrontation", outcome: "worse_than_before", over: "knows_said", a: A, b: B, witness: null, moved: [], settled: 0 },
    });
    await scene("2026-11-12-challenge", {
      kind: "challenge",
      day: "2026-11-12",
      cast: [C, D, E],
      lines: [
        { character_id: C, text: "Watch this." },
        { character_id: D, text: "Ugh." },
      ],
      result: { kind: "challenge", challenge: "bake", title: "The Bake-Off", winner: C, prize: { day: "2026-11-13", with: null, kind: "first_pick" } },
    });
    const beat = (day: string, who: string[], previously: string | null) =>
      t.db.query(`insert into story_beats (day, season_id, kind, status, tension, who, about, previously) values ($1, '2026-11-01', 'rival_date', 'staged', 'rivals', $2::jsonb, $3, $4)`, [day, JSON.stringify(who), F, previously]);
    await beat("2026-11-14", [D, E], "D and E both want F.");
    await beat("2026-11-15", [A, E], null); // no public line: not on the record
    await beat("2099-01-01", [A, F], "One day."); // its day hasn't come

    await deriveHouse(t.db, { now: NOW });
    expect(await tie(A, C, "talked_about")).toMatchObject({ detail: { count: 1 }, directed: true });
    expect(await tie(A, B, "told")).toMatchObject({ detail: { count: 1 } });
    expect(await tie(A, E, "told")).not.toBeNull();
    expect(await tie(B, A, "told")).toBeNull();
    expect(await tie(A, B, "feud")).toMatchObject({ valence: -2, status: "active", detail: { outcome: "worse_than_before", confrontations: 1 } });
    expect(await tie(C, D, "rival")).toMatchObject({ detail: { challenges: 1, beats: 0 } });
    expect(await tie(C, E, "rival")).toMatchObject({ detail: { challenges: 1, beats: 0 } });
    expect(await tie(D, E, "rival")).toMatchObject({ detail: { challenges: 0, beats: 1 } });
    expect(await tie(A, E, "rival")).toBeNull();
    expect(await tie(A, F, "rival")).toBeNull();

    // Idempotent.
    const before = (await t.db.query<{ n: number }>(`select count(*)::int as n from social_tie_events`)).rows[0].n;
    await deriveHouse(t.db, { now: NOW });
    expect((await t.db.query<{ n: number }>(`select count(*)::int as n from social_tie_events`)).rows[0].n).toBe(before);

    // The telling line is reported away (three reports hide it): what it told and who it talked about go.
    for (const r of ["r1", "r2", "r3"]) await reportSceneLine(t.db, "2026-11-10-gossip", 1, r);
    expect(await tie(A, B, "told")).toBeNull();
    expect(await tie(A, C, "talked_about")).toBeNull();
    expect(await tie(A, B, "feud")).not.toBeNull();
    // With the house switched off its ties wait for it: nothing is written and nothing goes.
    await t.db.query(`delete from house_scenes`);
    expect(await deriveHouse(t.db, { now: NOW, env: { HOUSE_SCENES: "0" } })).toMatchObject({ written: 0, removed: 0 });
    expect(await tie(A, B, "feud")).not.toBeNull();
  });
});

/* ------------------------------------------------------- seasons and places ------------------------------------------------------- */

describe("the season, venues and hometowns", () => {
  it("housemates and the house's lives memberships, a past season's ended", async () => {
    const cast = (season: string, id: string, slot: number, withdrawn = false) =>
      t.db.query(`insert into season_casts (season_id, character_id, slot, source, withdrawn_at) values ($1, $2, $3, 'dealt', $4)`, [season, id, slot, withdrawn ? at(5) : null]);
    await cast("2026-10-19", A, 0);
    await cast("2026-10-19", B, 1);
    await cast("2026-11-01", B, 0);
    await cast("2026-11-01", C, 1);
    await cast("2026-11-01", D, 2, true);
    await cast("2026-12-01", E, 0); // not begun
    await deriveSeasonCasts(t.db, { now: NOW });
    expect((await kindsOf("housemate")).sort()).toEqual([pair(A, B), pair(B, C)].sort());
    const lives = async (id: string) => (await membershipsOf(t.db, id, { roles: ["lives"] }))[0] ?? null;
    expect(await lives(A)).toMatchObject({ place_id: placeIdOf(HOUSE_PLACE.key), source: "derived", detail: { seasons: ["2026-10-19"] }, ended_at: "2026-11-01T00:00:00.000Z" });
    expect(await lives(B)).toMatchObject({ detail: { seasons: ["2026-10-19", "2026-11-01"] }, ended_at: null });
    expect(await lives(D)).toBeNull();
    expect(await lives(E)).toBeNull();
    await t.db.query(`delete from season_casts where character_id = $1`, [A]);
    await deriveSeasonCasts(t.db, { now: NOW });
    expect(await lives(A)).toBeNull();
    expect(await kindsOf("housemate")).toEqual([pair(B, C)]);
  });

  it("venues: visited with the count, regular from three, only public dates at the world's venues", async () => {
    const p = await person("p-venue");
    await airDate(A, B, { venue: "dive_bar", day: 1 });
    await airDate(A, C, { venue: "dive_bar", day: 2 });
    await airDate(A, p, { venue: "dive_bar", day: 3 });
    await airDate(A, D, { venue: "dive_bar", day: 4, visibility: "private" });
    await airDate(A, E, { venue: "home@their flat", day: 5 });
    await deriveVenues(t.db, [A, B, p]);
    const roles = async (id: string) => (await membershipsOf(t.db, id)).map((m) => `${m.role}:${(m.detail as { visits?: number }).visits}`).sort();
    expect(await roles(A)).toEqual(["regular:3", "visited:3"]);
    expect(await roles(B)).toEqual(["visited:1"]);
    // p goes private: its date counts for nobody, so A is no longer a regular.
    await setVisibility("characters", p, "private");
    await onCharacter(t.db, p, { visibility: true });
    expect(await roles(A)).toEqual(["visited:2"]);
    expect(await roles(p)).toEqual([]);
  });

  it("hometowns: made the first time they're named, moved when the sheet changes, gone when the character goes private", async () => {
    const p = await person("p-home", { hometown: "Leeds (mostly)" });
    await deriveHometowns(t.db, [p]);
    const from = async () => (await membershipsOf(t.db, p, { roles: ["from"] })).map((m) => m.place_id);
    expect(await from()).toEqual([placeIdOf("hometown:leeds")]);
    expect((await t.db.query<{ name: string; kind: string }>(`select name, kind from social_places where key = 'hometown:leeds'`)).rows[0]).toEqual({ name: "Leeds", kind: "hometown" });
    await t.db.query(`update characters set extras = $2::jsonb where id = $1`, [p, JSON.stringify({ hometown: "Lagos, then Atlanta" })]);
    await onCharacter(t.db, p);
    expect(await from()).toEqual([placeIdOf("hometown:lagos")]);
    await setVisibility("characters", p, "private");
    await onCharacter(t.db, p, { visibility: true });
    expect(await from()).toEqual([]);
  });
});

/* ------------------------------------------------------------ backfill ------------------------------------------------------------ */

describe("backfillSocial", () => {
  it("derives the whole record, does nothing until a step is due, and writes nothing when the record hasn't changed", async () => {
    // A record made with the hooks off, so only the backfill can find it.
    setSocialDerivingForTests(false);
    try {
      await airDate(A, B, { venue: "dive_bar", night: "night-9", day: 2 });
      await airDate(C, D, { night: "night-9", day: 2 });
      await refreshRelationship(t.db, A, B);
      await refreshRelationship(t.db, C, D);
      await addLink(t.db, E, F, "fake_dating", "A bet that got out of hand.");
      await person("p-back", { hometown: "Hull" });
    } finally {
      setSocialDerivingForTests(true);
    }
    expect(await backfillSocial(t.db, { now: NOW, env: { SOCIAL_TIES: "0" } })).toBeNull();
    // No time at all: nothing runs.
    expect((await backfillSocial(t.db, { now: NOW, budgetMs: -1 }))!.steps).toEqual({});

    const first = (await backfillSocial(t.db, { now: NOW }))!;
    expect(Object.values(first.steps).every((s) => s.done)).toBe(true);
    expect(await tie(A, B, "dated")).not.toBeNull();
    expect(await tie(A, C, "met_at_group_night")).not.toBeNull();
    expect(await tie(E, F, "fake_couple")).toMatchObject({ source: "house" });
    expect((await membershipsOf(t.db, A, { roles: ["visited", "regular"] })).map((m) => m.role)).toEqual(["visited"]);
    expect((await membershipsOf(t.db, "p-back")).map((m) => m.place_id)).toEqual([placeIdOf("hometown:hull")]);
    const steps = (await t.db.query<{ step: string; cursor: string | null }>(`select step, cursor from social_backfill order by step`)).rows;
    expect(steps.map((s) => s.step).sort()).toEqual(["dated", "hometowns", "house", "links", "nights", "seasons", "venues", "world"]);
    expect(steps.every((s) => s.cursor === null)).toBe(true);

    // Within the day: nothing is due.
    expect((await backfillSocial(t.db, { now: new Date(NOW.getTime() + 60 * 60 * 1000) }))!.steps).toEqual({});
    // A day on: every step again, and nothing changes.
    const events = (await t.db.query<{ n: number }>(`select count(*)::int as n from social_tie_events`)).rows[0].n;
    const again = (await backfillSocial(t.db, { now: new Date(NOW.getTime() + 25 * 60 * 60 * 1000) }))!;
    expect(Object.keys(again.steps)).toHaveLength(8);
    expect(Object.values(again.steps).reduce((n, s) => n + s.written + s.removed + s.members, 0)).toBe(0);
    expect((await t.db.query<{ n: number }>(`select count(*)::int as n from social_tie_events`)).rows[0].n).toBe(events);
  });
});
