/**
 * The locked picture's text, written when a date airs (the words and the rules are lib/locked-picture.ts: read that
 * first). Called from lib/relationship-events.ts refreshAndAnnounce, the one place every airing passes.
 *
 * WHAT SETS IT OFF (lockedPictureTrigger; from what the engine already decided and what publicly happened):
 *  - `overnight`: the date was an overnight date and the engine ended it in another date, so they left together (the
 *    public milestone of lib/overnight.ts). Always.
 *  - `steady`: an ordinary date that ended in another date, between a couple shown as going steady or more, or as
 *    keeping it casual (lib/relationships.ts storedStages: the SHOWN stage, the one pages read). One such date in
 *    LOCKED_PICTURE_RULES.steadyOneIn, decided by the date's id, because overnight dates are rare.
 *  Any other ending, a private date, a date someone stepped into, or a date that never aired: nothing.
 *
 * WHO HEARS, each side's character to the people it texts, as lib/house-texts.ts does: every thread with that character
 * whose person turned its texts on ("Let {name} text you first", companion_threads.muted_proactive = false) and that
 * isn't paused; its owner first, and anyone else only when the date is public, unhidden and both characters are
 * public. Never someone who muted texts as a notification type, never our own test and house-crowd identities
 * (lib/our-traffic.ts loadOurIds), never an owner the airing keeps quiet (a mixer's fillers), and only people After
 * Dark's own rules say may be told (lib/adult/locked-picture.ts whoMayBeSent: a signed-in adult last seen where its
 * pictures are allowed, for whom the pair's night could open). One text a person a date (their own character's when
 * both sides text them), once a thread a date (`locked_picture:<episode id>`), at most one such text a thread in
 * LOCKED_PICTURE_RULES.perThreadDays, and at most LOCKED_PICTURE_RULES.perAiring an airing. Every one goes through
 * lib/companion.ts postFromCharacter, so the AI notice, the paused rule, the PG check and the `character_texted_you`
 * notice hold.
 *
 * The show's side of this reads no After Dark table: the tile it shows is the character's own PG portrait, blurred
 * (app/api/locked-picture/[id]). LOCKED_PICTURE_TEXTS=0 sends nothing.
 *
 * Sacred rule: nothing here touches points, odds, pairings or endings. It reads an ending and a stage; it writes texts.
 */
import { track } from "./analytics";
import type { Db } from "./db";
import {
  LOCKED_PICTURE_KIND,
  LOCKED_PICTURE_RULES,
  LOCKED_PICTURE_TAG_SQL,
  lockedPictureEpisode,
  lockedPictureLines,
  lockedPicturePromptLine,
  lockedPictureTag,
  lockedPictureTextsOn,
  steadyOrMore,
  steadyRoll,
  type LockedPictureTrigger,
} from "./locked-picture";
import { loadOurIds } from "./our-traffic";
import { leftTogether, overnightDatesOn } from "./overnight-shared";
import { pairKey, storedStages } from "./relationships";
import type { Stage } from "./relationship-stages";
import { DELETED_OWNER, REPORT_HIDE_THRESHOLD } from "./rules";

type Env = Record<string, string | undefined>;

const DAY_MS = 24 * 60 * 60 * 1000;

/** What sets the text off for a date that aired, or null (pure). `roll`: the steady trigger's seeded one-in-N for this date. */
export function lockedPictureTrigger(d: { overnight: boolean; ending: string | null; stage: Stage | null; roll: boolean; overnightOn: boolean }): LockedPictureTrigger | null {
  if (d.overnight) return d.overnightOn && leftTogether(d.ending) ? "overnight" : null;
  return d.ending === "second_date" && steadyOrMore(d.stage) && d.roll ? "steady" : null;
}

export type LockedPictureSent = { trigger: LockedPictureTrigger | null; sent: number };

type DateRow = {
  ending: string | null;
  overnight: boolean;
  is_public: boolean;
  a_id: string; a_name: string; a_owner: string | null; a_public: boolean;
  b_id: string; b_name: string; b_owner: string | null; b_public: boolean;
};
type ThreadRow = { thread_id: string; user_id: string; character_id: string; owner: boolean };

/**
 * A date just aired: sends the locked picture's text to whoever may hear it (see the header). Idempotent: a thread that
 * carries the date's tag is never written to again. `quiet`: owners who hear nothing of this date.
 *
 * `preview`: an admin asked to see it on their own account (POST /api/admin/locked-picture), since our own accounts are
 * otherwise left out and a steady couple's date sends it one time in five. Only that admin's own threads are written
 * to, and a date that ended in another date counts whatever the couple's stage; every other rule holds for them too.
 */
