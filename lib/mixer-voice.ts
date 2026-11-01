/**
 * The room's own words (David 2026-11-01): a model writes a mixer night's opening (when the night runs) and its closing,
 * who leaves with whom (the moment its last table airs, lib/group-dates.ts notifyNightAired). One short call each per
 * night, on the show's default model with no paid upgrade (getModel(…, false): the cheap free-tier one), stored on the
 * night (group_nights.room_opening / room_closing) — written once, never per page view.
 *
 * The same checks as the show's other lines: the content filter (lib/safety.ts checkFields), English (the safety lists
 * are English-only, lib/language-check.ts), a length cap, and the facts kept — the opening names the room, the closing
 * names every pair that leaves together. A call that fails or is refused falls back to the template (lib/mixer-room.ts),
 * stored the same way with room_*_by = 'template', so the page always has something and never asks a model.
 *
 * The closing is only written once every table aired publicly, and the page still hides it until then.
 */
import type { Db } from "./db";
import { trimTo } from "./conversation";
import { needsTranslation } from "./language-check";
import { getModel, type Model } from "./model";
import { roomClosing, roomOpening } from "./mixer-room";
import { shortName } from "./names";
import type { Ending } from "./rules";
import { checkFields } from "./safety";
import { venuePhrase } from "./venues";

/** The longest a room beat may be (a short paragraph on the night page). */
export const ROOM_TEXT_MAX = 420;
const CODE_FENCE = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;

// On in production; the shared test harness turns it off so tests that script the date's model aren't also asked for
// the room. Tests of this file turn it back on.
let voiceEnabled = true;
export function setMixerVoiceEnabledForTests(on: boolean): void {
  voiceEnabled = on;
}

const SYSTEM =
  "You write one short stage direction for Botchelor, an AI dating show: the room at a speed-dating mixer. " +
  "Third person, present tense, warm and a little wry, PG. Two or three sentences, under 350 characters. " +
  "Use only the first names you're given; no other people, no real people, no brands. " +
  'Reply with JSON only: {"text": "..."}';

/** One model-written beat, checked; null when the call fails or the text doesn't pass. */
export async function writeBeat(model: Model, ask: string, mustName: readonly string[]): Promise<string | null> {
  let raw: string;
  try {
    raw = await model.complete(
      [
        { role: "system", content: SYSTEM },
        { role: "user", content: ask },
      ],
      { temperature: 0.8 },
    );
  } catch {
    return null;
  }
  const body = raw.trim();
  const unfenced = CODE_FENCE.exec(body)?.[1] ?? body;
  let text: unknown;
  try {
    text = (JSON.parse(unfenced) as { text?: unknown }).text;
  } catch {
    return null;
  }
  if (typeof text !== "string") return null;
  const clean = trimTo(text.replace(/\s+/g, " ").trim(), ROOM_TEXT_MAX);
  if (clean.length < 20) return null;
  if (!checkFields({ text: clean }).ok) return null;
  if (needsTranslation(clean)) return null;
  if (mustName.some((n) => !clean.includes(n))) return null;
  return clean;
}

type NightRow = { id: string; venue: string; kind: string; room_opening: string | null; room_closing: string | null; rotations: { a: string; b: string; episode_id?: string | null }[] | null };

async function seatsOf(db: Db, nightId: string): Promise<{ ids: string[]; names: Map<string, string> }> {
  const { rows } = await db.query<{ id: string; name: string }>(
    `select c.id, c.name from group_night_seats gs join characters c on c.id = gs.character_id where gs.night_id = $1 order by gs.joined_at`,
    [nightId],
  );
  return { ids: rows.map((r) => r.id), names: new Map(rows.map((r) => [r.id, r.name])) };
}

/** Writes and stores the night's opening (the mixer run, once it's claimed). True when the model wrote it. */
export async function writeRoomOpening(db: Db, nightId: string, model?: Model): Promise<boolean> {
  const g = (await db.query<NightRow>(`select id, venue, kind, room_opening, room_closing, rotations from group_nights where id = $1`, [nightId])).rows[0];
  if (!g || g.kind !== "mixer" || g.room_opening) return false;
  const { ids, names } = await seatsOf(db, nightId);
  const all = ids.map((id) => names.get(id)!);
  const firsts = all.map((n) => shortName(n));
  const text = voiceEnabled
    ? await writeBeat(
        model ?? getModel(undefined, false),
        `The mixer opens at ${venuePhrase(g.venue)}. In the room: ${firsts.join(", ")}. Write the opening: everyone arriving and taking their seats, ` +
          `sizing each other up, and the bell on the bar (six lines with each match, then it rings). Name everyone.`,
        firsts.slice(0, 3),
      )
    : null;
  await db.query(`update group_nights set room_opening = $2, room_opening_by = $3 where id = $1 and room_opening is null`, [
    nightId,
    text ?? roomOpening(nightId, g.venue, all),
    text ? "model" : "template",
  ]);
  return Boolean(text);
}

/**
 * Writes and stores the night's closing, once every table aired publicly (the caller, notifyNightAired, only gets here
 * then). Its facts are the template's (lib/mixer-room.ts roomClosing): the model only tells them. True when it wrote it.
 */
export async function writeRoomClosing(db: Db, nightId: string, model?: Model): Promise<boolean> {
  const g = (await db.query<NightRow>(`select id, venue, kind, room_opening, room_closing, rotations from group_nights where id = $1`, [nightId])).rows[0];
  if (!g || g.kind !== "mixer" || g.room_closing) return false;
  const booked = (g.rotations ?? []).filter((r) => r.episode_id);
  if (!booked.length) return false;
  const { rows } = await db.query<{ id: string; ending: Ending; aired: boolean; public: boolean }>(
    `select id, ending, revealed_at is not null as aired, visibility = 'public' as public from episodes where id = any($1)`,
    [booked.map((r) => r.episode_id)],
  );
  const ep = new Map(rows.map((x) => [x.id, x]));
  if (!booked.every((r) => ep.get(r.episode_id!)?.aired)) return false;
  const tables = booked.filter((r) => ep.get(r.episode_id!)?.public).map((r) => ({ a: r.a, b: r.b, ending: ep.get(r.episode_id!)!.ending }));
  const { ids, names } = await seatsOf(db, nightId);
  const facts = roomClosing(g.venue, tables, names, ids);
  // The pairs that leave together: the one fact a retelling must keep.
  const together = [...facts.matchAll(/(\S+) and (\S+) leave together/g)].flatMap((m) => [m[1], m[2]]);
  const text = voiceEnabled
    ? await writeBeat(
        model ?? getModel(undefined, false),
        `The mixer at ${venuePhrase(g.venue)} is over. What happened, exactly: ${facts} ` +
          `Write the closing beat: who leaves with whom, as the room empties. Keep every fact exactly (who leaves together, who goes home alone); add nothing else that happened.`,
        together,
      )
    : null;
  await db.query(`update group_nights set room_closing = $2, room_closing_by = $3 where id = $1 and room_closing is null`, [nightId, text ?? facts, text ? "model" : "template"]);
  return Boolean(text);
}
