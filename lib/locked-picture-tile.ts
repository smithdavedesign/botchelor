/**
 * The locked tile's pixels (lib/locked-picture.ts): PG, and only PG. The source is the character's own face as the show
 * prints it everywhere: the house cast's reviewed portrait, else its newest approved portrait rated pg
 * (lib/date-photo.ts portraitJpeg, which reads lib/portrait-sql.ts approvedPortraitSelect). That picture is shrunk to
 * 12 by 15 pixels and blown back up, blurred (lib/teaser-image.ts blurredTeaser), so colour and a rough shape are left
 * and no detail at all. A character with no portrait gets its avatar's two colours, blurred the same way.
 *
 * This file and its route import nothing of After Dark's and read no After Dark table (tests/locked-picture.test.ts
 * pins both): the tile is a door, and what is behind it never comes to the show.
 */
import { avatarPalette } from "./avatar";
import { portraitJpeg } from "./date-photo";
import type { Db } from "./db";
import { blurredTeaser, TEASER_HEIGHT, TEASER_WIDTH } from "./teaser-image";

/** What the portrait is cut to before it is blurred: the tile's own 4:5. */
const SOURCE = { width: TEASER_WIDTH, height: TEASER_HEIGHT };

export type TileCharacter = { id: string; hue: number | null; private: boolean; owner_id: string | null };

/** The character a tile is asked for, or null: gone, or a deleted owner's. */
export async function tileCharacter(db: Db, characterId: string): Promise<TileCharacter | null> {
  const { rows } = await db.query<{ id: string; avatar_hue: number | null; visibility: string; owner_id: string | null }>(
    `select id, avatar_hue, visibility, owner_id from characters where id = $1`,
    [characterId],
  );
  const r = rows[0];
  return r ? { id: r.id, hue: r.avatar_hue, private: r.visibility === "private", owner_id: r.owner_id } : null;
}

/** An avatar colour ("hsl(210 72% 58%)", lib/avatar.ts avatarPalette) as red, green and blue; a plum when it can't be read. */
export function rgbOfHsl(css: string): [number, number, number] {
  const m = /^hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*\)$/.exec(css.trim());
  if (!m) return [90, 60, 100];
  const [h, s, l] = [Number(m[1]) % 360, Number(m[2]) / 100, Number(m[3]) / 100];
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

/** The avatar's two colours as a tiny diagonal wash: what a character without a portrait has for a face. */
async function wash(c: TileCharacter): Promise<Buffer | null> {
  try {
    const { default: sharp } = await import("sharp");
    const p = avatarPalette(c.id, c.hue);
    const [from, to] = [rgbOfHsl(p.from), rgbOfHsl(p.to)];
    const w = 12;
    const h = 15;
    const raw = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = (x / (w - 1) + y / (h - 1)) / 2;
        for (let k = 0; k < 3; k++) raw[(y * w + x) * 3 + k] = Math.round(from[k] + (to[k] - from[k]) * t);
      }
    }
    return await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
  } catch {
    return null;
  }
}

/** The blurred tile for a character, as JPEG bytes, or null when nothing could be drawn (the page shows its own lock card). */
export async function lockedTile(db: Db, c: TileCharacter): Promise<Buffer | null> {
  const face = await portraitJpeg(db, c.id, SOURCE).catch(() => null);
  const data = face ? /^data:image\/jpeg;base64,(.+)$/.exec(face)?.[1] : null;
  const source = data ? Buffer.from(data, "base64") : await wash(c);
  return source ? blurredTeaser(source) : null;
}
