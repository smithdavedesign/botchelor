/**
 * Deleting one message of a companion thread (docs/companions.md, "Deleting one message"). Until 2026-11-15 the words
 * went only with the whole conversation (lib/companion.ts deleteThread) or the account, and the privacy notice had to
 * say so. A person can now delete any message they or the character said, a call's words included, from the thread's
 * Settings (app/companion/[id]/messages): never from the chat itself, which looks as it did.
 *
 * What a delete means, and why:
 *  - The row goes, with what hangs off it: its voice note's audio when no other reply says the same words
 *    (lib/companion-voice.ts forgetUnusedVoices), the report on it (the report is columns on the row), its chips or
 *    answer box, and the earlier draws it replaced (a reply drawn again keeps the old draw hidden under `replaced_by`:
 *    hidden words are still words, so they go too). A photo message has no file of its own (lib/date-photo.ts: the
 *    snapshot is drawn from the date), so only its row goes.
 *  - The notification that carried a text's first line ("💬 Nell texted you") goes with that line, which also clears
 *    its unread dot. An email or a push already sent can't be taken back.
 *  - The AI notice and a scene's line (role `system`) are never deleted on their own: the notice has to stay shown
 *    (lib/companion.ts putNotice: New York GBL Art. 47, at the start and every three hours), and a scene's line is what
 *    the redraw and the edit stop at (lastReply). They go with the conversation.
 *  - A text the character sent first (postFromCharacter) carries its dedupe tag in `action`, and every job that sends
 *    one looks for that tag in companion_messages before it writes (lib/after-date-text.ts, lib/house-texts.ts,
 *    lib/character-questions.ts, lib/character-lessons-job.ts). Deleting the last row that carries a tag would have the
 *    same text sent again, so that row stays as a blank marker instead: no words, no photo, no voice, hidden from every
 *    reader the way a redrawn reply is (`replaced_by` set, here to its own id, which nothing else ever is), with only the
 *    tag and when it was sent. A question's marker keeps whether questions were stopped, so they stay stopped.
 *  - Memory: facts already drawn from the message are the person's to change on the memory page (the page says so).
 *    The rolling summary may contain a message it has covered (`summary_upto`), so it's dropped then, and the next
 *    reply's follow-up writes it again from what's left (lib/companion-memory.ts updateSummary); no model call here.
 *  - A paused (crisis) thread can be deleted from, as the whole conversation can.
 */
import { track } from "./analytics";
import type { CompanionFail } from "./companion";
import { companionMessageDelete, isTextTag } from "./companion-shared";
import { forgetUnusedVoices } from "./companion-voice";
import type { Db } from "./db";
import { clipBody } from "./notifications";

export type MessageDeleted = {
  ok: true;
  /** The rolling summary had covered the message, so it was dropped: the next reply's follow-up writes it again. */
  summary_reset: boolean;
  /** A blank marker of a text the character sent first stayed (its tag and time only), so it isn't sent again. */
  marker: boolean;
};

const fail = (status: number, error: string, message: string): CompanionFail => ({ ok: false, status, error, message });
const NOT_FOUND = fail(404, "not_found", "Not found.");

/** How far back through earlier draws a delete follows `replaced_by` (a reply is rarely drawn again more than a few times). */
const DRAWS_FOLLOWED = 200;

type Gone = { id: string; role: "user" | "character" | "system"; text: string; action: string | null; scene: string | null; created_at: string | Date; on_call: boolean; depth: number };

/**
 * Deletes one message of this person's own thread: theirs or the character's, never a system line. Not-found for
 * someone else's thread, an id that isn't a shown message of it, or with COMPANION_MESSAGE_DELETE=0.
 */
