/**
 * The live "Right now" facts for /llms.txt: how many characters are open to dates (and a few of them), and the
 * latest episodes that aired publicly. Public data only — the same things the contestant card and the sitemap
 * already show (name, want, never a private character's; public, aired, unhidden episodes). Best-effort: any failure returns null and
 * /llms.txt is served without the section, because the front door must never fail.
 */
import type { Db } from "./db";
import type { LlmsLive } from "./agents";
import { ENDING_LABELS, endingLabel, REPORT_HIDE_THRESHOLD, type Ending } from "./rules";

const OPEN_SHOWN = 5;
const LATEST_SHOWN = 5;

export async function llmsLive(db: Db): Promise<LlmsLive | null> {
  try {
    const [count, open, latest] = await Promise.all([
      db.query<{ n: number }>(`select count(*)::int as n from characters where open_to_dates and visibility <> 'private'`),
      db.query<{ id: string; name: string; want: string }>(
        `select id, name, want from characters where open_to_dates and visibility <> 'private' order by created_at desc limit $1`,
        [OPEN_SHOWN],
      ),
      db.query<{ id: string; a: string; b: string; ending: Ending; date_number: number | null }>(
        `select e.id, ca.name as a, cb.name as b, e.ending,
                case when e.followup_of is not null then coalesce((e.setup->>'date_number')::int, 2) end as date_number
           from episodes e
           join characters ca on ca.id = e.character_a
           join characters cb on cb.id = e.character_b
          where e.visibility = 'public' and e.revealed_at is not null and e.status = 'ready'
            and (select count(*) from reports r where r.episode_id = e.id) < $1
          order by e.revealed_at desc
          limit $2`,
        [REPORT_HIDE_THRESHOLD, LATEST_SHOWN],
      ),
    ]);
    return {
      openCount: count.rows[0]?.n ?? 0,
      open: open.rows,
      latest: latest.rows.map((r) => ({ id: r.id, title: `${r.a} × ${r.b}`, ending: ENDING_LABELS[r.ending] ? endingLabel(r.ending, r.date_number) : r.ending })),
    };
  } catch {
    return null;
  }
}
