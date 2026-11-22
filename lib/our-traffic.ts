/**
 * Our own traffic: client names and user agents of our checks, the loop's visitors and scripts. Its own module so
 * lib/mcp.ts can use it without importing lib/agent-analytics.ts, which imports lib/mcp.ts.
 * Extend it when a new check starts talking to production.
 */
import type { Db } from "./db";
import { HOUSE_BOT_CLIENT_PREFIX } from "./house-bots";
import { PEOPLE_ACTS_SQL } from "./people-acts";
import { DELETED_OWNER } from "./rules";

export const OUR_TRAFFIC = /^(botchelor|live-|verify|curl|stats-check|smoke|agents-check|rounds-test|own-date-test|e2e)|\(Claude\)|botchelor-/i;
export const isOurs = (client: string | null, userAgent: string | null): boolean =>
  OUR_TRAFFIC.test(client ?? "") || OUR_TRAFFIC.test(userAgent ?? "");

/** The show's own always-on watch-party dates are booked by this id (lib/watch.ts SYSTEM_CREATOR_ID, repeated here so
 * the analytics don't import the watch module and everything it pulls in). */
export const SYSTEM_ID = "system";

/**
 * Characters our own scripts and tests make, by name: their owners are ours too. A harness run against production on
 * 2026-10-14 made eleven of the cast below from eleven fresh browsers in one minute, and the insights overview counted
 * them as new people (botchelor-41, 2026-10-22: "it isn't a drop; the week before was test traffic"). Sources:
 * scripts/harness.mjs CAST, scripts/sim-pairs.mjs and the tests' defaults, plus David's own test characters (the quoted,
 * accented one with an emoji was a 2026-11-13 test of odd names, tests/feedback-2026-11-14.test.ts). Names nobody picks by
 * chance; extend it when a new script writes to production.
 */
export const OUR_TEST_NAMES: readonly string[] = [
  "Mira Quell", "Otto Fenn", "Tamsin Holloway", "Bas Niro", "Wrenna Sol", "Halden Voss", "Ysolde Marchetti", "Pike Alderman",
  "Soraya Bell", "Emrys Nakamura-Pine", "Emrys Pine", "Pernilla Krause", "Avi Marin", "Clem Osei", "Dez Kowal", "Hei Park",
  "Juno Wick", "Nova Pike", "Riv Marchand", "Current Partner", "David's OC",
  "David Smith", "Wren Kestrel", 'Zoë "Café" Marlowe 🚀',
];
/** A test-style character name ("Quinn Tester", "Planna Testwell"), in Postgres's word-boundary syntax. */
export const TEST_NAME_SQL = "\\m(test|tester|testwell|e2e)\\M";

/**
 * botchelor.com went public on this day. Before it the app lived only at its vercel.app address and everyone on it was
 * us: harness runs, e2e checks, David's own testing. The 2026-10-14 harness run also left 23 identities that never made a
 * character (eleven passed the age gate in the same second; five predicted four seconds after the harness cast), which
 * the names above can't catch, and nothing stores a web visitor's user agent. So a person first active before this day
 * is ours. Agents keep their own rules: an MCP identity is never ours for being early.
 */
export const PUBLIC_LAUNCH_DAY = "2026-10-16";
let launchDay: string | null = PUBLIC_LAUNCH_DAY;
/** The UTC day people are counted from, or null for no such floor (the shared test harness). */
export const peopleCountedFrom = (): string | null => launchDay;
/** The shared test harness counts people from any day, so its fixtures can sit before the launch; launch tests set it. */
export function setPublicLaunchDayForTests(day: string | null): void {
  launchDay = day;
}

/**
 * Every identity that's ours, for the analytics to leave out (Real use, lib/real-metrics.ts; the insights overview,
 * lib/insights.ts): admin accounts and any agent linked to one, every agent that ever connected as one of our checks or
 * as the loop's house-run bots and crowd, the owners of our scripts' and tests' characters (OUR_TEST_NAMES, test-style
 * names) and whoever booked a date for one (only a character's owner can: a deleted account's kept characters move to
 * the deleted owner, but its dates keep their creator, as David's "Wren Kestrel" runs did), people first active before
 * the public launch (PUBLIC_LAUNCH_DAY), the deleted owner (a deleted account's kept characters) and the show itself.
 *
 * Kept in this server's memory for OUR_IDS_TTL_MS, one load at a time for everyone asking (2026-11-22 audit: the query,
 * then reading every MCP call, held a database connection 4–7 s; an admin page asked 3–7 times at once, and two of them
 * held 9 of the pool's 10). A failed load isn't kept; each caller gets its own copy. Off outside production (tests and
 * scripts read it every time), unless a test turns it on.
 */
