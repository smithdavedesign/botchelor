/**
 * The mixer night as one page (/mixers/[id], lib/mixer-room.ts): the room's opening, every table in the order the bell
 * played them with the beats around it, and the closing once the whole night has aired. Each table is still its own
 * episode, read through getEpisodeView as this viewer — so a private table stays its people's, a table that hasn't
 * aired shows no lines to anyone but its creators, and a reported one stays hidden. Kept apart from lib/group-dates.ts
 * because it reads lib/game.ts (the booking route imports group-dates, and game is a much bigger import).
 */
import { portraitPathSql } from "./assets";
import type { Turn } from "./conversation";
import type { Db } from "./db";
import { getEpisodeView, type CharacterRef } from "./game";
import type { GroupNight, Rotation } from "./group-dates";
import { houseBotCharacterIds } from "./house-bots";
import { backgroundBeats, playOrder, roomClosing, roomOpening, rotationRound, type RoomBeat } from "./mixer-room";
import { endingLabel, type Ending } from "./rules";

export type MixerTableState = "ready" | "airs_soon" | "generating" | "private" | "hidden" | "failed";

export type MixerTable = {
  /** The rotation's index on the night (rotations[index]). */
  index: number;
  round: number;
  episode_id: string | null;
  characters: [CharacterRef, CharacterRef];
  state: MixerTableState;
  /** The lines, when this viewer may read them (aired, or one of the table's creators). */
  turns: Turn[];
  /** The table's ending, only when its lines are shown (aired, or its creators'). */
  ending_label: string | null;
  beats: RoomBeat[];
};

export type MixerSeatView = CharacterRef & { house_run: boolean };

export type MixerNightView = {
  id: string;
  venue: string;
  status: GroupNight["status"];
  rounds: number;
  seats: MixerSeatView[];
  opening: string;
  /** Who leaves with whom: only once every booked table has aired (it would spoil the endings viewers predict). */
  closing: string | null;
  /** In the order the bell plays them. */
  tables: MixerTable[];
};

type SeatRow = { id: string; name: string; is_house: boolean; hue: number | null; portrait: string | null; agent: boolean; private: boolean };

export async function mixerNightView(db: Db, nightId: string, viewerId: string | null): Promise<MixerNightView | null> {
  const g = (await db.query<{ id: string; venue: string; status: GroupNight["status"]; rotations: Rotation[] | null }>(
    `select id, venue, status, rotations from group_nights where id = $1 and kind = 'mixer'`,
    [nightId],
  )).rows[0];
  if (!g) return null;
  const seatRows = (
    await db.query<SeatRow>(
      `select c.id, c.name, c.is_house, c.avatar_hue as hue, ${portraitPathSql("c")} as portrait, c.created_via = 'mcp' as agent,
              (c.visibility = 'private' and c.owner_id is distinct from $2::text) as private
         from group_night_seats gs join characters c on c.id = gs.character_id
        where gs.night_id = $1 order by gs.joined_at`,
      [nightId, viewerId],
    )
  ).rows;
  const bots = await houseBotCharacterIds(db, seatRows.map((s) => s.id)).catch(() => new Set<string>());
  const seats: MixerSeatView[] = seatRows.map((s) => ({
    id: s.id,
    name: s.name,
    house: s.is_house,
    hue: s.hue,
    portrait: s.portrait,
    agent: s.agent,
    ...(s.private ? { private: true } : {}),
    house_run: s.is_house || bots.has(s.id),
  }));
  const byId = new Map(seats.map((s) => [s.id, s]));
  const names = new Map(seats.map((s) => [s.id, s.name]));
  const seatIds = seats.map((s) => s.id);
  const rotations = g.rotations ?? [];
  const rounds = rotations.length ? Math.max(...rotations.map((_, i) => rotationRound(rotations, i))) + 1 : 0;
  const ref = (id: string): CharacterRef => {
    const { house_run: _hr, ...c } = byId.get(id) ?? { id, name: "Someone", house: false, hue: null, portrait: null, house_run: false };
    return c;
  };

  const tables: MixerTable[] = [];
  for (const i of playOrder(rotations)) {
    const r = rotations[i];
    const base = { index: i, round: rotationRound(rotations, i), episode_id: r.episode_id ?? null, beats: backgroundBeats(g.id, rotations, i, names, seatIds) };
    if (!r.episode_id) {
      tables.push({ ...base, characters: [ref(r.a), ref(r.b)], state: "failed", turns: [], ending_label: null });
      continue;
    }
    const view = await getEpisodeView(db, r.episode_id, viewerId).catch(() => null);
    if (!view) {
      tables.push({ ...base, characters: [ref(r.a), ref(r.b)], state: "private", turns: [], ending_label: null });
      continue;
    }
    const mine = view.is_creator || view.is_host;
    const state: MixerTableState =
      view.hidden && !mine ? "hidden" : view.status === "generating" ? "generating" : !view.revealed && !mine ? "airs_soon" : "ready";
    const show = state === "ready" || (state === "generating" && mine);
    tables.push({
      ...base,
      characters: view.characters,
      state,
      turns: show ? (view.transcript ?? []) : [],
      ending_label: state === "ready" && view.ending ? endingLabel(view.ending as Ending, view.date_number) : null,
    });
  }

  // The closing: every booked table aired. Private tables never count toward it (their endings are their people's).
  let closing: string | null = null;
  const booked = rotations.filter((r) => r.episode_id);
  if (booked.length && (g.status === "done" || g.status === "running")) {
    const { rows } = await db.query<{ id: string; ending: Ending; aired: boolean; public: boolean }>(
      `select id, ending, revealed_at is not null as aired, visibility = 'public' as public from episodes where id = any($1)`,
      [booked.map((r) => r.episode_id)],
    );
    const ep = new Map(rows.map((x) => [x.id, x]));
    if (booked.every((r) => ep.get(r.episode_id!)?.aired)) {
      const endings = booked
        .filter((r) => ep.get(r.episode_id!)?.public)
        .map((r) => ({ a: r.a, b: r.b, ending: ep.get(r.episode_id!)!.ending }));
      closing = roomClosing(g.venue, endings, names, seatIds);
    }
  }
  return { id: g.id, venue: g.venue, status: g.status, rounds, seats, opening: roomOpening(g.id, g.venue, seats.map((s) => s.name)), closing, tables };
}

/** The mixer night an episode was one table of (the episode page's link back to the whole room), with its round. */
export async function mixerNightOf(db: Db, episodeId: string): Promise<{ night_id: string; venue: string; round: number; rounds: number } | null> {
  const g = (
    await db.query<{ id: string; venue: string; rotations: Rotation[] | null }>(
      `select gn.id, gn.venue, gn.rotations from episodes e join group_nights gn on gn.id = e.group_id where e.id = $1 and gn.kind = 'mixer'`,
      [episodeId],
    )
  ).rows[0];
  if (!g?.rotations?.length) return null;
  const i = g.rotations.findIndex((r) => r.episode_id === episodeId);
  if (i < 0) return null;
  const rounds = Math.max(...g.rotations.map((_, j) => rotationRound(g.rotations!, j))) + 1;
  return { night_id: g.id, venue: g.venue, round: rotationRound(g.rotations, i) + 1, rounds };
}
