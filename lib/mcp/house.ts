/**
 * The house over MCP (2.31.0): what an agent can read of the show's house and story layer.
 *
 *  - get_house_scene: one house scene exactly as /house shows it to a stranger (lib/house-scenes.ts listHouseScenes and
 *    houseScene: lines reported away, private speakers and retellings of dates that are no longer public are already
 *    left out there, so nothing here can show more than the page does).
 *  - get_house_talk: the public scenes that name one character (it spoke, it was in the room, its date was talked
 *    about, it had it out with someone, it won the challenge), each decided from that same public view.
 *  - get_story_so_far: the producer's public lines for today, what GET /api/story returns (lib/producer.ts clipStory).
 *  - my_story_state: for the caller's OWN character, what its owner's fold on the character page shows
 *    (lib/story-state.ts storyView): what it thinks of people, what it has heard and from whom, what it wants this
 *    week. Forgetting stays where it already was, forget_memory (kinds opinion and heard), which calls the same route
 *    the page's Forget buttons do.
 *
 * All four only read. Nothing an owner can send into a scene exists on the site (a scene is written by the show from
 * aired dates; the one write on /house is a viewer's report of a line), so there is no write tool here, and nothing in
 * this file touches points, odds, pairings or endings.
 *
 * MCP_HOUSE=0 turns the four tools off without a deploy of code: they leave every tool list and a call is refused.
 */
import type { Db } from "../db";
import { houseLine, houseScene, houseScenesOn, type HouseSceneView, listHouseScenes, scenePath } from "../house-scenes";
import { shortName } from "../names";
import { clipStory, producerOn } from "../producer";
import { siteUrl } from "../site";
import { storyStateOn, storyView } from "../story-state";
import { HOUSE_TALK_DEFAULT, HOUSE_TALK_MAX } from "./constants";
import { mcpHouseOn } from "./schemas";

export const HOUSE_TOOL_NAMES = ["get_house_scene", "get_house_talk", "get_story_so_far", "my_story_state"] as const;
export type HouseToolName = (typeof HOUSE_TOOL_NAMES)[number];
const HOUSE_TOOLS = new Set<string>(HOUSE_TOOL_NAMES);
export const isHouseTool = (name: string): name is HouseToolName => HOUSE_TOOLS.has(name);

export { mcpHouseOn };

/** What a call gets while the switch is off: the server's "not open" shape (as companion's), with its own code. */
export const HOUSE_TOOLS_OFF = { error: "The house tools aren't available right now.", code: "not_available" } as const;

/** How many of a scene's lines get_house_talk quotes (the ones by the character or naming it). */
const TALK_LINES = 4;
/** How many earlier scenes get_house_scene names under the latest one. */
const EARLIER = 6;

type Outcome = { data: Record<string, unknown> } | { error: string; code?: string };

const link = (sceneId: string): string => `${siteUrl()}${scenePath(sceneId)}`;

/** A scene as an agent reads it: the page's view without the faces' colours and portraits. */
function sceneOut(s: HouseSceneView): Record<string, unknown> {
  return {
    scene_id: s.id,
    day: s.day,
    kind: s.kind,
    ...(s.code ? { code: s.code } : {}),
    place: s.place.label,
    summary: houseLine(s),
    cast: s.cast.map((c) => ({ id: c.id, name: c.name, ...(c.house ? { house: true } : {}) })),
    lines: s.lines.map((l) => ({ n: l.n, character_id: l.id, by: l.name, text: l.text })),
    ...(s.about.length ? { about: s.about.map((d) => ({ episode_id: d.episode_id, a: d.a, b: d.b })) } : {}),
    ...(s.result
      ? { result: s.result.kind === "confrontation" ? { kind: s.result.kind, a: s.result.a, b: s.result.b, outcome: s.result.outcome, label: s.result.label } : { kind: s.result.kind, title: s.result.title, winner: { id: s.result.winner.id, name: s.result.winner.name }, prize: s.result.prize } }
      : {}),
    link: link(s.id),
  };
}

const QUIET = "The house is quiet: no scene has been written yet. One is written each evening (UTC) while a season has a cast.";

