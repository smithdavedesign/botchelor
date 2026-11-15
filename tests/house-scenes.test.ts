/**
 * The daily house scene (lib/house-scenes.ts, the drama wave 2026-11-15): what the writer may know, every check on a
 * line, what a scene tells to whom through `hear`, the one harmless wrong retelling, the owner's notification and text,
 * reports, the switch, the empty states and the page's lists. No paid calls.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as adminReports, POST as adminReview } from "@/app/api/admin/reports/route";
import { POST as adminWrite } from "@/app/api/admin/house-scene/route";
import { POST as reportRoute } from "@/app/api/house/[id]/report/route";
import { textLink } from "@/lib/companion-shared";
import { getThread } from "@/lib/companion";
import { HOUSE_CHARACTERS } from "@/lib/house";
import {
  applyTold,
  checkEnding,
  checkSceneLines,
  ensureHouseScene,
  factClaim,
  harmlessWrong,
  houseLine,
  houseScene,
  houseScenesOn,
  houseTalkLines,
  houseUpkeep,
  HOUSE_PAGE_SIZE,
  inFirstPerson,
  isScene,
  latestHouseScene,
  listHouseScenes,
  listSceneReports,
  pickRoom,
  reportSceneLine,
  reviewSceneLine,
  sceneFacts,
  sceneIdOf,
  scenePrompt,
  sceneSource,
  sensitiveClaim,
  templateScene,
  toldBy,
  voicesTake,
  type SceneDate,
  type SceneFacts,
  type SceneMember,
} from "@/lib/house-scenes";
import type { ChatMessage, Model } from "@/lib/model";
import { shortName } from "@/lib/names";
import { REPORT_HIDE_THRESHOLD } from "@/lib/rules";
import { checkSheetText, checkShowText } from "@/lib/safety";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { clearSharedCache } from "@/lib/shared-cache";
import { showSince } from "@/lib/show-since";
import { hear, setOpinion, tensions } from "@/lib/story-state";
import { seasonIdOf } from "@/lib/season-window";
import { BASE_URL, jsonRequest, startTestDb } from "./helpers";

vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
}));
const { default: HousePage } = await import("@/app/house/page");

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});

// The cast: five house characters. Rafe and Juniper go on the date; Dex, Marisol and Teo are left to talk about it.
const CAST = HOUSE_CHARACTERS.slice(0, 5);
const [RAFE, JUNIPER, DEX, MARISOL, TEO] = CAST.map((c) => c.id);
const OFF_CAST = HOUSE_CHARACTERS[6];
const first = (id: string) => shortName(HOUSE_CHARACTERS.find((c) => c.id === id)?.name ?? id);
// 18:20 UTC on Nov 12: the first pass from the scene's hour on.
const NOW = new Date("2026-11-12T18:20:00Z");
const DAY = "2026-11-12";
const SCENE = sceneIdOf(DAY);
const HOURS = 60 * 60 * 1000;
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOURS).toISOString();
const HIDDEN = "Still sleeps with a night light shaped like a moon.";

beforeEach(async () => {
  await t.reset();
  // A reset keeps notifications (other suites key them by fresh user ids); these tests reuse their owners.
  await t.db.query(`delete from notifications`);
  clearSharedCache();
  setSeasonCastForTests(CAST.map((c) => c.id));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  setSeasonCastForTests(null);
});

let n = 0;
async function episode(a: string, b: string, e: { ending?: string; revealedAt?: string | null; visibility?: string; venue?: string } = {}) {
  const id = `hs-ep-${++n}`;
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, revealed_at, visibility, setup, transcript)
     values ($1, 'system', $2, $3, 'a bar', '[]'::jsonb, '[]'::jsonb, 'TWIST-WORDS', 'FINALE-WORDS', $4, $5, $6, $7::jsonb, '[]'::jsonb)`,
    [id, a, b, e.ending ?? "friends", e.revealedAt === undefined ? ago(3) : e.revealedAt, e.visibility ?? "public", JSON.stringify({ venue: e.venue ?? "rooftop_bar" })],
  );
  return id;
}
async function person(name: string, owner: string, visibility = "public") {
  const id = `hs-char-${++n}`;
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility)
     values ($1, $2, false, $3, 30, 'Bakes bread and argues with the radio.', '["kind"]'::jsonb, 'someone kind', 'liars', $4)`,
    [id, owner, name, visibility],
  );
  return id;
}
const heardRows = async () =>
  (await t.db.query<{ holder_id: string; about_id: string; about_b_id: string | null; claim: string; told_by: string | null; source: string; is_true: boolean }>(
    `select holder_id, about_id, about_b_id, claim, told_by, source, is_true from character_heard where told_by is not null order by source, holder_id`,
  )).rows;

/** A model that answers with `reply` and remembers what it was asked; it reports usage like the real one. */
const answering = (reply: string | Error) => {
  const calls: ChatMessage[][] = [];
  const model: Model = {
    async complete(messages, options) {
      calls.push(messages);
      if (reply instanceof Error) throw reply;
      options?.onUsage?.({ model: "gemini-3.5-flash-lite", input: 900, cachedInput: 0, output: 300, thinking: 0 });
      return reply;
    },
  };
  return { model, calls };
};
const script = (lines: Record<string, unknown>[]) => JSON.stringify({ lines });

/* ------------------------------------------------ pure pieces ------------------------------------------------ */

const member = (id: string): SceneMember => {
  const c = HOUSE_CHARACTERS.find((h) => h.id === id)!;
  return { id, name: c.name, bio: c.bio, house: true };
};
const date = (a: string, b: string, ending: SceneDate["ending"], venue = "rooftop_bar", episode_id = `ep-${a}-${b}`): SceneDate => ({
  episode_id, a, b, a_name: HOUSE_CHARACTERS.find((h) => h.id === a)!.name, b_name: HOUSE_CHARACTERS.find((h) => h.id === b)!.name,
  ending, ending_detail: null, venue, date_number: null, rejected: null, walked_out: null,
});
const facts = (over: Partial<SceneFacts> = {}): SceneFacts => ({
  id: SCENE, day: DAY, place: "kitchen", speakers: [member(DEX), member(MARISOL), member(TEO)], dates: [date(RAFE, JUNIPER, "friends")],
  notes: {}, takes: {}, askWrong: true, tension: null, ...over,
});
const R = first(RAFE);
const J = first(JUNIPER);

