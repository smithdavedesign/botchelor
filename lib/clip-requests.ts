/**
 * A person's own date as a postable 9:16 clip (David, 2026-11-20: the show's clips on new brand accounts drew no views;
 * a clip of someone's own date, posted to their own followers and credited to them, is what spreads). After a date has
 * aired, the owner of one of its two characters asks for a clip (POST /api/clips); David's Mac renders it with the
 * episode-cut pipeline (scripts/clips/clip-queue.mjs: the best lines, voiced, both characters' art, how it ended, and a
 * credit line naming their creator page and botchelor.com burned into every frame), sends the MP4 back
 * (/api/clips/worker/done), and they're notified (notification kind `date_clip`) with a page to download or share it
 * (/clips/<id>). docs/clips/requested-clips.md has the whole flow and how to run the worker.
 *
 * The rules (requestClip, clipRefusal):
 *  - **Theirs:** only the owner of one of the date's two characters, for that character.
 *  - **Finished and shareable,** as the owner's own share of a date is (app/episodes/[id]/ShareEnding.tsx): aired and
 *    ready, public or unlisted, never private. Never a date that carried an After Dark memory, never one with an open
 *    report, never one with a private character or one of our test characters (lib/our-traffic.ts): the clip goes
 *    out to strangers with their name on it.
 *  - **One live request a date and person:** asking again returns the one in the queue, rendering or ready; only a
 *    failed one may be asked again.
 *  - **First clip free** an account; after that it comes with the Companion Plan (lib/writing-style.ts hasDepth: the
 *    plan or an admin), else it costs CLIP_TOKENS bought dates (lib/allowance.ts spendBoughtTokens, the same paywall
 *    the intro clips and stories use), given back if the clip can't be made. There is no "Plus" plan yet
 *    (lib/plus-interest.ts is an interest tile only), so the plan is the Companion Plan.
 *  - **A daily cap** for everyone together (CLIP_REQUESTS_DAILY, default 20): one Mac renders them.
 *  - **Off unless CLIP_REQUESTS=1.** The worker routes need `Authorization: Bearer $CLIP_WORKER_SECRET`.
 *
 * Where the clip lives: the store the show's own media uses (lib/object-store.ts keepBytes, area `clips`), or the row
 * itself when none is configured, served by /api/clips/<id>/clip.mp4 (and poster). Its owner can always open it; anyone
 * with the link can while the date itself may be seen by link (aired, public or unlisted, not hidden by reports, both
 * characters public): the clip mirrors the date's own visibility, so a date taken down takes its clip with it.
 *
 * Their characters' words are never rewritten: the clip quotes the date's own lines (whole sentences, gaps marked), and
 * the credit and caption are the show's own words built from their public creator page (creator_profiles).
 */
import { randomUUID } from "node:crypto";
import { CLIP_TOKEN_COST, refundBoughtTokens, spendBoughtTokens } from "./allowance";
import type { Db } from "./db";
import { getEpisodeView, type EpisodeView } from "./game";
import { safeEqual } from "./http";
import { notify } from "./notifications";
import { keepBytes, objectStore, readBytes } from "./object-store";
import { OUR_TEST_NAMES } from "./our-traffic";
import { REPORT_HIDE_THRESHOLD } from "./rules";
import { hasDepth } from "./writing-style";

type Env = Record<string, string | undefined>;

/** The daily cap when CLIP_REQUESTS_DAILY isn't set: a handful an evening for one Mac. */
export const CLIP_REQUESTS_DAILY_DEFAULT = 20;
/** What a clip costs in bought dates once the free one is used, without the plan. */
export const CLIP_TOKENS = CLIP_TOKEN_COST;
/** How many times the Mac may try one request before it counts as failed. */
export const CLIP_MAX_ATTEMPTS = 3;
/** How long a claimed request is the Mac's before another claim may take it again (a crashed render). */
export const CLIP_LEASE_MINUTES = 20;
/** The most a finished clip may weigh and run, and its cover weigh (the route's hard stops). */
export const CLIP_MAX_BYTES = 30_000_000;
export const CLIP_MAX_SECONDS = 120;
export const CLIP_POSTER_MAX_BYTES = 4_000_000;
/** A worker secret shorter than this counts as none: the routes stay shut. */
export const WORKER_SECRET_MIN = 16;

