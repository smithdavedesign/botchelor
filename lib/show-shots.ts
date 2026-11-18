/**
 * The show kit's shots (docs/PRDs/styles-and-storylines.md, phase 3): six expressions and three moments per contestant
 * (lib/show-shots-shared.ts says which, and which face a line shows). Each is drawn free on Workers AI (lib/workers-ai.ts)
 * from the character's own portrait, the only reference picture the show uses, in their art style (lib/art-style.ts).
 *
 * - **Checked like every free picture:** the show's PG check with the explicit question (`unfiltered`: Workers AI has no
 *   checker of its own). A refused shot isn't drawn again from the same portrait. Neither is one that keeps failing.
 * - **Kept per portrait:** a shot belongs to the portrait and the style it was drawn from (portrait_key, style). Pages
 *   read only the shots of the portrait a character has now, so a new portrait or style never shows old faces. The
 *   batch draws the new set and clears the old.
 * - **When:** a batch in the hourly job from 20:00 UTC, taking what's left of the day's free budget and leaving
 *   SHOTS_RESERVE_NEURONS for people's own pictures (the PRD's risk note). An admin can draw one character's at any time
 *   (/api/admin/show-shots). Never a paid fallback: past the budget, it waits for tomorrow.
 * - **Who first:** the house cast, then whoever aired the most dates in the last two weeks.
 *
 * Served by /api/shots/<id>.webp (public, PG, never changes once ready), marked AI-generated like every drawn picture.
 */
import { artStyleFrom, artStyleSql, isDrawnStyle, STYLE_WORDS, type ArtStyle } from "./art-style";
import { checkMedia, checkReady, isVerdict } from "./adult/moderation";
import type { Db } from "./db";
import { dataColumn, keepBytes, readBytes } from "./object-store";
import { characterPortrait, HOUSE_PORTRAIT_IDS } from "./portraits";
import { EXPRESSIONS, SHOTS, type Expression, type Shot } from "./show-shots-shared";
import { resizedWebp } from "./thumbs";
import { drawWithWorkersAi, workersAiBudget, workersAiConfig } from "./workers-ai";

export const SHOT_MODEL = "workers-ai/flux-2-klein-4b";
/** The batch starts at this UTC hour: the day's free budget is people's first. */
export const SHOTS_FROM_HOUR = 20;
/** What a batch leaves of the day's budget: about fourteen pictures for people's own portraits and tiles. */
export const SHOTS_RESERVE_NEURONS = 1500;
/** What one shot costs, about (FLUX.2 klein is billed as at least 1024², plus the reference picture). */
export const SHOT_NEURONS = 110;
/** A shot that failed (not refused) is tried again this many times, at most. */
export const SHOT_ATTEMPTS = 3;
/** A shot "making" this long was lost with its request. */
const LOST_MS = 10 * 60 * 1000;

/** Each shot's frame: drawn at about a megapixel (the smallest Workers AI bills for), kept small. */
const FRAME: Record<Shot, { width: number; height: number; keep: number }> = {
  ...(Object.fromEntries(EXPRESSIONS.map((e) => [e, { width: 1024, height: 1024, keep: 512 }])) as Record<Expression, { width: number; height: number; keep: number }>),
  reveal: { width: 832, height: 1248, keep: 512 },
  rose: { width: 896, height: 1120, keep: 512 },
  confessional: { width: 896, height: 1120, keep: 512 },
};

/** How each expression looks: the pilot's words (2026-11-17), which held the face across all six. */
export const EXPRESSION_LOOKS: Record<Expression, string> = {
  smitten: "smitten: a soft dreamy smile, warm slightly dazed eyes, cheeks a little flushed",
  laughing: "laughing: a big open laugh, eyes crinkled",
  flustered: "flustered: blushing, eyes wide, an embarrassed half-smile",
  smug: "smug: a knowing smirk, one eyebrow raised, chin up",
  unimpressed: "unimpressed: a flat mouth, half-lidded eyes, one eyebrow lowered",
  heartbroken: "heartbroken: glassy eyes on the edge of tears, lips pressed together, brows drawn up",
};

/**
 * The adult cue every shot ends on. The drawn styles carry the full one (lib/art-style.ts: drawing drifts young). A
 * photograph keeps its own age from the portrait: "mature features" aged it instead (a 35-year-old's rose shot read
 * nearer sixty, 2026-11-17), and every shot still passes the age check.
 */
const ADULT_DRAWN = "A clearly grown adult with mature features and adult proportions, fully clothed.";
const ADULT_PHOTO = "A grown adult, as old as in image 0 and no older, fully clothed.";
const CLEAN = "No text, no logo, no watermark.";

