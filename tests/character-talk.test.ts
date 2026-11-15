/**
 * Talk of the house (lib/character-talk.ts, the character page's Talk tab; the front-door wave 2026-11-15): the pure
 * shaping, what the reads may and may not bring in (public only: /house's own view, the producer's public line up to
 * today, the public layer of the graph; never the story-state tables, a beat's reasons, a hidden secret or whether a
 * retelling was true), the switch, the tab list, the old #audience anchor and the ratings row in the header.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }),
}));
// The After Dark teaser on a house character is its own async server component: not what these tests are about.
vi.mock("@/app/AfterDarkTeaser", () => ({ default: () => null }));
import { renderToStaticMarkup } from "react-dom/server";
import CharacterPage from "@/app/characters/[id]/page";
import { characterTalk, characterTalkOn, EMPTY_TALK, publicEdges, shapeTalk, TALK_SAID, type TalkBeat, type TalkEdge, type TalkInput } from "@/lib/character-talk";
import { HOUSE_CHARACTERS } from "@/lib/house";
import { sceneIdOf, scenePath, type HouseSceneView, type SceneFace } from "@/lib/house-scenes";
import { shortName } from "@/lib/names";
import { refreshRelationship, relationshipsOf } from "@/lib/relationships";
import { setSeasonCastForTests } from "@/lib/season-cast";
import { clearSharedCache } from "@/lib/shared-cache";
import { api, newUserCookie, startTestDb, userIdOf, validCharacter } from "./helpers";

const CAST = HOUSE_CHARACTERS.slice(0, 5);
const [RAFE, JUNIPER, DEX, MARISOL, TEO] = CAST.map((c) => c.id);
const nameOf = (id: string) => HOUSE_CHARACTERS.find((c) => c.id === id)!.name;
const first = (id: string) => shortName(nameOf(id));
const face = (id: string): SceneFace => ({ id, name: first(id), hue: null, portrait: null, house: true });
const PEOPLE = new Map(CAST.map((c) => [c.id, { id: c.id, name: c.name }]));

/* ------------------------------------------------ the pure shaping ------------------------------------------------ */

const place = { id: "stairs", label: "the stairs", at: "on the stairs", when: "late" };
function scene(day: string, o: Partial<HouseSceneView> & Pick<HouseSceneView, "lines">, kind = "gossip"): HouseSceneView {
  return { id: sceneIdOf(day, kind), day, kind, place, code: null, written_at: `${day}T18:20:00.000Z`, cast: [face(DEX), face(MARISOL)], about: [], result: null, ...o };
}
const shape = (o: Partial<TalkInput> & { id?: string }) =>
  shapeTalk({ character: { id: o.id ?? RAFE, name: nameOf(o.id ?? RAFE) }, scenes: [], beats: [], edges: [], people: PEOPLE, ...o });