describe("who is in the room (pickRoom)", () => {
  const cast = CAST.map((c) => member(c.id));
  it("seats two or three cast members who were not on the date, and never anyone who was", () => {
    const room = pickRoom(DAY, cast, [date(RAFE, JUNIPER, "friends")])!;
    expect(room.speakers.length).toBeGreaterThanOrEqual(2);
    expect(room.speakers.length).toBeLessThanOrEqual(3);
    expect(room.speakers.map((s) => s.id)).not.toContain(RAFE);
    expect(room.speakers.map((s) => s.id)).not.toContain(JUNIPER);
    // Deterministic: the same day deals the same room.
    expect(pickRoom(DAY, cast, [date(RAFE, JUNIPER, "friends")])!.speakers).toEqual(room.speakers);
  });
  it("follows a tension when both of its people were off a date, preferring the date its subject was on", () => {
    const dates = [date(RAFE, JUNIPER, "friends"), date(RAFE, MARISOL, "disaster", "cooking_class")];
    const room = pickRoom(DAY, cast, dates, [{ kind: "rivals", a: DEX, b: TEO, about: MARISOL }])!;
    expect(room.speakers.slice(0, 2).map((s) => s.id)).toEqual([DEX, TEO]);
    expect(room.dates[0].b).toBe(MARISOL);
    expect(room.tension).toMatchObject({ kind: "rivals", a: DEX, b: TEO });
    // Nobody in the room was on any date it talks about.
    for (const d of room.dates) for (const s of room.speakers) expect([d.a, d.b]).not.toContain(s.id);
  });
  it("is quiet when the cast can't field two people who weren't on the date", () => {
    expect(pickRoom(DAY, [member(RAFE), member(JUNIPER), member(DEX)], [date(RAFE, JUNIPER, "friends")])).toBeNull();
    // A tension whose people were on the date is passed over, not seated.
    const room = pickRoom(DAY, cast, [date(RAFE, JUNIPER, "friends")], [{ kind: "rivals", a: RAFE, b: DEX, about: null }])!;
    expect(room.tension).toBeNull();
  });
});

describe("the checks on a line (checkSceneLines)", () => {
  const f = facts();
  const keep = (raw: Record<string, unknown>[], ff: SceneFacts = f, hidden: string[] = []) => checkSceneLines(raw, ff, hidden);

  it("keeps a faithful retelling as the public record's own words, never the model's", () => {
    const [line] = keep([{ from: first(DEX), text: `${R} and ${J}, the rooftop bar. Friends. That's the whole story.`, retells: 1, faithful: true }]);
    expect(line.character_id).toBe(DEX);
    expect(line.tell).toEqual({ episode_id: f.dates[0].episode_id, about: RAFE, about_b: JUNIPER, claim: factClaim(f.dates[0]), is_true: true });
    expect(line.tell!.claim).toBe(`${R} and ${J}'s first date at a rooftop bar at golden hour: they parted as friends.`);
  });

  it("drops a line from someone not in the scene, one that isn't PG, one too long, and meme-speak", () => {
    expect(keep([{ from: R, text: "I was there, it was fine." }])).toEqual([]); // on the date, so not in the room
    expect(keep([{ from: shortName(OFF_CAST.name), text: "Evening, all." }])).toEqual([]);
    expect(keep([{ from: first(DEX), text: "They got naked on the roof." }])).toEqual([]);
    expect(keep([{ from: first(DEX), text: "x".repeat(200) }])).toEqual([]);
    expect(keep([{ from: first(DEX), text: `${J} has main character energy tonight.` }])).toEqual([]);
    expect(keep([{ from: first(DEX), text: "Pass the tea towel." }])).toHaveLength(1);
  });

  it("drops anyone talking as if they had been on the date, and any hidden secret", () => {
    expect(keep([{ from: first(DEX), text: `I gave ${J} a seven, and I stand by it.` }])).toEqual([]);
    expect(keep([{ from: first(DEX), text: `We left before ${R} even ordered.` }])).toEqual([]);
    expect(keep([{ from: first(TEO), text: "Someone here still sleeps with a moon night light." }], f, [HIDDEN])).toEqual([]);
  });

  it("drops anything about crime, health, money or sex, true or not", () => {
    for (const text of [`${R} stole her scarf.`, `${J} was drunk by eight.`, `${R} made her pay for everything, he's broke.`, `${R} and ${J} kissed on the stairs.`, `${J} went home with him.`]) {
      expect(sensitiveClaim(text)).toBe(true);
      expect(keep([{ from: first(DEX), text, retells: 1, faithful: true }])).toEqual([]);
    }
    expect(sensitiveClaim(`${R} talked about bread for an hour.`)).toBe(false);
  });

  it("checks the ending against the fact: a contradiction is dropped, faithful or not", () => {
    expect(checkEnding("They both want a second date.", { ending: "friends" })).toBe("contradicts");
    expect(checkEnding("No second date for those two.", { ending: "friends" })).toBe("exaggerated");
    expect(checkEnding("Just friends, apparently.", { ending: "second_date" })).toBe("contradicts");
    expect(checkEnding("Just friends, apparently.", { ending: "disaster" })).toBe("contradicts");
    expect(checkEnding("It was a disaster from the first hello.", { ending: "friends" })).toBe("exaggerated");
    expect(checkEnding("Friends. Fine. Nobody cried.", { ending: "friends" })).toBe("ok");
    expect(keep([{ from: first(DEX), text: `${R} and ${J} both want a second date, I hear.`, retells: 1, faithful: true }])).toEqual([]);
    expect(keep([{ from: first(DEX), text: `${R} and ${J} both want a second date, I hear.`, retells: 1, faithful: false, claim: `${R} said he wants a second date.` }])).toEqual([]);
    // A plain reaction that names the pair still can't contradict their date.
    expect(keep([{ from: first(DEX), text: `${R} and ${J} are seeing each other again, obviously.`, retells: null }])).toEqual([]);
  });

  it("checks the place against the fact: a retelling that moves the date to another date's place is dropped", () => {
    const two = facts({ dates: [date(RAFE, JUNIPER, "friends", "rooftop_bar"), date(RAFE, OFF_CAST.id, "disaster", "cooking_class")] });
    expect(keep([{ from: first(DEX), text: `${R} and ${J} at the cooking class. Friends.`, retells: 1, faithful: true }], two)).toEqual([]);
    expect(keep([{ from: first(DEX), text: `${R} and ${J} at the rooftop bar. Friends.`, retells: 1, faithful: true }], two)).toHaveLength(1);
  });

  it("a retelling that names neither of the date's people stays a plain line and tells nothing", () => {
    const [line] = keep([{ from: first(DEX), text: "Friends. I could have told them that.", retells: 1, faithful: true }]);
    expect(line.tell).toBeUndefined();
    expect(keep([{ from: first(DEX), text: "Lovely evening for it.", retells: 7, faithful: true }])[0].tell).toBeUndefined();
  });

  it("never puts one character's private take in another's mouth", () => {
    const withTakes = facts({ takes: { [MARISOL]: ["Rafe is charming until the conversation turns serious, then he vanishes."] } });
    expect(voicesTake("Rafe is charming until things turn serious, then he vanishes.", withTakes.takes[MARISOL][0], ["Rafe Calloway"])).toBe(true);
    expect(keep([{ from: first(DEX), text: `${R} is charming until things turn serious, then he vanishes.` }], withTakes)).toEqual([]);
    // Its own take is its own to say.
    expect(keep([{ from: first(MARISOL), text: `${R} is charming until things turn serious, then he vanishes.` }], withTakes)).toHaveLength(1);
    // Small talk that shares a name is not a take.
    expect(voicesTake("Rafe again? Really?", "I like Rafe.", ["Rafe Calloway"])).toBe(false);
  });

  describe("the one wrong retelling", () => {
    it("allows one, in a harmless way, stored in the writer's own plain sentence and marked untrue", () => {
      const lines = keep([
        { from: first(DEX), text: `${R} and ${J}, rooftop bar. Friends.`, retells: 1, faithful: true },
        { from: first(MARISOL), text: `I heard ${R} was out the door before the second drink.`, retells: 1, faithful: false, claim: `${R} left before the second drink.` },
      ]);
      expect(lines.map((l) => l.tell?.is_true)).toEqual([true, false]);
      expect(lines[1].tell!.claim).toBe(`${R} left before the second drink.`);
    });

    it("drops a second wrong retelling whole: at most one a scene", () => {
      const lines = keep([
        { from: first(MARISOL), text: `I heard ${R} was out the door early.`, retells: 1, faithful: false, claim: `${R} left before the second drink.` },
        { from: first(TEO), text: `And ${J} told him he talks too much.`, retells: 1, faithful: false, claim: `${J} told ${R} he talks too much.` },
        { from: first(DEX), text: "You two should start a newspaper." },
      ]);
      expect(lines).toHaveLength(2);
      expect(lines.filter((l) => l.tell && !l.tell.is_true)).toHaveLength(1);
      expect(lines[1].character_id).toBe(DEX);
    });

    it("drops a wrong retelling that isn't one of the harmless kinds, rather than softening it", () => {
      const wrong = (claim: string, text = `Word is something happened with ${R}.`) => keep([{ from: first(MARISOL), text, retells: 1, faithful: false, claim }]);
      expect(wrong(`${R} stole the tip jar.`)).toEqual([]); // crime
      expect(wrong(`${J} said ${R} is broke.`)).toEqual([]); // money
      expect(wrong(`${J} was sick all night.`)).toEqual([]); // health
      expect(wrong(`${R} kissed the waiter.`)).toEqual([]); // sex
      expect(wrong(`${R} wore a green jacket.`)).toEqual([]); // harmless, but not who left / who said / an exaggeration
      expect(wrong(`${first(TEO)} left early.`)).toEqual([]); // not about the date's people
      expect(wrong(`${R} said they both want a second date.`)).toEqual([]); // gets the ending itself wrong
      expect(wrong("He left early.")).toEqual([]); // names nobody
      // A line the writer owns up to as wrong never survives as a plain line: no fact named, or a claim that fails.
      expect(keep([{ from: first(MARISOL), text: "And then they parted as friends right by the mats.", retells: 1, faithful: false, claim: `${R} and ${J} parted as friends right by the mats.` }])).toEqual([]);
      expect(keep([{ from: first(MARISOL), text: "I made all of that up.", retells: null, faithful: false }])).toEqual([]);
      expect(wrong(`${R} left before the second drink.`)).toHaveLength(1);
      expect(harmlessWrong(`${J} didn't laugh once the whole night.`, f.dates[0], f)).toBe(`${J} didn't laugh once the whole night.`);
      expect(harmlessWrong(42, f.dates[0], f)).toBeNull();
    });

    it("counts an exaggerated ending it catches as the wrong one, whatever the writer said", () => {
      const lines = keep([{ from: first(MARISOL), text: `${R} and ${J}? It was a disaster, he never stopped talking.`, retells: 1, faithful: true }]);
      expect(lines[0].tell).toMatchObject({ is_true: false, claim: `${R} and ${J}? It was a disaster, he never stopped talking.` });
    });
  });

  it("is a scene only with four lines, two voices and at least one retelling", () => {
    const plain = (who: string, text: string) => ({ from: first(who), text });
    const told = { from: first(DEX), text: `${R} and ${J}. Friends.`, retells: 1, faithful: true };
    expect(isScene(keep([told, plain(MARISOL, "Hm."), plain(DEX, "Hm?"), plain(MARISOL, "Nothing.")]))).toBe(true);
    expect(isScene(keep([told, plain(MARISOL, "Hm."), plain(DEX, "Hm?")]))).toBe(false);
    expect(isScene(keep([plain(DEX, "Tea?"), plain(MARISOL, "Hm."), plain(DEX, "Hm?"), plain(MARISOL, "Nothing.")]))).toBe(false);
    expect(isScene(keep([told, plain(DEX, "One."), plain(DEX, "Two."), plain(DEX, "Three.")]))).toBe(false);
    // Never more than six.
    expect(keep(Array.from({ length: 9 }, (_, i) => plain(i % 2 ? DEX : TEO, `Line number ${i + 1}.`)))).toHaveLength(6);
  });
});

