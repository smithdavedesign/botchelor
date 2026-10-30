/**
 * Date photos (the PG Studio plan's "Together PG" and "date memory", one feature; 2026-10-30): after a finished date, a
 * photo of the two of them there, a selfie together, a photo-booth strip, a slow dance or the two of them at the place,
 * drawn from both faces in the PG Studio's safe mode and held to its strict check (lib/adult/moderation.ts checkRating).
 *
 * The rules (the plan's, for someone else's character in a picture):
 *  - only the owner of one of the two can make one, and only of a date that's ready;
 *  - it is never kept in their Studio gallery, so it can't be pinned to a profile or posted on the showcase with the other
 *    one's face in it. It lives with the date, seen by the two owners only, and goes into the pair's texts as a 📷 photo,
 *    which both owners already read;
 *  - both faces are already public (a house portrait, or the newest approved pg portrait), and a pg rating only.
 *
 * Priced like a shoot (`studio.pg.price`), refunded when nothing passes; free for admins. Open to whoever the PG Studio
 * is open to (`studio.pg.open_to`).
 */
import { refundBoughtTokens, spendBoughtTokens } from "../allowance";
import { recordAsset, reviewAsset } from "../assets";
import { insertText } from "../between-dates";
import { loadCharacter, type Character } from "../character";
import type { Db } from "../db";
import { notify } from "../notifications";
import { pairKey } from "../relationships";
import { checkPgPictureText } from "../safety";
import { checkRating } from "../adult/moderation";
import { adultKeys } from "../adult/settings";
import { drawPg, faceReference, pgAccess, pgSubject, type PgConfig, type PgFail } from "./pg";
import { PG_TAIL } from "./pg-catalog";

export const DATE_PHOTO_STYLES = [
  { id: "selfie", label: "🤳 A selfie together", words: "an arm's-length selfie of the two of them together, cheek to cheek, both smiling at the phone" },
  { id: "booth", label: "🎞 Photo-booth strip", words: "a photo-booth strip of four frames of the two of them: pulling faces, laughing, a kiss on the cheek, a smile" },
  { id: "dance", label: "💃 A slow dance", words: "the two of them slow dancing, close, both laughing, caught candidly by a friend" },
  { id: "there", label: "📍 The two of them there", words: "a candid photograph of the two of them sitting together, turned toward each other mid-conversation" },
] as const;
export type DatePhotoStyle = (typeof DATE_PHOTO_STYLES)[number]["id"];
export const DATE_PHOTO_STYLE_IDS = DATE_PHOTO_STYLES.map((s) => s.id) as [DatePhotoStyle, ...DatePhotoStyle[]];

/** How many a date photo draws (the passing ones are kept). */
const DRAWS = 2;

const fail = (status: number, error: string, message: string): PgFail => ({ ok: false, status, error, message });

export type DatePhoto = { asset_id: string; url: string; style: DatePhotoStyle; created_at: string };
export type DatePhotoState = { mine: string; partner: string; price: number; free: boolean; tokens_note: string; photos: DatePhoto[] };

type Pair = { episode: { id: string; setting: string }; mine: Character; partner: Character };

/** The date and which of its two is the viewer's (one they can open the PG Studio for); or why not. */
async function pairOf(db: Db, viewer: string | null, episodeId: string): Promise<{ ok: true; pair: Pair; config: PgConfig; admin: boolean } | PgFail> {
  if (!viewer) return fail(401, "sign_in", "Sign in first.");
  const ep = (await db.query<{ id: string; setting: string; character_a: string; character_b: string; status: string }>(`select id, setting, character_a, character_b, status from episodes where id = $1`, [episodeId])).rows[0];
  if (!ep || ep.status !== "ready") return fail(404, "not_found", "No finished date with that id.");
  for (const [mineId, partnerId] of [
    [ep.character_a, ep.character_b],
    [ep.character_b, ep.character_a],
  ]) {
    const access = await pgAccess(db, viewer, mineId);
    if (!access.ok) continue;
    const partner = await loadCharacter(db, partnerId);
    if (!partner) break;
    return { ok: true, pair: { episode: ep, mine: access.character, partner }, config: access.config, admin: access.admin };
  }
  return fail(404, "not_found", "Date photos are for the people whose characters were on the date.");
}

/** What the date page shows its owner: the photos made of it, and what another costs. Null when it isn't theirs. */
export async function datePhotoState(db: Db, viewer: string | null, episodeId: string): Promise<DatePhotoState | null> {
  const p = await pairOf(db, viewer, episodeId);
  if (!p.ok) return null;
  const { rows } = await db.query<{ asset_id: string; style: DatePhotoStyle; created_at: Date }>(
    `select d.asset_id, d.style, d.created_at from date_photos d join character_assets a on a.id = d.asset_id and a.review_status = 'approved'
      where d.episode_id = $1 order by d.created_at`,
    [episodeId],
  );
  return {
    mine: p.pair.mine.name,
    partner: p.pair.partner.name,
    price: p.admin ? 0 : p.config.price,
    free: p.admin,
    tokens_note: p.admin ? "free for admins" : `${p.config.price} token${p.config.price === 1 ? "" : "s"}`,
    photos: rows.map((r) => ({ asset_id: r.asset_id, url: `/api/assets/${r.asset_id}`, style: r.style, created_at: new Date(r.created_at).toISOString() })),
  };
}