export const CLIP_STATUSES = ["queued", "rendering", "ready", "failed"] as const;
export type ClipStatus = (typeof CLIP_STATUSES)[number];
export type ClipCharge = "free" | "plan" | "tokens";

/** The switch: CLIP_REQUESTS=1 turns asking for clips (and the worker's claims) on. Off by default. */
export function clipRequestsOn(env: Env = process.env): boolean {
  return env.CLIP_REQUESTS?.trim() === "1";
}

/** How many requests everyone together may make in a UTC day (CLIP_REQUESTS_DAILY, a positive whole number). */
export function clipDailyCap(env: Env = process.env): number {
  const n = Number(env.CLIP_REQUESTS_DAILY?.trim());
  return Number.isInteger(n) && n > 0 ? n : CLIP_REQUESTS_DAILY_DEFAULT;
}

/** Whether a request comes from the Mac: `Authorization: Bearer $CLIP_WORKER_SECRET`, compared in constant time. */
export function clipWorkerAuthorized(req: Request, env: Env = process.env): boolean {
  const secret = env.CLIP_WORKER_SECRET?.trim() ?? "";
  if (secret.length < WORKER_SECRET_MIN) return false;
  return safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`);
}

/* ------------------------------------------------------ the rules ------------------------------------------------------ */

export type ClipSide = { id: string; name: string; owner_id: string | null; visibility: string; maker: Maker };
/** What the rules read about a date (clipDateFacts). */
export type ClipDateFacts = {
  id: string;
  status: string;
  revealed: boolean;
  visibility: string;
  after_dark: boolean;
  /** Open reports (reviewed ones move to reports_reviewed). */
  reports: number;
  characters: [ClipSide, ClipSide];
};

export const CLIP_REFUSALS = {
  not_found: "No such date.",
  not_yours: "Only the owner of one of the date's two characters can make a clip of it.",
  not_ended: "The date hasn't aired yet: a clip comes once it has.",
  private_date: "This date is private. Make it unlisted or public to make a clip to post.",
  after_dark: "This date can't be made into a clip.",
  reported: "This date has a report waiting for review, so it can't be made into a clip for now.",
  private_character: "A character on this date is private, so it can't be made into a clip to post.",
  test_character: "This date can't be made into a clip.",
} as const;
export type ClipRefusal = keyof typeof CLIP_REFUSALS;

/** A test-style character name, as lib/our-traffic.ts TEST_NAME_SQL reads one, or one of our own scripts' cast. */
export function isTestName(name: string): boolean {
  return OUR_TEST_NAMES.includes(name) || /(^|[^a-z0-9])(test|tester|testwell|e2e)($|[^a-z0-9])/i.test(name);
}

/**
 * Whether `requester` may have a clip of this date, for `characterId` (or the side they own when it's left out: side a
 * when they own both). Pure. Returns the side, or why not.
 */
export function clipRefusal(facts: ClipDateFacts | null, requester: string | null, characterId?: string | null): { refusal: ClipRefusal } | { side: 0 | 1 } {
  if (!facts) return { refusal: "not_found" };
  const owned = ([0, 1] as const).filter((i) => requester && facts.characters[i].owner_id === requester);
  const side = characterId ? owned.find((i) => facts.characters[i].id === characterId) : owned[0];
  if (side === undefined) return { refusal: "not_yours" };
  if (facts.status !== "ready" || !facts.revealed) return { refusal: "not_ended" };
  if (facts.visibility === "private") return { refusal: "private_date" };
  if (facts.after_dark) return { refusal: "after_dark" };
  if (facts.reports > 0) return { refusal: "reported" };
  if (facts.characters.some((c) => c.visibility === "private")) return { refusal: "private_character" };
  if (facts.characters.some((c) => isTestName(c.name))) return { refusal: "test_character" };
  return { side };
}

/** The facts clipRefusal reads, in one query; null when there's no such date. */
export async function clipDateFacts(db: Db, episodeId: string): Promise<ClipDateFacts | null> {
  const row = (
    await db.query<{
      id: string;
      status: string;
      revealed: boolean;
      visibility: string;
      after_dark: boolean;
      reports: number;
      a_id: string; a_name: string; a_owner: string | null; a_vis: string; a_handle: string | null; a_maker: string | null;
      b_id: string; b_name: string; b_owner: string | null; b_vis: string; b_handle: string | null; b_maker: string | null;
    }>(
      `select e.id, e.status, e.revealed_at is not null as revealed, e.visibility,
              coalesce(e.setup->>'after_dark', 'false') = 'true' as after_dark,
              (select count(*)::int from reports r where r.episode_id = e.id) as reports,
              a.id as a_id, a.name as a_name, a.owner_id as a_owner, a.visibility as a_vis, cpa.handle as a_handle, cpa.display_name as a_maker,
              b.id as b_id, b.name as b_name, b.owner_id as b_owner, b.visibility as b_vis, cpb.handle as b_handle, cpb.display_name as b_maker
         from episodes e
         join characters a on a.id = e.character_a
         join characters b on b.id = e.character_b
         left join creator_profiles cpa on cpa.user_id = a.owner_id and not cpa.hidden
         left join creator_profiles cpb on cpb.user_id = b.owner_id and not cpb.hidden
        where e.id = $1`,
      [episodeId],
    )
  ).rows[0];
  if (!row) return null;
  const side = (p: "a" | "b"): ClipSide => {
    const handle = row[`${p}_handle`];
    const name = row[`${p}_maker`];
    return { id: row[`${p}_id`], name: row[`${p}_name`], owner_id: row[`${p}_owner`], visibility: row[`${p}_vis`], maker: handle && name ? { handle, name } : null };
  };
  return { id: row.id, status: row.status, revealed: row.revealed, visibility: row.visibility, after_dark: row.after_dark, reports: row.reports, characters: [side("a"), side("b")] };
}

/* ------------------------------------------------- the credit and caption ------------------------------------------------- */

/** Who made a character, as their public creator page names them (creator_profiles, not hidden), or null. */
export type Maker = { handle: string; name: string } | null;

/** The host people type, for the credit (botchelor.com on the show). */
const SHOW_HOST = "botchelor.com";

/**
 * The line burned into every frame of the clip (pure): the character's own name as they wrote it, their creator handle
 * when they have a public creator page, and where to find the show. No page: no person named.
 */
export function creditLine(characterName: string, maker: Maker): string {
  return maker ? `${characterName} by @${maker.handle} · ${SHOW_HOST}` : `${characterName} · made on ${SHOW_HOST}`;
}

/**
 * The caption suggested for their post (pure): it credits them (and the other character's maker when their page and
 * the date are public), says it's AI fiction, and links the whole date. The show's words; they may change any of it.
 */
export function clipCaption(o: { mine: string; other: string; maker: Maker; otherMaker: Maker; episodeId: string }): string {
  return [
    `My OC ${o.mine} went on an AI blind date with ${o.other} 👀`,
    "Would you have said yes?",
    "",
    ...(o.maker ? [`${o.mine} is by ${o.maker.name}: ${SHOW_HOST}/creators/${o.maker.handle}`] : []),
    ...(o.otherMaker ? [`${o.other} is by ${o.otherMaker.name}: ${SHOW_HOST}/creators/${o.otherMaker.handle}`] : []),
    `Watch the whole date: ${SHOW_HOST}/episodes/${o.episodeId}?ref=clip`,
    "Every character is AI, and every date is AI-generated fiction.",
    "",
    "#botchelor #originalcharacter #oc #aicharacters #blinddate",
  ].join("\n");
}

/* ------------------------------------------------------ the requests ------------------------------------------------------ */

type ClipRow = {
  id: string;
  episode_id: string;
  character_id: string;
  owner_id: string;
  status: ClipStatus;
  charge: ClipCharge;
  credit: string;
  caption: string;
  attempts: number;
  poster_mime: string | null;
  seconds: string | number | null;
  created_at: Date | string;
  ready_at: Date | string | null;
};

/** What the owner sees of a request (GET /api/clips/<id>, the episode page, /clips/<id>). Never the Mac's error. */
export type ClipView = {
  id: string;
  episode_id: string;
  character_id: string;
  status: ClipStatus;
  charge: ClipCharge;
  credit: string;
  caption: string;
  page: string;
  clip_src: string | null;
  download_src: string | null;
  poster_src: string | null;
  seconds: number | null;
  created_at: string;
  ready_at: string | null;
};

const iso = (d: Date | string | null) => (d == null ? null : new Date(d).toISOString());
const ROW_COLUMNS = "id, episode_id, character_id, owner_id, status, charge, credit, caption, attempts, poster_mime, seconds, created_at, ready_at";

export function viewOf(r: ClipRow): ClipView {
  const ready = r.status === "ready";
  return {
    id: r.id,
    episode_id: r.episode_id,
    character_id: r.character_id,
    status: r.status,
    charge: r.charge,
    credit: r.credit,
    caption: r.caption,
    page: `/clips/${r.id}`,
    clip_src: ready ? `/api/clips/${r.id}/clip.mp4` : null,
    download_src: ready ? `/api/clips/${r.id}/clip.mp4?download=1` : null,
    poster_src: ready && r.poster_mime ? `/api/clips/${r.id}/${r.poster_mime === "image/png" ? "poster.png" : "poster.jpg"}` : null,
    seconds: r.seconds == null ? null : Number(r.seconds),
    created_at: iso(r.created_at)!,
    ready_at: iso(r.ready_at),
  };
}

async function row(db: Db, id: string): Promise<ClipRow | null> {
  return (await db.query<ClipRow>(`select ${ROW_COLUMNS} from clip_requests where id = $1`, [id])).rows[0] ?? null;
}

/** A request for its owner only (null for anyone else, or no such request). */
export async function clipForOwner(db: Db, id: string, userId: string | null): Promise<ClipView | null> {
  if (!userId) return null;
  const r = await row(db, id);
  return r && r.owner_id === userId ? viewOf(r) : null;
}

/** The owner's request for this date that still stands (queued, rendering or ready), else their newest failed one. */
export async function ownersClipFor(db: Db, episodeId: string, userId: string | null): Promise<ClipView | null> {
  if (!userId) return null;
  const r = (
    await db.query<ClipRow>(
      `select ${ROW_COLUMNS} from clip_requests where episode_id = $1 and owner_id = $2
        order by (status <> 'failed') desc, created_at desc limit 1`,
      [episodeId, userId],
    )
  ).rows[0];
  return r ? viewOf(r) : null;
}

/** What their next clip would cost (no spending): free while their free one is unused or failed, the plan, or tokens. */
export async function nextClipCharge(db: Db, userId: string): Promise<ClipCharge> {
  const usedFree = (await db.query(`select 1 from clip_requests where owner_id = $1 and charge = 'free' and status <> 'failed' limit 1`, [userId])).rows.length > 0;
  if (!usedFree) return "free";
  return (await hasDepth(db, userId)) ? "plan" : "tokens";
}

/** How the episode page says what a clip costs. */
export function chargeLabel(c: ClipCharge): string {
  return c === "free" ? "your first one is free" : c === "plan" ? "included with your plan" : `${CLIP_TOKENS} bought date`;
}

/** The start of the UTC day `now` is in, as ISO: the daily cap counts requests from then. */
export const utcDayStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();

export type ClipAnswer = { ok: true; created: boolean; clip: ClipView } | { ok: false; status: number; error: string; message: string };

/**
 * Asks for a clip of `episodeId` for `userId`'s character on it (POST /api/clips). Idempotent: a standing request for
 * the date is returned as it is, never charged twice.
 */
export async function requestClip(db: Db, userId: string | null, input: { episode_id: string; character_id?: string | null }, now: Date = new Date(), env: Env = process.env): Promise<ClipAnswer> {
  if (!clipRequestsOn(env)) return { ok: false, status: 404, error: "off", message: "Clips to post aren't open yet." };
  const facts = await clipDateFacts(db, input.episode_id);
  const verdict = clipRefusal(facts, userId, input.character_id ?? null);
  if ("refusal" in verdict) {
    const status = verdict.refusal === "not_found" ? 404 : verdict.refusal === "not_yours" ? 403 : 409;
    return { ok: false, status, error: verdict.refusal, message: CLIP_REFUSALS[verdict.refusal] };
  }
  const owner = userId!;
  const standing = await ownersClipFor(db, facts!.id, owner);
  if (standing && standing.status !== "failed") return { ok: true, created: false, clip: standing };

  const today = (await db.query<{ n: number }>(`select count(*)::int as n from clip_requests where created_at >= $1`, [utcDayStart(now)])).rows[0]?.n ?? 0;
  if (today >= clipDailyCap(env)) {
    return { ok: false, status: 429, error: "busy_today", message: "Today's clips are all taken: we render them one at a time. Try again tomorrow." };
  }

  const charge = await nextClipCharge(db, owner);
  if (charge === "tokens" && !(await spendBoughtTokens(db, owner, CLIP_TOKENS))) {
    return {
      ok: false,
      status: 402,
      error: "needs_tokens",
      message: `Your first clip was free. More come with the Companion Plan, or for ${CLIP_TOKENS} bought date each (a date pack).`,
    };
  }

  const [a, b] = facts!.characters;
  const mine = verdict.side === 0 ? a : b;
  const other = verdict.side === 0 ? b : a;
  // The other side's maker is named only where the date page itself credits them: a public date and a public character.
  const otherMaker = facts!.visibility === "public" && other.owner_id !== owner ? other.maker : null;
  const id = randomUUID();
  const inserted = (
    await db.query<ClipRow>(
      `insert into clip_requests (id, episode_id, character_id, owner_id, status, charge, credit, caption, created_at, updated_at)
       values ($1, $2, $3, $4, 'queued', $5, $6, $7, $8, $8)
       on conflict do nothing
       returning ${ROW_COLUMNS}`,
      [id, facts!.id, mine.id, owner, charge, creditLine(mine.name, mine.maker), clipCaption({ mine: mine.name, other: other.name, maker: mine.maker, otherMaker, episodeId: facts!.id }), now.toISOString()],
    )
  ).rows[0];
  if (!inserted) {
    // Another press got there first: theirs stands, and this one costs nothing.
    if (charge === "tokens") await refundBoughtTokens(db, owner, CLIP_TOKENS);
    const won = await ownersClipFor(db, facts!.id, owner);
    if (won) return { ok: true, created: false, clip: won };
    return { ok: false, status: 409, error: "busy", message: "Try again in a moment." };
  }
  return { ok: true, created: true, clip: viewOf(inserted) };
}

/* ------------------------------------------------------ the worker ------------------------------------------------------ */

/** What the Mac gets for one request: the date as a stranger sees it once aired, and what to burn in and caption. */
export type ClaimedClip = {
  id: string;
  attempt: number;
  episode_id: string;
  character_id: string;
  side: "a" | "b";
  credit: string;
  caption: string;
  episode: EpisodeView;
};

async function names(db: Db, episodeId: string): Promise<string> {
  const r = (
    await db.query<{ a: string; b: string }>(
      `select a.name as a, b.name as b from episodes e join characters a on a.id = e.character_a join characters b on b.id = e.character_b where e.id = $1`,
      [episodeId],
    )
  ).rows[0];
  return r ? `${r.a} × ${r.b}` : "your date";
}

/** Marks a request failed for good: gives back a bought date it used, and tells its owner. */
async function failForGood(db: Db, r: Pick<ClipRow, "id" | "owner_id" | "episode_id" | "charge">, error: string): Promise<void> {
  const done = (
    await db.query(`update clip_requests set status = 'failed', error = $2, leased_until = null, updated_at = now() where id = $1 and status in ('queued', 'rendering') returning id`, [
      r.id,
      error.slice(0, 300),
    ])
  ).rows.length;
  if (!done) return;
  if (r.charge === "tokens") await refundBoughtTokens(db, r.owner_id, CLIP_TOKENS);
  const back =
    r.charge === "tokens" ? `The bought date it used is back on your account.` : r.charge === "free" ? "Your free clip is still yours." : "";
  await notify(db, r.owner_id, {
    kind: "date_clip",
    title: `Your clip of ${await names(db, r.episode_id)} couldn't be made`,
    body: `${back} You can ask again from the date's page.`.trim(),
    link: `/episodes/${r.episode_id}`,
  });
}