describe("what a scene tells to whom (toldBy)", () => {
  const tell = (is_true = true, claim = "c") => ({ episode_id: "ep-1", about: RAFE, about_b: JUNIPER, claim, is_true });
  it("tells everyone else in the room, each claim once, each telling with its own source", () => {
    const told = toldBy(SCENE, [
      { character_id: DEX, text: "one", tell: tell() },
      { character_id: MARISOL, text: "two" },
      { character_id: MARISOL, text: "three", tell: tell() }, // the same fact again: everyone in the room has it already
      { character_id: TEO, text: "four", tell: tell(false, `${R} left early.`) },
    ], [DEX, MARISOL, TEO]);
    expect(told.map((x) => [x.line, x.by, x.to, x.source, x.is_true])).toEqual([
      [1, DEX, [MARISOL, TEO], `scene:${SCENE}#1`, true],
      [4, TEO, [DEX, MARISOL], `scene:${SCENE}#4`, false],
    ]);
    expect(sceneSource(SCENE, 4)).toBe(`scene:${SCENE}#4`);
  });
  it("tells nothing for a line that was taken down", () => {
    expect(toldBy(SCENE, [{ character_id: DEX, text: "one", tell: tell(), removed: true }], [DEX, MARISOL])).toEqual([]);
  });
});

describe("the template scene", () => {
  it("is a scene for every ending, every line PG, every retelling faithful", () => {
    for (const ending of ["second_date", "friends", "disaster"] as const) {
      for (const speakers of [[member(DEX), member(MARISOL)], [member(DEX), member(MARISOL), member(TEO)]]) {
        for (const dates of [[date(RAFE, JUNIPER, ending)], [date(RAFE, JUNIPER, ending), date(RAFE, OFF_CAST.id, "disaster", "cooking_class")]]) {
          const f = facts({ speakers, dates });
          const lines = templateScene(f);
          expect(isScene(lines)).toBe(true);
          expect(lines.length).toBeLessThanOrEqual(6);
          for (const l of lines) {
            expect(checkSheetText({ text: l.text }).ok && checkShowText({ text: l.text }).ok).toBe(true);
            expect(speakers.map((s) => s.id)).toContain(l.character_id);
            if (l.tell) expect(l.tell.is_true).toBe(true);
          }
          // The template passes the same checks the model's lines do.
          const raw = lines.map((l) => ({ from: first(l.character_id), text: l.text, retells: l.tell ? dates.findIndex((d) => d.episode_id === l.tell!.episode_id) + 1 : null, faithful: true }));
          expect(checkSceneLines(raw, f, [])).toHaveLength(lines.length);
        }
      }
    }
  });
});