/** Where the date was, as picture words: its setting when that's PG words, else a plain evening out. */
export function placeWordsOf(setting: string): string {
  const s = setting.trim().replace(/[.\s]+$/, "").slice(0, 160);
  return s && checkPgPictureText({ words: s }).ok ? s : "a cosy bar in the evening";
}

/** The prompt: both faces kept, by picture, the style, and where. */
export function datePhotoPrompt(style: DatePhotoStyle, mine: Character, partner: Character, setting: string): string {
  const who = (c: Character, n: number) => {
    const s = pgSubject(c);
    return `the ${s.noun} in Picture ${n} (a ${s.age}-year-old ${s.noun}${s.look ? `, ${s.look}` : ""})`;
  };
  const words = DATE_PHOTO_STYLES.find((s) => s.id === style)!.words;
  return [`A photograph of two people: ${who(mine, 1)} and ${who(partner, 2)}, keeping both faces exactly.`, `${words.charAt(0).toUpperCase()}${words.slice(1)}.`, `At ${placeWordsOf(setting)}.`, `Only the two of them in the picture. ${PG_TAIL}`].join(" ");
}

export type DatePhotoResult = { ok: true; photos: DatePhoto[]; refunded: boolean; message: string | null } | PgFail;

/** Makes a date photo, keeps what passes with the date, and sends the first into the pair's texts. */
export async function makeDatePhoto(db: Db, viewer: string | null, episodeId: string, style: DatePhotoStyle, baseUrl: string): Promise<DatePhotoResult> {
  const p = await pairOf(db, viewer, episodeId);
  if (!p.ok) return p;
  const { pair, admin } = p;
  const owner = viewer!;
  const [faceA, faceB] = await Promise.all([faceReference(db, pair.mine, baseUrl), faceReference(db, pair.partner, baseUrl)]);
  if (!faceA || !faceB) return fail(409, "no_face", `A date photo is drawn from both their portraits: ${!faceA ? pair.mine.name : pair.partner.name} needs one first.`);
  const keys = await adultKeys(db);
  if (!keys.venice) return fail(409, "not_set_up", "The Studio needs a Venice key in the settings.");
  const tokens = admin ? 0 : p.config.price;
  if (tokens > 0 && !(await spendBoughtTokens(db, owner, tokens))) return fail(402, "needs_tokens", `A date photo is ${tokens} token${tokens === 1 ? "" : "s"}. Get more on the shop page.`);
  const prompt = datePhotoPrompt(style, pair.mine, pair.partner, pair.episode.setting);
  const drawn = await Promise.all(
    Array.from({ length: DRAWS }, () => drawPg(keys.venice!, p.config, prompt, [faceA, faceB], style === "booth" ? "9:16" : "4:5").then((file) => ({ file }), (err: unknown) => ({ error: err instanceof Error ? err.message.slice(0, 200) : "error" }))),
  );
  const kept: DatePhoto[] = [];
  let lastError: string | null = null;
  for (const d of drawn) {
    if ("error" in d) {
      lastError = d.error;
      continue;
    }
    const v = await checkRating(db, { base64: d.file.bytes.toString("base64"), mime: d.file.mime });
    if (!v.ok) {
      lastError = v.reason;
      continue;
    }
    // A pair photo goes nowhere suggestive: pg or it isn't kept.
    if (v.rating !== "pg") {
      lastError = "the check rated it suggestive";
      continue;
    }
    const asset = await recordAsset(db, {
      character_id: pair.mine.id,
      kind: "photo",
      source_type: "generated",
      source_model: p.config.edit_model,
      prompt: prompt.slice(0, 2000),
      url: `data:${d.file.mime};base64,${d.file.bytes.toString("base64")}`,
      content_rating: "pg",
    });
    await reviewAsset(db, asset, "approved", `date photo of ${episodeId}, rated pg by the Studio's check`);
    await db.query(`insert into date_photos (asset_id, episode_id, owner_id, style) values ($1, $2, $3, $4)`, [asset, episodeId, owner, style]);
    kept.push({ asset_id: asset, url: `/api/assets/${asset}`, style, created_at: new Date().toISOString() });
  }
  const refunded = kept.length === 0 && tokens > 0;
  if (refunded) await refundBoughtTokens(db, owner, tokens);
  if (kept.length) {
    // The first in their texts, as a 📷 photo from the viewer's character: both owners read the thread already.
    const [lo, hi] = pairKey(pair.mine.id, pair.partner.id);
    await insertText(db, lo, hi, pair.mine.id === lo ? "lo" : "hi", "📷", "photo", new Date(), kept[0].asset_id);
    const to = pair.partner.ownerId;
    if (to && to !== owner) {
      await notify(db, to, { kind: "texted", title: `📷 ${pair.mine.name} sent ${pair.partner.name} a photo from your date`.slice(0, 125), link: `/messages/${lo}/${hi}` });
    }
  }
  return {
    ok: true,
    photos: kept,
    refunded,
    message: kept.length ? null : `Nothing came through${lastError ? ` (${lastError})` : ""}.${refunded ? " Your tokens are back." : ""}`,
  };
}