/**
 * The next request for the Mac (POST /api/clips/worker/claim): the oldest queued one, or one whose render went quiet
 * past its lease, marked rendering with a new lease and attempt. A request the rules no longer allow (the date went
 * private or was reported since) or that ran out of attempts fails for good here, and the next is taken. Null: none.
 */
export async function claimNextClip(db: Db, now: Date = new Date(), env: Env = process.env): Promise<ClaimedClip | null> {
  if (!clipRequestsOn(env)) return null;
  // Renders that went quiet with no attempts left: failed, their bought date back.
  const spent = await db.query<ClipRow>(
    `select ${ROW_COLUMNS} from clip_requests where status = 'rendering' and leased_until < $1 and attempts >= $2`,
    [now.toISOString(), CLIP_MAX_ATTEMPTS],
  );
  for (const r of spent.rows) await failForGood(db, r, "the render stopped answering");
  for (let tries = 0; tries < 10; tries++) {
    const r = (
      await db.query<ClipRow>(
        `update clip_requests set status = 'rendering', attempts = attempts + 1, leased_until = $1::timestamptz + make_interval(mins => $2::int),
                updated_at = now()
          where id = (select id from clip_requests
                       where (status = 'queued' or (status = 'rendering' and leased_until < $1::timestamptz)) and attempts < $3
                       order by created_at, id
                       limit 1
                       for update skip locked)
          returning ${ROW_COLUMNS}`,
        [now.toISOString(), CLIP_LEASE_MINUTES, CLIP_MAX_ATTEMPTS],
      )
    ).rows[0];
    if (!r) return null;
    const verdict = clipRefusal(await clipDateFacts(db, r.episode_id), r.owner_id, r.character_id);
    const episode = "side" in verdict ? await getEpisodeView(db, r.episode_id, null) : null;
    if (!("side" in verdict) || !episode) {
      await failForGood(db, r, "refusal" in verdict ? verdict.refusal : "episode_not_found");
      continue;
    }
    return { id: r.id, attempt: r.attempts, episode_id: r.episode_id, character_id: r.character_id, side: verdict.side === 0 ? "a" : "b", credit: r.credit, caption: r.caption, episode };
  }
  return null;
}