describe("the owner's text (templates)", () => {
  it("answers a wrong claim in the character's own first person, and quotes one it can't turn", () => {
    expect(inFirstPerson("Lexi left before the second drink.", "Lexi Marlowe")).toBe("I left before the second drink");
    expect(inFirstPerson("Rafe told Lexi she talks too much.", "Lexi Marlowe")).toBeNull();
    expect(houseTalkLines({ name: "Lexi Marlowe", speaker: "Sable Quist", partner: "Rafe Calloway", place: "in the kitchen", claim: "Lexi left early.", isTrue: false })).toEqual([
      "Apparently Sable is telling people I left early.",
      "I did not.",
      "Go and hear it for yourself.",
    ]);
    const quoted = houseTalkLines({ name: "Lexi Marlowe", speaker: "Sable Quist", partner: "Rafe Calloway", place: "in the kitchen", claim: "Rafe told Lexi she talks too much.", isTrue: false });
    expect(quoted[0]).toContain('"Rafe told Lexi she talks too much."');
    expect(quoted[1]).toBe("That is not how it went.");
    const fair = houseTalkLines({ name: "Lexi Marlowe", speaker: "Sable Quist", partner: "Rafe Calloway", place: "in the kitchen", claim: "x", isTrue: true });
    expect(fair[0]).toBe("So the house was talking about my date with Rafe. Sable brought it up in the kitchen.");
  });
  it("links a text about a scene to the scene, and a date's tease to the date", () => {
    expect(textLink(`house_scene:${SCENE}`)).toEqual({ href: `/house?scene=${SCENE}#scene-${SCENE}`, label: "Hear what they said" });
    expect(textLink("tease:ep-1")).toEqual({ href: "/episodes/ep-1", label: "Watch the date" });
    expect(textLink("after_date:ep-1")).toBeNull();
  });
});

/* ------------------------------------------------ with the database ------------------------------------------------ */

describe("what the writer may know (sceneFacts)", () => {
  it("hears only public dates that aired in the last day between public characters: nothing private, unaired, old or reported away", async () => {
    const aired = await episode(RAFE, JUNIPER, { ending: "friends" });
    await episode(RAFE, OFF_CAST.id, { visibility: "private" });
    await episode(JUNIPER, OFF_CAST.id, { revealedAt: null });
    await episode(RAFE, JUNIPER, { revealedAt: ago(40) });
    const reported = await episode(JUNIPER, OFF_CAST.id, { ending: "disaster", venue: "cooking_class" });
    for (let i = 0; i < REPORT_HIDE_THRESHOLD; i++) await t.db.query(`insert into reports (episode_id, reporter_id) values ($1, $2)`, [reported, `r-${i}`]);
    const hiddenOwner = await person("Quiet Quinn", "owner-q", "private");
    await episode(RAFE, hiddenOwner, { ending: "second_date" });

    const f = (await sceneFacts(t.db, NOW))!;
    expect(f.dates.map((d) => d.episode_id)).toEqual([aired]);
    expect(f.speakers.map((s) => s.id).every((id) => [DEX, MARISOL, TEO].includes(id))).toBe(true);
    const prompt = scenePrompt(f);
    expect(prompt).toContain(`1. ${R} and ${J}'s first date at a rooftop bar at golden hour: they parted as friends.`);
    expect(prompt).not.toMatch(/TWIST-WORDS|FINALE-WORDS|Quinn|cooking class/);
    expect(prompt).not.toContain(shortName(OFF_CAST.name));
  });

  it("gives a speaker only its own state: a house character's own stance, a person's character only what it has heard, never a take or a hidden secret", async () => {
    await episode(RAFE, JUNIPER, { ending: "friends" });
    for (const [idx, secret] of [HIDDEN, "Has never seen the sea.", "Can't whistle."].entries()) {
      await t.db.query(`insert into cast_secrets (character_id, season_id, idx, secret, source) values ($1, '2026-11-01', $2, $3, 'model')`, [DEX, idx, secret]);
    }
    // A fan pick on the cast, with a private opinion of Rafe and something it was told.
    const fan = await person("Lexi Marlowe", "owner-1");
    setSeasonCastForTests([RAFE, JUNIPER, DEX], [fan]);
    await setOpinion(t.db, { holder: fan, about: RAFE, trust: -1, attraction: 0, take: "Rafe performs sincerity like a magician performs sawing.", basis: "firsthand", source: "old-ep", at: new Date(ago(90)) });
    await setOpinion(t.db, { holder: DEX, about: RAFE, trust: 1, attraction: null, take: "Rafe owes me a rematch at darts and knows it.", basis: "firsthand", source: "old-ep-2", at: new Date(ago(90)) });
    await hear(t.db, { holder: fan, about: RAFE, claim: "Rafe once sang at a wedding uninvited.", toldBy: JUNIPER, source: "scene:old#1", isTrue: true, at: new Date(ago(50)) });

    const f = (await sceneFacts(t.db, NOW))!;
    expect(f.speakers.map((s) => s.id).sort()).toEqual([DEX, fan].sort());
    const prompt = scenePrompt(f);
    // Dex (house): where he stands on Rafe is his note, in the scale's words, never his private take word for word.
    // Lexi (a person's character): only what she heard, never her private opinion.
    expect(f.notes[DEX]).toContain(`${R}: trusts them`);
    expect(f.notes[fan]).toEqual([`${J} told them: Rafe once sang at a wedding uninvited.`]);
    expect(prompt).toContain(`- ${first(DEX)}: ${R}: trusts them`);
    expect(prompt).not.toMatch(/sawing|rematch at darts|wary/);
    expect(f.takes[DEX]).toEqual(["Rafe owes me a rematch at darts and knows it."]);
    expect(f.takes[fan]).toEqual(["Rafe performs sincerity like a magician performs sawing."]);
    expect(prompt).not.toMatch(/night light/i);
  });

  it("talks about a couple once: when two of their dates aired since, the newest is the news", async () => {
    await episode(RAFE, JUNIPER, { ending: "friends", revealedAt: ago(9) });
    const newest = await episode(JUNIPER, RAFE, { ending: "second_date", revealedAt: ago(2), venue: "cooking_class" });
    const f = (await sceneFacts(t.db, NOW))!;
    expect(f.dates.map((d) => d.episode_id)).toEqual([newest]);
  });

  it("is null on a quiet day, and with fewer than two of the cast free to talk", async () => {
    expect(await sceneFacts(t.db, NOW)).toBeNull();
    await episode(RAFE, JUNIPER);
    setSeasonCastForTests([RAFE, JUNIPER, DEX]);
    expect(await sceneFacts(t.db, NOW)).toBeNull();
  });
});

const GOOD = (wrong = true) =>
  script([
    { from: first(DEX), text: `${R} and ${J} at the rooftop bar. Friends, and that was that.`, retells: 1, faithful: true },
    { from: first(MARISOL), text: "I watched it. Nobody was swept anywhere.", retells: null },
    ...(wrong ? [{ from: first(MARISOL), text: `I heard ${R} was gone before the second drink.`, retells: 1, faithful: false, claim: `${R} left before the second drink.` }] : []),
    { from: first(DEX), text: "Who told you that?", retells: null },
    { from: first(MARISOL), text: "A reliable source. Possibly the fridge.", retells: null },
    { from: R, text: "I'm not even in this scene." }, // on the date: dropped
    { from: first(DEX), text: `${R} stole her scarf, too.`, retells: 1, faithful: true }, // crime: dropped
  ]);