/** One shot's prompt, in their style: image 0 is their portrait. */
export function shotPrompt(shot: Shot, style: ArtStyle): string {
  const drawn = isDrawnStyle(style);
  const who = drawn ? "character" : "person";
  const { noun, short } = STYLE_WORDS[style];
  const same = `the same face, skin tone, hair, age and outfit`;
  const end = `${short} ${drawn ? ADULT_DRAWN : ADULT_PHOTO} ${CLEAN}`;
  if ((EXPRESSIONS as readonly string[]).includes(shot)) {
    return (
      `Edit image 0: the same ${who}, ${same}, the same background and the same ${drawn ? `${noun} style` : "photographic look"}. ` +
      `Change only the expression to ${EXPRESSION_LOOKS[shot as Expression]}. Head and shoulders, centred for a square crop. ${end}`
    );
  }
  if (shot === "reveal") {
    return (
      `A full-length ${noun} of the same ${who} as image 0: ${same}. They step out through a parting red velvet curtain onto a glossy ` +
      `dating-show stage under warm spotlights, one hand raised in a confident wave, the whole figure in frame from head to shoes. ${end}`
    );
  }
  if (shot === "rose") {
    // A warm, soft spotlight: a hard one carved lines into the face and aged it.
    return (
      `A waist-up ${noun} of the same ${who} as image 0: ${same}. They hold out a single red rose toward the viewer with a nervous, ` +
      `hopeful smile, in a warm, soft spotlight on a dark stage. ${end}`
    );
  }
  return (
    `A waist-up ${noun} of the same ${who} as image 0: ${same}. They sit alone in a cosy reality-show confessional, in a plush ` +
    `armchair with warm lamps and a soft rose-coloured wall behind them, leaning toward the camera with a candid, ` +
    `conspiratorial look, as if telling a secret. ${end}`
  );
}

/**
 * A steady seed per portrait, shot and take, so drawing again draws the same picture. An admin's redo of one shot that
 * drifted from their face is the next take (app/api/admin/show-shots), so it's drawn from another seed.
 */
