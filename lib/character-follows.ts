/**
 * Follow a character (2026-11-16). People could follow a couple (lib/follows.ts) and a creator
 * (lib/showcase-social.ts), never one character, so the only reason to come back was a character of their own. One
 * control on a public character's page, and following means two things for that person:
 *
 *  - THEY HEAR when something public happens to the character, through the kinds that already tell a couple's
 *    followers and an owner, with the same words: a date of theirs airs (`couple_date`), the date agreed a second one
 *    or made them a couple (`stage_up`; both from lib/relationship-events.ts, on airing), the house talks about them or
 *    they are in a confrontation or the week's challenge (`house_talk`, right after the scene is stored). One notice a
 *    person an event, whichever of its people they follow, and each kind sits under a type they can mute
 *    (lib/notification-types.ts: Matches & dates, The show).
 *  - THE CHARACTER MAY TEXT THEM. Where they may text it (the eligibility its Text button uses, lib/companion.ts), the
 *    thread is found, or opened the way "Hear from" opens one (the AI notice, no opener, no model call), and its texts
 *    are switched on, so the event-driven texts (lib/house-texts.ts) arrive in Chat. A follower whose thread got the
 *    character's own text about a scene is not also sent the notice for it: the text's own notice is the one.
 *    Someone without an account gets this only in a conversation they already have (a guest's few threads are theirs
 *    to spend). Unfollowing switches those texts off again when the follow is what switched them on (`texts_on`), and
 *    never deletes a conversation or a message.
 *
 * Who can be followed: a public character whose creator is still here, by anyone but its owner (an owner already
 * hears everything, and more). Never a private one. Following is private, like a couple's: a page shows how many
 * follow, never who.
 *
 * Privacy: every notice here is built from what a stranger can read (an aired public date between two public
 * characters; a scene as /house shows it, lib/house-scenes.ts HouseSceneView). Nothing here reads the story state.
 *
 * CHARACTER_FOLLOW=0 turns it off without a deploy of code: the control is hidden, the route refuses, and no follower
 * is sent a notice (the rows stay, so turning it back on loses nothing). Texts a follow had switched on stay on the
 * thread's own switch (Settings, "Let {name} text you first"), which is where a person turns them off meanwhile.
 */
import type { Db } from "./db";
import { notifyAll } from "./notifications";
import { DELETED_OWNER } from "./rules";

type Env = Record<string, string | undefined>;

/** CHARACTER_FOLLOW: on unless it is "0". */
export const characterFollowOn = (env: Env = process.env): boolean => env.CHARACTER_FOLLOW?.trim() !== "0";

/** Follows one person may start an hour and a day (each may open a quiet thread): abuse only. */
export const CHARACTER_FOLLOW_LIMITS = { perHour: 60, perDay: 300 };

export type CharacterFollowState = { following: boolean; followers: number };
const NOBODY: CharacterFollowState = { following: false, followers: 0 };

/** Whether this viewer follows the character, and how many do. One read; the page starts it with its first query. */
export async function characterFollowState(db: Db, characterId: string, userId: string | null): Promise<CharacterFollowState> {
  const { rows } = await db.query<{ n: number; me: boolean }>(
    `select count(*)::int as n, coalesce(bool_or(user_id = $2::text), false) as me from character_follows where character_id = $1`,
    [characterId, userId],
  );
  return { following: rows[0]?.me ?? false, followers: rows[0]?.n ?? 0 };
}

export type FollowWho = { userId: string; authenticated: boolean };
export type FollowFail = { ok: false; status: number; error: "off" | "not_found" | "private" | "own"; message: string };
export type FollowDone = {
  ok: true;
  state: CharacterFollowState;
  /** The character's texts are on for them now (by this follow, or already). */
  texts: boolean;
  /** Their conversation with the character, when there is one. */
  thread_id: string | null;
};

const fail = (status: number, error: FollowFail["error"], message: string): FollowFail => ({ ok: false, status, error, message });
const OFF = fail(404, "off", "Not found.");

/**
 * Follows a character. Idempotent: following twice changes nothing, and a second follow never claims texts a first one
 * did not switch on.
 */
