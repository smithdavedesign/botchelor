/**
 * The PG Studio (plan PR 3, ~/.claude/plans/allow-studio-for-after-memoized-bird.md; David, 2026-10-25: "a Studio for
 * regular characters too … safe mode"): photo shoots of an owner's own character for the show, at /characters/[id]/studio.
 * It reuses nothing of After Dark's menus or models, and keeps nothing explicit:
 *
 *  - **Who:** the character's owner (signed in); an admin also the house cast. Open to everyone since its live test
 *    (2026-10-25); `studio.pg.open_to: "admins"` closes it to all but admins again (lib/adult/studio-config.ts).
 *  - **A shoot:** the menus' picks (lib/studio/pg-catalog.ts) and their own words, checked by checkPgPictureText first;
 *    `shoot_size` pictures drawn in Venice's safe mode, from their portrait (the face kept) when they have one, else from
 *    their look's words.
 *  - **The check:** every picture through checkRating (one Venice vision call: clothing and age). Only `pg` and
 *    `suggestive` are kept, each with that rating; nudity, sex, anyone not clearly an adult, or no verdict: discarded.
 *  - **Price:** `price` tokens a shoot, taken first and given back whole when nothing came through; the first shoot of
 *    each character free (while the site's `free_per_day` lasts); admins free. Each person's pictures a month are capped.
 *  - **Where it's kept:** studio_pg_pictures, bytes in the bucket under studio-pg/; only the owner (or an admin) sees them
 *    (app/api/studio/pictures/[id]).
 *  - **Identity pack (the creator suite):** eight views of them from their portrait (lib/studio/identity-views.ts), each
 *    checked like a shoot's pictures, for `identity_price` (fewer, a redraw, for their share of it).
 */
import { createHash } from "node:crypto";
import { isAdmin } from "../admins";
import { episodeAllowance, refundBoughtTokens, spendBoughtTokens } from "../allowance";
import { loadCharacter, type Character } from "../character";
import { ALL_HOUSE_CHARACTERS } from "../house";
import type { Db } from "../db";
import { keepBytes } from "../object-store";
import { characterPortrait } from "../portraits";
import { checkPgPictureText } from "../safety";
import { checkRating } from "../adult/moderation";
import { adultKeys, getAdultSettings } from "../adult/settings";
import { PG_GROUPS, PG_NEGATIVE, pgShootPrompt, planPgShoot, planWords, type PgChoices, type PgSubject } from "./pg-catalog";
import { getLibrary, type MyPlace, type MyPrompt } from "./library";
import { identityPackOf, keepIdentityView, type IdentityPack } from "./identity-pack";
import { IDENTITY_VIEW_IDS, identityPrice, identityViewPrompt, type IdentityViewId } from "./identity-views";

export type PgFail = { ok: false; status: number; error: string; message: string };
const fail = (status: number, error: string, message: string): PgFail => ({ ok: false, status, error, message });

export type PgConfig = Awaited<ReturnType<typeof getAdultSettings>>["studio"]["pg"];
export type PgAccess = { ok: true; character: Character; admin: boolean; config: PgConfig } | PgFail;

/** Whether this viewer may open the PG Studio for this character. */
export async function pgAccess(db: Db, viewer: string | null, characterId: string): Promise<PgAccess> {
  if (!viewer) return fail(401, "sign_in", "Sign in to use the Studio.");
  const config = (await getAdultSettings(db)).studio.pg;
  const admin = await isAdmin(db, viewer);
  if (config.open_to === "admins" && !admin) return fail(404, "not_found", "The Studio isn't open yet.");
  const c = await loadCharacter(db, characterId);
  if (!c) return fail(404, "not_found", "No character with that id.");
  if (c.ownerId !== viewer && !(admin && c.house)) return fail(404, "not_found", "The Studio is for your own characters.");
  return { ok: true, character: c, admin, config };
}

