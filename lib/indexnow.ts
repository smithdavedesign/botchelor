/**
 * IndexNow (indexnow.org): tell Bing, Yandex, Seznam and Naver the moment public pages appear, instead of
 * waiting to be crawled. Bing's index also feeds ChatGPT search and Copilot, so this is the fastest free way
 * for new episodes and characters to become findable by people *and* by AI assistants.
 *
 * Opt-in by INDEXNOW_KEY (a random 32-hex key). The key is served at /indexnow-key.txt (keyLocation) to prove
 * we own the host. Only production submits, so previews never ping the engines. Never throws: indexing is
 * a nicety, never load-bearing. The daily cron submits the last day's newly public URLs.
 */
import type { Db } from "./db";
import { closedSeasons } from "./season-ref";
import { seasonWindow } from "./season-window";
import { REPORT_HIDE_THRESHOLD } from "./rules";
import { SITEMAP_MIN_COUPLE_DATES, authoredCharacterSql, authoredDateSql } from "./seo";
import { siteUrl } from "./site";
import { isProductionDeploy } from "./deploy";
import { listedCharacterSql, listedDateSql } from "./public-cast";

export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
export const INDEXNOW_KEY_PATH = "/indexnow-key.txt";
const KEY_FORMAT = /^[a-zA-Z0-9-]{8,128}$/;

export function indexNowKey(env: Record<string, string | undefined> = process.env): string | null {
  const key = env.INDEXNOW_KEY?.trim();
  return key && KEY_FORMAT.test(key) ? key : null;
}

/**
 * Static pages that were rewritten, and when: the daily job's window (the last 26 hours) covers each date once, so
 * the engines hear about the new words once, the day after they ship, and never again. Add a line when a landing
 * page changes enough to be worth a re-crawl; the date is the day after the merge (the job runs at 16:20 UTC).
 */
export const LANDING_CHANGES: readonly { path: string; changedAt: string }[] = [
  // The Character.AI rescue door (2026-11-14): /import's ?from=cai copy and the landing's new words.
  { path: "/import", changedAt: "2026-11-15T00:00:00Z" },
  { path: "/alternatives/character-ai", changedAt: "2026-11-15T00:00:00Z" },
];

/** The landing pages whose words changed inside the window (LANDING_CHANGES), as full URLs. */
export function changedLandingUrls(since: Date, base: string = siteUrl(), now = new Date(), changes = LANDING_CHANGES): string[] {
  return changes.filter((c) => new Date(c.changedAt) >= since && new Date(c.changedAt) <= now).map((c) => `${base}${c.path}`);
}

/**
 * Public pages that became indexable since `since`: aired public episodes, characters newly open to dates, couples
 * whose latest public date aired since (their /couples page changed), a season whose finale closed since, and a
 * landing page rewritten since (LANDING_CHANGES). Never one with a deleted account's character (lib/public-cast.ts),
 * nor a date or couple between two machine-made characters (lib/seo.ts authoredDateSql): the sitemap's bar.
 */
export async function recentPublicUrls(db: Db, since: Date, base: string = siteUrl(), now = new Date()): Promise<string[]> {
  const seasons = closedSeasons(now).filter((s) => seasonWindow(new Date(`${s.id}T00:00:00Z`)).end >= since);
  const [episodes, characters, couples] = await Promise.all([
    db.query<{ id: string }>(
      `select e.id from episodes e
        where e.visibility = 'public' and e.status = 'ready' and e.revealed_at >= $1
          and (select count(*) from reports r where r.episode_id = e.id) < $2
          and ${listedDateSql("e")} and ${authoredDateSql("e")}
        limit 5000`,
      [since.toISOString(), REPORT_HIDE_THRESHOLD],
    ),
    // A character once it's worth indexing (lib/seo.ts indexableCharacterSql, 2026-11-19): when one of its dates airs
    // publicly, not when it's made. Public ones only (a private character's page says noindex).
    db.query<{ id: string }>(
      `select distinct c.id from characters c
         join episodes e on e.character_a = c.id or e.character_b = c.id
        where c.visibility = 'public' and ${listedCharacterSql("c")} and e.visibility = 'public' and e.status = 'ready' and e.revealed_at >= $1
          and ${authoredDateSql("e")}
        limit 5000`,
      [since.toISOString()],
    ),
    db.query<{ a: string; b: string }>(
      `select r.character_a as a, r.character_b as b from relationships r
         join characters ca on ca.id = r.character_a join characters cb on cb.id = r.character_b
        where r.public_dates >= $2 and r.public_last_at >= $1 and ca.visibility = 'public' and cb.visibility = 'public'
          and ${listedCharacterSql("ca")} and ${listedCharacterSql("cb")}
          and (${authoredCharacterSql("ca")} or ${authoredCharacterSql("cb")}) limit 5000`,
      [since.toISOString(), SITEMAP_MIN_COUPLE_DATES],
    ),
  ]);
  return [
    ...episodes.rows.map((r) => `${base}/episodes/${r.id}`),
    ...characters.rows.map((r) => `${base}/characters/${r.id}`),
    ...couples.rows.map((r) => `${base}/couples/${r.a}/${r.b}`),
    ...seasons.map((s) => `${base}${s.path}`),
    ...changedLandingUrls(since, base, now),
  ];
}

export type IndexNowResult = { submitted: number; status: number | null; skipped?: "no_key" | "not_production" | "nothing_new" };

export async function submitIndexNow(
  urls: string[],
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<IndexNowResult> {
  const key = indexNowKey(env);
  if (!key) return { submitted: 0, status: null, skipped: "no_key" };
  if (!isProductionDeploy(env)) return { submitted: 0, status: null, skipped: "not_production" };
  if (urls.length === 0) return { submitted: 0, status: null, skipped: "nothing_new" };
  const base = siteUrl(env);
  try {
    const res = await fetchImpl(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host: new URL(base).host, key, keyLocation: `${base}${INDEXNOW_KEY_PATH}`, urlList: urls.slice(0, 10000) }),
      signal: AbortSignal.timeout(10_000),
    });
    // 200 = accepted, 202 = accepted (key validation pending). Anything else is reported, never thrown.
    return { submitted: res.ok ? urls.length : 0, status: res.status };
  } catch {
    return { submitted: 0, status: null };
  }
}