export async function followCharacter(db: Db, who: FollowWho, characterId: string, opts: { now?: Date; env?: Env } = {}): Promise<FollowDone | FollowFail> {
  const env = opts.env ?? process.env;
  if (!characterFollowOn(env)) return OFF;
  const c = (await db.query<{ owner_id: string | null; visibility: string }>(`select owner_id, visibility from characters where id = $1`, [characterId])).rows[0];
  if (!c || c.owner_id === DELETED_OWNER) return fail(404, "not_found", "That character isn't here.");
  if (c.owner_id === who.userId) return fail(409, "own", "They're yours: you already hear everything that happens to them.");
  if (c.visibility !== "public") return fail(404, "private", "Their creator keeps this character private.");
  await db.query(`insert into character_follows (user_id, character_id) values ($1, $2) on conflict do nothing`, [who.userId, characterId]);
  const texts = await turnTextsOn(db, who, characterId, opts.now ?? new Date(), env).catch(() => ({ on: false, thread_id: null as string | null }));
  return { ok: true, state: await characterFollowState(db, characterId, who.userId), texts: texts.on, thread_id: texts.thread_id };
}

/**
 * The texts half of a follow: the thread found or quietly opened (an account only), its texts switched on, and the
 * follow marked as the one that did it. Nothing when they may not text this character.
 */
async function turnTextsOn(db: Db, who: FollowWho, characterId: string, now: Date, env: Env): Promise<{ on: boolean; thread_id: string | null }> {
  const { companionAllowed, companionEligible, openThread, threadIdFor } = await import("./companion");
  let threadId: string | null;
  if (who.authenticated) {
    if (!(await companionAllowed(db, who, env)) || !(await companionEligible(db, who.userId, characterId))) return { on: false, thread_id: null };
    // The way "Hear from" opens one: the AI notice, no opener, no model call. An existing thread is left as it is.
    const opened = await openThread(db, who.userId, characterId, now, { opener: false });
    threadId = opened.ok ? opened.thread_id : null;
  } else {
    threadId = await threadIdFor(db, who.userId, characterId);
  }
  if (!threadId) return { on: false, thread_id: null };
  const switched = await db.query(`update companion_threads set muted_proactive = false where id = $1 and user_id = $2 and muted_proactive returning id`, [threadId, who.userId]);
  // Only a follow that switched them on switches them off again (unfollowCharacter).
  if (switched.rows.length) await db.query(`update character_follows set texts_on = true where user_id = $1 and character_id = $2`, [who.userId, characterId]);
  return { on: true, thread_id: threadId };
}

/**
 * Unfollows: the notices stop, and the texts this follow switched on are switched off again. The conversation and
 * everything in it stay. Refused with the switch off, like following.
 */
export async function unfollowCharacter(
  db: Db,
  userId: string,
  characterId: string,
  opts: { env?: Env } = {},
): Promise<{ ok: true; state: CharacterFollowState; /** The texts the follow had switched on went off with it. */ texts_off: boolean } | FollowFail> {
  if (!characterFollowOn(opts.env ?? process.env)) return OFF;
  const gone = (await db.query<{ texts_on: boolean }>(`delete from character_follows where user_id = $1 and character_id = $2 returning texts_on`, [userId, characterId])).rows[0];
  const textsOff = gone?.texts_on === true;
  if (textsOff) await db.query(`update companion_threads set muted_proactive = true where user_id = $1 and character_id = $2`, [userId, characterId]);
  return { ok: true, state: await characterFollowState(db, characterId, userId), texts_off: textsOff };
}

/* ------------------------------------------------ who hears ------------------------------------------------ */

/**
 * The followers of each of these characters, for the ones that are public and whose creator is still here. Never a
 * character's own owner (they hear as its owner). Empty with the switch off.
 */
export async function characterFollowers(db: Db, characterIds: readonly string[], env: Env = process.env): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!characterFollowOn(env) || !characterIds.length) return out;
  const { rows } = await db.query<{ character_id: string; user_id: string }>(
    `select f.character_id, f.user_id
       from character_follows f join characters c on c.id = f.character_id
      where f.character_id = any($1) and c.visibility = 'public' and c.owner_id is distinct from $2 and c.owner_id is distinct from f.user_id
      order by f.created_at, f.user_id`,
    [[...new Set(characterIds)], DELETED_OWNER],
  );
  for (const r of rows) out.set(r.character_id, [...(out.get(r.character_id) ?? []), r.user_id]);
  return out;
}