/** He, she or a person, from their pronouns. */
const nounOf = (c: Pick<Character, "pronouns">): PgSubject["noun"] => (c.pronouns?.startsWith("she") ? "woman" : c.pronouns?.startsWith("he") ? "man" : "person");

/** Who the picture shows: the house cast's own look line, else their sheet's appearance; dropped if it isn't PG words. */
export function pgSubject(c: Character): PgSubject {
  const raw = (ALL_HOUSE_CHARACTERS.find((h) => h.id === c.id)?.look ?? c.look.physical ?? c.look.appearance ?? "").trim().replace(/[.\s]+$/, "");
  const look = raw.replace(/^an?\s+((?:[\w-]+\s+)?)(?:man|woman|person)\b\s*/i, "$1").replace(/^,\s*/, "").slice(0, 300);
  return { noun: nounOf(c), age: c.age, look: look && checkPgPictureText({ look }).ok ? look : "" };
}

/** Their face for the edit: the house cast's reviewed portrait (a link), else their newest approved pg portrait's bytes. */
export async function faceReference(db: Db, c: Character, baseUrl: string): Promise<string | null> {
  const house = characterPortrait(c.id);
  if (house) return new URL(house, baseUrl).toString();
  const r = await db
    .query<{ url: string | null }>(
      `select url from character_assets where character_id = $1 and kind = 'portrait' and review_status = 'approved' and content_rating = 'pg' and url is not null
        order by created_at desc limit 1`,
      [c.id],
    )
    .catch(() => null);
  const url = r?.rows[0]?.url ?? null;
  if (!url) return null;
  if (url.startsWith("data:image/")) return url;
  return url.startsWith("/cast/") ? new URL(url, baseUrl).toString() : null;
}

/* ------------------------------------------------- drawing ------------------------------------------------- */

const VENICE = "https://api.venice.ai/api/v1";
const MAX_BYTES = 20 * 1024 * 1024;
type Fetch = typeof fetch;
let testFetch: Fetch | null = null;
/** Tests stub the picture model's calls. */
export function setPgStudioFetchForTests(f: Fetch | null): void {
  testFetch = f;
}
const doFetch: Fetch = (...a) => (testFetch ?? fetch)(...a);

/** One picture in Venice's safe mode: an edit of their face when there is one, else a new picture from words. */
async function drawPg(key: string, config: PgConfig, prompt: string, face: string | null): Promise<{ bytes: Buffer; mime: string }> {
  const res = face
    ? await doFetch(`${VENICE}/image/multi-edit`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ modelId: config.edit_model, prompt, images: [face], safe_mode: true, aspect_ratio: "3:4", output_format: "png" }),
      })
    : await doFetch(`${VENICE}/image/generate`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model: config.new_model, prompt, negative_prompt: PG_NEGATIVE, width: 832, height: 1104, format: "png", safe_mode: true, hide_watermark: true }),
      });
  if (!res.ok) throw new Error(`Venice ${res.status}: ${(await res.text().catch(() => "")).slice(0, 160)}`);
  // Venice's safe mode blurs what it judges adult and says so: never kept.
  if (res.headers.get("x-venice-is-blurred") === "true" || res.headers.get("x-venice-is-content-violation") === "true") throw new Error("Venice's safe mode flagged it");
  const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  let bytes: Buffer;
  let mime = "image/png";
  if (type.startsWith("image/")) {
    bytes = Buffer.from(await res.arrayBuffer());
    mime = type;
  } else {
    const b64 = ((await res.json().catch(() => ({}))) as { images?: string[] }).images?.[0];
    if (!b64) throw new Error("Venice returned no picture");
    bytes = Buffer.from(b64.replace(/^data:[^,]*,/, ""), "base64");
  }
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error("Venice returned no usable picture");
  return { bytes, mime };
}

/* ------------------------------------------------- state ------------------------------------------------- */

