/**
 * Relationships that go somewhere (lib/relationship-stages.ts, 2026-11-16): the derivation table (histories in, stage
 * out, both states of RELATIONSHIP_STAGES_V2), the bad-blood rule against the shapes production holds, what a refresh
 * stores and logs, the silent backfill, the notices, and the readers that tell a stage.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { shapeNow } from "@/lib/character-now";
import { shapeTalk } from "@/lib/character-talk";
import { publicTimeline } from "@/lib/graph";
import { personLabel, personStage, shownPairStatus, standingWords, metBefore, type CharacterMemory, type PersonMemory } from "@/lib/memory";
import { listNotifications } from "@/lib/notifications";
import { refreshAndAnnounce } from "@/lib/relationship-events";
import {
  BASE_STAGES,
  baseOf,
  justSplit,
  shownStage,
  shownStageOf,
  STAGE_LABELS,
  STAGE_LINES,
  STAGE_RANK,
  STAGES,
  STANDING_LINES,
  stageOf,
  stageSteps,
  stagesV2On,
  steppedUp,
  type Stage,
  type StageDate,
} from "@/lib/relationship-stages";
import { backfillShownStages, computeRelationship, eventStageSql, loadRelationship, pairContext, pairKey, refreshRelationship, storedStages, viewRelationship, type RelEpisode } from "@/lib/relationships";
import type { Ending } from "@/lib/rules";
import { checkShowText } from "@/lib/safety";
import { pruneKeptData } from "@/lib/retention";
import { wantFromRules, firsthandOpinion } from "@/lib/story-state";
import { shapeStoryMap, TIE_KINDS } from "@/lib/story-map";
import { startTestDb } from "./helpers";

const OFF = { RELATIONSHIP_STAGES_V2: "0" };
const ON = {};
const E: Record<string, Ending> = { S: "second_date", F: "friends", D: "disaster" };
/** "SSD" → three dates a day apart; "O" is an overnight date they left together. */
const dates = (seq: string, start = Date.UTC(2026, 9, 1)): StageDate[] =>
  [...seq].map((c, i) => ({ ending: c === "O" ? "second_date" : E[c], at: new Date(start + i * 86_400_000).toISOString(), ...(c === "O" ? { overnight: true } : {}) }));
const shown = (seq: string, marks = {}) => shownStageOf(dates(seq), marks, ON);
const base = (seq: string) => stageOf(dates(seq).map((d) => d.ending));

describe("the switch", () => {
  it("is on unless RELATIONSHIP_STAGES_V2 is 0", () => {
    expect(stagesV2On({})).toBe(true);
    expect(stagesV2On({ RELATIONSHIP_STAGES_V2: "1" })).toBe(true);
    expect(stagesV2On({ RELATIONSHIP_STAGES_V2: " 0 " })).toBe(false);
  });

  it("off, every history reads exactly as the seven base stages did", () => {
    for (const seq of ["D", "FD", "DD", "S", "SS", "SSSS", "SSSSSS", "SSSSSSSSSS", "SSO", "SSSSD", "SDS", "F", "SF", "SOF"]) {
      const got = shownStageOf(dates(seq), { engaged_at: "2026-12-01T00:00:00Z", feud: true }, OFF);
      expect(got, seq).toBe(base(seq));
      expect(BASE_STAGES as readonly string[]).toContain(got);
    }
  });
});

describe("the derivation: histories in, stage out", () => {
  // [history, the base stage every rule reads, the stage shown]
  const table: [string, Stage, Stage][] = [
    // One date.
    ["F", "just_met", "just_met"],
    ["S", "sparks", "sparks"],
    ["D", "bad_blood", "didnt_click"],
    // The climb.
    ["SS", "dating", "dating"],
    ["SSS", "dating", "dating"],
    ["SSSS", "going_steady", "going_steady"],
    ["SSSSS", "going_steady", "going_steady"],
    ["SSSSSS", "going_steady", "official"],
    ["SSSSSSSSS", "going_steady", "official"],
    ["SSSSSSSSSS", "going_steady", "moved_in"],
    ["FSSSS", "going_steady", "going_steady"],
    // Friends.
    ["FF", "friends", "friends"],
    ["SF", "friends", "friends"],
    ["SSSSF", "friends", "friends"],
    ["DF", "friends", "friends"],
    // Keeping it casual: they left an overnight date together and aren't going steady.
    ["SSO", "dating", "casual"],
    ["SSOF", "friends", "casual"],
    ["SSOFS", "sparks", "casual"],
    ["SSOS", "going_steady", "going_steady"],
    ["SSOD", "exes", "exes"],
    ["SSODS", "sparks", "back_together"],
    // Bad blood means it: history first, or more than one disaster.
    ["FD", "bad_blood", "bad_blood"],
    ["DD", "bad_blood", "bad_blood"],
    ["DFD", "bad_blood", "bad_blood"],
    ["FFD", "bad_blood", "bad_blood"],
    // Apart, and back.
    ["SD", "exes", "exes"],
    ["SSD", "exes", "exes"],
    ["SSSSD", "exes", "broke_up"],
    ["SSSSFD", "exes", "broke_up"],
    ["SSSSDD", "exes", "broke_up"],
    ["SSSSDF", "friends", "friends"],
    ["SDS", "sparks", "back_together"],
    ["SSSSDS", "sparks", "back_together"],
    ["SDSS", "dating", "dating"],
    ["SDFS", "sparks", "back_together"],
    ["SDSD", "exes", "exes"],
    ["DS", "sparks", "sparks"],
  ];
  it.each(table)("%s: rules read %s, pages show %s", (seq, wantBase, wantShown) => {
    expect(base(seq)).toBe(wantBase);
    expect(shown(seq)).toBe(wantShown);
    // The shown reading never contradicts what the rules read: apart stays apart, never-a-couple stays so.
    if (["exes", "broke_up", "divorced"].includes(wantShown)) expect(wantBase).toBe("exes");
    if (["bad_blood", "didnt_click"].includes(wantShown)) expect(wantBase).toBe("bad_blood");
  });

  it("tells the stage after every date, so a timeline can say which date changed it", () => {
    expect(stageSteps(dates("SSSSSSD")).steps).toEqual(["sparks", "dating", "dating", "going_steady", "going_steady", "official", "broke_up"]);
    expect(stageSteps(dates("DSSD")).steps).toEqual(["didnt_click", "sparks", "dating", "exes"]);
  });

  it("an empty history has no stage", () => {
    expect(shown("")).toBeNull();
    expect(stageSteps([]).now).toBeNull();
  });
});

