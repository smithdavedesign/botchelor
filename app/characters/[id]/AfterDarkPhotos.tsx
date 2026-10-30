import { cookies, headers } from "next/headers";
import Link from "next/link";
import { accessHere } from "@/lib/adult/place";
import { afterDarkHref } from "@/lib/after-dark-host";
import { detectBot } from "@/lib/bots";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";

/** How many teasers the row shows. */
const SHOWN = 4;

/**
 * "🌙 N After Dark photos" on the owner's own character page (the PG Studio plan's teasers in normal mode): their After
 * Dark pictures of this character as server-blurred teasers only (/api/teasers, lib/teaser-image.ts), so the show's page
 * never carries the bytes. Signed in, never a bot, never where After Dark isn't offered; the owner's page only, which
 * is never indexed for them (the owner's view carries no public content beyond what everyone sees).
 */
export type AfterDarkPhotosData = { ids: string[]; n: number; open: boolean };

/** What the row shows, or null when it shows nothing (loaded by the page, so the row itself renders at once). */
export async function afterDarkPhotosOf(characterId: string, owner: string): Promise<AfterDarkPhotosData | null> {
  const h = await headers();
  if (detectBot(h.get("user-agent"), h.get("signature-agent"))) return null;
  const db = await getDb();
  const here = await accessHere(db, authFromCookieStore(await cookies()), h);
  if (here.mode === "blocked") return null;
  const { rows } = await db.query<{ id: string; n: number }>(
    `select id, count(*) over ()::int as n from adult_images
      where owner_id = $1 and character_id = $2 and character_b is null and kind in ('baseline', 'scene') and status = 'ready' and mime like 'image/%'
      order by created_at desc limit ${SHOWN}`,
    [owner, characterId],
  );
  if (!rows.length) return null;
  return { ids: rows.map((r) => r.id), n: rows[0].n, open: here.entitled.ok };
}

export default function AfterDarkPhotos({ characterId, data: { ids, n, open } }: { characterId: string; data: AfterDarkPhotosData }) {
  return (
    <section className="card ad-photos" aria-label="After Dark photos">
      <h2>
        🌙 {n} After Dark photo{n === 1 ? "" : "s"}
      </h2>
      <ul className="profile-photos-grid">
        {ids.map((id) => (
          <li key={id}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a blurred teaser from its own route */}
            <img src={`/api/teasers/${id}`} alt="A blurred After Dark picture" loading="lazy" />
          </li>
        ))}
      </ul>
      {open ? (
        <Link className="button small" href={afterDarkHref(`/after-dark/studio/${characterId}`)}>
          Open in After Dark
        </Link>
      ) : (
        <Link className="button small" href={afterDarkHref("/after-dark/subscribe")}>
          Subscribe to see them
        </Link>
      )}
    </section>
  );
}