/** Pins who is in the room: with Rafe and Juniper on the date, Dex and Marisol are the only two left to talk. */
const dexAndMarisol = () => setSeasonCastForTests([RAFE, JUNIPER, DEX, MARISOL]);

describe("the daily scene (ensureHouseScene)", () => {
  it("waits for its hour, writes once, stores the model and what it would cost, and is off with HOUSE_SCENES=0", async () => {
    await episode(RAFE, JUNIPER, { ending: "friends" });
    dexAndMarisol();
    const m = answering(GOOD());
    expect(await ensureHouseScene(t.db, new Date("2026-11-12T17:20:00Z"), { model: m.model })).toEqual({ skipped: "early" });
    expect(await ensureHouseScene(t.db, NOW, { model: m.model, env: { HOUSE_SCENES: "0" } })).toEqual({ skipped: "off" });
    expect(houseScenesOn({ HOUSE_SCENES: "0" })).toBe(false);
    expect(houseScenesOn({})).toBe(true);
    expect(m.calls).toHaveLength(0);

    const made = await ensureHouseScene(t.db, NOW, { model: m.model });
    expect(made).toMatchObject({ id: SCENE, source: "model" });
    expect(m.calls).toHaveLength(1);
    expect(await ensureHouseScene(t.db, new Date(NOW.getTime() + HOURS), { model: m.model })).toEqual({ skipped: "already" });
    expect(m.calls).toHaveLength(1);

    const row = (await t.db.query<{ kind: string; source: string; model: string; cost_usd: string; input_tokens: number; output_tokens: number; lines: { text: string }[]; cast_ids: string[] }>(`select * from house_scenes where id = $1`, [SCENE])).rows[0];
    expect(row).toMatchObject({ kind: "gossip", source: "model", model: "gemini-3.5-flash-lite", input_tokens: 900, output_tokens: 300 });
    // 900 in and 300 out at flash-lite list prices: about a tenth of a cent, inside the 0.2 cent target.
    expect(Number(row.cost_usd)).toBeCloseTo(0.00102, 6);
    expect(Number(row.cost_usd)).toBeLessThan(0.002);
    expect(row.lines.every((l) => !/scene\.|stole/.test(l.text))).toBe(true);
    expect(row.cast_ids).not.toContain(RAFE);
  });

  it("makes every retelling something the others in the room heard, from its speaker, each with its own source", async () => {
    const ep = await episode(RAFE, JUNIPER, { ending: "friends" });
    dexAndMarisol();
    const made = await ensureHouseScene(t.db, NOW, { model: answering(GOOD()).model });
    if (!("id" in made)) throw new Error("no scene");
    const scene = (await t.db.query<{ cast_ids: string[]; told: { line: number; by: string; to: string[]; is_true: boolean; source: string }[] }>(`select cast_ids, told from house_scenes where id = $1`, [SCENE])).rows[0];
    const rows = await heardRows();
    expect(scene.cast_ids.sort()).toEqual([DEX, MARISOL].sort());
    // Dex's faithful line reaches Marisol, in the record's own words; Marisol's wrong one reaches Dex, marked untrue.
    expect(rows).toEqual([
      { holder_id: MARISOL, about_id: RAFE, about_b_id: JUNIPER, claim: `${R} and ${J}'s first date at a rooftop bar at golden hour: they parted as friends.`, told_by: DEX, source: `scene:${SCENE}#1`, is_true: true },
      { holder_id: DEX, about_id: RAFE, about_b_id: JUNIPER, claim: `${R} left before the second drink.`, told_by: MARISOL, source: `scene:${SCENE}#3`, is_true: false },
    ]);
    expect(made.told).toBe(2);
    expect(scene.told.map((x) => [x.line, x.by, x.to, x.is_true])).toEqual([
      [1, DEX, [MARISOL], true],
      [3, MARISOL, [DEX], false],
    ]);
    // Being told gives each a 'heard' opinion of the people in it, and the two stories now sit against each other.
    const heardOpinions = (await t.db.query<{ holder_id: string; about_id: string; basis: string; source: string }>(`select holder_id, about_id, basis, source from character_opinions order by holder_id, about_id`)).rows;
    expect(heardOpinions).toContainEqual({ holder_id: DEX, about_id: RAFE, basis: "heard", source: `scene:${SCENE}#3` });
    expect((await tensions(t.db, seasonIdOf(NOW), { now: NOW })).some((x) => x.kind === "opposing_claims" && x.about === RAFE)).toBe(true);
    expect(ep).toBeTruthy();
    // Run again by hand: nothing is told twice.
    expect(await applyTold(t.db, scene.told as never, NOW)).toBe(0);
  });

  it("never lets a private or unaired date in: nothing of it is written, told or heard", async () => {
    const hidden = await episode(RAFE, JUNIPER, { visibility: "private", ending: "disaster", venue: "cooking_class" });
    const unaired = await episode(DEX, MARISOL, { revealedAt: null });
    expect(await ensureHouseScene(t.db, NOW, { model: answering(GOOD()).model })).toEqual({ skipped: "quiet" });
    expect(await heardRows()).toEqual([]);
    // With a public one beside them, only the public one is on the table.
    await t.db.query(`delete from house_scenes`);
    const open = await episode(TEO, OFF_CAST.id, { ending: "second_date" });
    const m = answering(new Error("down"));
    const made = await ensureHouseScene(t.db, NOW, { model: m.model });
    expect(made).toMatchObject({ source: "template" });
    const told = (await t.db.query<{ told: { episode_id: string }[] }>(`select told from house_scenes where id = $1`, [SCENE])).rows[0].told;
    expect(told.length).toBeGreaterThan(0);
    expect(told.every((x) => x.episode_id === open)).toBe(true);
    const text = JSON.stringify((await t.db.query(`select lines from house_scenes where id = $1`, [SCENE])).rows[0]);
    expect(text).not.toMatch(/cooking class/);
    expect((await heardRows()).every((r) => r.source.startsWith(`scene:${SCENE}#`))).toBe(true);
    expect([hidden, unaired]).not.toContain(told[0].episode_id);
  });

  it("falls back to the template when the call fails or too few lines pass, and keeps a quiet day quiet", async () => {
    await episode(RAFE, JUNIPER, { ending: "second_date" });
    const few = answering(script([{ from: first(DEX), text: `${R} and ${J}. A second date.`, retells: 1, faithful: true }, { from: R, text: "Hello." }]));
    const made = await ensureHouseScene(t.db, NOW, { model: few.model });
    expect(made).toMatchObject({ source: "template" });
    expect((await heardRows()).length).toBeGreaterThan(0);
    expect((await heardRows()).every((r) => r.is_true)).toBe(true);
    // The next day nothing aired since: a quiet row, no scene, asked once.
    const next = new Date(NOW.getTime() + 24 * HOURS);
    expect(await ensureHouseScene(t.db, next, { model: few.model })).toEqual({ skipped: "quiet" });
    expect(await ensureHouseScene(t.db, next, { model: few.model })).toEqual({ skipped: "already" });
    // And the date it already told is never the topic twice, even inside the window.
    await t.db.query(`delete from house_scenes where day = $1`, ["2026-11-13"]);
    expect(await ensureHouseScene(t.db, new Date(NOW.getTime() + 20 * HOURS + 24 * HOURS - 20 * HOURS), { model: few.model })).toEqual({ skipped: "quiet" });
  });

  it("an admin can ask for today's scene before its hour; nobody else can", async () => {
    await episode(RAFE, JUNIPER);
    vi.stubEnv("FRONTIER_PASSWORD", "owner-pass");
    // Mid-morning, hours before the scene's own hour.
    vi.useFakeTimers({ now: new Date("2026-11-12T16:00:00Z"), toFake: ["Date"] });
    expect((await adminWrite(new Request(`${BASE_URL}/api/admin/house-scene`, { method: "POST" }))).status).toBe(403);
    const res = await adminWrite(new Request(`${BASE_URL}/api/admin/house-scene`, { method: "POST", headers: { "x-frontier-key": "owner-pass" } }));
    expect(res.status).toBe(200);
    // The harness turns the model off: the template's scene, written whatever the hour, once a day.
    expect((await res.json()).house_scene).toMatchObject({ source: "template" });
    const again = await adminWrite(new Request(`${BASE_URL}/api/admin/house-scene`, { method: "POST", headers: { "x-frontier-key": "owner-pass" } }));
    expect((await again.json()).house_scene).toEqual({ skipped: "already" });
    vi.useRealTimers();
  });

  it("takes over a claim that was left pending by a pass that died", async () => {
    await episode(RAFE, JUNIPER);
    await t.db.query(`insert into house_scenes (id, day, season_id, kind, place, source, created_at) values ($1, $2, '2026-11-01', 'gossip', 'kitchen', 'pending', $3)`, [SCENE, DAY, ago(0.1)]);
    expect(await ensureHouseScene(t.db, NOW)).toEqual({ skipped: "already" });
    await t.db.query(`update house_scenes set created_at = $2 where id = $1`, [SCENE, ago(1)]);
    expect(await ensureHouseScene(t.db, NOW)).toMatchObject({ source: "template" });
  });
});