describe("bad blood only where there was some: the shapes production holds (2026-11-16, public layer)", () => {
  // Every public ending sequence on the live graph that day, with how many pairs had it.
  const live: [string, number][] = [
    ["D", 138], ["FD", 1],
    ["SS", 15], ["SSS", 2], ["FFSS", 1], ["FSS", 1], ["FSSS", 1],
    ["SD", 1],
    ["FF", 6], ["SF", 3], ["SDFFDFFFFF", 1], ["DF", 1], ["DFF", 1], ["FSF", 1], ["SSF", 1],
    ["SSSSSSS", 3], ["SSSS", 1], ["S".repeat(15), 1], ["S".repeat(24), 1],
    ["F", 164],
    ["S", 133], ["FS", 10], ["DS", 4], ["SSFS", 1],
  ];
  const tally = (read: (seq: string) => Stage | null) => {
    const out: Record<string, number> = {};
    for (const [seq, n] of live) out[read(seq)!] = (out[read(seq)!] ?? 0) + n;
    return out;
  };

  it("before: 139 of those pairs were bad blood, 6 going steady", () => {
    expect(tally(base)).toEqual({ bad_blood: 139, dating: 20, exes: 1, friends: 14, going_steady: 6, just_met: 164, sparks: 148 });
  });

  it("after: one pair is bad blood (a friendly date, then a disaster); 138 single bad dates didn't click", () => {
    expect(tally((s) => shown(s))).toEqual({
      bad_blood: 1, didnt_click: 138, dating: 20, exes: 1, friends: 14, going_steady: 1, official: 3, moved_in: 2, just_met: 164, sparks: 148,
    });
  });

  it("a confrontation in the house that didn't clear the air makes a date that didn't click bad blood, and nothing else", () => {
    expect(shown("D", { feud: true })).toBe("bad_blood");
    expect(shown("S", { feud: true })).toBe("sparks");
    expect(shown("F", { feud: true })).toBe("just_met");
    expect(shown("SSD", { feud: true })).toBe("exes");
  });
});

describe("a finale's marks: engaged, married, divorced", () => {
  const afterTen = new Date(Date.UTC(2026, 9, 1) + 9 * 86_400_000 + 3_600_000).toISOString(); // an hour after their tenth date
  const afterTwelve = new Date(Date.UTC(2026, 9, 1) + 11 * 86_400_000 + 3_600_000).toISOString();

  it("no history alone makes a couple engaged or married: only a finale's mark does", () => {
    expect(shown("S".repeat(40))).toBe("moved_in");
    for (const seq of ["SSSSSSSSSSD", "SDSDSD", "SSOSSSSSSSSSSF"]) expect(stageSteps(dates(seq)).steps.filter((s) => s === "engaged" || s === "married" || s === "divorced")).toEqual([]);
  });

  it("engaged holds through second dates and a flat night; a disaster ends it as a breakup", () => {
    const m = { engaged_at: afterTen };
    expect(shown("S".repeat(10), m)).toBe("engaged");
    expect(shown("S".repeat(11), m)).toBe("engaged");
    expect(shown(`${"S".repeat(10)}F`, m)).toBe("engaged");
    expect(shown(`${"S".repeat(10)}SD`, m)).toBe("broke_up");
    expect(shown(`${"S".repeat(10)}SDS`, m)).toBe("back_together");
  });

  it("married after engaged; a disaster after the wedding is a divorce, and only then", () => {
    const m = { engaged_at: afterTen, married_at: afterTwelve };
    expect(shown("S".repeat(12), m)).toBe("married");
    expect(shown("S".repeat(13), m)).toBe("married");
    expect(shown(`${"S".repeat(12)}D`, m)).toBe("divorced");
    expect(shown(`${"S".repeat(12)}DD`, m)).toBe("divorced");
    expect(shown(`${"S".repeat(12)}DS`, m)).toBe("back_together");
    // A disaster before the wedding day: the mark was for a couple no longer together, and is not read.
    expect(shown(`${"S".repeat(10)}D`, { married_at: afterTwelve })).toBe("broke_up");
    expect(stageSteps(dates(`${"S".repeat(10)}D`)).steps).not.toContain("divorced");
  });
});