/** MP4 (an `ftyp` box first), PNG and JPEG by their first bytes. */
export const looksLikeMp4 = (b: Uint8Array) => b.length > 12 && Buffer.from(b.subarray(4, 8)).toString("latin1") === "ftyp";
export const looksLikePng = (b: Uint8Array) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
export const looksLikeJpeg = (b: Uint8Array) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/**
 * The Mac's finished clip (POST /api/clips/worker/done): kept, the request marked ready, its owner told. Only for the
 * attempt that holds the request now, so a render the lease already gave away can't overwrite a newer one.
 */
export async function finishClip(
  db: Db,
  c: { id: string; attempt: number; clip: Buffer; seconds: number; poster?: { bytes: Buffer; mime: "image/png" | "image/jpeg" } | null },
): Promise<{ ok: true; clip: ClipView } | { ok: false; error: "not_found" | "not_rendering" }> {
  const r = await row(db, c.id);
  if (!r) return { ok: false, error: "not_found" };
  if (r.status !== "rendering" || r.attempts !== c.attempt) return { ok: false, error: "not_rendering" };
  const clip = await keepBytes("clips", `${c.id}-request`, c.clip, "video/mp4");
  const poster = c.poster ? await keepBytes("clips", `${c.id}-request-poster`, c.poster.bytes, c.poster.mime) : null;
  const done = (
    await db.query<ClipRow>(
      `update clip_requests set status = 'ready', clip_key = $3, clip_data = $4, poster_key = $5, poster_data = $6, poster_mime = $7, seconds = $8,
              leased_until = null, error = null, ready_at = now(), updated_at = now()
        where id = $1 and status = 'rendering' and attempts = $2
        returning ${ROW_COLUMNS}`,
      [c.id, c.attempt, clip.object_key, clip.data, poster?.object_key ?? null, poster?.data ?? null, c.poster?.mime ?? null, Math.round(c.seconds * 100) / 100],
    )
  ).rows[0];
  if (!done) return { ok: false, error: "not_rendering" };
  await notify(db, done.owner_id, {
    kind: "date_clip",
    title: `🎬 Your clip of ${await names(db, done.episode_id)} is ready`,
    body: "Download it or share it from your phone: it credits you. A caption is ready to copy.",
    link: `/clips/${done.id}`,
  });
  return { ok: true, clip: viewOf(done) };
}