export function shotSeed(portraitKey: string, shot: Shot, take = 0): number {
  let h = 2166136261 >>> 0;
  for (const ch of take ? `${portraitKey}:${shot}:${take}` : `${portraitKey}:${shot}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Reading them for a page lives apart, so the pages don't load the checker or the image code.
export { shotsFor, shotsJsonSql, shotUrl, shotUrlsOf } from "./show-shots-sql";

/** The portrait a character's shots come from: their newest approved PG portrait, else a house character's file. */
export async function shotSource(db: Db, characterId: string, baseUrl: string): Promise<{ portraitKey: string; url: string; style: ArtStyle } | null> {
  const { rows } = await db.query<{ asset_id: string | null; asset_url: string | null; style: string }>(
    `select a.id as asset_id, a.url as asset_url, ${artStyleSql("c")} as style
       from characters c
       left join lateral (
         select id, url from character_assets
          where character_id = c.id and kind = 'portrait' and review_status = 'approved' and content_rating = 'pg' and url is not null
          order by created_at desc limit 1
       ) a on true
      where c.id = $1`,
    [characterId],
  );
  const r = rows[0];
  if (!r) return null;
  const style = artStyleFrom(r.style);
  if (r.asset_id && r.asset_url) return { portraitKey: r.asset_id, url: new URL(r.asset_url.startsWith("/") ? r.asset_url : `/api/assets/${r.asset_id}`, baseUrl).toString(), style };
  const house = characterPortrait(characterId);
  return house ? { portraitKey: `static:${house}`, url: new URL(house, baseUrl).toString(), style } : null;
}

/** A ready shot's file, for the route. */
export async function shotFile(db: Db, id: string): Promise<{ bytes: Buffer; mime: string } | null> {
  const { rows } = await db.query<{ mime: string; data: Buffer | null; object_key: string | null }>(
    `select mime, ${dataColumn()}, object_key from show_shots where id = $1 and status = 'ready'`,
    [id],
  );
  const r = rows[0];
  if (!r) return null;
  const bytes = await readBytes(r);
  return bytes ? { bytes, mime: r.mime || "image/webp" } : null;
}

type Row = { id: string; shot: Shot; status: "making" | "ready" | "refused" | "failed"; attempts: number; take: number; updated_at: Date | string };

export type ShotsRun = {
  drawn: number;
  refused: number;
  failed: number;
  characters: number;
  /** Why it stopped: done, off (no Worker), hour (before SHOTS_FROM_HOUR), budget, or no_checker. */
  stopped: "done" | "off" | "hour" | "budget" | "no_checker";
};

type RunOpts = {
  /** At most this many shots drawn. */
  max?: number;
  /** Only this character's (an admin's ask): any hour, as long as the budget lasts. */
  characterId?: string;
  baseUrl?: string;
  now?: Date;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
};

/** Who gets shots first: the house cast, then whoever aired the most dates in the last two weeks (with a portrait). */
async function queue(db: Db, limit: number): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `select c.id
       from characters c
       join episodes e on (e.character_a = c.id or e.character_b = c.id)
      where e.status = 'ready' and e.created_at > now() - interval '14 days'
        and exists (select 1 from character_assets a where a.character_id = c.id and a.kind = 'portrait' and a.review_status = 'approved' and a.content_rating = 'pg' and a.url is not null)
      group by c.id
      order by count(*) desc, c.id
      limit $1`,
    [limit],
  );
  return [...new Set([...HOUSE_PORTRAIT_IDS, ...rows.map((r) => r.id)])];
}

/**
 * Draws the shots that are missing, free, a character at a time. Stops at `max`, at the reserve of the day's budget, or
 * when the Worker says the budget's spent. Never throws for one bad shot: it's marked and the batch goes on.
 */
export async function drawShowShots(db: Db, opts: RunOpts = {}): Promise<ShotsRun> {
  const run: ShotsRun = { drawn: 0, refused: 0, failed: 0, characters: 0, stopped: "done" };
  const env = opts.env ?? process.env;
  const now = opts.now ?? new Date();
  const max = opts.max ?? 12;
  const doFetch = opts.fetchImpl ?? fetch;
  if (!workersAiConfig(env)) return { ...run, stopped: "off" };
  if (!opts.characterId && now.getUTCHours() < SHOTS_FROM_HOUR) return { ...run, stopped: "hour" };
  if (!(await checkReady(db, { pg: true }))) return { ...run, stopped: "no_checker" };
  const baseUrl = opts.baseUrl ?? env.SITE_URL ?? "https://botchelor.com";

  const roomFor = async (): Promise<boolean> => {
    if (opts.characterId) return true;
    const b = await workersAiBudget({ env, fetchImpl: doFetch });
    return Boolean(b && b.left - SHOT_NEURONS >= SHOTS_RESERVE_NEURONS);
  };

  const ids = opts.characterId ? [opts.characterId] : await queue(db, 40);
  for (const characterId of ids) {
    if (run.drawn + run.refused + run.failed >= max) break;
    const source = await shotSource(db, characterId, baseUrl);
    if (!source) continue;
    // A new portrait or style: the old shots go, and the new ones are drawn.
    await db.query(`delete from show_shots where character_id = $1 and (portrait_key <> $2 or style <> $3)`, [characterId, source.portraitKey, source.style]);
    const { rows } = await db.query<Row>(`select id, shot, status, attempts, take, updated_at from show_shots where character_id = $1`, [characterId]);
    const had = new Map(rows.map((r) => [r.shot, r]));
    const todo = SHOTS.filter((shot) => {
      const r = had.get(shot);
      if (!r) return true;
      if (r.status === "making") return now.getTime() - new Date(r.updated_at).getTime() > LOST_MS;
      return r.status === "failed" && r.attempts < SHOT_ATTEMPTS;
    });
    if (!todo.length) continue;

    let portrait: Buffer;
    try {
      const res = await doFetch(source.url, { signal: AbortSignal.timeout(20_000) });
      if (!res.ok) continue;
      portrait = Buffer.from(await res.arrayBuffer());
    } catch {
      continue;
    }
    run.characters += 1;

    for (const shot of todo) {
      if (run.drawn + run.refused + run.failed >= max) break;
      if (!(await roomFor())) return { ...run, stopped: "budget" };
      const id = had.get(shot)?.id ?? crypto.randomUUID();
      await db.query(
        `insert into show_shots (id, character_id, portrait_key, style, shot, status, model, attempts)
         values ($1, $2, $3, $4, $5, 'making', $6, 1)
         on conflict (id) do update set status = 'making', error = null, attempts = show_shots.attempts + 1, updated_at = now()`,
        [id, characterId, source.portraitKey, source.style, shot, SHOT_MODEL],
      );
      const frame = FRAME[shot];
      const drawn = await drawWithWorkersAi(
        { prompt: shotPrompt(shot, source.style), width: frame.width, height: frame.height, refs: [portrait], seed: shotSeed(source.portraitKey, shot, had.get(shot)?.take ?? 0) },
        { env, fetchImpl: doFetch },
      );
      if (!drawn.ok) {
        if (drawn.reason === "budget") {
          await db.query(`update show_shots set status = 'failed', error = $2, attempts = greatest(attempts - 1, 0), updated_at = now() where id = $1`, [id, drawn.detail.slice(0, 300)]);
          return { ...run, stopped: "budget" };
        }
        await db.query(`update show_shots set status = 'failed', error = $2, updated_at = now() where id = $1`, [id, drawn.detail.slice(0, 300)]);
        run.failed += 1;
        continue;
      }
      const v = await checkMedia(db, { base64: drawn.base64, mime: drawn.mime }, "pg_image", { unfiltered: true });
      if (!v.ok) {
        // No verdict (a checker down) is a reason to try again, not a refusal.
        const unchecked = !isVerdict(v);
        await db.query(`update show_shots set status = $2, error = $3, updated_at = now() where id = $1`, [id, unchecked ? "failed" : "refused", v.reason.slice(0, 300)]);
        if (unchecked) run.failed += 1;
        else run.refused += 1;
        continue;
      }
      const small = await resizedWebp(drawn.bytes, frame.keep);
      if (!small) {
        await db.query(`update show_shots set status = 'failed', error = 'the picture could not be resized', updated_at = now() where id = $1`, [id]);
        run.failed += 1;
        continue;
      }
      const kept = await keepBytes("looks", id, small, "image/webp");
      await db.query(
        `update show_shots set status = 'ready', error = null, mime = 'image/webp', data = $2, object_key = $3, updated_at = now() where id = $1`,
        [id, kept.data, kept.object_key],
      );
      run.drawn += 1;
    }
  }
  return run;
}