/**
 * Who follows either of a date's two, to be told it aired (lib/relationship-events.ts): only when both are public (the
 * notice names them both), and never an owner of either (they hear as owners). Each person once.
 */
export async function pairCharacterFollowers(db: Db, x: string, y: string, env: Env = process.env): Promise<string[]> {
  if (!characterFollowOn(env)) return [];
  const { rows } = await db.query<{ user_id: string }>(
    `select distinct f.user_id
       from character_follows f
      where f.character_id = any($1)
        and (select count(*) from characters c where c.id = any($1) and c.visibility = 'public' and c.owner_id is distinct from $2) = 2
        and not exists (select 1 from characters o where o.id = any($1) and o.owner_id = f.user_id)`,
    [[x, y], DELETED_OWNER],
  );
  return rows.map((r) => r.user_id);
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * Right after a house scene is stored (lib/house-scenes.ts textAboutScene, once the characters' own texts have gone):
 * the followers of everyone it names get one `house_talk` notice each, in the owners' words. Read from the scene as
 * /house shows it, so a removed line, a private character and a date that is no longer public are already gone. Never
 * twice for one scene (the link is the key), and not to a follower whose thread just got the character's own text
 * about it. Returns how many went out; never throws.
 */
export async function tellFollowersOfScene(db: Db, sceneId: string, env: Env = process.env): Promise<number> {
  try {
    if (!characterFollowOn(env)) return 0;
    const [{ houseScene, scenePath }, { sceneEvents, houseTextTag }] = await Promise.all([import("./house-scenes"), import("./house-texts")]);
    const scene = await houseScene(db, sceneId);
    if (!scene) return 0;
    // What it did to each person it names, the weightiest first (a confrontation's two, a winner, then who was talked about).
    const events = sceneEvents(scene);
    if (!events.length) return 0;
    const followers = await characterFollowers(db, events.map((e) => e.me.id), env);
    if (!followers.size) return 0;
    const link = scenePath(scene.id);
    const everyone = [...new Set([...followers.values()].flat())];
    const [had, texted] = await Promise.all([
      db.query<{ user_id: string }>(`select user_id from notifications where user_id = any($1) and kind = 'house_talk' and link = $2`, [everyone, link]),
      db.query<{ user_id: string }>(
        `select distinct t.user_id from companion_messages m join companion_threads t on t.id = m.thread_id
          where t.user_id = any($1) and m.role = 'character' and m.action = $2`,
        [everyone, houseTextTag({ kind: "talked", ref: scene.id, day: scene.day })],
      ),
    ]);
    const done = new Set([...had.rows, ...texted.rows].map((r) => r.user_id));
    let sent = 0;
    for (const e of events) {
      const to = (followers.get(e.me.id) ?? []).filter((u) => !done.has(u));
      if (!to.length) continue;
      const other = e.other?.name ?? "Someone";
      const title = lowerFirst(e.title ?? "the challenge");
      const notice =
        e.kind === "confronted"
          ? { title: `🏠 ${e.me.name} had it out with ${other} in the house`, body: `${e.label ?? "They agreed to disagree"}.` }
          : e.kind === "won"
            ? { title: `🏆 ${e.me.name} won ${title}`, body: `The prize: ${e.prize ?? "the next one-on-one"}` }
            : e.kind === "lost"
              ? { title: `🏆 ${e.me.name} was in ${title}`, body: `${other} won.` }
              : { title: `🏠 The house is talking about ${e.me.name}`, body: `${other}, ${e.at ?? "in the house"}: “${e.said ?? ""}”` };
      await notifyAll(db, to, { kind: "house_talk", ...notice, link });
      for (const u of to) done.add(u);
      sent += to.length;
    }
    return sent;
  } catch (err) {
    console.error("[character-follows] could not tell a scene's followers:", err instanceof Error ? err.message : "unknown");
    return 0;
  }
}