/**
 * The Mac couldn't make it (POST /api/clips/worker/failed). `retry`: a passing trouble (a voice service down, the
 * network): back in the queue while attempts remain. Otherwise, or with none left, it fails for good.
 */
export async function failClip(db: Db, f: { id: string; attempt: number; error: string; retry: boolean }): Promise<{ ok: true; status: ClipStatus } | { ok: false; error: "not_found" | "not_rendering" }> {
  const r = await row(db, f.id);
  if (!r) return { ok: false, error: "not_found" };
  if (r.status !== "rendering" || r.attempts !== f.attempt) return { ok: false, error: "not_rendering" };
  if (f.retry && r.attempts < CLIP_MAX_ATTEMPTS) {
    await db.query(`update clip_requests set status = 'queued', leased_until = null, error = $2, updated_at = now() where id = $1 and status = 'rendering'`, [f.id, f.error.slice(0, 300)]);
    return { ok: true, status: "queued" };
  }
  await failForGood(db, r, f.error);
  return { ok: true, status: "failed" };
}

/* ------------------------------------------------------ reading it ------------------------------------------------------ */

/**
 * Whether anyone with the link may see a clip's date ($1 = the report threshold; needs `e`, `a`, `b`): aired, ready,
 * public or unlisted (as the date's own page: unlisted is anyone with the link), not hidden by reports, both characters
 * public, no After Dark memory.
 */
