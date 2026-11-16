/**
 * A photo from the date, in the character's texts (2026-11-15: 9 people opened a companion in 30 days and none came back
 * a second day; what our companions have that others don't is a life you can watch, so the texts should show it).
 *
 * A PG date has no drawn picture of its own (beat pictures are After Dark's), so the photo is a snapshot composed on
 * request from what the date already has: the place's reviewed backdrop, both portraits, the two names, the place and
 * the day (app/api/og/date-photo/[id]/route.tsx). $0: no model call, no image generated, nothing stored. It never says
 * how the date ended, so it can sit in a text to someone who hasn't watched yet (the tease, a cast character's opener).
 * When the owner made a real date photo in the PG Studio (lib/studio/date-photos.ts, `date_photos`), the thread shows
 * that one in the snapshot's place (lib/companion.ts getThread).
 *
 * In a thread it is one message of its own: companion_messages.via = 'photo', media_url = the snapshot's path, text =
 * its alt text, and the same tag as the text it came with (so it is sent once, with it). DATE_PHOTO_TEXTS=0 stops new
 * ones (lib/companion-shared.ts datePhotoTexts).
 *
 * The same photo is in the COUPLE's thread too (2026-11-16; the owner made two real photos of a date and they showed in
 * no thread): one of the two sends it right after the date's marker (lib/text-chain.ts, a `photo` item), with a short
 * line from templates in the sender's tone. The real photo when an approved PG one exists (the newest), else this
 * snapshot, so making a real one upgrades it in place. It follows its date: anyone sees it once the date aired publicly
 * between public characters, its owners before that, nobody else for a private or unlisted one. DATE_PHOTO_IN_CHAIN=0
 * takes it out of the thread without a deploy of code. And when an owner makes a real photo of their own character's
 * date, that character sends it to them once, where its texts are on (`realPhotoText`, tag `date_photo:<episode id>`).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { approvedPortraitId, getApprovedAsset } from "./assets";
import { datePhotoPath, datePhotoTexts } from "./companion-shared";
import type { Db } from "./db";
import { seedFrom } from "./engine";
import { characterPortrait, venueBackdrop } from "./portraits";
import { REPORT_HIDE_THRESHOLD } from "./rules";
import { toneOf, type Tone, type ToneSheet } from "./sheet-tone";
import { withResizeSlot } from "./thumbs";
import { venuePhrase } from "./venues";

const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] || name;

/** "Saturday, November 14": the day a date happened, in UTC like the show's other days. */
export const datePhotoDay = (at: string | Date): string => new Date(at).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });

/** What a photo message carries (lib/companion.ts postFromCharacter): where it is drawn, and its alt text. */
export type TextPhoto = { url: string; alt: string };

/** The snapshot's alt text (pure): who, where, when. Never the ending. */
export function datePhotoAlt(ep: { names: readonly [string, string]; venue: string | null; at: string | Date }): string {
  const where = ep.venue ? ` at ${venuePhrase(ep.venue)}` : "";
  return `A photo from the date: ${firstNameOf(ep.names[0])} and ${firstNameOf(ep.names[1])}${where}, ${datePhotoDay(ep.at)}.`;
}

/** The photo a text about this date carries, or null with DATE_PHOTO_TEXTS=0 (pure). */
export function textPhoto(ep: { id: string; names: readonly [string, string]; venue: string | null; at: string | Date }, env: Record<string, string | undefined> = process.env): TextPhoto | null {
  if (!datePhotoTexts(env)) return null;
  return { url: datePhotoPath(ep.id), alt: datePhotoAlt(ep) };
}

/* ------------------------------------------- the photo in the couple's thread ------------------------------------------- */

/** DATE_PHOTO_IN_CHAIN: on unless it is "0". Off: the couple's thread has no photo items (lib/text-chain.ts). */
export const datePhotoInChain = (env: Record<string, string | undefined> = process.env): boolean => env.DATE_PHOTO_IN_CHAIN?.trim() !== "0";

/** Which of the two sends the date's photo: dealt by the date, so it never changes for that date. */
export const photoSender = (episodeId: string): "a" | "b" => (seedFrom("date-photo", episodeId) % 2 === 0 ? "a" : "b");

