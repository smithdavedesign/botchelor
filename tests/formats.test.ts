import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  api,
  episodeJson,
  HOUSE_PARTNER_ID,
  newUserCookie,
  scriptedModel,
  scriptOutcome,
  startTestDb,
  validCharacter,
} from "./helpers";
import { buildMessages } from "@/lib/showrunner";
import { simulateConversation, type Turn } from "@/lib/conversation";
import {
  deterministicEngine,
  NEUTRAL_SIGNALS,
  type CharacterSheet,
  type DateInput,
  type Outcome,
  type SideOutcome,
  type SideSetup,
} from "@/lib/engine";
import type { Model } from "@/lib/model";
import { buildDate, type CharacterForDate, type DateRequest } from "@/lib/simulation";
import { DEFAULT_FORMAT, FORMATS, format, type FormatId } from "@/lib/formats";

const sheetA: CharacterSheet = { name: "Mira", age: 27, bio: "a cartographer", traits: ["curious", "warm"], want: "a map reader", dealbreaker: "hates surprises", house: false };
const sheetB: CharacterSheet = { name: "Rafe", age: 30, bio: "a baker", traits: ["dramatic", "kind"], want: "an honest taste-tester", dealbreaker: "liars", house: true };
const side = (sheet: CharacterSheet): SideSetup => ({
  sheet, signals: NEUTRAL_SIGNALS, autonomy: "balanced", strategy: "genuine_chemistry", agendaId: "find_adventurous", note: null, gameBudget: 25,
});
const INPUT: DateInput = { a: side(sheetA), b: side(sheetB) };
const sideOutcome = (wants: boolean): SideOutcome => ({ wants_another: wants, agenda_met: true, satisfied: wants, dealbreaker_hit: null, want_met: null, note_followed: null });
const OUTCOME: Outcome = { ...deterministicEngine.decide(INPUT, 1), sides: [sideOutcome(true), sideOutcome(false)] };

const turnJson = () => JSON.stringify({ dialogue: "A friendly, safe line.", action: "asks", emotion: "curious", interest_signal: 0.5 });
function turnModel(n: number): Model {
  const queue = Array.from({ length: n }, turnJson);
  return { async complete() { return queue.shift() ?? turnJson(); } };
}

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

describe("formats — the catalogue", () => {
  it("defaults to classic and falls back for unknown ids", () => {
    expect(DEFAULT_FORMAT).toBe("classic");
    expect(format(undefined).id).toBe("classic");
    expect(format("not_a_format" as never).id).toBe("classic");
    expect(FORMATS.map((f) => f.id)).toContain("speed_date");
  });

  it("every format is free today (the paid-pack seam is present but off)", () => {
    for (const f of FORMATS) expect(f.premiumSku).toBeNull();
  });

  it("a speed date is snappier (a turn override); classic has none", () => {
    expect(format("speed_date").turns).toBe(6);
    expect(format("classic").turns).toBeUndefined();
  });
});

describe("formats — fairness (the engine never sees the format)", () => {
  it("same characters + same seed => identical outcome in every format", async () => {
    const aFor: CharacterForDate = { id: "fmt-a", sheet: sheetA };
    const bFor: CharacterForDate = { id: "fmt-b", sheet: sheetB };
    const req = (f: FormatId): DateRequest => ({ autonomy: "balanced", strategy: "genuine_chemistry", gameBudget: 25, agendaId: "find_adventurous", note: null, format: f });

    const classic = await buildDate(t.db, "ep-classic", aFor, bFor, req("classic"), 4242);
    const speed = await buildDate(t.db, "ep-speed", aFor, bFor, req("speed_date"), 4242);

    // The format is recorded on the setup...
    expect(classic.setup.format).toBe("classic");
    expect(speed.setup.format).toBe("speed_date");
    // ...but it is not part of the engine input, so the decided outcome is byte-identical.
    const o1 = deterministicEngine.decide(classic.input, classic.seed);
    const o2 = deterministicEngine.decide(speed.input, speed.seed);
    expect(o2).toEqual(o1);
  });
});

describe("formats — framing only", () => {
  it("the showrunner prompt carries the chosen format's note", () => {
    const user = (f: FormatId) =>
      buildMessages(INPUT, OUTCOME, [null, null], "a_hard_question", "rooftop_bar", f)
        .filter((m) => m.role === "user").map((m) => m.content).join("\n");
    expect(user("speed_date")).toContain("SPEED DATE");
    expect(user("meet_the_parents")).toContain("CHAPERONE");
    expect(user("classic")).not.toContain("SPEED DATE");
  });

  it("a speed date runs fewer conversation turns than a classic date", async () => {
    const classic: Turn[] = await simulateConversation(turnModel(8), INPUT, OUTCOME, [null, null], "a_hard_question", "rooftop_bar", "classic");
    const speed: Turn[] = await simulateConversation(turnModel(6), INPUT, OUTCOME, [null, null], "a_hard_question", "rooftop_bar", "speed_date");
    expect(classic.length).toBe(8);
    expect(speed.length).toBe(6);
  });
});

describe("formats — the episode route", () => {
  it("stores a chosen format and surfaces it on the episode; classic is left unbadged", async () => {
    const creator = newUserCookie();
    const character = await (await api.createCharacter(validCharacter(), creator)).json();

    scriptOutcome({ ending: "second_date" });
    scriptedModel([episodeJson()]);
    const speed = await (await api.createEpisode({ character_id: character.id, partner_id: HOUSE_PARTNER_ID, format: "speed_date" }, creator)).json();
    expect(speed.format).toBe("speed_date");

    scriptOutcome({ ending: "friends" });
    scriptedModel([episodeJson()]);
    const classic = await (await api.createEpisode({ character_id: character.id, partner_id: HOUSE_PARTNER_ID }, creator)).json();
    expect(classic.format).toBeUndefined();
  });

  it("rejects an unknown format with 422", async () => {
    const creator = newUserCookie();
    const character = await (await api.createCharacter(validCharacter(), creator)).json();
    const res = await api.createEpisode({ character_id: character.id, partner_id: HOUSE_PARTNER_ID, format: "telenovela" }, creator);
    expect(res.status).toBe(422);
  });
});