const DATE_SHAREABLE = `e.revealed_at is not null and e.status = 'ready' and e.visibility in ('public', 'unlisted')
        and a.visibility = 'public' and b.visibility = 'public'
        and coalesce(e.setup->>'after_dark', 'false') <> 'true'
        and (select count(*) from reports r where r.episode_id = e.id) < $1::int`;

export type ClipPage = ClipView & { owner: boolean; names: [string, string] };

/** A clip for /clips/<id>: its owner sees it in any state; anyone else only when it's ready and its date shareable. */
export async function clipPageFor(db: Db, id: string, viewer: string | null): Promise<ClipPage | null> {
  const r = (
    await db.query<ClipRow & { a_name: string; b_name: string; shareable: boolean }>(
      `select c.id, c.episode_id, c.character_id, c.owner_id, c.status, c.charge, c.credit, c.caption, c.attempts, c.poster_mime, c.seconds,
              c.created_at, c.ready_at, a.name as a_name, b.name as b_name, (${DATE_SHAREABLE}) as shareable
         from clip_requests c
         join episodes e on e.id = c.episode_id
         join characters a on a.id = e.character_a
         join characters b on b.id = e.character_b
        where c.id = $2`,
      [REPORT_HIDE_THRESHOLD, id],
    )
  ).rows[0];
  if (!r) return null;
  const owner = Boolean(viewer) && r.owner_id === viewer;
  if (!owner && !(r.status === "ready" && r.shareable)) return null;
  return { ...viewOf(r), owner, names: [r.a_name, r.b_name] };
}