export async function deleteMessage(
  db: Db,
  userId: string,
  threadId: string,
  messageId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<MessageDeleted | CompanionFail> {
  if (!companionMessageDelete(env)) return NOT_FOUND;
  // The same ownership check the conversation's delete makes: the thread is this person's (a guest's included).
  const t = (await db.query<{ id: string; summary_upto: string | Date | null }>(`select id, summary_upto from companion_threads where id = $1 and user_id = $2`, [threadId, userId])).rows[0];
  if (!t) return NOT_FOUND;
  // The message as the thread shows it (never an earlier draw or a marker), and every earlier draw it replaced.
  const { rows: gone } = await db.query<Gone>(
    `with recursive gone as (
       select m.id, m.role, m.text, m.action, m.scene, m.created_at, m.on_call, 0 as depth
         from companion_messages m where m.id = $2 and m.thread_id = $1 and m.replaced_by is null
       union all
       select m.id, m.role, m.text, m.action, m.scene, m.created_at, m.on_call, g.depth + 1
         from companion_messages m join gone g on m.replaced_by = g.id
        where m.thread_id = $1 and m.id <> m.replaced_by and g.depth < $3
     )
     select id, role, text, action, scene, created_at, on_call, depth from gone order by depth, created_at, id`,
    [threadId, messageId, DRAWS_FOLLOWED],
  );
  const target = gone[0];
  if (!target) return NOT_FOUND;
  if (target.role === "system") {
    return fail(409, "kept", "The AI notice and a scene's line stay with the conversation. Deleting the whole conversation removes them.");
  }
  const ids = [...new Set(gone.map((m) => m.id))];
  // A text's tag that would leave the thread with these rows: its earliest row stays, blank, as the marker.
  const tagged = gone.filter((m) => m.role === "character" && !m.scene && isTextTag(m.action));
  const tags = [...new Set(tagged.map((m) => m.action!))];
  let markers: string[] = [];
  if (tags.length) {
    const { rows } = await db.query<{ action: string }>(
      `select distinct action from companion_messages where thread_id = $1 and role = 'character' and action = any($2::text[]) and not (id = any($3::text[]))`,
      [threadId, tags, ids],
    );
    const elsewhere = new Set(rows.map((r) => r.action));
    const at = (m: Gone) => new Date(m.created_at).getTime();
    markers = tags.filter((tag) => !elsewhere.has(tag)).map((tag) => tagged.filter((m) => m.action === tag).sort((a, b) => at(a) - at(b))[0].id);
  }
  const removed = ids.filter((id) => !markers.includes(id));
  // One statement, so a marker is never lost between the two: the rows go and the markers are blanked together. A
  // question's menu holds no words (the field, whether it was answered, whether questions were stopped): kept, so a
  // stop still holds. A date's chips go: nothing is booked from a deleted text.
  await db.query(
    `with blanked as (
       update companion_messages
          set text = '', replaced_by = id, via = 'text', media_url = null, voice_key = null, model = null, cost = null,
              reported = null, reported_at = null, report_reviewed_at = null, report_decision = null, roleplay = null, on_call = false,
              offers = case when offers->'field' is not null and offers->'episode_id' is null then offers else null end
        where thread_id = $1 and id = any($2::text[]) returning id
     ), dropped as (
       delete from companion_messages where thread_id = $1 and id = any($3::text[]) returning id
     )
     select (select count(*) from blanked)::int as blanked, (select count(*) from dropped)::int as dropped`,
    [threadId, markers, removed],
  );
  // The summary covers everything up to summary_upto: it may hold this message, so it's written again from what's left.
  const summaryReset = t.summary_upto !== null && new Date(target.created_at).getTime() <= new Date(t.summary_upto).getTime();
  if (summaryReset) await db.query(`update companion_threads set summary = null, summary_upto = null where id = $1`, [threadId]);
  // The notification that quoted a text's first line (lib/companion.ts postFromCharacter: body = the line, clipped).
  const said = [...new Set(gone.filter((m) => m.role === "character" && m.text).map((m) => clipBody(m.text)))];
  if (said.length) {
    await db
      .query(`delete from notifications where user_id = $1 and kind = 'character_texted_you' and link = $2 and body = any($3::text[])`, [userId, `/companion/${threadId}`, said])
      .catch(() => {});
  }
  // Its voice note's audio, unless another reply says the same words in the same voice.
  await forgetUnusedVoices(db);
  track("companion_message_delete", { role: target.role, call: target.on_call || undefined, marker: markers.length > 0 || undefined, summary_reset: summaryReset || undefined });
  return { ok: true, summary_reset: summaryReset, marker: markers.length > 0 };
}

export type DeletableMessage = {
  id: string;
  /** Who said it. */
  from: "you" | "them";
  text: string;
  at: string;
  /** Said on a call (📞). */
  call: boolean;
  /** A photo from a date (its text is the alt text). */
  photo: boolean;
  /** It has a voice note. */
  voice: boolean;
  /** The person reported it: deleting it takes the report back too. */
  reported: boolean;
};

/**
 * The messages a person can delete, newest first, for the page under the thread's Settings: what they and the character
 * said as the thread shows it (an earlier draw of a reply is not listed: it goes with the reply). Null for someone
 * else's thread.
 */
export async function deletableMessages(db: Db, userId: string, threadId: string): Promise<DeletableMessage[] | null> {
  const own = await db.query(`select 1 from companion_threads where id = $1 and user_id = $2`, [threadId, userId]);
  if (!own.rows.length) return null;
  const { rows } = await db.query<{ id: string; role: "user" | "character"; text: string; created_at: string | Date; on_call: boolean; via: string; voice_key: string | null; reported: string | null }>(
    `select id, role, text, created_at, on_call, via, voice_key, reported from companion_messages
      where thread_id = $1 and role <> 'system' and replaced_by is null
      order by created_at desc, id desc`,
    [threadId],
  );
  return rows.map((m) => ({
    id: m.id,
    from: m.role === "user" ? "you" : "them",
    text: m.text,
    at: new Date(m.created_at).toISOString(),
    call: m.on_call,
    photo: m.via === "photo",
    voice: Boolean(m.voice_key),
    reported: Boolean(m.reported),
  }));
}
