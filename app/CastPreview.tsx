import Link from "next/link";
import Avatar from "@/app/Avatar";
import { getDb } from "@/lib/db";
import { shortName } from "@/lib/names";
import { seasonCastCards } from "@/lib/season-cast";

/**
 * Who's waiting once you have a character (the UX pass, David 2026-10-22): the season's cast as faces, under the
 * "Make a character" card on pages that need one (Swipe, Matches), so the step reads as worth taking.
 */
export default async function CastPreview({ line }: { line: string }) {
  const cast = await seasonCastCards(await getDb()).catch(() => []);
  if (!cast.length) return null;
  return (
    <div className="cast-preview">
      <p className="muted small">{line}</p>
      <ul className="cast-preview-faces">
        {cast.map((c) => (
          <li key={c.id}>
            <Link href={`/characters/${c.id}`} title={c.name}>
              <Avatar seed={c.id} name={c.name} hue={c.hue} house size={48} />
              <span className="small">{shortName(c.name)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