export type ClipFile = { key: string | null; bytes: Buffer | null; mime: string; owner_only: boolean };

/** A ready clip's file (the MP4, or its cover) for `viewer`: the owner always, anyone else while its date is shareable. */
export async function clipFile(db: Db, id: string, which: "clip" | "poster", viewer: string | null): Promise<ClipFile | null> {
  const r = (
    await db.query<{ owner_id: string; object_key: string | null; data: Buffer | Uint8Array | null; poster_mime: string | null; shareable: boolean }>(
      `select c.owner_id, c.${which}_key as object_key, c.${which}_data as data, c.poster_mime, (${DATE_SHAREABLE}) as shareable
         from clip_requests c
         join episodes e on e.id = c.episode_id
         join characters a on a.id = e.character_a
         join characters b on b.id = e.character_b
        where c.id = $2 and c.status = 'ready'`,
      [REPORT_HIDE_THRESHOLD, id],
    )
  ).rows[0];
  if (!r) return null;
  const owner = Boolean(viewer) && r.owner_id === viewer;
  if (!owner && !r.shareable) return null;
  const mime = which === "clip" ? "video/mp4" : (r.poster_mime ?? "image/png");
  if (r.object_key) return { key: r.object_key, bytes: null, mime, owner_only: !r.shareable };
  const bytes = await readBytes(r);
  return bytes ? { key: null, bytes, mime, owner_only: !r.shareable } : null;
}

/** Takes an account's clip files out of the store (account deletion; best effort, the rows go after). */
export async function removeClipFilesOf(db: Db, userId: string): Promise<void> {
  const keys = (
    await db.query<{ clip_key: string | null; poster_key: string | null }>(`select clip_key, poster_key from clip_requests where owner_id = $1`, [userId])
  ).rows.flatMap((r) => [r.clip_key, r.poster_key]).filter((k): k is string => Boolean(k));
  const store = keys.length ? objectStore() : null;
  for (const key of keys) if (store) await store.remove(key).catch(() => {});
}