describe("shapeTalk: said about them", () => {
  const gossip = scene("2026-11-12", {
    about: [{ episode_id: "ep1", a: nameOf(RAFE), b: nameOf(JUNIPER), a_id: RAFE, b_id: JUNIPER }],
    lines: [
      { ...face(DEX), n: 1, text: "They split the bill and that was that.", about: [RAFE, JUNIPER] },
      { ...face(MARISOL), n: 2, text: `I heard ${first(RAFE)} talked about boats all night.` },
      { ...face(DEX), n: 3, text: "The stairs are cold." },
    ],
  });

  it("takes a retelling of their date and a line that names them, with who said it, where, when and the scene's link", () => {
    const talk = shape({ scenes: [gossip] });
    expect(talk.empty).toBe(false);
    expect(talk.said.map((l) => l.text)).toEqual(["They split the bill and that was that.", `I heard ${first(RAFE)} talked about boats all night.`]);
    expect(talk.said[0]).toMatchObject({ day: "2026-11-12", where: "on the stairs", href: scenePath(gossip.id), speaker: { id: DEX, name: first(DEX) } });
    // The other half of the date gets the retelling, not the line that names only Rafe.
    expect(shape({ id: JUNIPER, scenes: [gossip] }).said.map((l) => l.text)).toEqual(["They split the bill and that was that."]);
  });

  it("never counts their own lines, nor a namesake's mention in a scene they have nothing to do with", () => {
    const own = scene("2026-11-11", { cast: [face(RAFE), face(DEX)], lines: [{ ...face(RAFE), n: 1, text: `${first(RAFE)} here, speaking of myself.` }, { ...face(DEX), n: 2, text: "Go on." }] });
    expect(shape({ scenes: [own] }).said).toEqual([]);
    // A scene that isn't about them and doesn't have them in it: the same first name belongs to somebody else's date.
    const elsewhere = scene("2026-11-10", { lines: [{ ...face(DEX), n: 1, text: `${first(TEO)} left early.` }, { ...face(MARISOL), n: 2, text: "Did they." }] });
    expect(shape({ id: TEO, scenes: [elsewhere] }).said).toEqual([]);
  });

  it("is a handful, newest first", () => {
    const days = Array.from({ length: 8 }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`);
    const scenes = days.map((day) => scene(day, { lines: [{ ...face(DEX), n: 1, text: `About the ${day} date.`, about: [RAFE, JUNIPER] }, { ...face(MARISOL), n: 2, text: "Mm." }] }));
    const talk = shape({ scenes });
    expect(talk.said).toHaveLength(TALK_SAID);
    expect(talk.said[0].day).toBe("2026-11-08");
    expect(talk.said.map((l) => l.day)).toEqual([...talk.said.map((l) => l.day)].sort().reverse());
  });
});

describe("shapeTalk: friction", () => {
  it("tells a confrontation and a challenge as /house prints them, a producer's falling-out line, and public bad blood", () => {
    const fight = scene(
      "2026-11-12",
      {
        cast: [face(RAFE), face(DEX)],
        lines: [{ ...face(RAFE), n: 1, text: "You said it." }, { ...face(DEX), n: 2, text: "I did." }],
        result: { kind: "confrontation", a: first(RAFE), b: first(DEX), a_id: RAFE, b_id: DEX, outcome: "worse_than_before", label: "It ended worse than it started" },
      },
      "confrontation",
    );
    const cookoff = scene(
      "2026-11-11",
      {
        cast: [face(RAFE), face(DEX), face(TEO)],
        lines: [{ ...face(RAFE), n: 1, text: "Knives out." }, { ...face(TEO), n: 2, text: "Literally." }],
        result: { kind: "challenge", title: "The cook-off", winner: face(TEO), prize: "first pick of Thursday's house date" },
      },
      "challenge",
    );
    const beats: TalkBeat[] = [{ day: "2026-11-10", tension: "mutual_distrust", who: [MARISOL, RAFE], about: null, previously: `Previously: ${first(MARISOL)} and ${first(RAFE)} stopped trusting each other.` }];
    const edges: TalkEdge[] = [{ other: JUNIPER, stage: "bad_blood", last_at: "2026-11-09T20:00:00.000Z", path: `/couples/${JUNIPER}/${RAFE}` }];
    const talk = shape({ scenes: [fight, cookoff], beats, edges });
    expect(talk.friction.map((f) => f.kind)).toEqual(["confrontation", "challenge", "story", "bad_blood"]);
    expect(talk.friction[0]).toMatchObject({ text: `Had it out with ${first(DEX)} on the stairs.`, result: "It ended worse than it started.", href: scenePath(fight.id), other: { id: DEX } });
    expect(talk.friction[1]).toMatchObject({ text: "Competed in the cook-off.", result: `${first(TEO)} won.`, href: scenePath(cookoff.id) });
    // The producer's line without its lead; no scene that day, so it links to the house.
    expect(talk.friction[2]).toMatchObject({ text: `${first(MARISOL)} and ${first(RAFE)} stopped trusting each other.`, href: "/house", other: { id: MARISOL } });
    expect(talk.friction[3]).toMatchObject({ text: `Bad blood with ${first(JUNIPER)}.`, href: `/couples/${JUNIPER}/${RAFE}` });
    // The winner's own page says what they won.
    expect(shape({ id: TEO, scenes: [cookoff] }).friction[0]).toMatchObject({ text: "Won the cook-off.", result: "The prize: first pick of Thursday's house date." });
    // Someone who wasn't in either scene has no friction from them.
    expect(shape({ id: MARISOL, scenes: [fight, cookoff] }).friction).toEqual([]);
  });
});

describe("shapeTalk: who is after whom", () => {
  const rivals: TalkBeat = { day: "2026-11-12", tension: "rivals", who: [DEX, TEO], about: RAFE, previously: `Previously: ${first(DEX)} and ${first(TEO)} both set their sights on ${first(RAFE)}.` };

  it("reads the producer's public rivals line both ways, and the public graph's second dates and couples", () => {
    const them = shape({ beats: [rivals] });
    expect(them.after.map((a) => [a.direction, a.other.id])).toEqual([["them", DEX], ["them", TEO]]);
    expect(them.after[0].text).toBe(`${first(DEX)} and ${first(TEO)} both set their sights on ${first(RAFE)}.`);
    expect(shape({ id: DEX, beats: [rivals] }).after.map((a) => [a.direction, a.other.id])).toEqual([["theirs", RAFE]]);
    expect(them.friction).toEqual([]);

    const edges: TalkEdge[] = [
      { other: JUNIPER, stage: "sparks", last_at: "2026-11-13T20:00:00.000Z", path: "/couples/x/y" },
      { other: MARISOL, stage: "going_steady", last_at: "2026-11-11T20:00:00.000Z", path: "/couples/x/z" },
      { other: TEO, stage: "friends", last_at: "2026-11-14T20:00:00.000Z", path: "/couples/x/w" },
    ];
    const graph = shape({ edges });
    expect(graph.after.map((a) => [a.direction, a.other.id, a.text])).toEqual([
      ["both", JUNIPER, `${first(RAFE)} and ${first(JUNIPER)} agreed to a second date.`],
      ["both", MARISOL, `${first(RAFE)} and ${first(MARISOL)} are together: going steady.`],
    ]);
  });

  it("keeps one row per person and direction (a week of the same beat), newest standing", () => {
    const again = { ...rivals, day: "2026-11-10" };
    const talk = shape({ beats: [rivals, again] });
    expect(talk.after).toHaveLength(2);
    expect(talk.after.every((a) => a.day === "2026-11-12")).toBe(true);
  });

  it("drops a line that names someone who is no longer public, and a private character has no talk at all", () => {
    const people = new Map([...PEOPLE].filter(([id]) => id !== TEO));
    expect(shape({ beats: [rivals], people }).after).toEqual([]);
    expect(shape({ edges: [{ other: TEO, stage: "bad_blood", last_at: null, path: "/couples/a/b" }], people }).friction).toEqual([]);
    expect(shapeTalk({ character: { id: RAFE, name: nameOf(RAFE), private: true }, scenes: [], beats: [rivals], edges: [], people: PEOPLE })).toEqual(EMPTY_TALK);
    expect(shape({}).empty).toBe(true);
  });
});

it("the switch: on unless CHARACTER_TALK=0", () => {
  expect(characterTalkOn({})).toBe(true);
  expect(characterTalkOn({ CHARACTER_TALK: "1" })).toBe(true);
  expect(characterTalkOn({ CHARACTER_TALK: "0" })).toBe(false);
});

/* ------------------------------------------------ the reads and the page ------------------------------------------------ */

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});

const NOW = new Date("2026-11-12T19:00:00Z");
const DAY = "2026-11-12";
const TOMORROW = "2026-11-13";
const HOURS = 60 * 60 * 1000;
const ago = (hours: number) => new Date(NOW.getTime() - hours * HOURS).toISOString();
// Words that live only where a viewer may not look: none of them may reach the talk or the page.
const SECRET = {
  opinion: "OPINION-TAKE-OWNER-ONLY",
  heard: "HEARD-CLAIM-OWNER-ONLY",
  want: "WANT-OWNER-ONLY",
  why: "WHY-SAYS-WHICH-CLAIM-IS-TRUE",
  beatWant: "BEAT-WANT-OWNER-ONLY",
  told: "TOLD-CLAIM-UNTRUE-MARKER",
  hidden: "HIDDEN-SECRET-NIGHT-LIGHT",
  unaired: "UNAIRED-DATE-RETELLING",
  privateDate: "PRIVATE-DATE-RETELLING",
  privateSpeaker: "PRIVATE-SPEAKER-LINE",
  tomorrow: "TOMORROW-BEAT-LINE",
};

beforeEach(async () => {
  await t.reset();
  // A reset keeps the drama wave's tables; these tests plant their own rows in each.
  for (const table of ["story_beats", "house_scenes", "character_opinions", "character_heard", "character_wants", "cast_secrets"]) await t.db.query(`delete from ${table}`);
  clearSharedCache();
  jar.cookies.clear();
  setSeasonCastForTests(CAST.map((c) => c.id));
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  setSeasonCastForTests(null);
});

let n = 0;
async function episode(a: string, b: string, e: { ending?: string; revealedAt?: string | null; visibility?: string; createdAt?: string } = {}) {
  const id = `talk-ep-${++n}`;
  await t.db.query(
    `insert into episodes (id, creator_id, character_a, character_b, setting, goals, scenes, twist, finale, ending, revealed_at, visibility, setup, transcript, created_at)
     values ($1, 'system', $2, $3, 'a bar', '[]'::jsonb, '[]'::jsonb, 'T', 'F', $4, $5, $6, '{"venue":"rooftop_bar"}'::jsonb, '[]'::jsonb, $7)`,
    [id, a, b, e.ending ?? "friends", e.revealedAt === undefined ? ago(3) : e.revealedAt, e.visibility ?? "public", e.createdAt ?? ago(5)],
  );
  await refreshRelationship(t.db, a, b);
  return id;
}
async function person(name: string, owner: string, visibility = "public") {
  const id = `talk-char-${++n}`;
  await t.db.query(
    `insert into characters (id, owner_id, is_house, name, age, bio, traits, want, dealbreaker, visibility)
     values ($1, $2, false, $3, 30, 'Bakes bread and argues with the radio.', '["kind"]'::jsonb, 'someone kind', 'liars', $4)`,
    [id, owner, name, visibility],
  );
  return id;
}
type Line = { character_id: string; text: string; tell?: { episode_id: string; about: string; about_b: string; claim: string; is_true: boolean } };
async function storeScene(day: string, kind: string, cast: string[], lines: Line[], result: unknown = null) {
  const id = sceneIdOf(day, kind);
  const told = lines.flatMap((l, i) => (l.tell ? [{ ...l.tell, line: i + 1, by: l.character_id, to: cast.filter((c) => c !== l.character_id), source: `scene:${id}#${i + 1}` }] : []));
  await t.db.query(
    `insert into house_scenes (id, day, season_id, kind, place, cast_ids, lines, told, tension, result, source, created_at, written_at)
     values ($1, $2, '2026-11-01', $3, 'stairs', $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, 'template', $9, $9)`,
    [id, day, kind, JSON.stringify(cast), JSON.stringify(lines), JSON.stringify(told), JSON.stringify({ kind: "knows_said", a: cast[0], b: cast[1], about: null }), JSON.stringify(result), `${day}T18:20:00Z`],
  );
  return id;
}
async function beat(day: string, tension: string, who: string[], about: string | null, previously: string, status = "staged") {
  await t.db.query(
    `insert into story_beats (day, season_id, kind, status, tension, who, about, evidence, why, logline, previously, tonight, wants)
     values ($1, '2026-11-01', 'same_room', $2, $3, $4::jsonb, $5, $6::jsonb, $7, 'x', $8, 'Tonight: x', $9::jsonb)`,
    [day, status, tension, JSON.stringify(who), about, JSON.stringify({ heard: ["h1"] }), SECRET.why, previously, JSON.stringify([{ holder: who[0], about: who[1], kind: "settle_score", want: SECRET.beatWant }])],
  );
}
const talkOf = (id: string, opts: Parameters<typeof characterTalk>[2] = {}) => characterTalk(t.db, { id, name: nameOf(id) }, { now: NOW, ...opts });
const page = async (id: string, cookie: string | null = null) => {
  jar.cookies.clear();
  if (cookie) jar.cookies.set(cookie.split("=")[0], cookie.split("=")[1]);
  return renderToStaticMarkup(await CharacterPage({ params: Promise.resolve({ id }) }));
};
const panelTag = (html: string, id: string) => html.match(new RegExp(`<div data-panel="${id}"[^>]*>`))?.[0] ?? null;

/** A house with a week of story around Rafe, and everything a viewer may not see planted beside it. */
async function seed() {
  const aired = await episode(RAFE, JUNIPER, { ending: "disaster" });
  const unaired = await episode(RAFE, MARISOL, { revealedAt: null });
  const hiddenDate = await episode(RAFE, TEO, { visibility: "private" });
  const lurker = await person("Wren Lurker", "u-lurker", "private");
  const tell = (episode_id: string, about_b: string, claim: string, is_true = true) => ({ episode_id, about: RAFE, about_b, claim, is_true });
  const gossip = await storeScene(DAY, "gossip", [DEX, MARISOL, lurker], [
    { character_id: DEX, text: `${first(RAFE)} and ${first(JUNIPER)} left by separate doors.`, tell: tell(aired, JUNIPER, SECRET.told, false) },
    { character_id: MARISOL, text: `Poor ${first(RAFE)}. Somebody should check on him.` },
    { character_id: DEX, text: SECRET.unaired, tell: tell(unaired, MARISOL, "x") },
    { character_id: MARISOL, text: SECRET.privateDate, tell: tell(hiddenDate, TEO, "x") },
    { character_id: lurker, text: `${SECRET.privateSpeaker} about ${first(RAFE)}.` },
  ]);
  const fight = await storeScene("2026-11-11", "confrontation", [RAFE, DEX], [
    { character_id: RAFE, text: "Say it to my face." },
    { character_id: DEX, text: `Fine, ${first(RAFE)}. I said it.` },
  ], { kind: "confrontation", outcome: "cleared_the_air", over: "knows_said", a: RAFE, b: DEX, witness: null, moved: [{ holder: RAFE, about: DEX, from: -1, to: 1 }], settled: 1 });
  await beat(DAY, "rivals", [DEX, TEO], RAFE, `Previously: ${first(DEX)} and ${first(TEO)} both set their sights on ${first(RAFE)}.`);
  await beat(TOMORROW, "mutual_distrust", [RAFE, MARISOL], null, `Previously: ${SECRET.tomorrow}`);
  await beat("2026-11-09", "mutual_distrust", [RAFE, TEO], null, `Previously: ${SECRET.tomorrow} (skipped)`, "skipped");
  // The story state: the owner's alone.
  await t.db.query(`insert into character_opinions (holder_id, about_id, trust, attraction, take, basis) values ($1, $2, -2, 2, $3, 'heard')`, [DEX, RAFE, SECRET.opinion]);
  await t.db.query(`insert into character_heard (id, holder_id, about_id, claim, told_by, source, is_true) values ('h1', $1, $2, $3, $4, 'scene:x#1', false)`, [MARISOL, RAFE, SECRET.heard, DEX]);
  await t.db.query(`insert into character_wants (holder_id, season_id, week_id, want, about_id, kind, set_by) values ($1, '2026-11-01', '2026-W46', $2, $3, 'pursue', 'rules')`, [DEX, SECRET.want, RAFE]);
  await t.db.query(`insert into cast_secrets (character_id, season_id, idx, secret, source) values ($1, '2026-11-01', 0, $2, 'pool') on conflict (character_id, season_id, idx) do update set secret = excluded.secret`, [RAFE, SECRET.hidden]);
  return { aired, gossip, fight, lurker };
}

describe("characterTalk: public only", () => {
  it("tells what /house, the producer's line up to today and the public graph show, with links, and nothing else", async () => {
    const { gossip, fight } = await seed();
    const talk = (await talkOf(RAFE))!;
    expect(talk.empty).toBe(false);
    // Said: the retelling of the aired date, the line that names him, and Dex's line from the confrontation.
    expect(talk.said.map((l) => l.text)).toEqual([`${first(RAFE)} and ${first(JUNIPER)} left by separate doors.`, `Poor ${first(RAFE)}. Somebody should check on him.`, `Fine, ${first(RAFE)}. I said it.`]);
    expect(talk.said[0].href).toBe(scenePath(gossip));
    // Friction, newest first: today's aired disaster as public bad blood, then yesterday's confrontation with its result.
    expect(talk.friction.map((f) => [f.kind, f.text, f.result])).toEqual([
      ["bad_blood", `Bad blood with ${first(JUNIPER)}.`, null],
      ["confrontation", `Had it out with ${first(DEX)} on the stairs.`, "They cleared the air."],
    ]);
    expect(talk.friction[1].href).toBe(scenePath(fight));
    // After them: today's public rivals line, linked to the day's scene. Tomorrow's beat and a skipped one aren't public.
    expect(talk.after.map((a) => [a.direction, a.other.id])).toEqual([["them", DEX], ["them", TEO]]);
    expect(talk.after[0].href).toBe(scenePath(gossip));
    const all = JSON.stringify(talk);
    for (const [what, words] of Object.entries(SECRET)) expect(all, what).not.toContain(words);
    // Whether a retelling was true is not in /house's view, so not here either.
    expect(all).not.toMatch(/is_true|"claim"|"told"|"tension"|"evidence"|"why"|"moved"/);
    // The one being pursued sees who is after them; the pursuer's page says who they are after.
    expect((await talkOf(DEX))!.after.map((a) => [a.direction, a.other.id])).toEqual([["theirs", RAFE]]);
  });

  it("drops a line once its speaker goes private or is deleted, and what names a now-private character", async () => {
    await seed();
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [MARISOL]);
    clearSharedCache();
    expect((await talkOf(RAFE))!.said.map((l) => l.speaker.id)).not.toContain(MARISOL);
    // Teo went private: the rivals line names him, so it goes whole, for everyone it named.
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [TEO]);
    expect((await talkOf(RAFE))!.after).toEqual([]);
    // Juniper too: the bad blood with her is no longer told.
    await t.db.query(`update characters set visibility = 'private' where id = $1`, [JUNIPER]);
    const talk = (await talkOf(RAFE))!;
    expect(talk.friction.map((f) => f.kind)).toEqual(["confrontation"]);
    // The retelling of the date with her went with her (as on /house).
    expect(talk.said.map((l) => l.text)).toEqual([`Fine, ${first(RAFE)}. I said it.`]);
    await t.db.query(`update characters set visibility = 'public' where id = any($1)`, [[MARISOL, TEO, JUNIPER]]);
  });

  it("reads the public layer of the graph whoever asks: an unaired or private date never makes a tie", async () => {
    const owner = "u-owner";
    const mine = await person("Ira Fenn", owner);
    await episode(mine, RAFE, { ending: "second_date", revealedAt: null });
    await episode(mine, DEX, { ending: "disaster", visibility: "private" });
    const rels = await relationshipsOf(t.db, mine);
    expect(rels.length).toBe(2);
    expect(publicEdges(mine, rels, NOW)).toEqual([]);
    expect(await characterTalk(t.db, { id: mine, name: "Ira Fenn" }, { now: NOW })).toEqual(EMPTY_TALK);
    // Aired and public, the second date is told on both pages.
    await episode(mine, JUNIPER, { ending: "second_date" });
    const talk = (await characterTalk(t.db, { id: mine, name: "Ira Fenn" }, { now: NOW }))!;
    expect(talk.after.map((a) => [a.direction, a.other.id, a.text])).toEqual([["both", JUNIPER, `Ira and ${first(JUNIPER)} agreed to a second date.`]]);
  });

  it("is null with the switch off, empty for a private character, and empty (never a throw) when a read fails", async () => {
    await seed();
    expect(await talkOf(RAFE, { env: { CHARACTER_TALK: "0" } })).toBeNull();
    expect(await characterTalk(t.db, { id: RAFE, name: nameOf(RAFE), private: true }, { now: NOW })).toEqual(EMPTY_TALK);
    expect((await talkOf(RAFE, { edges: Promise.reject(new Error("down")) }))!.friction.map((f) => f.kind)).toEqual(["confrontation"]);
    // HOUSE_SCENES=0 and PRODUCER=0 take the house's part away, as they do on /house; the graph's stays.
    vi.stubEnv("HOUSE_SCENES", "0");
    const quiet = (await talkOf(RAFE, { env: { PRODUCER: "0" } }))!;
    expect(quiet.said).toEqual([]);
    expect(quiet.after).toEqual([]);
    expect(quiet.friction.map((f) => f.kind)).toEqual(["bad_blood"]);
  });
});

describe("the character page: Talk in Audience's place", () => {
  it("has a Talk tab with the talk, ratings under the name, and the reviews folded at the old #audience anchor", async () => {
    await seed();
    const html = await page(RAFE);
    const tabs = html.slice(html.indexOf('<div class="page-tabs" role="tablist"'), html.indexOf('<div data-panel="profile"'));
    expect(tabs).toMatch(/id="tab-talk"[^>]*><span class="tab-long">Talk of the house<\/span><span class="tab-short">Talk<\/span><\/button>/);
    expect(tabs).not.toContain("Audience");
    expect(panelTag(html, "audience")).toBeNull();
    expect(panelTag(html, "talk")).toContain("hidden");
    const talk = html.slice(html.indexOf(panelTag(html, "talk")!), html.indexOf('<div data-panel="dates"'));
    for (const words of ["Talk of the house", `Said about ${first(RAFE)}`, "left by separate doors.", "Friction", "They cleared the air.", "Who&#x27;s after whom", `is after ${first(RAFE)}`]) expect(talk).toContain(words);
    expect(talk).toContain(`href="/house?scene=${DAY}-gossip#scene-${DAY}-gossip"`);
    expect(talk).not.toContain("Nobody in the house is talking");
    // The old anchor is the reviews fold, inside the Talk panel, closed until a link asks for it.
    expect(talk).toMatch(/<details class="card ux-fold character-audience talk-audience" id="audience"><summary><h3>From the audience<\/h3>/);
    expect(talk).toContain("No reviews yet");
    expect(talk).toMatch(/Write a review of/);
    // The talk comes before the fold; the circle mounts above both.
    expect(talk.indexOf('id="talk"')).toBeLessThan(talk.indexOf('id="audience"'));
    // Ratings: in the header, not in the panel, with the same note.
    const head = html.slice(0, html.indexOf('<div class="page-tabs"'));
    expect(head).toMatch(/<div class="hero-ratings" id="ratings"><div class="ratings ratings-compact"><button type="button" class="rating-chip"/);
    expect(head).toContain("it never changes a date, the odds or anyone&#x27;s points.");
    expect(talk).not.toContain("rating-chip");
    // Nothing a viewer may not see is anywhere on the page.
    for (const [what, words] of Object.entries(SECRET)) expect(html, what).not.toContain(words);
  });

  it("says so in one line, with the page's verb, when nobody is talking; the owner sees counts they can't press", async () => {
    const cookie = newUserCookie();
    const res = await api.createCharacter(validCharacter({ name: "Ira Fenn" }), cookie);
    const id = (await res.json()).id as string;
    const stranger = await page(id);
    const talk = stranger.slice(stranger.indexOf(panelTag(stranger, "talk")!));
    expect(talk).toContain("Nobody in the house is talking about Ira yet; that starts when one of their dates airs.");
    expect(talk).not.toContain("Said about");
    expect(talk).toContain('id="audience"');
    const mine = await page(id, cookie);
    expect(userIdOf(cookie)).toBeTruthy();
    const head = mine.slice(0, mine.indexOf('<div class="page-tabs"'));
    expect(head).toMatch(/<div class="ratings ratings-compact"><span class="rating-chip is-count">/);
    expect(head).not.toMatch(/<button type="button" class="rating-chip/);
    expect(head).toContain("Others rate your character: you can&#x27;t rate your own.");
    expect(mine.slice(mine.indexOf(panelTag(mine, "talk")!))).toContain("Others review your character");
    // The owner's private fold is where it was (the Story tab), never in the talk.
    expect(mine.slice(mine.indexOf(panelTag(mine, "talk")!), mine.indexOf('<div data-panel="dates"'))).not.toContain("only you see this");
  });

  it("CHARACTER_TALK=0 is the Audience tab as it was: ratings and reviews in it, none in the header", async () => {
    await seed();
    vi.stubEnv("CHARACTER_TALK", "0");
    const html = await page(RAFE);
    const tabs = html.slice(html.indexOf('<div class="page-tabs" role="tablist"'), html.indexOf('<div data-panel="profile"'));
    expect(tabs).toMatch(/role="tab"[^>]*>Audience<\/button>/);
    expect(tabs).not.toContain("Talk");
    expect(panelTag(html, "talk")).toBeNull();
    expect(html).not.toContain("hero-ratings");
    const part = html.slice(html.indexOf(panelTag(html, "audience")!));
    expect(part).toMatch(/^<div data-panel="audience"[^>]*>\s*<section class="card character-audience" id="audience"/);
    expect(part).toContain('<div class="ratings"><button type="button" class="rating-chip"');
    expect(html).not.toContain("left by separate doors.");
  });
});
