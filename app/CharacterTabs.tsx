import Link from "next/link";
import Avatar from "@/app/Avatar";
import type { CharacterNews } from "@/lib/inbox";
import { shortName } from "@/lib/names";

/** "Dex", "Dex and Sam", "Dex, Sam and Ro". */
const andList = (names: string[]): string => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** Up to this many, the faces are a row; more, and the one on screen opens a grid of all of them. */
export const TABS_ROW_MAX = 4;

type Character = { id: string; name: string; hue: number | null; portrait: string | null };

/**
 * Your characters, to switch whose page this is: /matches and /swipe (David, 2026-10-21: switching characters was "a
 * bit funky", a drop-down that hid which one had news; 2026-10-22: the deck the same way). Each opens `href` plus its
 * id, and the one on screen is marked. On /matches each says how much is new for it. A taken one (with someone and
 * wanting one partner, so closed to other dates: lib/partners.ts takenWith) is dimmed with a 💍 Taken tag, and its
 * label says who it's with and what that rules out on this page. It stays a link: picking it says why.
 *
 * A few are a row of faces. More (David, 2026-11-04: "instead of a long horizontal scroll find a better way") fold into
 * the one on screen, which opens a grid of every one, those with news first, and says when another has news.
 * Plain links and a <details>: no JavaScript.
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
  characters: Character[];
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
  const about = (c: Character) => {
    const n = news?.get(c.id);
    const count = (n?.texts ?? 0) + (n?.matches ?? 0);
    const what = n ? [n.matches ? `${n.matches} new ${n.matches === 1 ? "match" : "matches"}` : "", n.texts ? `${n.texts} new ${n.texts === 1 ? "text" : "texts"}` : ""].filter(Boolean).join(", ") : "";
    const partners = taken?.get(c.id);
    // "Lexi: taken (dating Dex), can't swipe": a taken one's whole label, read out in place of what the pill shows.
    const takenLabel = partners ? [`${shortName(c.name)}: taken (dating ${andList(partners.map((p) => shortName(p.name)))})`, takenNote].filter(Boolean).join(", ") : "";
    return { count, what, partners, title: [takenLabel, what].filter(Boolean).join(". ") };
  };
  const tab = (c: Character, className: string, size: number) => {
    const { count, what, partners, title } = about(c);
    return (
      <Link
        key={c.id}
        href={`${href}${encodeURIComponent(c.id)}`}
        className={partners ? `${className} is-taken` : className}
        aria-current={c.id === current ? "page" : undefined}
        aria-label={partners ? title : undefined}
        title={title || undefined}
      >
        <Avatar seed={c.id} name={c.name} hue={c.hue} portraitSrc={c.portrait} size={size} />
        <span className="character-tab-name">{shortName(c.name)}</span>
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
  };

  if (characters.length <= TABS_ROW_MAX) {
    return (
      <nav className="character-tabs" aria-label={label}>
        {characters.map((c) => tab(c, "character-tab", 28))}
      </nav>
    );
  }

  const me = characters.find((c) => c.id === current) ?? characters[0];
  const elsewhere = characters.filter((c) => c.id !== me.id && about(c).count > 0);
  // With news first, the rest as they were.
  const order = [...characters].sort((x, y) => Number(about(y).count > 0) - Number(about(x).count > 0));
  const mine = about(me);
  return (
    <nav className="character-switch" aria-label={label}>
      {/* Keyed by the one on screen, so picking another opens its page with the grid closed. */}
      <details key={me.id} className="character-switch-menu">
        <summary className="character-tab character-switch-current" aria-label={`${label}: ${shortName(me.name)}. ${characters.length} characters, tap to switch`}>
          <Avatar seed={me.id} name={me.name} hue={me.hue} portraitSrc={me.portrait} size={32} />
          <span className="character-tab-name">{shortName(me.name)}</span>
          {mine.partners && (
            <span className="badge character-tab-taken" aria-hidden="true">
              💍 Taken
            </span>
          )}
          <span className="character-switch-more">
            {elsewhere.length ? `${elsewhere.length === 1 ? shortName(elsewhere[0].name) : `${elsewhere.length} others`} ${elsewhere.length === 1 ? "has" : "have"} news` : `Switch · ${characters.length}`}
          </span>
          {elsewhere.length > 0 && <span className="matches-dot" aria-hidden="true" />}
          <span className="character-switch-chevron" aria-hidden="true">
            ▾
          </span>
        </summary>
        <div className="character-grid">{order.map((c) => tab(c, "character-tile", 48))}</div>
      </details>
    </nav>
  );
}