describe("people's characters: the owner hears", () => {
  async function walkOn() {
    const lexi = await person("Lexi Marlowe", "owner-1");
    const ep = await episode(lexi, RAFE, { ending: "friends" });
    // Rafe is on the date: Dex and Marisol are the room.
    setSeasonCastForTests([RAFE, DEX, MARISOL]);
    return { lexi, ep };
  }
  const WRONG = () =>
    script([
      { from: first(DEX), text: `Lexi and ${R} at the rooftop bar. Friends.`, retells: 1, faithful: true },
      { from: first(MARISOL), text: "I heard Lexi was gone before the second drink.", retells: 1, faithful: false, claim: "Lexi left before the second drink." },
      { from: first(DEX), text: "From whom?", retells: null },
      { from: first(MARISOL), text: "I never reveal a source.", retells: null },
      { from: first(DEX), text: "You are the source.", retells: null },
    ]);
  const notices = async (user: string) => (await t.db.query<{ kind: string; title: string; body: string; link: string }>(`select kind, title, body, link from notifications where user_id = $1 and kind = 'house_talk' order by created_at`, [user])).rows;
  const texts = async (thread: string) => (await t.db.query<{ text: string; action: string; offers: unknown }>(`select text, action, offers from companion_messages where thread_id = $1 and role = 'character' order by created_at, id`, [thread])).rows;

  it("a walk-on's public aired date is public record: the house talks about it, and its owner is notified once", async () => {
    await walkOn();
    const made = await ensureHouseScene(t.db, NOW, { model: answering(WRONG()).model });
    expect(made).toMatchObject({ source: "model", notified: 1, texted: 0 });
    const [notice] = await notices("owner-1");
    expect(notice.title).toBe("🏠 The house is talking about Lexi");
    expect(notice.link).toBe(`/house?scene=${SCENE}#scene-${SCENE}`);
    // The wrong retelling is what the owner is told about first.
    expect(notice.body).toMatch(/^Marisol, (in|on|at) the .+: “I heard Lexi was gone before the second drink\.”$/);
    // Never opted in to the character's texts: no thread is opened for them.
    expect((await t.db.query(`select 1 from companion_threads where user_id = 'owner-1'`)).rows).toEqual([]);
    // A rerun of the telling notifies nobody twice.
    const row = (await t.db.query<{ id: string; day: string; place: string; lines: never; told: never }>(`select id, day, place, lines, told from house_scenes where id = $1`, [SCENE])).rows[0];
    const { tellOwners } = await import("@/lib/house-scenes");
    expect(await tellOwners(t.db, row, NOW)).toEqual({ notified: 0, texted: 0 });
    expect(await notices("owner-1")).toHaveLength(1);
  });

  it("an owner who opted in also gets the character's own text, with the scene's link and the date's chips, at most one a day", async () => {
    const { lexi, ep } = await walkOn();
    await t.db.query(`insert into companion_threads (id, user_id, character_id, muted_proactive) values ('th-lexi', 'owner-1', $1, false)`, [lexi]);
    const made = await ensureHouseScene(t.db, NOW, { model: answering(WRONG()).model });
    expect(made).toMatchObject({ notified: 1, texted: 1 });
    const sent = await texts("th-lexi");
    expect(sent.map((x) => x.text)).toEqual(["Apparently Marisol is telling people I left before the second drink.", "I did not.", "Go and hear it for yourself."]);
    expect(sent.every((s) => s.action === `house_scene:${SCENE}`)).toBe(true);
    expect(sent[0].offers).toMatchObject({ episode_id: ep, partner_id: RAFE, kinds: ["someone_new", "advice"] });
    // The thread shows the link under the last bubble, and the chips on the first.
    const view = await getThread(t.db, "owner-1", "th-lexi");
    if (!view.ok) throw new Error("no thread");
    const mine = view.view.messages.filter((x) => x.role === "character");
    expect(mine[mine.length - 1].link).toEqual({ href: `/house?scene=${SCENE}#scene-${SCENE}`, label: "Hear what they said" });
    expect(mine[0].offers).toMatchObject({ episode_id: ep });

    // The same day, another scene about them (a second kind, later): notified again, but not texted again.
    const { tellOwners } = await import("@/lib/house-scenes");
    const again = await tellOwners(t.db, { id: `${DAY}-other`, day: DAY, place: "stairs", lines: [{ character_id: DEX, text: "Lexi again." }], told: [{ line: 1, by: DEX, to: [TEO], episode_id: ep, about: lexi, about_b: RAFE, claim: "x", is_true: true, source: "scene:x#1" }] }, NOW);
    expect(again).toEqual({ notified: 1, texted: 0 });
    // Tomorrow is another day.
    const tomorrow = new Date(NOW.getTime() + 24 * HOURS);
    const next = await tellOwners(t.db, { id: `2026-11-13-gossip`, day: "2026-11-13", place: "stairs", lines: [{ character_id: DEX, text: "Lexi again." }], told: [{ line: 1, by: DEX, to: [TEO], episode_id: ep, about: lexi, about_b: RAFE, claim: "x", is_true: true, source: "scene:y#1" }] }, tomorrow);
    expect(next).toEqual({ notified: 1, texted: 1 });
  });

  it("tells nobody about a house character's date, a private character's, or a muted or paused thread's owner by text", async () => {
    await episode(RAFE, JUNIPER);
    expect(await ensureHouseScene(t.db, NOW)).toMatchObject({ notified: 0, texted: 0 });
    expect((await t.db.query(`select 1 from notifications where kind = 'house_talk'`)).rows).toEqual([]);
    const { tellOwners } = await import("@/lib/house-scenes");
    const lexi = await person("Lexi Marlowe", "owner-2");
    const ep = await episode(lexi, RAFE);
    await t.db.query(`insert into companion_threads (id, user_id, character_id, muted_proactive, paused_at) values ('th-p', 'owner-2', $1, false, now())`, [lexi]);
    const told = [{ line: 1, by: DEX, to: [TEO], episode_id: ep, about: lexi, about_b: RAFE, claim: "x", is_true: true, source: "scene:z#1" }];
    expect(await tellOwners(t.db, { id: "s-1", day: DAY, place: "stairs", lines: [{ character_id: DEX, text: "Lexi." }], told }, NOW)).toEqual({ notified: 1, texted: 0 });
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [lexi]);
    expect(await tellOwners(t.db, { id: "s-2", day: DAY, place: "stairs", lines: [{ character_id: DEX, text: "Lexi." }], told }, NOW)).toEqual({ notified: 0, texted: 0 });
  });
});