/**
 * What the sender says with the photo, by its tone (lib/sheet-tone.ts). None of them says or hints how the date went:
 * the line shows to an owner before the date airs, and under a date a visitor may not have watched. `{place}` is the
 * venue's phrase ("a safari jeep at dawn"); a line that needs one is skipped for a date without a venue.
 */
export const PHOTO_LINES: Record<Tone, readonly string[]> = {
  warm: ["Look at us.", "From {place}. I wanted you to have it.", "Sending you this one. It's a good picture of you."],
  wry: ["Photographic evidence. We were both there.", "For the record: {place}, two witnesses.", "Exhibit A."],
  reserved: ["This came out better than I expected.", "Here. From {place}.", "You should have a copy."],
  plain: ["Found this from the date.", "From {place}.", "Sending you this before I forget."],
};

/** The sender's line with the date's photo (pure): dealt by the date from its tone's lines. No model call. */
export function datePhotoLine(ep: { id: string; venue: string | null }, sender: ToneSheet): string {
  const lines = PHOTO_LINES[toneOf(sender)].filter((l) => ep.venue || !l.includes("{place}"));
  const line = lines[seedFrom("date-photo-line", ep.id) % lines.length];
  return line.replace("{place}", ep.venue ? venuePhrase(ep.venue) : "");
}

/** What the owner's own character says when it sends them the real photo they made (pure). Never the ending. */
export const REAL_PHOTO_LINES: Record<Tone, readonly string[]> = {
  warm: ["Look at us.", "I'm keeping this one."],
  wry: ["Look at us.", "Suspiciously photogenic, the pair of us."],
  reserved: ["Look at us.", "It came out better than I expected."],
  plain: ["Look at us.", "The real one, not the show's snapshot."],
};
export const realPhotoLines = (sender: ToneSheet): string[] => [...REAL_PHOTO_LINES[toneOf(sender)]];

export type DatePhotoSide = { id: string; name: string; hue: number | null; house: boolean; /** Its portrait may be drawn for this viewer (a private character's only for its owner). */ showFace: boolean };

/** What the snapshot is drawn from: no ending, no line of the date. */
export type DatePhotoFacts = {
  id: string;
  at: string;
  venue: string | null;
  /**
   * Everyone who may ask gets this same picture (a public or unlisted date of two public characters): it may be cached
   * for everyone. Otherwise it depends on who asks (a private date, or a private character whose face only its owner
   * sees), and it is kept in that browser only.
   */
  shared: boolean;
  sides: [DatePhotoSide, DatePhotoSide];
};

/**
 * The date as its snapshot needs it, for this viewer, or null when they may not see it: the episode page's own rule
 * (lib/game.ts getEpisodeView). A private date is for the two characters' owners and its host; one hidden by reports is
 * for nobody but them; After Dark's dates are never drawn on the show. The date need not be finished: the owner's text
 * can come while it is still being wrapped up (lib/after-date-text.ts endingStands), and the picture has no ending in it.
 */
export async function datePhotoFacts(db: Db, episodeId: string, viewerId: string | null): Promise<DatePhotoFacts | null> {
  const { rows } = await db.query<{
    id: string;
    created_at: Date | string;
    venue: string | null;
    visibility: string;
    mine: boolean;
    hidden: boolean;
    a_id: string;
    a_name: string;
    a_hue: number | null;
    a_house: boolean;
    a_private: boolean;
    a_face: boolean;
    b_id: string;
    b_name: string;
    b_hue: number | null;
    b_house: boolean;
    b_private: boolean;
    b_face: boolean;
  }>(
    `select e.id, e.created_at, e.setup->>'venue' as venue, e.visibility,
            coalesce($2::text in (a.owner_id, b.owner_id, e.creator_id), false) as mine,
            (select count(*) from reports r where r.episode_id = e.id) >= $3::int as hidden,
            a.id as a_id, a.name as a_name, a.avatar_hue as a_hue, a.is_house as a_house,
            a.visibility = 'private' as a_private, (a.visibility <> 'private' or coalesce(a.owner_id = $2::text, false)) as a_face,
            b.id as b_id, b.name as b_name, b.avatar_hue as b_hue, b.is_house as b_house,
            b.visibility = 'private' as b_private, (b.visibility <> 'private' or coalesce(b.owner_id = $2::text, false)) as b_face
       from episodes e
       join characters a on a.id = e.character_a
       join characters b on b.id = e.character_b
      where e.id = $1 and e.status in ('generating', 'ready')
        and coalesce((e.setup->>'after_dark')::boolean, false) = false`,
    [episodeId, viewerId, REPORT_HIDE_THRESHOLD],
  );
  const r = rows[0];
  if (!r) return null;
  if (!r.mine && (r.visibility === "private" || r.hidden)) return null;
  return {
    id: r.id,
    at: new Date(r.created_at).toISOString(),
    venue: r.venue,
    shared: r.visibility !== "private" && !r.hidden && !r.a_private && !r.b_private,
    sides: [
      { id: r.a_id, name: r.a_name, hue: r.a_hue, house: r.a_house, showFace: r.a_face },
      { id: r.b_id, name: r.b_name, hue: r.b_hue, house: r.b_house, showFace: r.b_face },
    ],
  };
}

