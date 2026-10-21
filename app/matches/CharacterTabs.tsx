import Link from "next/link";
import Avatar from "@/app/Avatar";
import type { CharacterNews } from "@/lib/inbox";
import { shortName } from "@/lib/names";

/**
 * Whose matches, as a row of faces (David, 2026-10-21: switching characters was "a bit funky", a drop-down that hid
 * which one had news). Each says how much is new for it, and the one on screen is marked. Plain links: no JavaScript.
 */
export default function CharacterTabs({
  characters,
  current,
  news,
}: {
  characters: { id: string; name: string; hue: number | null; portrait: string | null }[];
  current: string;
  news: Map<string, CharacterNews>;
}) {
  if (characters.length < 2) return null;
  return (
    <nav className="character-tabs" aria-label="Whose matches">
      {characters.map((c) => {
        const n = news.get(c.id);
        const count = (n?.texts ?? 0) + (n?.matches ?? 0);
        const what = n ? [n.matches ? `${n.matches} new ${n.matches === 1 ? "match" : "matches"}` : "", n.texts ? `${n.texts} new ${n.texts === 1 ? "text" : "texts"}` : ""].filter(Boolean).join(", ") : "";
        return (
          <Link
            key={c.id}
            href={`/matches?character=${encodeURIComponent(c.id)}`}
            className="character-tab"
            aria-current={c.id === current ? "page" : undefined}
            title={what || undefined}
          >
            <Avatar seed={c.id} name={c.name} hue={c.hue} portraitSrc={c.portrait} size={28} />
            <span>{shortName(c.name)}</span>
            {count > 0 && (
              <span className="nav-count" aria-label={what}>
                {count > 99 ? "99+" : count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