/** get_house_scene: the latest scene (and the ids of the few before it), or the one asked for by id. */
export async function getHouseScene(db: Db, args: Record<string, unknown>, now: Date = new Date()): Promise<Outcome> {
  const wanted = typeof args.scene_id === "string" ? args.scene_id.trim() : "";
  if (wanted) {
    // The same shape /house accepts for ?scene= (an id is a day and a kind).
    const scene = /^[A-Za-z0-9_.-]{1,64}$/.test(wanted) ? await houseScene(db, wanted) : null;
    if (!scene) return { error: `No house scene with that scene_id (${wanted.slice(0, 64)}). get_house_scene without one returns the latest and lists the ones before it.`, code: "not_found" };
    return { data: { scene: sceneOut(scene) } };
  }
  const { scenes } = await listHouseScenes(db, { limit: EARLIER + 1 });
  const [lead, ...earlier] = scenes;
  if (!lead) return { data: { scene: null, empty_note: houseScenesOn() ? QUIET : "The house is closed right now." } };
  return {
    data: {
      scene: sceneOut(lead),
      today: lead.day === now.toISOString().slice(0, 10),
      ...(earlier.length ? { earlier: earlier.map((s) => ({ scene_id: s.id, day: s.day, kind: s.kind, summary: houseLine(s) })) } : {}),
    },
  };
}

/** Whether `text` says `name` as a word ("Nell", not "Nelly"). */
const says = (text: string, name: string): boolean => new RegExp(`(^|[^\\p{L}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}]|$)`, "iu").test(text);

/**
 * get_house_talk: the public scenes that name one character, newest first. A scene is found by the stored row (who was
 * in the room, who spoke, whose date was retold) and then read through the page's own view, and how it names the
 * character is decided from that view alone: a line taken down, or a date that stopped being public, names nobody.
 */
export async function getHouseTalk(db: Db, args: Record<string, unknown>, viewerId: string | null): Promise<Outcome> {
  const id = String(args.character_id ?? "").trim();
  const who = (await db.query<{ id: string; name: string; visibility: string; owner_id: string | null }>(`select id, name, visibility, owner_id from characters where id = $1`, [id])).rows[0];
  // A private character reads as no character at all to anyone but its owner (as get_character has it).
  const mine = Boolean(who && viewerId && who.owner_id === viewerId);
  if (!who || (who.visibility !== "public" && !mine)) return { error: "No character with that character_id.", code: "not_found" };
  const character = { id: who.id, name: who.name };
  if (who.visibility !== "public") {
    return { data: { character, talked_about: false, scenes: [], empty_note: "The house only talks about public characters' public, aired dates: this one isn't public, so it is never named there." } };
  }
  if (!houseScenesOn()) return { data: { character, talked_about: false, scenes: [], empty_note: "The house is closed right now." } };
  const limit = Math.min(Math.max(Math.trunc(Number(args.limit)) || HOUSE_TALK_DEFAULT, 1), HOUSE_TALK_MAX);
  const j = (v: unknown) => JSON.stringify(v);
  const { rows } = await db.query<{ id: string }>(
    `select id from house_scenes
      where source in ('model', 'template') and jsonb_array_length(lines) > 0
        and (cast_ids @> $1::jsonb or lines @> $2::jsonb or told @> $3::jsonb or told @> $4::jsonb)
      order by day desc, created_at desc limit $5`,
    // A few more than asked for: some may name nobody once read through the public view.
    [j([id]), j([{ character_id: id }]), j([{ about: id }]), j([{ about_b: id }]), limit * 2 + 2],
  );
  const views = (await Promise.all(rows.map((r) => houseScene(db, r.id).catch(() => null)))).filter((s): s is HouseSceneView => s !== null);
  // Which of the dates those scenes still talk about were this character's.
  const episodeIds = [...new Set(views.flatMap((s) => s.about.map((d) => d.episode_id)))];
  const theirs = new Set(
    episodeIds.length
      ? (await db.query<{ id: string }>(`select id from episodes where id = any($1) and (character_a = $2 or character_b = $2)`, [episodeIds, id])).rows.map((r) => r.id)
      : [],
  );
  const name = shortName(who.name);
  const scenes = views
    .map((s) => {
      const how = [
        ...(s.lines.some((l) => l.id === id) ? ["spoke"] : []),
        ...(s.cast.some((c) => c.id === id) ? ["was_there"] : []),
        ...(s.about.some((d) => theirs.has(d.episode_id)) ? ["date_talked_about"] : []),
        ...(s.result?.kind === "confrontation" && s.cast.some((c) => c.id === id) && (s.result.a === name || s.result.b === name) ? ["had_it_out"] : []),
        ...(s.result?.kind === "challenge" && s.result.winner.id === id ? ["won_the_challenge"] : []),
      ];
      const lines = s.lines.filter((l) => l.id === id || says(l.text, name)).slice(0, TALK_LINES);
      // A scene that only quotes the name in a line counts too: that is the house talking about them.
      if (!how.length && lines.some((l) => l.id !== id)) how.push("named");
      return { s, how, lines };
    })
    .filter((x) => x.how.length > 0)
    .slice(0, limit)
    .map(({ s, how, lines }) => ({
      scene_id: s.id,
      day: s.day,
      kind: s.kind,
      place: s.place.label,
      how,
      summary: houseLine(s),
      ...(lines.length ? { lines: lines.map((l) => ({ n: l.n, by: l.name, text: l.text })) } : {}),
      link: link(s.id),
    }));
  return {
    data: {
      character,
      talked_about: scenes.length > 0,
      scenes,
      ...(scenes.length
        ? { note: "Each scene's whole text: get_house_scene with its scene_id. What the cast says there can be wrong: it is gossip about dates that aired, and it never changes how a date ends." }
        : { empty_note: `Nobody in the house has named ${name} yet. The house talks about public dates once they've aired.` }),
    },
  };
}