/* ------------------------------------------------ the pictures in it ------------------------------------------------ */

/**
 * The rasterizer behind next/og draws a WebP as nothing, and a full-size portrait (a 1024px PNG of ~1.4 MB) took a
 * share card 8-11 s (2026-11-01 audit, R7). So every picture goes in as a small JPEG, made here a few at a time
 * (lib/thumbs.ts withResizeSlot). Null when sharp or the picture isn't there: the snapshot paints a gradient instead.
 */
async function smallJpeg(bytes: Buffer, size: { width: number; height: number }): Promise<string | null> {
  try {
    const { default: sharp } = await import("sharp");
    const out = await withResizeSlot(() => sharp(bytes).resize({ ...size, fit: "cover", position: "attention" }).jpeg({ quality: 78 }).toBuffer());
    return `data:image/jpeg;base64,${out.toString("base64")}`;
  } catch {
    return null;
  }
}

/** A reviewed file of the show's own art (public/cast: the house portraits and the venue backdrops), or null. */
const CAST_FILE = /^\/cast\/([\w.-]+\.webp)$/;
async function castFile(publicPath: string): Promise<Buffer | null> {
  const m = CAST_FILE.exec(publicPath);
  if (!m) return null;
  return readFile(path.join(process.cwd(), "public", "cast", m[1])).catch(() => null);
}

/**
 * The show's own art changes only with a deploy, so its small copies are kept for the process's life: about 60 files
 * of ~40 KB at the most.
 */
const kept = new Map<string, Promise<string | null>>();
function castJpeg(publicPath: string, size: { width: number; height: number }): Promise<string | null> {
  const key = `${publicPath}@${size.width}x${size.height}`;
  let made = kept.get(key);
  if (!made) {
    made = castFile(publicPath).then((bytes) => (bytes ? smallJpeg(bytes, size) : null));
    kept.set(key, made);
    // A miss isn't kept: the file may be there on the next try (and a failed resize shouldn't stick).
    void made.then((v) => v === null && kept.delete(key));
  }
  return made;
}

/** The place's reviewed backdrop as a small JPEG, or null for a place without one (the gradient is painted). */
export const backdropJpeg = (venueId: string | null, size: { width: number; height: number }): Promise<string | null> => {
  const file = venueBackdrop(venueId);
  return file ? castJpeg(file, size) : Promise.resolve(null);
};

/**
 * A character's face as a small JPEG: the house cast's reviewed portrait, else its newest approved portrait from the
 * ledger (lib/assets.ts). Null when it has none or it can't be read: the snapshot paints its gradient tile.
 */
export async function portraitJpeg(db: Db, characterId: string, size: { width: number; height: number }): Promise<string | null> {
  const house = characterPortrait(characterId);
  if (house) return castJpeg(house, size);
  const id = await approvedPortraitId(db, characterId).catch(() => null);
  const url = id ? ((await getApprovedAsset(db, id).catch(() => null))?.url ?? null) : null;
  if (!url) return null;
  if (url.startsWith("/cast/")) return castJpeg(url, size);
  const data = /^data:image\/(?:png|jpeg|webp);base64,/.exec(url);
  return data ? smallJpeg(Buffer.from(url.slice(data[0].length), "base64"), size) : null;
}
