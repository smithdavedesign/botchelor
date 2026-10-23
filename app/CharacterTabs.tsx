import Link from "next/link";
import Avatar from "@/app/Avatar";
import type { CharacterNews } from "@/lib/inbox";
import { shortName } from "@/lib/names";

/** "Dex", "Dex and Sam", "Dex, Sam and Ro". */
const andList = (names: string[]): string => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/**
 * Your characters as a row of faces, to switch whose page this is: /matches and /swipe (David, 2026-10-21: switching
 * characters was "a bit funky", a drop-down that hid which one had news; 2026-10-22: the deck the same way). Each opens
 * `href` plus its id, and the one on screen is marked. On /matches each says how much is new for it. A taken one (with
 * someone and wanting one partner, so closed to other dates: lib/partners.ts takenWith) is dimmed with a 💍 Taken tag,
 * and its label says who it's with and what that rules out on this page. It stays a link: picking it says why.
 * Plain links: no JavaScript.
 */
export default function CharacterTabs({
  characters,
  current,
  href,
  label,
  news,
  taken,
  takenNote,
}: {
  characters: { id: string; name: string; hue: number | null; portrait: string | null }[];
  current: string;
  /** Where each character's page is, e.g. `/matches?character=` (the id is appended). */
  href: string;
  /** What the row is for, read out to a screen reader: "Whose matches". */
  label: string;
  /** What's new for each one (/matches). */
  news?: Map<string, CharacterNews>;
  /** The taken ones, each with who it's with (lib/partners.ts takenWith). */
  taken?: Map<string, { name: string }[]>;
  /** What being taken rules out on this page, for a taken one's label: "can't swipe". */
  takenNote?: string;
}) {
  if (characters.length < 2) return null;
  return (
    <nav className="character-tabs" aria-label={label}>
      {characters.map((c) => {
        const n = news?.get(c.id);
        const count = (n?.texts ?? 0) + (n?.matches ?? 0);
        const what = n ? [n.matches ? `${n.matches} new ${n.matches === 1 ? "match" : "matches"}` : "", n.texts ? `${n.texts} new ${n.texts === 1 ? "text" : "texts"}` : ""].filter(Boolean).join(", ") : "";
        const partners = taken?.get(c.id);
        // "Lexi: taken (dating Dex), can't swipe": a taken one's whole label, read out in place of what the pill shows.
        const takenLabel = partners ? [`${shortName(c.name)}: taken (dating ${andList(partners.map((p) => shortName(p.name)))})`, takenNote].filter(Boolean).join(", ") : "";
        const title = [takenLabel, what].filter(Boolean).join(". ");
        return (
          <Link
            key={c.id}
            href={`${href}${encodeURIComponent(c.id)}`}
            className={partners ? "character-tab is-taken" : "character-tab"}
            aria-current={c.id === current ? "page" : undefined}
            aria-label={partners ? title : undefined}
            title={title || undefined}
          >
            <Avatar seed={c.id} name={c.name} hue={c.hue} portraitSrc={c.portrait} size={28} />
            <span>{shortName(c.name)}</span>
            {partners && (
              <span className="badge character-tab-taken" aria-hidden="true">
                💍 Taken
              </span>
            )}
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