/** get_story_so_far: the producer's public lines for today and the aired dates the last few beats were about (GET /api/story). */
export async function getStorySoFar(db: Db, now: Date = new Date()): Promise<Outcome> {
  const s = await clipStory(db, now);
  const base = siteUrl();
  return {
    data: {
      day: s.day,
      logline: s.logline,
      previously: s.previously,
      tonight: s.tonight,
      episodes: s.episodes.map((e) => ({ episode_id: e.id, day: e.day, logline: e.logline, link: `${base}/episodes/${e.id}` })),
      ...(s.day
        ? {}
        : { empty_note: producerOn() ? "No story line today: the producer writes one overnight when the cast gives it something to follow." : "The producer is off right now." }),
      note: "Written by the show's producer from what has aired. It frames tonight; the engine alone decides how every date ends.",
    },
  };
}

/** my_story_state: what the caller's own character holds, as its owner's fold shows it. Ownership is the caller's to check. */
export async function myStoryState(db: Db, characterId: string, now: Date = new Date()): Promise<Outcome> {
  const view = await storyView(db, characterId, now);
  if (!view) return { data: { character_id: characterId, empty_note: storyStateOn() ? "Nothing yet." : "Story state is off right now." } };
  const nothing = !view.thinks.length && !view.heard.length && !view.want;
  return {
    data: {
      character_id: characterId,
      thinks: view.thinks.map((o) => ({
        about: o.about_id,
        name: o.about_name,
        trust: o.trust_label,
        ...(o.attraction_label ? { attraction: o.attraction_label } : {}),
        take: o.take,
        basis: o.basis,
        ...(o.source ? { from: o.source } : {}),
        forget: { kind: "opinion", item: o.item },
      })),
      // Whether a heard thing is true is never here: the character doesn't know (lib/story-state.ts StoryView).
      heard: view.heard.map((h) => ({
        id: h.id,
        claim: h.claim,
        about: h.about_name,
        ...(h.about_b_name ? { and: h.about_b_name } : {}),
        told_by: h.told_by_name ?? "watched it air",
        ...(h.used_at ? { brought_up: true } : {}),
        from: h.source,
        forget: { kind: "heard", item: h.item },
      })),
      wants: view.want ? { want: view.want.want, kind: view.want.kind, ...(view.want.about_id ? { about: view.want.about_id } : {}), week: view.want.week_id } : null,
      ...(view.forgotten.length ? { forgotten: view.forgotten.map(({ kind, item, label }) => ({ kind, item, label })) } : {}),
      ...(nothing ? { empty_note: "Nothing yet: it forms opinions from its aired dates, hears things in the house, and gets a want each week it's on the cast." } : {}),
      note: "Private to you. It colours how the character talks on dates and in texts, never how a date ends. To make it forget one: forget_memory with this character_id and that item's forget { kind, item } (remember_again: true undoes it).",
    },
  };
}

/**
 * Whether a public house scene still talks about this date, for get_episode's pointer: the newest such scene, read
 * through the page's view (so a retelling that was taken down points nowhere), or null.
 */
export async function sceneAbout(db: Db, episodeId: string): Promise<{ scene_id: string; summary: string; link: string } | null> {
  if (!mcpHouseOn() || !houseScenesOn()) return null;
  const { rows } = await db.query<{ id: string }>(
    `select id from house_scenes where source in ('model', 'template') and told @> $1::jsonb order by day desc, created_at desc limit 2`,
    [JSON.stringify([{ episode_id: episodeId }])],
  );
  for (const r of rows) {
    const s = await houseScene(db, r.id).catch(() => null);
    if (s?.about.some((d) => d.episode_id === episodeId)) return { scene_id: s.id, summary: houseLine(s), link: link(s.id) };
  }
  return null;
}