describe("a reported line", () => {
  async function scene() {
    await episode(RAFE, JUNIPER, { ending: "friends" });
    await ensureHouseScene(t.db, NOW, { model: answering(new Error("down")).model });
    const row = (await t.db.query<{ lines: { text: string; tell?: unknown }[]; told: { line: number; source: string }[] }>(`select lines, told from house_scenes where id = $1`, [SCENE])).rows[0];
    return row;
  }
  const post = (line: number, cookie?: string) => reportRoute(jsonRequest(`/api/house/${SCENE}/report`, { line, reason: "other" }, cookie ? { cookie } : {}), { params: Promise.resolve({ id: SCENE }) });

  it("is hidden once enough people report it, and takes what it told with it", async () => {
    const row = await scene();
    const line = row.told[0].line;
    const before = (await heardRows()).filter((r) => r.source === row.told[0].source).length;
    expect(before).toBeGreaterThan(0);
    expect(await reportSceneLine(t.db, SCENE, line, "v-1")).toEqual({ ok: true, reported: true, hidden: false });
    expect(await reportSceneLine(t.db, SCENE, line, "v-1")).toEqual({ ok: true, reported: false, hidden: false }); // once a person
    expect(await reportSceneLine(t.db, SCENE, line, "v-2")).toMatchObject({ hidden: false });
    expect((await houseScene(t.db, SCENE))!.lines.map((l) => l.n)).toContain(line);
    expect(await reportSceneLine(t.db, SCENE, line, "v-3")).toEqual({ ok: true, reported: true, hidden: true });
    expect((await heardRows()).filter((r) => r.source === row.told[0].source)).toEqual([]);
    expect((await houseScene(t.db, SCENE))!.lines.map((l) => l.n)).not.toContain(line);
    expect(await reportSceneLine(t.db, SCENE, 99, "v-1")).toEqual({ ok: false, status: 404, error: "line_not_found" });
    expect(await reportSceneLine(t.db, "nope", 1, "v-1")).toMatchObject({ ok: false, status: 404 });

    // The admin puts it back: it shows again and what it told is told again. Or takes it down for good.
    expect((await listSceneReports(t.db))[0]).toMatchObject({ scene_id: SCENE, line, reports: 3, hidden: true });
    expect(await reviewSceneLine(t.db, SCENE, line, "cleared")).toBe(3);
    expect((await heardRows()).filter((r) => r.source === row.told[0].source)).toHaveLength(before);
    expect((await houseScene(t.db, SCENE))!.lines.map((l) => l.n)).toContain(line);
    expect(await reviewSceneLine(t.db, SCENE, line, "cleared")).toBe(0);
    await reportSceneLine(t.db, SCENE, line, "v-9");
    expect(await reviewSceneLine(t.db, SCENE, line, "removed")).toBe(1);
    expect((await heardRows()).filter((r) => r.source === row.told[0].source)).toEqual([]);
    expect((await houseScene(t.db, SCENE))!.lines.map((l) => l.n)).not.toContain(line);
  });

  it("over the API: a report is a 201, a repeat a 200, a missing line a 404; the admin list needs an admin", async () => {
    await scene();
    const res = await post(1);
    expect(res.status).toBe(201);
    const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
    expect((await post(1, cookie)).status).toBe(200);
    expect((await post(30)).status).toBe(404);
    expect((await reportRoute(jsonRequest(`/api/house/${SCENE}/report`, { line: "one" }), { params: Promise.resolve({ id: SCENE }) })).status).toBe(422);
    vi.stubEnv("FRONTIER_PASSWORD", "owner-pass");
    expect((await adminReports(new Request(`${BASE_URL}/api/admin/reports`))).status).toBe(403);
    const listed = await (await adminReports(new Request(`${BASE_URL}/api/admin/reports`, { headers: { "x-frontier-key": "owner-pass" } }))).json();
    expect(listed.scene_lines).toMatchObject([{ scene_id: SCENE, line: 1, reports: 1 }]);
    const review = await adminReview(new Request(`${BASE_URL}/api/admin/reports`, { method: "POST", headers: { "content-type": "application/json", "x-frontier-key": "owner-pass" }, body: JSON.stringify({ scene_id: SCENE, line: 1, decision: "removed" }) }));
    expect(review.status).toBe(200);
    expect((await listSceneReports(t.db))).toEqual([]);
  });

  it("a date that stops being public takes what the scene told of it, and its lines leave the page", async () => {
    const row = await scene();
    expect((await heardRows()).length).toBeGreaterThan(0);
    expect(await houseUpkeep(t.db, NOW)).toEqual({ retracted: 0 });
    await t.db.query(`update episodes set visibility = 'private'`);
    const kept = await houseUpkeep(t.db, NOW);
    expect(kept.retracted).toBeGreaterThan(0);
    expect(await heardRows()).toEqual([]);
    const view = await houseScene(t.db, SCENE);
    // The retellings are gone; what is left of the scene names no date.
    expect(view?.about ?? []).toEqual([]);
    const tellTexts = row.lines.filter((l) => l.tell).map((l) => l.text);
    for (const text of tellTexts) expect((view?.lines ?? []).map((l) => l.text)).not.toContain(text);
  });
});