export type PgPicture = { id: string; rating: "pg" | "suggestive"; created_at: string; shoot_id: string | null };
export type PgShoot = { id: string; status: string; asked: number; made: number; tokens: number; free: boolean; error: string | null; created_at: string };
export type PgState = {
  character: { id: string; name: string; house: boolean; face: boolean };
  groups: typeof PG_GROUPS;
  pictures: PgPicture[];
  shoots: PgShoot[];
  price: number;
  /** This shoot would be free: the character's first, the site's free shoots not used up, or an admin. */
  free: boolean;
  shoot_size: number;
  tokens: number;
  left_this_month: number;
  admin: boolean;
  /** Their own safe venues and prompts (lib/studio/library.ts), for the Where menu and the words box. */
  library: { places: MyPlace[]; prompts: MyPrompt[] };
  /** Their identity pack's views (the creator suite), and what all eight cost. */
  identity_pack: IdentityPack;
  identity_price: number;
};

/**
 * Which face a view was drawn from, as kept with it: the portrait's path (the same on every host), or a hash of the
 * picture itself. A new portrait, and the old views say so.
 */
export function faceKey(face: string): string {
  if (face.startsWith("data:")) return createHash("sha256").update(face).digest("hex").slice(0, 24);
  try {
    return new URL(face).pathname;
  } catch {
    return face.slice(0, 200);
  }
}

const monthStart = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
};

async function picturesThisMonth(db: Db, viewer: string): Promise<number> {
  return (await db.query<{ n: number }>(`select count(*)::int as n from studio_pg_pictures where owner_id = $1 and created_at >= $2`, [viewer, monthStart()])).rows[0]?.n ?? 0;
}

/** Whether the next shoot of this character is the free first one (and today's free shoots aren't used up). */
async function firstShootFree(db: Db, viewer: string, characterId: string, config: PgConfig): Promise<boolean> {
  if (!config.free_first_shoot) return false;
  const r = (
    await db.query<{ mine: number; today: number }>(
      `select count(*) filter (where owner_id = $1 and character_id = $2 and kind = 'shoot' and (made > 0 or status = 'making'))::int as mine,
              count(*) filter (where free and created_at > now() - interval '1 day')::int as today
         from studio_pg_shoots`,
      [viewer, characterId],
    )
  ).rows[0];
  return (r?.mine ?? 0) === 0 && (r?.today ?? 0) < config.free_per_day;
}

export async function pgState(db: Db, viewer: string | null, characterId: string, baseUrl: string): Promise<{ ok: true; state: PgState } | PgFail> {
  const access = await pgAccess(db, viewer, characterId);
  if (!access.ok) return access;
  const { character: c, config, admin } = access;
  const [pictures, shoots, allowance, used, free, face, library] = await Promise.all([
    db.query<{ id: string; content_rating: "pg" | "suggestive"; created_at: Date; shoot_id: string | null }>(
      `select id, content_rating, created_at, shoot_id from studio_pg_pictures where owner_id = $1 and character_id = $2 order by created_at desc limit 120`,
      [viewer, c.id],
    ),
    db.query<{ id: string; status: string; asked: number; made: number; tokens: number; free: boolean; error: string | null; created_at: Date }>(
      `select id, status, asked, made, tokens, free, error, created_at from studio_pg_shoots where owner_id = $1 and character_id = $2 order by created_at desc limit 20`,
      [viewer, c.id],
    ),
    episodeAllowance(db, viewer!),
    picturesThisMonth(db, viewer!),
    firstShootFree(db, viewer!, c.id, config),
    faceReference(db, c, baseUrl),
    getLibrary(db, viewer!, { safeOnly: true }).catch(() => ({ places: [], prompts: [], roleplays: [] })),
  ]);
  return {
    ok: true,
    state: {
      character: { id: c.id, name: c.name, house: c.house, face: Boolean(face) },
      groups: PG_GROUPS,
      pictures: pictures.rows.map((p) => ({ id: p.id, rating: p.content_rating, created_at: new Date(p.created_at).toISOString(), shoot_id: p.shoot_id })),
      shoots: shoots.rows.map((s) => ({ ...s, created_at: new Date(s.created_at).toISOString() })),
      price: config.price,
      free: admin || free,
      shoot_size: config.shoot_size,
      tokens: allowance.pack_left,
      left_this_month: Math.max(0, config.monthly_cap - used),
      admin,
      library: { places: library.places, prompts: library.prompts },
      identity_pack: await identityPackOf(db, viewer!, c.id, "pg", face ? faceKey(face) : null),
      identity_price: config.identity_price,
    },
  };
}