export async function lockedPictureAired(
  db: Db,
  episodeId: string,
  opts: { now?: Date; env?: Env; quiet?: readonly string[]; preview?: string | null } = {},
): Promise<LockedPictureSent> {
  const none: LockedPictureSent = { trigger: null, sent: 0 };
  const env = opts.env ?? process.env;
  if (!lockedPictureTextsOn(env)) return none;
  const now = opts.now ?? new Date();
  const d = (
    await db.query<DateRow>(
      `select e.ending, coalesce(e.setup->>'overnight' = 'true', false) as overnight,
              (e.visibility = 'public' and (select count(*) from reports r where r.episode_id = e.id) < $2) as is_public,
              a.id as a_id, a.name as a_name, a.owner_id as a_owner, a.visibility = 'public' as a_public,
              b.id as b_id, b.name as b_name, b.owner_id as b_owner, b.visibility = 'public' as b_public
         from episodes e
         join characters a on a.id = e.character_a
         join characters b on b.id = e.character_b
        where e.id = $1 and e.status = 'ready' and e.revealed_at is not null and e.visibility <> 'private'
          and e.varies_episode_id is null
          and coalesce(e.setup->>'met_via', '') <> 'step_in'
          and coalesce((e.setup->>'after_dark')::boolean, false) = false`,
      [episodeId, REPORT_HIDE_THRESHOLD],
    )
  ).rows[0];
  if (!d) return none;
  const [lo, hi] = pairKey(d.a_id, d.b_id);
  // The stage as it is SHOWN (lib/relationship-stages.ts), on the layer this date is on. Only an ordinary date asks.
  const stages = d.overnight || d.ending !== "second_date" ? null : await storedStages(db, lo, hi, env);
  const trigger =
    lockedPictureTrigger({
      overnight: d.overnight,
      ending: d.ending,
      stage: stages ? (d.is_public ? stages.public_shown : stages.shown) : null,
      roll: steadyRoll(episodeId),
      overnightOn: overnightDatesOn(env),
    }) ?? (opts.preview && !d.overnight && d.ending === "second_date" ? "steady" : null);
  if (!trigger) return none;
  const sides = [
    { id: d.a_id, partner: d.b_name },
    { id: d.b_id, partner: d.a_name },
  ];
  const everyone = d.is_public && d.a_public && d.b_public;
  const threads = (
    await db.query<ThreadRow>(
      `select t.id as thread_id, t.user_id, t.character_id, coalesce(t.user_id = c.owner_id, false) as owner
         from companion_threads t join characters c on c.id = t.character_id
        where t.character_id = any($1) and t.muted_proactive = false and t.paused_at is null and t.user_id <> $2
          and not exists (select 1 from notification_mutes nm where nm.user_id = t.user_id and nm.type = 'texts')
        order by coalesce(t.user_id = c.owner_id, false) desc, t.last_at desc, t.id`,
      [[d.a_id, d.b_id], DELETED_OWNER],
    )
  ).rows.filter((t) => (t.owner || everyone) && !opts.quiet?.includes(t.user_id) && (!opts.preview || t.user_id === opts.preview));
  if (!threads.length) return { trigger, sent: 0 };
  const ours = opts.preview ? new Set<string>() : new Set(await loadOurIds(db).catch(() => [] as string[]));
  const notOurs = threads.filter((t) => !ours.has(t.user_id));
  if (!notOurs.length) return { trigger, sent: 0 };
  // After Dark's own rules, asked of After Dark's code (imported when needed: most airings never get this far).
  const { whoMayBeSent } = await import("./adult/locked-picture");
  const may = await whoMayBeSent(db, notOurs.map((t) => t.user_id), [lo, hi], now, env);
  // This date already (the tag), or any such text lately: the weekly cap.
  const tag = lockedPictureTag(episodeId);
  const had = (
    await db.query<{ thread_id: string; action: string }>(
      `select thread_id, action from companion_messages
        where thread_id = any($1) and role = 'character' and action ~ ${LOCKED_PICTURE_TAG_SQL} and (created_at >= $2::timestamptz or action = $3)`,
      [notOurs.map((t) => t.thread_id), new Date(now.getTime() - LOCKED_PICTURE_RULES.perThreadDays * DAY_MS).toISOString(), tag],
    )
  ).rows;
  const { postFromCharacter } = await import("./companion");
  const told = new Set<string>();
  let sent = 0;
  // Owners first (the query's order), so a person both sides text hears it from their own character.
  for (const t of notOurs) {
    if (sent >= LOCKED_PICTURE_RULES.perAiring) break;
    const door = may.get(t.user_id);
    if (!door || told.has(t.user_id) || had.some((h) => h.thread_id === t.thread_id)) continue;
    const side = sides.find((s) => s.id === t.character_id);
    if (!side) continue;
    const posted = await postFromCharacter(db, {
      userId: t.user_id,
      characterId: side.id,
      lines: lockedPictureLines(trigger, side.partner, `${episodeId}:${side.id}`),
      // After the overnight text the same airing sends (lib/overnight.ts), so the two read in order.
      now: new Date(now.getTime() + 1000),
      kind: LOCKED_PICTURE_KIND,
      dedupeKey: tag,
    }).catch(() => null);
    if (!posted) continue;
    told.add(t.user_id);
    sent++;
    // The funnel's first step, without content: what set it off, and which tile they will see.
    track("locked_picture_sent", { trigger, door, owner: t.owner });
  }
  return { trigger, sent };
}

/**
 * The companion prompt's one line about it (lib/companion-prompt.ts), while such a text is recent in this thread: where
 * the picture is, and that it is never described. Null with none (a text the person deleted is none: its blank marker
 * only keeps it from being sent again), with LOCKED_PICTURE_TEXTS=0, and on any failure.
 */
export async function lockedPictureForPrompt(db: Db, threadId: string, characterId: string, now: Date = new Date(), env: Env = process.env): Promise<string | null> {
  if (!lockedPictureTextsOn(env)) return null;
  try {
    const { rows } = await db.query<{ action: string }>(
      `select action from companion_messages
        where thread_id = $1 and role = 'character' and action ~ ${LOCKED_PICTURE_TAG_SQL} and created_at >= $2::timestamptz
          and replaced_by is null
        order by created_at desc limit 1`,
      [threadId, new Date(now.getTime() - LOCKED_PICTURE_RULES.promptDays * DAY_MS).toISOString()],
    );
    const episode = lockedPictureEpisode(rows[0]?.action);
    if (!episode) return null;
    const partner = (
      await db.query<{ name: string }>(
        `select c.name from episodes e join characters c on c.id = case when e.character_a = $2 then e.character_b else e.character_a end where e.id = $1 and $2 in (e.character_a, e.character_b)`,
        [episode, characterId],
      )
    ).rows[0];
    return lockedPicturePromptLine(partner?.name ?? null);
  } catch {
    return null;
  }
}