describe("labels, lines and ranks", () => {
  it("every stage has a label, a one-line description and a line for a prompt, all PG", () => {
    for (const s of STAGES) {
      expect(STAGE_LABELS[s]).toMatch(/^\S+ \S/);
      expect(STAGE_LINES[s].length).toBeGreaterThan(10);
      expect(checkShowText({ text: `${STAGE_LABELS[s]} ${STAGE_LINES[s]} ${STANDING_LINES[s]}` }).ok).toBe(true);
    }
    // The PG word for friends with benefits, and nothing more explicit anywhere.
    expect(STAGE_LABELS.casual).toBe("🌙 Keeping it casual");
    expect(JSON.stringify([STAGE_LABELS, STAGE_LINES, STANDING_LINES])).not.toMatch(/benefit|hook|sex|slept|bed\b/i);
  });

  it("the seven base labels are unchanged", () => {
    expect(BASE_STAGES.map((s) => STAGE_LABELS[s])).toEqual(["👋 Just met", "✨ Sparks", "💞 Dating", "💍 Going steady", "🤝 Friends", "💔 Exes", "🔥 Bad blood"]);
  });

  it("orders a romance: each step past the last, and nothing apart or cold is ever a step up", () => {
    const climb: Stage[] = ["just_met", "sparks", "dating", "casual", "going_steady", "official", "moved_in", "engaged", "married"];
    for (let i = 1; i < climb.length; i++) expect(STAGE_RANK[climb[i]]).toBeGreaterThan(STAGE_RANK[climb[i - 1]]);
    for (const s of ["friends", "exes", "bad_blood", "didnt_click", "broke_up", "divorced"] as Stage[]) {
      expect(STAGE_RANK[s]).toBe(0);
      expect(steppedUp("going_steady", s)).toBe(false);
    }
    expect(steppedUp("going_steady", "official")).toBe(true);
    expect(steppedUp("exes", "back_together")).toBe(true);
    expect(steppedUp(null, "just_met")).toBe(false);
    expect(steppedUp("official", "official")).toBe(false);
    expect(justSplit("official", "broke_up")).toBe(true);
    expect(justSplit("broke_up", "broke_up")).toBe(false);
    expect(justSplit("sparks", "exes")).toBe(false);
  });

  it("a stored shown value falls back to a base stage when the switch is off", () => {
    expect(STAGES.map(baseOf).every((s) => (BASE_STAGES as readonly string[]).includes(s))).toBe(true);
    expect(shownStage("going_steady", "official", ON)).toBe("official");
    expect(shownStage("going_steady", "official", OFF)).toBe("going_steady");
    expect(shownStage("bad_blood", null, ON)).toBe("bad_blood");
    expect(shownStage(null, null, ON)).toBeNull();
  });
});

/* ----------------------------------------------- the edge, pure ----------------------------------------------- */

const [LO, HI] = pairKey("char-cass", "char-ira");
function ep(id: string, day: number, over: Partial<RelEpisode> = {}): RelEpisode {
  return {
    id,
    created_at: new Date(Date.UTC(2026, 9, day)).toISOString(),
    revealed_at: new Date(Date.UTC(2026, 9, day, 12)).toISOString(),
    visibility: "public",
    hidden: false,
    creator_id: "user-1",
    character_a: LO,
    character_b: HI,
    ending: "second_date",
    sides: null,
    box_score: null,
    transcript: [],
    afterglow: [],
    venue: "rooftop_bar",
    followup_of: null,
    ...over,
  };
}
const run = (seq: string) => [...seq].map((c, i) => ep(`e${i + 1}`, i + 1, { ending: c === "O" ? "second_date" : E[c], ...(c === "O" ? { overnight: true } : {}) }));
const spectator = { userId: null, owner: false };