export const OUR_IDS_TTL_MS = 10 * 60_000;
type KeptIds = { at: number; ids: Promise<string[]> };
const keptIds = new WeakMap<object, KeptIds>();
let ourIdsCacheForced: boolean | null = null;
const ourIdsCacheOn = () => ourIdsCacheForced ?? (process.env.NODE_ENV === "production" && !process.env.VITEST);

/** Tests: switch the kept list on or off regardless of the environment (null: back to the default). */
export function setOurIdsCacheForTests(enabled: boolean | null): void {
  ourIdsCacheForced = enabled;
}

export async function loadOurIds(db: Db, now = Date.now()): Promise<string[]> {
  if (!ourIdsCacheOn()) return queryOurIds(db);
  const hit = keptIds.get(db);
  if (hit && now - hit.at < OUR_IDS_TTL_MS) return [...(await hit.ids)];
  const ids = queryOurIds(db);
  keptIds.set(db, { at: now, ids });
  ids.catch(() => {
    if (keptIds.get(db)?.ids === ids) keptIds.delete(db);
  });
  return [...(await ids)];
}

async function queryOurIds(db: Db): Promise<string[]> {
  const ours = (client: string, ua: string) => `(${client} ~* $1 or ${ua} ~* $1 or ${client} like $2)`;
  // Agents that connected as one of our checks or bots. The patterns run once per distinct client and user agent of the
  // sessions (~770, not on each of 25,000 sessions). The call log takes its distinct (agent, client, user agent) first
  // (~18,800 of 419,000 calls), reuses the sessions' answers and runs the patterns only on a pair no session has.
  // 2026-11-22: 4.4 s on every call, 0.36 s on every distinct triple and session, ~0.2 s like this (most of it the one
  // read of the call log); same ids. `materialized` and `offset 0` keep the planner from moving the patterns back into
  // the scans.
  const { rows } = await db.query<{ id: string }>(
    `with session_clients as materialized (
       select client, ua, ${ours("client", "ua")} as ours
         from (select distinct coalesce(client_name, '') as client, coalesce(user_agent, '') as ua from mcp_sessions offset 0) p)
     select user_id as id from admins
     union select user_id from adult_entitlements where provider = 'reviewer'
     union select l.agent_id from agent_links l join admins a on a.user_id = l.user_id
     union select s.agent_id from mcp_sessions s
            where exists (select 1 from session_clients o where o.ours and o.client = coalesce(s.client_name, '') and o.ua = coalesce(s.user_agent, ''))
     union select k.agent_id
             from (select distinct agent_id, coalesce(client_name, '') as client, coalesce(user_agent, '') as ua from mcp_calls
                    where agent_id is not null offset 0) k
             left join session_clients o on o.client = k.client and o.ua = k.ua
            where coalesce(o.ours, ${ours("k.client", "k.ua")})
     union select owner_id from characters where owner_id is not null and (name = any($5::text[]) or name ~* $6)
     union select e.creator_id from episodes e join characters c on c.id = e.character_a
            where e.creator_id is not null and (c.name = any($5::text[]) or c.name ~* $6)
     union select a.id from (${PEOPLE_ACTS_SQL}) a
            where a.id is not null and a.at < $7::timestamptz and not exists (select 1 from mcp_sessions s where s.agent_id = a.id)
     union select $3::text
     union select $4::text`,
    [OUR_TRAFFIC.source, `${HOUSE_BOT_CLIENT_PREFIX}%`, DELETED_OWNER, SYSTEM_ID, OUR_TEST_NAMES, TEST_NAME_SQL, launchDay && `${launchDay}T00:00:00Z`],
  );
  return rows.map((r) => r.id);
}