/* ------------------------------------------------- a shoot ------------------------------------------------- */

export type PgShootResult = { ok: true; shoot: PgShoot; pictures: PgPicture[]; refunded: boolean; message: string | null } | PgFail;

let pauses = true;
/** Tests skip the pause between checks. */
export function setPgStudioPausesForTests(on: boolean): void {
  pauses = on;
}
const CHECK_GAP_MS = 800;

export async function pgShoot(db: Db, viewer: string | null, characterId: string, choices: PgChoices, baseUrl: string): Promise<PgShootResult> {
  const access = await pgAccess(db, viewer, characterId);
  if (!access.ok) return access;
  const { character: c, config, admin } = access;
  const owner = viewer!;
  const planned = planPgShoot(choices);
  if (!planned.ok) return fail(422, planned.error, planned.message);
  const { plan } = planned;
  // The owner's words and every pick's words: the strict PG word check first (nothing spent on a refusal).
  const words = checkPgPictureText({ words: planWords(plan) });
  if (!words.ok) {
    const why = words.reason === "real_person" ? "no real or famous people" : words.reason === "minor" ? "everyone shown is an adult" : "the Studio keeps pictures for everyone (no underwear, nudity or anything sexual)";
    return fail(422, "not_allowed", `That can't be shot here: ${why}.`);
  }
  const keys = await adultKeys(db);
  if (!keys.venice) return fail(409, "not_set_up", "The Studio needs a Venice key in the settings.");
  const asked = config.shoot_size;
  const used = await picturesThisMonth(db, owner);
  if (!admin && used + asked > config.monthly_cap) return fail(429, "over_cap", `That's ${asked} and ${Math.max(0, config.monthly_cap - used)} are left this month. They reset on the 1st.`);
  const free = !admin && (await firstShootFree(db, owner, c.id, config));
  const tokens = admin || free ? 0 : config.price;
  if (tokens > 0 && !(await spendBoughtTokens(db, owner, tokens))) return fail(402, "needs_tokens", `A shoot is ${tokens} token${tokens === 1 ? "" : "s"}. Get more on the shop page.`);
  const face = await faceReference(db, c, baseUrl);
  const prompt = pgShootPrompt(plan, pgSubject(c), Boolean(face));
  const id = crypto.randomUUID();
  await db.query(
    `insert into studio_pg_shoots (id, owner_id, character_id, choices, model, tokens, free, asked, status) values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, 'making')`,
    [id, owner, c.id, JSON.stringify(choices), face ? config.edit_model : config.new_model, tokens, free, asked],
  );
  const drawn = await Promise.all(
    Array.from({ length: asked }, () => drawPg(keys.venice!, config, prompt, face).then((file) => ({ file }), (err: unknown) => ({ error: err instanceof Error ? err.message.slice(0, 200) : "error" }))),
  );
  const kept: PgPicture[] = [];
  let lastError: string | null = null;
  let checked = 0;
  for (const d of drawn) {
    if ("error" in d) {
      lastError = d.error;
      continue;
    }
    if (checked++ && pauses) await new Promise((r) => setTimeout(r, CHECK_GAP_MS));
    const v = await checkRating(db, { base64: d.file.bytes.toString("base64"), mime: d.file.mime }, { beach: plan.beach });
    if (!v.ok) {
      lastError = v.reason;
      continue;
    }
    const pid = crypto.randomUUID();
    const store = await keepBytes("studio-pg", pid, d.file.bytes, d.file.mime);
    await db.query(
      `insert into studio_pg_pictures (id, owner_id, character_id, shoot_id, prompt, mime, data, object_key, content_rating, clothing, model)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [pid, owner, c.id, id, prompt.slice(0, 2000), d.file.mime, store.data, store.object_key, v.rating, v.clothing, face ? config.edit_model : config.new_model],
    );
    kept.push({ id: pid, rating: v.rating, created_at: new Date().toISOString(), shoot_id: id });
  }
  const made = kept.length;
  const refunded = made === 0 && tokens > 0;
  if (refunded) await refundBoughtTokens(db, owner, tokens);
  const status = made === 0 ? "failed" : made < asked ? "partial" : "ready";
  await db.query(`update studio_pg_shoots set made = $2, status = $3, error = $4, tokens = $5 where id = $1`, [id, made, status, lastError, refunded ? 0 : tokens]);
  const message =
    made === 0
      ? `Nothing came through${lastError ? ` (${lastError})` : ""}.${refunded ? " Your tokens are back." : free ? " Your free shoot is still there." : ""}`
      : made < asked
        ? `${made} of ${asked} came through; the rest didn't pass the Studio's check or failed to draw.`
        : null;
  return {
    ok: true,
    shoot: { id, status, asked, made, tokens: refunded ? 0 : tokens, free, error: lastError, created_at: new Date().toISOString() },
    pictures: kept,
    refunded,
    message,
  };
}

/**
 * The identity pack in the PG Studio (the creator suite, 2026-10-26; lib/studio/identity-views.ts): eight views of them,
 * each an edit of their portrait in Venice's safe mode, four at a time, each checked as a shoot's are and kept as a
 * picture of theirs (a view that doesn't pass isn't kept). All eight for `identity_price`, or the ones asked for (a
 * redraw) for their share of it; admins free; given back whole when nothing came through. They count against the
 * month's pictures, and never use up the free first shoot.
 */
export async function pgIdentityPack(db: Db, viewer: string | null, characterId: string, input: { views?: IdentityViewId[] }, baseUrl: string): Promise<PgShootResult> {
  const access = await pgAccess(db, viewer, characterId);
  if (!access.ok) return access;
  const { character: c, config, admin } = access;
  const owner = viewer!;
  const views = input.views?.length ? IDENTITY_VIEW_IDS.filter((v) => input.views!.includes(v)) : [...IDENTITY_VIEW_IDS];
  if (!views.length) return fail(422, "unknown_view", "Pick the views to draw.");
  const face = await faceReference(db, c, baseUrl);
  if (!face) return fail(409, "no_face", "Give them a portrait first: the pack is drawn from their face.");
  const keys = await adultKeys(db);
  if (!keys.venice) return fail(409, "not_set_up", "The Studio needs a Venice key in the settings.");
  const asked = views.length;
  const used = await picturesThisMonth(db, owner);
  if (!admin && used + asked > config.monthly_cap) return fail(429, "over_cap", `That's ${asked} and ${Math.max(0, config.monthly_cap - used)} are left this month. They reset on the 1st.`);
  const tokens = admin ? 0 : identityPrice(config.identity_price, asked);
  if (tokens > 0 && !(await spendBoughtTokens(db, owner, tokens))) return fail(402, "needs_tokens", `That's ${tokens} token${tokens === 1 ? "" : "s"}. Get more on the shop page.`);
  const subject = pgSubject(c);
  const from = faceKey(face);
  const id = crypto.randomUUID();
  await db.query(
    `insert into studio_pg_shoots (id, owner_id, character_id, choices, model, tokens, free, asked, status, kind) values ($1, $2, $3, $4::jsonb, $5, $6, false, $7, 'making', 'identity')`,
    [id, owner, c.id, JSON.stringify({ views }), config.edit_model, tokens, asked],
  );
  const drawn: ({ view: IdentityViewId; prompt: string } & ({ file: { bytes: Buffer; mime: string } } | { error: string }))[] = [];
  for (let i = 0; i < views.length; i += 4) {
    const batch = views.slice(i, i + 4).map((view) => {
      const prompt = identityViewPrompt(view, subject, { pg: true });
      return drawPg(keys.venice!, config, prompt, face).then(
        (file) => ({ view, prompt, file }),
        (err: unknown) => ({ view, prompt, error: err instanceof Error ? err.message.slice(0, 200) : "error" }),
      );
    });
    drawn.push(...(await Promise.all(batch)));
  }
  const kept: PgPicture[] = [];
  let lastError: string | null = null;
  let checked = 0;
  for (const d of drawn) {
    if ("error" in d) {
      lastError = d.error;
      continue;
    }
    if (checked++ && pauses) await new Promise((r) => setTimeout(r, CHECK_GAP_MS));
    const v = await checkRating(db, { base64: d.file.bytes.toString("base64"), mime: d.file.mime }, { beach: false });
    if (!v.ok) {
      lastError = v.reason;
      continue;
    }
    const pid = crypto.randomUUID();
    const store = await keepBytes("studio-pg", pid, d.file.bytes, d.file.mime);
    await db.query(
      `insert into studio_pg_pictures (id, owner_id, character_id, shoot_id, prompt, mime, data, object_key, content_rating, clothing, model)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [pid, owner, c.id, id, d.prompt.slice(0, 2000), d.file.mime, store.data, store.object_key, v.rating, v.clothing, config.edit_model],
    );
    await keepIdentityView(db, owner, c.id, "pg", d.view, pid, from);
    kept.push({ id: pid, rating: v.rating, created_at: new Date().toISOString(), shoot_id: id });
  }
  const made = kept.length;
  const refunded = made === 0 && tokens > 0;
  if (refunded) await refundBoughtTokens(db, owner, tokens);
  const status = made === 0 ? "failed" : made < asked ? "partial" : "ready";
  await db.query(`update studio_pg_shoots set made = $2, status = $3, error = $4, tokens = $5 where id = $1`, [id, made, status, lastError, refunded ? 0 : tokens]);
  const message =
    made === 0
      ? `Nothing came through${lastError ? ` (${lastError})` : ""}.${refunded ? " Your tokens are back." : ""}`
      : made < asked
        ? `${made} of ${asked} views came through; the rest didn't pass the Studio's check or failed to draw. Tap one to draw it again.`
        : null;
  return {
    ok: true,
    shoot: { id, status, asked, made, tokens: refunded ? 0 : tokens, free: false, error: lastError, created_at: new Date().toISOString() },
    pictures: kept,
    refunded,
    message,
  };
}

/** Deletes one of the owner's pictures (and its bytes stay only until the bucket's own cleanup). */
export async function deletePgPicture(db: Db, viewer: string | null, pictureId: string): Promise<boolean> {
  if (!viewer) return false;
  const r = await db.query<{ id: string }>(`delete from studio_pg_pictures where id = $1 and owner_id = $2 returning id`, [pictureId, viewer]);
  return r.rows.length > 0;
}

/** A picture for its route: the owner's, or any for an admin. */
export async function pgPictureRef(db: Db, viewer: string | null, pictureId: string): Promise<{ mime: string; data: Buffer | null; object_key: string | null; rating: string } | null> {
  if (!viewer) return null;
  const admin = await isAdmin(db, viewer);
  const r = (
    await db.query<{ mime: string; data: Buffer | Uint8Array | null; object_key: string | null; content_rating: string }>(
      `select mime, data, object_key, content_rating from studio_pg_pictures where id = $1 and ($2::boolean or owner_id = $3)`,
      [pictureId, admin, viewer],
    )
  ).rows[0];
  return r ? { mime: r.mime, data: r.data ? Buffer.from(r.data) : null, object_key: r.object_key, rating: r.content_rating } : null;
}