describe("the edge carries both readings", () => {
  it("summary.stage is the base stage the rules read; summary.shown is what is told", () => {
    const rel = computeRelationship(LO, HI, run("SSSSSS"), ["Cass", "Ira"], [], {}, ON);
    expect(rel.public.stage).toBe("going_steady");
    expect(rel.public.shown).toBe("official");
    const off = computeRelationship(LO, HI, run("SSSSSS"), ["Cass", "Ira"], [], {}, OFF);
    expect(off.public.stage).toBe("going_steady");
    expect(off.public.shown).toBe("going_steady");
  });

  it("the view shows the stage, the line under it, and which date moved them", () => {
    const view = viewRelationship(computeRelationship(LO, HI, run("SSSSD")), spectator, new Date("2026-10-20T00:00:00Z"), ON)!;
    expect(view).toMatchObject({ stage: "broke_up", stage_label: "💔 Broke up", stage_line: "They were going steady, and then a date ended badly." });
    expect(view.timeline.map((t) => t.became ?? null)).toEqual([null, "Dating", null, "Going steady", "Broke up"]);
  });

  it("a single date that didn't click reads so on the couple's page, with no feud about it", () => {
    const view = viewRelationship(computeRelationship(LO, HI, run("D")), spectator, new Date("2026-10-20T00:00:00Z"), ON)!;
    expect(view).toMatchObject({ stage: "didnt_click", stage_label: "🤷 Didn't click" });
    expect(view.stage_line).toMatch(/didn't click/);
  });

  it("off, the view is today's: a base stage, no line, no step badges", () => {
    const view = viewRelationship(computeRelationship(LO, HI, run("SSSSSSD"), ["", ""], [], {}, OFF), spectator, new Date("2026-10-20T00:00:00Z"), OFF)!;
    expect(view).toMatchObject({ stage: "exes", stage_label: "💔 Exes", stage_line: null });
    expect(view.timeline.some((t) => "became" in t)).toBe(false);
  });

  it("an overnight date counts only on the layer that can see it", () => {
    const eps = run("SS");
    eps.push(ep("e3", 3, { overnight: true, visibility: "unlisted" }));
    const rel = computeRelationship(LO, HI, eps, ["", ""], [], {}, ON);
    expect(rel.all.shown).toBe("casual");
    expect(rel.public.shown).toBe("dating");
    expect(viewRelationship(rel, spectator, new Date(), ON)!.stage).toBe("dating");
  });

  it("OVERNIGHT_DATES=0 reads an overnight date as an ordinary one", () => {
    expect(computeRelationship(LO, HI, run("SSO"), ["", ""], [], {}, { OVERNIGHT_DATES: "0" }).public.shown).toBe("dating");
  });

  it("the date's prompt hears where they stand in plain words", () => {
    const casual = pairContext(computeRelationship(LO, HI, run("SSO")), LO, "user-1", null)!;
    expect(casual.where_you_stand_now).toBe("Keeping it casual");
    const official = pairContext(computeRelationship(LO, HI, run("SSSSSS")), LO, "user-1", null)!;
    expect(official.where_you_stand_now).toBe("Official");
    expect(checkShowText({ text: String(casual.where_you_stand_now) }).ok).toBe(true);
  });

  it("the Constellation's public timeline steps through the shown stages", () => {
    const steps = publicTimeline(dates("SSSSD"), ON).timeline.map((s) => s.stage);
    expect(steps).toEqual(["✨ Sparks", "💞 Dating", "💞 Dating", "💍 Going steady", "💔 Broke up"]);
    expect(publicTimeline(dates("SSSSD"), OFF).timeline.at(-1)!.stage).toBe("💔 Exes");
    expect(publicTimeline(dates("D"), ON).timeline[0].stage).toBe("🤷 Didn't click");
  });
});

/* ------------------------------------------- stored, logged, backfilled ------------------------------------------- */

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

let n = 0;
const A = "house-nell";
const B = "house-sable";
/** One aired public date between two characters, `day` days into October; no refresh. */
async function aired(a: string, b: string, ending: Ending, day: number, setup: Record<string, unknown> = {}) {
  const id = `rs-ep-${++n}`;
  const at = new Date(Date.UTC(2026, 9, day, 12)).toISOString();
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, revealed_at, visibility, setup, transcript, created_at)
     values ($1, 'system', $2, $3, 'a bar', '[]'::jsonb, '[]'::jsonb, 'T', 'F', $4, $5, 'public', $6::jsonb, '[]'::jsonb, $5)`,
    [id, a, b, ending, at, JSON.stringify({ venue: "rooftop_bar", ...setup })],
  );
  return id;
}
const stored = async (a = A, b = B) => {
  const [lo, hi] = pairKey(a, b);
  return (await t.db.query<{ stage: string | null; public_stage: string | null; shown_stage: string | null; public_shown_stage: string | null }>(`select stage, public_stage, shown_stage, public_shown_stage from relationships where character_a = $1 and character_b = $2`, [lo, hi])).rows[0];
};
const events = async (a = A, b = B) => {
  const [lo, hi] = pairKey(a, b);
  return (
    await t.db.query<{ layer: string; from_stage: string | null; to_stage: string | null; from_shown: string | null; to_shown: string | null; kind: string | null }>(
      `select layer, from_stage, to_stage, from_shown, to_shown, kind from relationship_events where character_a = $1 and character_b = $2 order by id`,
      [lo, hi],
    )
  ).rows;
};
const cast = async () => (await t.db.query<{ id: string }>(`select id from characters where is_house order by id limit 6`)).rows.map((r) => r.id);

describe("a refresh stores both stages and logs a move in either", () => {
  it("the base columns keep the seven; the shown columns hold the fuller reading", async () => {
    for (let d = 1; d <= 6; d++) await aired(A, B, "second_date", d);
    await refreshRelationship(t.db, A, B);
    expect(await stored()).toEqual({ stage: "going_steady", public_stage: "going_steady", shown_stage: "official", public_shown_stage: "official" });
    expect((await loadRelationship(t.db, A, B))!.public).toMatchObject({ stage: "going_steady", shown: "official" });
  });

  it("an event row keeps both readings, and is written when only the shown one moved", async () => {
    for (let d = 1; d <= 5; d++) await aired(A, B, "second_date", d);
    await refreshRelationship(t.db, A, B);
    const before = (await events()).length;
    await aired(A, B, "second_date", 6);
    await refreshRelationship(t.db, A, B);
    const added = (await events()).slice(before);
    // Going steady either way for the rules; official is new for the page.
    expect(added).toEqual([
      { layer: "all", from_stage: "going_steady", to_stage: "going_steady", from_shown: "going_steady", to_shown: "official", kind: null },
      { layer: "public", from_stage: "going_steady", to_stage: "going_steady", from_shown: "going_steady", to_shown: "official", kind: null },
    ]);
    // A refresh that changes nothing logs nothing.
    await refreshRelationship(t.db, A, B);
    expect((await events()).length).toBe(before + 2);
  });

  it("the readers' SQL takes the reading the switch shows, and skips a row where only the other moved", async () => {
    for (let d = 1; d <= 6; d++) {
      await aired(A, B, "second_date", d);
      await refreshRelationship(t.db, A, B);
    }
    const read = async (env: Record<string, string>) => {
      const m = eventStageSql("r", env);
      return (await t.db.query<{ to: string }>(`select ${m.to} as to from relationship_events r where r.layer = 'public' and r.kind is null and ${m.from} is distinct from ${m.to} order by r.id`)).rows.map((r) => r.to);
    };
    expect(await read(ON)).toEqual(["sparks", "dating", "going_steady", "official"]);
    expect(await read(OFF)).toEqual(["sparks", "dating", "going_steady"]);
  });

  it("off: the shown columns are emptied, the events are today's, and every reader shows the base stage", async () => {
    for (let d = 1; d <= 6; d++) await aired(A, B, "second_date", d);
    await refreshRelationship(t.db, A, B);
    expect((await stored()).public_shown_stage).toBe("official");
    await aired(A, B, "disaster", 7);
    await refreshRelationship(t.db, A, B, OFF);
    expect(await stored()).toEqual({ stage: "exes", public_stage: "exes", shown_stage: null, public_shown_stage: null });
    expect((await events()).slice(-2)).toEqual([
      { layer: "all", from_stage: "going_steady", to_stage: "exes", from_shown: null, to_shown: null, kind: null },
      { layer: "public", from_stage: "going_steady", to_stage: "exes", from_shown: null, to_shown: null, kind: null },
    ]);
    const rel = (await loadRelationship(t.db, A, B))!;
    expect(viewRelationship(rel, spectator, new Date(), OFF)).toMatchObject({ stage: "exes", stage_label: "💔 Exes", stage_line: null });
    // Back on: the stored row has no shown stage yet, and reads as its own dates say until the backfill reaches it.
    expect(viewRelationship(rel, spectator, new Date(), ON)!.stage).toBe("broke_up");
    expect((await storedStages(t.db, A, B, ON)).public_shown).toBe("broke_up");
    expect((await storedStages(t.db, A, B, OFF)).public_shown).toBe("exes");
  });

  it("a confrontation that didn't clear the air is read from what /house shows", async () => {
    await aired(A, B, "disaster", 1);
    await refreshRelationship(t.db, A, B);
    expect((await stored()).public_shown_stage).toBe("didnt_click");
    const scene = (id: string, day: string, outcome: string, lines = [{ n: 1 }]) =>
      t.db.query(
        `insert into house_scenes (id, day, season_id, kind, place, cast_ids, lines, told, result, source, written_at)
         values ($1, $2, '2026-10-01', 'confrontation', 'kitchen', $3::jsonb, $4::jsonb, '[]'::jsonb, $5::jsonb, 'template', now())`,
        [id, day, JSON.stringify([A, B]), JSON.stringify(lines), JSON.stringify({ kind: "confrontation", outcome, over: "mutual_distrust", a: B, b: A, witness: null, moved: [], settled: 0 })],
      );
    await scene("c1", "2026-10-03", "worse_than_before");
    await refreshRelationship(t.db, A, B);
    expect((await stored()).public_shown_stage).toBe("bad_blood");
    expect((await stored()).public_stage).toBe("bad_blood");
    // They have it out again and clear the air: the newest one counts.
    await scene("c2", "2026-10-05", "cleared_the_air");
    await refreshRelationship(t.db, A, B);
    expect((await stored()).public_shown_stage).toBe("didnt_click");
    // A scene /house no longer shows (its lines taken down) is not read.
    await scene("c3", "2026-10-06", "worse_than_before", []);
    await refreshRelationship(t.db, A, B);
    expect((await stored()).public_shown_stage).toBe("didnt_click");
  });
});

describe("the backfill is silent and invents nothing", () => {
  /** Rows as they were before this shipped: base stages stored, no shown stage. */
  async function legacy() {
    const [, , c, d, e] = await cast();
    for (let day = 1; day <= 12; day++) await aired(A, B, "second_date", day); // long-steady
    await aired(A, c, "disaster", 2); // one bad date
    await aired(A, d, "friends", 3);
    await aired(A, d, "disaster", 4); // history, then a disaster
    for (let day = 5; day <= 8; day++) await aired(A, e, "second_date", day);
    await aired(A, e, "disaster", 9); // steady, then a disaster
    for (const other of [B, c, d, e]) await refreshRelationship(t.db, A, other, OFF);
    await t.db.query(`delete from relationship_events`);
    await t.db.query(`delete from notifications`);
    return { c, d, e };
  }

  it("fills every row's shown stage from its own dates, with no event and no notice", async () => {
    const { c, d, e } = await legacy();
    expect((await stored()).public_shown_stage).toBeNull();
    expect(await backfillShownStages(t.db)).toBe(4);
    expect((await stored()).public_shown_stage).toBe("moved_in");
    expect((await stored(A, c)).public_shown_stage).toBe("didnt_click");
    expect((await stored(A, d)).public_shown_stage).toBe("bad_blood");
    expect((await stored(A, e)).public_shown_stage).toBe("broke_up");
    // The base stages are untouched.
    expect([(await stored()).public_stage, (await stored(A, c)).public_stage, (await stored(A, e)).public_stage]).toEqual(["going_steady", "bad_blood", "exes"]);
    expect((await t.db.query(`select 1 from relationship_events`)).rows).toEqual([]);
    expect((await t.db.query(`select 1 from notifications`)).rows).toEqual([]);
    // Done: nothing left to fill, and a second pass changes nothing.
    expect(await backfillShownStages(t.db)).toBe(0);
  });

  it("a stale row (its one bad date no longer public, the edge never refreshed) reads as its stored counts say", async () => {
    const { c } = await legacy();
    await t.db.query(`update episodes set visibility = 'unlisted' where (character_a = $1 and character_b = $2) or (character_a = $2 and character_b = $1)`, [A, c]);
    await backfillShownStages(t.db);
    expect(await stored(A, c)).toEqual({ stage: "bad_blood", public_stage: "bad_blood", shown_stage: "didnt_click", public_shown_stage: "didnt_click" });
  });

  it("grants no engagement, wedding or divorce: no history alone holds one", async () => {
    await legacy();
    await backfillShownStages(t.db);
    const all = (await t.db.query<{ s: string | null; p: string | null }>(`select shown_stage as s, public_shown_stage as p from relationships`)).rows.flatMap((r) => [r.s, r.p]);
    expect(all.filter((s) => s === "engaged" || s === "married" || s === "divorced")).toEqual([]);
  });

  it("does nothing while the switch is off", async () => {
    await legacy();
    expect(await backfillShownStages(t.db, { env: OFF })).toBe(0);
    expect((await stored()).public_shown_stage).toBeNull();
  });

  it("a row it hasn't reached yet announces only what a new date changed, never the new rules", async () => {
    const { c } = await legacy();
    const owner = `rs-follower-${++n}`;
    const [lo, hi] = pairKey(A, B);
    await t.db.query(`insert into couple_follows (user_id, character_lo, character_hi) values ($1, $2, $3)`, [owner, lo, hi]);
    const [clo, chi] = pairKey(A, c);
    await t.db.query(`insert into couple_follows (user_id, character_lo, character_hi) values ($1, $2, $3)`, [owner, clo, chi]);
    // The long-steady pair has one more second date: moved in before it and after it. No step up.
    const next = await aired(A, B, "second_date", 13);
    await refreshAndAnnounce(t.db, A, B, { episodeId: next });
    // The pair whose one date went badly has it refreshed for another reason: bad blood → didn't click is the rules, not news.
    await refreshAndAnnounce(t.db, A, c);
    const heard = await listNotifications(t.db, owner);
    expect(heard.filter((x) => x.kind === "stage_up")).toEqual([]);
    expect(heard.filter((x) => x.kind === "couple_date")).toHaveLength(1);
    expect((await events(A, c)).filter((r) => r.layer === "public")).toEqual([]);
    expect((await stored(A, c)).public_shown_stage).toBe("didnt_click");
  });
});

describe("a finale's mark outlives the timeline's retention", () => {
  it("the 400-day prune keeps an engagement row and drops the stage moves around it", async () => {
    const [lo, hi] = pairKey(A, B);
    const old = new Date("2025-01-01T00:00:00Z").toISOString();
    await t.db.query(`insert into relationship_events (character_a, character_b, layer, kind, at) values ($1, $2, 'public', 'engaged', $3)`, [lo, hi, old]);
    await t.db.query(`insert into relationship_events (character_a, character_b, layer, from_stage, to_stage, at) values ($1, $2, 'public', 'sparks', 'dating', $3)`, [lo, hi, old]);
    await t.db.query(`insert into relationship_events (character_a, character_b, layer, kind, at) values ($1, $2, 'public', 'overnight', $3)`, [lo, hi, old]);
    await pruneKeptData(t.db, new Date("2026-11-16T00:00:00Z"));
    expect((await events()).map((e) => e.kind ?? e.to_stage)).toEqual(["engaged"]);
  });
});

describe("followers hear a step up in the new stages, and a couple splitting", () => {
  async function follower(a = A, b = B) {
    const [lo, hi] = pairKey(a, b);
    const fan = `rs-fan-${++n}`;
    await t.db.query(`insert into couple_follows (user_id, character_lo, character_hi) values ($3, $1, $2)`, [lo, hi, fan]);
    return async () => (await listNotifications(t.db, fan)).filter((x) => x.kind === "stage_up").map((x) => `${x.title} | ${x.body}`);
  }

  it("official at six in a row; broke up when a steady couple's date ends badly; back together after", async () => {
    const heard = await follower();
    for (let d = 1; d <= 5; d++) await aired(A, B, "second_date", d);
    await refreshRelationship(t.db, A, B);
    const six = await aired(A, B, "second_date", 6);
    await refreshAndAnnounce(t.db, A, B, { episodeId: six });
    expect(await heard()).toEqual(["Nell & Sable: 💑 Official | 6 dates in a row have ended in another. They're official."]);
    const seven = await aired(A, B, "disaster", 7);
    await refreshAndAnnounce(t.db, A, B, { episodeId: seven });
    expect((await heard())[0]).toBe("Nell & Sable: 💔 Broke up | They were going steady. Their latest date ended badly.");
    const eight = await aired(A, B, "second_date", 8);
    await refreshAndAnnounce(t.db, A, B, { episodeId: eight });
    expect((await heard())[0]).toBe("Nell & Sable: 🔁 Back together | They had split. Their latest date ended in another.");
  });

  it("a date that didn't click, exes and bad blood are never announced as a stage", async () => {
    const heard = await follower();
    const one = await aired(A, B, "disaster", 1);
    await refreshAndAnnounce(t.db, A, B, { episodeId: one });
    const two = await aired(A, B, "disaster", 2);
    await refreshAndAnnounce(t.db, A, B, { episodeId: two });
    expect((await stored()).public_shown_stage).toBe("bad_blood");
    expect(await heard()).toEqual([]);
  });

  it("keeping it casual: they left an overnight date together", async () => {
    const heard = await follower();
    for (let d = 1; d <= 2; d++) await aired(A, B, "second_date", d);
    await refreshRelationship(t.db, A, B);
    const night = await aired(A, B, "second_date", 3, { overnight: true });
    await refreshAndAnnounce(t.db, A, B, { episodeId: night });
    expect(await heard()).toEqual(["Nell & Sable: 🌙 Keeping it casual | They left an overnight date together, and they're keeping it casual."]);
  });
});

/* ------------------------------------------------- the readers ------------------------------------------------- */

describe("the story map and Talk of the house", () => {
  const person = (id: string, name: string) => ({ id, name, hue: 1, portrait: null, house: true, visibility: "public", owner_id: null });
  const facts = (stage: string) => ({
    now: new Date("2026-11-15T15:00:00Z"),
    season_id: "2026-11-01",
    cast: ["house-nell", "house-sable"],
    lead: null,
    people: [person("house-nell", "Nell Okafor"), person("house-sable", "Sable Voss")],
    beats: [],
    pairs: [{ a: "house-nell", b: "house-sable", stage, dates: 3, second_dates: 2, last_at: "2026-11-14T13:00:00Z" }],
    rooms: [],
    scenes: [],
  });
  const ties = (stage: string) => shapeStoryMap(facts(stage) as Parameters<typeof shapeStoryMap>[0]).ties.map((x) => `${x.kind}: ${x.text}`);

  it("a date that didn't click is no tie; bad blood with cause still is", () => {
    expect(ties("didnt_click")).toEqual([]);
    expect(ties("bad_blood")).toEqual(["bad_blood: Nell and Sable: bad blood after their date"]);
  });

  it("couples read in their own words, and a breakup is its own kind", () => {
    expect(ties("casual")).toEqual(["together: Nell and Sable: keeping it casual"]);
    expect(ties("official")).toEqual(["together: Nell and Sable: official"]);
    expect(ties("moved_in")).toEqual(["together: Nell and Sable: moved in together"]);
    expect(ties("engaged")).toEqual(["together: Nell and Sable: engaged"]);
    expect(ties("back_together")).toEqual(["together: Nell and Sable: back together"]);
    expect(ties("broke_up")).toEqual(["broke_up: Nell and Sable: broke up"]);
    expect(ties("divorced")).toEqual(["broke_up: Nell and Sable: divorced"]);
    expect(ties("going_steady")).toEqual(["together: Nell and Sable: going steady"]);
    // A breakup outranks a standing couple and a second date; the house's own stories still lead.
    expect(TIE_KINDS.indexOf("broke_up")).toBeLessThan(TIE_KINDS.indexOf("together"));
    expect(TIE_KINDS.indexOf("feuding")).toBeLessThan(TIE_KINDS.indexOf("broke_up"));
  });

  const talk = (stage: Stage) =>
    shapeTalk({
      character: { id: "house-nell", name: "Nell Okafor" },
      scenes: [],
      beats: [],
      edges: [{ other: "house-sable", stage, last_at: "2026-11-14T17:00:00Z", path: "/couples/house-nell/house-sable" }],
      people: new Map([["house-sable", { id: "house-sable", name: "Sable" }]]),
    });

  it("Friction holds bad blood and a breakup, never a date that didn't click", () => {
    expect(talk("didnt_click")).toMatchObject({ friction: [], after: [], empty: true });
    expect(talk("bad_blood").friction.map((f) => `${f.kind}: ${f.text}`)).toEqual(["bad_blood: Bad blood with Sable."]);
    expect(talk("broke_up").friction.map((f) => `${f.kind}: ${f.text}`)).toEqual(["breakup: Broke up with Sable."]);
    expect(talk("divorced").friction.map((f) => f.text)).toEqual(["Divorced from Sable."]);
  });

  it("who they are with, in the stage's words", () => {
    expect(talk("casual").after.map((a) => a.text)).toEqual(["Nell and Sable are keeping it casual."]);
    expect(talk("official").after.map((a) => a.text)).toEqual(["Nell and Sable are official."]);
    expect(talk("moved_in").after.map((a) => a.text)).toEqual(["Nell and Sable have moved in together."]);
    expect(talk("back_together").after.map((a) => a.text)).toEqual(["Nell and Sable are back together."]);
    // The two that were there before read as they did.
    expect(talk("dating").after.map((a) => a.text)).toEqual(["Nell and Sable are together: dating."]);
    expect(talk("sparks").after.map((a) => a.text)).toEqual(["Nell and Sable agreed to a second date."]);
  });

  it("Right now tells a breakup as a standing, with the couple's page behind it", () => {
    const now = shapeNow({ character: { id: "house-nell", name: "Nell Okafor" }, circle: null, talk: talk("broke_up"), week: null, lastDate: null, today: "2026-11-15" })!;
    expect(now.lines.map((l) => `${l.icon} ${l.text}`)).toEqual(["💔 Broke up with Sable"]);
    const casual = shapeNow({ character: { id: "house-nell", name: "Nell Okafor" }, circle: null, talk: talk("casual"), week: null, lastDate: null, today: "2026-11-15" })!;
    expect(casual.lines.map((l) => l.text)).toEqual(["Nell and Sable are keeping it casual"]);
  });
});

describe("the characters know: memory and the story state", () => {
  const p = (over: Partial<PersonMemory>): PersonMemory => ({
    id: "house-sable", name: "Sable Voss", house: true, dates: 1, status: "bad_blood", last_ending: "disaster", last_venue: null, last_at: "2026-11-10T00:00:00Z",
    turned_down: null, wanted_more: null, they_said: null, you_said: null, ...over,
  });

  it("one date that ended badly is 'didn't click' from a memory stored before this, without a rebuild", () => {
    const old = p({ stage: "bad_blood" });
    expect(shownPairStatus(old.status, old.dates, ON)).toBe("didnt_click");
    expect(personStage(old, ON)).toBe("didnt_click");
    expect(personLabel(old, ON)).toBe("🤷 Didn't click");
    expect(standingWords(old, ON)).toBe("didn't click");
    // With history it is still bad blood; and off, everything is as stored.
    expect(shownPairStatus("bad_blood", 2, ON)).toBe("bad_blood");
    expect(personLabel(p({ dates: 2, stage: "bad_blood" }), ON)).toBe("🔥 Bad blood");
    expect(shownPairStatus(old.status, old.dates, OFF)).toBe("bad_blood");
    expect(personLabel(old, OFF)).toBe("🔥 Bad blood");
    expect(personStage(p({ status: "seeing", stage: "official", dates: 6 }), OFF)).toBe("going_steady");
  });

  it("a date's prompt says where they stand without a feud that never was, and a companion can say they're official", () => {
    const memory = { people: [p({ stage: "bad_blood" })] } as unknown as CharacterMemory;
    expect(metBefore(memory, "house-sable")!.where_you_stand).toBe("You met once; it didn't click, and that's all it was.");
    const official = { people: [p({ status: "seeing", stage: "official", dates: 6, last_ending: "second_date" })] } as unknown as CharacterMemory;
    expect(metBefore(official, "house-sable")!.where_you_stand).toBe("You're official now.");
    expect(standingWords(p({ status: "seeing", stage: "casual", dates: 3 }), ON)).toBe("keeping it casual");
    // The statuses that already had words keep them.
    expect(standingWords(p({ status: "seeing", stage: "dating", dates: 2 }), ON)).toBe("seeing");
  });

  it("no score to settle over a date that didn't click; a real falling-out still is one", () => {
    const facts = (people: Parameters<typeof wantFromRules>[0]["people"]) => ({ holder: "house-nell", lead: null, suitors: [], opinions: [], people, knows: [], rivals: {} }) as unknown as Parameters<typeof wantFromRules>[0];
    const once = wantFromRules(facts([{ id: "house-sable", name: "Sable Voss", status: "bad_blood", last_ending: "disaster", turned_down: null, wanted_more: null, dates: 1 }]));
    expect(once).toMatchObject({ kind: "prove", about_id: null });
    const twice = wantFromRules(facts([{ id: "house-sable", name: "Sable Voss", status: "bad_blood", last_ending: "disaster", turned_down: null, wanted_more: null, dates: 2 }]));
    expect(twice).toMatchObject({ kind: "settle_score", about_id: "house-sable" });
  });

  it("only real bad blood caps trust after a date", () => {
    const f = { ending: "disaster" as const, feeling: "comfortable" as const, strength: 0.5, seeAgain: "no" as const, turnedDown: null, walkedOut: null, otherName: "Sable", texts: [] };
    expect(firsthandOpinion({ ...f, status: "didnt_click" }).trust).toBe(0);
    expect(firsthandOpinion({ ...f, status: "bad_blood" }).trust).toBe(-1);
  });
});
