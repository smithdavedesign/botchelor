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
import { REPORT_HIDE_THRESHOLD } from "./rules";
import { siteUrl } from "./site";
import { isProductionDeploy } from "./deploy";

export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
export const INDEXNOW_KEY_PATH = "/indexnow-key.txt";
const KEY_FORMAT = /^[a-zA-Z0-9-]{8,128}$/;

export function indexNowKey(env: Record<string, string | undefined> = process.env): string | null {
  const key = env.INDEXNOW_KEY?.trim();
  return key && KEY_FORMAT.test(key) ? key : null;
}

/** Public pages that became indexable since `since`: aired public episodes and characters newly open to dates. */
export async function recentPublicUrls(db: Db, since: Date, base: string = siteUrl()): Promise<string[]> {
  const [episodes, characters] = await Promise.all([
    db.query<{ id: string }>(
      `select e.id from episodes e
        where e.visibility = 'public' and e.status = 'ready' and e.revealed_at >= $1
          and (select count(*) from reports r where r.episode_id = e.id) < $2
        limit 5000`,
      [since.toISOString(), REPORT_HIDE_THRESHOLD],
    ),
    db.query<{ id: string }>(`select id from characters where open_to_dates and created_at >= $1 limit 5000`, [since.toISOString()]),
  ]);
  return [...episodes.rows.map((r) => `${base}/episodes/${r.id}`), ...characters.rows.map((r) => `${base}/characters/${r.id}`)];
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