describe("where it shows", () => {
  it("lists the newest scene first, pages the rest, and gives the Tonight band and Since you were here one line", async () => {
    await episode(RAFE, JUNIPER, { ending: "friends" });
    dexAndMarisol();
    await ensureHouseScene(t.db, NOW, { model: answering(GOOD(false)).model });
    // Earlier scenes, stored directly.
    for (let i = 1; i <= HOUSE_PAGE_SIZE; i++) {
      const day = new Date(NOW.getTime() - i * 24 * HOURS).toISOString().slice(0, 10);
      await t.db.query(
        `insert into house_scenes (id, day, season_id, kind, place, cast_ids, lines, told, source, created_at, written_at) values ($1, $2, '2026-11-01', 'gossip', 'stairs', $3::jsonb, $4::jsonb, '[]'::jsonb, 'template', $5, $5)`,
        [sceneIdOf(day), day, JSON.stringify([DEX, TEO]), JSON.stringify([{ character_id: DEX, text: `Day ${i}, line one.` }, { character_id: TEO, text: `Day ${i}, line two.` }]), `${day}T18:20:00Z`],
      );
    }
    const page1 = await listHouseScenes(t.db);
    expect(page1.total).toBe(HOUSE_PAGE_SIZE + 1);
    expect(page1.scenes).toHaveLength(HOUSE_PAGE_SIZE);
    expect(page1.scenes[0].id).toBe(SCENE);
    expect(page1.scenes[0].code).toBe("S2 · Night 12");
    const page2 = await listHouseScenes(t.db, { offset: HOUSE_PAGE_SIZE });
    expect(page2.scenes).toHaveLength(1);

    const latest = (await latestHouseScene(t.db, NOW))!;
    expect(latest.id).toBe(SCENE);
    expect(latest.about).toEqual([{ episode_id: expect.any(String), a: "Rafe Calloway", b: "Juniper Vale" }]);
    expect(houseLine(latest)).toMatch(new RegExp(`^(Dex and Marisol|Marisol and Dex) (in|on|at) the .+, on ${R} and ${J}'s date$`));
    // Three days on with nothing new, the band and the card let it go; the page still has it.
    expect(await latestHouseScene(t.db, new Date(NOW.getTime() + 4 * 24 * HOURS))).toBeNull();

    await t.db.query(`insert into owner_activity (user_id, last_seen, prev_seen) values ('fan', $1, null)`, [ago(30)]);
    const card = await showSince(t.db, "fan", NOW);
    expect(card?.house).toMatchObject({ name: first(DEX), path: `/house?scene=${SCENE}#scene-${SCENE}` });
    expect(card!.house!.who).toBe(houseLine(latest));
    // A visit after the scene was written: it isn't news.
    await t.db.query(`update owner_activity set last_seen = $1 where user_id = 'fan'`, [new Date(NOW.getTime() + 2 * HOURS).toISOString()]);
    expect((await showSince(t.db, "fan", new Date(NOW.getTime() + 20 * HOURS)))?.house ?? null).toBeNull();
  });

  it("the page: today's scene first with its lines and the date it is about, earlier ones under it, a pager, and the linked scene on top", async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    try {
      await episode(RAFE, JUNIPER, { ending: "friends" });
      dexAndMarisol();
      await ensureHouseScene(t.db, NOW, { model: answering(GOOD(false)).model });
      for (let i = 1; i <= HOUSE_PAGE_SIZE; i++) {
        const day = new Date(NOW.getTime() - i * 24 * HOURS).toISOString().slice(0, 10);
        await t.db.query(
          `insert into house_scenes (id, day, season_id, kind, place, cast_ids, lines, told, source, created_at, written_at) values ($1, $2, '2026-11-01', 'gossip', 'stairs', $3::jsonb, $4::jsonb, '[]'::jsonb, 'template', $5, $5)`,
          [sceneIdOf(day), day, JSON.stringify([DEX, TEO]), JSON.stringify([{ character_id: DEX, text: `Day ${i}, line one.` }, { character_id: TEO, text: `Day ${i}, line two.` }]), `${day}T18:20:00Z`],
        );
      }
      const html = renderToStaticMarkup(await HousePage());
      expect(html).toContain("<h1>The house</h1>");
      expect(html.indexOf(`id="scene-${SCENE}"`)).toBeGreaterThan(-1);
      expect(html.indexOf(`id="scene-${SCENE}"`)).toBeLessThan(html.indexOf("Earlier in the house"));
      expect(html).toContain("Friends, and that was that.");
      expect(html).toMatch(/On the table:.*Rafe and Juniper(&#x27;|')s date/);
      expect(html).toContain("Something wrong with a line?");
      expect(html).toContain("Day 1, line one.");
      expect(html).not.toContain(`Day ${HOUSE_PAGE_SIZE}, line one.`); // on page 2
      expect(html).toContain('href="/house?page=2"');
      expect(html).not.toContain("The house is quiet");
      // A link to the oldest scene puts it first, whatever page it is on.
      const oldest = sceneIdOf(new Date(NOW.getTime() - HOUSE_PAGE_SIZE * 24 * HOURS).toISOString().slice(0, 10));
      const linked = renderToStaticMarkup(await HousePage({ searchParams: Promise.resolve({ scene: oldest }) }));
      expect(linked.indexOf(`id="scene-${oldest}"`)).toBeLessThan(linked.indexOf(`id="scene-${SCENE}"`));
      expect(linked).toContain("More from the house");
    } finally {
      vi.useRealTimers();
    }
  });

  it("the page's empty states: nothing yet, a quiet today over the last scene, and HOUSE_SCENES=0", async () => {
    const empty = renderToStaticMarkup(await HousePage());
    expect(empty).toContain("The house is quiet");
    expect(empty).toContain("come back this evening");
    expect(empty).toContain('href="/watch"');

    await episode(RAFE, JUNIPER, { ending: "friends" });
    await ensureHouseScene(t.db, NOW);
    clearSharedCache();
    // Viewed on a later day with nothing new: the last scene, under a note that today is quiet.
    const later = renderToStaticMarkup(await HousePage());
    expect(later).toContain("The house is quiet so far today. The last scene:");
    expect(later).toContain(`id="scene-${SCENE}"`);

    vi.stubEnv("HOUSE_SCENES", "0");
    clearSharedCache();
    const off = renderToStaticMarkup(await HousePage());
    expect(off).toContain("The house is quiet");
    expect(off).toContain("keeping to itself");
    expect(off).not.toContain(`id="scene-${SCENE}"`);
    expect(await latestHouseScene(t.db, NOW)).toBeNull();
    expect((await listHouseScenes(t.db)).scenes).toEqual([]);
    expect(await ensureHouseScene(t.db, new Date(NOW.getTime() + 24 * HOURS))).toEqual({ skipped: "off" });
  });

  it("leaves out a speaker who went private since", async () => {
    await episode(RAFE, JUNIPER, { ending: "friends" });
    const fan = await person("Lexi Marlowe", "owner-1");
    setSeasonCastForTests([RAFE, JUNIPER, DEX, TEO], [fan]);
    await ensureHouseScene(t.db, NOW);
    const before = (await houseScene(t.db, SCENE))!;
    if (!before.cast.some((c) => c.id === fan)) return; // the day's seed left her out of the room
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [fan]);
    const after = await houseScene(t.db, SCENE);
    expect((after?.lines ?? []).every((l) => l.id !== fan)).toBe(true);
    expect((after?.cast ?? []).every((c) => c.id !== fan)).toBe(true);
  });
});
