/**
 * The public profile of one AI agent (docs/PRDs/agent-world.md, Phase 1): the characters it has made, the public dates
 * they've been on and a little about how long it's been here. Keyed on the agent's public HANDLE (lib/agent-handle),
 * never its agent_id — the agent_id is a bearer token and never leaves the server. Everything shown is already public;
 * a private character appears by name only, exactly as the /characters directory lists it (lib/directory.ts), with no
 * portrait, bio or age.
 */
import { dateNumberSql } from "./date-number";
import type { Db } from "./db";
import { portraitPathSql } from "./portrait-sql";
import { endingLabel, type Ending } from "./rules";

export type AgentProfileChar = {
  id: string;
  name: string;
  hue: number;
  private: boolean;
  /** Its approved portrait's path (/api/assets/<id>), or null: a private character's is always null. */
  portrait: string | null;
  /** The one-line hook under the name: the character's bio, as the directory shows it. Null for a private one. */
  bio: string | null;
  age: number | null;
};

/** One side of a date on the profile: enough to draw its face and name it. */
export type AgentProfileDateSide = { id: string; name: string; hue: number | null; house: boolean; portrait: string | null; private: boolean };

export type AgentProfileDate = {
  episode_id: string;
  a: AgentProfileDateSide;
  b: AgentProfileDateSide;
  /** Where it happened (lib/venues.ts PlaceId), or null for a date written before the venue library. */
  venue: string | null;
  ending: Ending;
  /** How it ended, in the show's words, counted for the couple ("A third date"). */
  ending_label: string;
  date_number: number | null;
  aired_at: string | null;
  title: string | null;
};

/** How many of the agent's dates the profile lists: the newest few, with the count above saying how many there are. */
export const PROFILE_DATES_SHOWN = 6;

export type AgentProfile = {
  handle: string;
  display_name: string | null;
  bio: string | null;
  characters: AgentProfileChar[];
  character_count: number;
  /** Aired, public dates any of its characters have been on. */
  public_dates: number;
  /** The newest of those, up to PROFILE_DATES_SHOWN, with both sides and the place. */
  dates: AgentProfileDate[];
  first_seen: string | null;
  last_seen: string | null;
};

type DateRow = {
  id: string;
  ending: Ending;
  aired_at: Date | string | null;
  title: string | null;
  venue: string | null;
  date_number: number | null;
  a_id: string;
  a_name: string;
  a_hue: number | null;
  a_house: boolean;
  a_portrait: string | null;
  a_private: boolean;
  b_id: string;
  b_name: string;
  b_hue: number | null;
  b_house: boolean;
  b_portrait: string | null;
  b_private: boolean;
};

/** A side's columns for `alias`: a private character's portrait stays null, as withPortraits (lib/portrait-sql.ts) keeps it. */
const sideSql = (alias: string, prefix: string) =>
  `${alias}.id as ${prefix}_id, ${alias}.name as ${prefix}_name, ${alias}.avatar_hue as ${prefix}_hue, ${alias}.is_house as ${prefix}_house,
   case when ${alias}.visibility = 'private' then null else ${portraitPathSql(alias)} end as ${prefix}_portrait,
   ${alias}.visibility = 'private' as ${prefix}_private`;

/** The public profile behind a handle, or null when the handle doesn't belong to any agent (so the page is a 404). */
export async function agentProfile(db: Db, handle: string): Promise<AgentProfile | null> {
  const info = (
    await db.query<{ agent_id: string; display_name: string | null; bio: string | null }>(
      `select agent_id, display_name, bio from agent_handles where handle = $1`,
      [handle],
    )
  ).rows[0];
  if (!info) return null;
  const agentId = info.agent_id;

  const chars = (
    await db.query<{ id: string; name: string; hue: number; visibility: string; portrait: string | null; bio: string | null; age: number | null }>(
      `select c.id, c.name, c.avatar_hue as hue, c.visibility, ${portraitPathSql("c")} as portrait, c.bio, c.age from characters c
        where c.owner_id = $1 and c.created_via = 'mcp' and not c.is_house and c.owner_id is distinct from 'deleted'
        order by c.created_at`,
      [agentId],
    )
  ).rows;

  const [dates, seen, recent] = await Promise.all([
    db
      .query<{ n: number }>(
        `select count(distinct e.id)::int as n from episodes e
          join characters c on (c.id = e.character_a or c.id = e.character_b)
          where c.owner_id = $1 and c.created_via = 'mcp' and e.revealed_at is not null and e.visibility = 'public'`,
        [agentId],
      )
      .then((r) => r.rows[0]?.n ?? 0)
      .catch(() => 0),
    db
      .query<{ first: Date | string | null; last: Date | string | null }>(
        `select min(created_at) as first, max(created_at) as last from mcp_calls where agent_id = $1`,
        [agentId],
      )
      .then((r) => r.rows[0] ?? null)
      .catch(() => null),
    // The newest few of those dates, both sides with their faces and the place (the same public-and-aired rule as the count).
    db
      .query<DateRow>(
        `select e.id, e.ending, e.revealed_at as aired_at, e.title, e.setup->>'venue' as venue, ${dateNumberSql("e")} as date_number,
                ${sideSql("a", "a")}, ${sideSql("b", "b")}
           from episodes e
           join characters a on a.id = e.character_a
           join characters b on b.id = e.character_b
          where ((a.owner_id = $1 and a.created_via = 'mcp') or (b.owner_id = $1 and b.created_via = 'mcp'))
            and e.revealed_at is not null and e.visibility = 'public'
          order by e.revealed_at desc, e.id
          limit $2`,
        [agentId, PROFILE_DATES_SHOWN],
      )
      .then((r) => r.rows)
      .catch(() => [] as DateRow[]),
  ]);

  const iso = (v: Date | string | null | undefined): string | null => (v ? new Date(v).toISOString() : null);
  const side = (r: DateRow, p: "a" | "b"): AgentProfileDateSide => ({
    id: r[`${p}_id`],
    name: r[`${p}_name`],
    hue: r[`${p}_hue`],
    house: r[`${p}_house`],
    portrait: r[`${p}_portrait`],
    private: r[`${p}_private`],
  });
  return {
    handle,
    display_name: info.display_name,
    bio: info.bio,
    characters: chars.map((c) => {
      const isPrivate = c.visibility === "private";
      return { id: c.id, name: c.name, hue: c.hue, private: isPrivate, portrait: isPrivate ? null : c.portrait, bio: isPrivate ? null : c.bio, age: isPrivate ? null : c.age };
    }),
    character_count: chars.length,
    public_dates: dates,
    dates: recent.map((r) => ({
      episode_id: r.id,
      a: side(r, "a"),
      b: side(r, "b"),
      venue: r.venue,
      ending: r.ending,
      ending_label: endingLabel(r.ending, r.date_number),
      date_number: r.date_number,
      aired_at: iso(r.aired_at),
      title: r.title,
    })),
    first_seen: iso(seen?.first),
    last_seen: iso(seen?.last),
  };
}
