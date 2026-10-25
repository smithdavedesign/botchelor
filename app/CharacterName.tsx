import Link from "next/link";
import Avatar from "@/app/Avatar";

/** What a name label needs to know about its character (a CharacterRef, a directory entry, a graph node all fit). */
export type NamedCharacter = {
  id: string;
  name: string;
  hue?: number | null;
  house?: boolean;
  /** An approved generated portrait (/api/assets/<id>), or null for the drawn tile. */
  portrait?: string | null;
  /** A realistic headshot that wins over the portrait (After Dark's theater), or none. */
  photo?: string | null;
  /** Private to someone else (#309/#509): its page shows only its name, so the label is the name and nothing more. */
  private?: boolean;
};

type Props = {
  character: NamedCharacter;
  /** What to show instead of the full name ("Dex" for "Dex Calloway"). */
  label?: string;
  /** The small face before the name; off where a bigger avatar already sits beside it. */
  avatar?: boolean;
  /** Off inside something that is already a link or a button (no nested anchors): the face and name, unlinked. */
  link?: boolean;
  /** The face's size in px (about 20 to 28 inline). */
  size?: number;
  /** Bold, like the <strong> name labels it replaces. */
  strong?: boolean;
  className?: string;
};

/**
 * A character's name as a label (David, 2026-10-22: "a face by every name, and names that go to the character"): its
 * small round portrait (or the hue-and-initials tile), then the name, both one link to /characters/[id]. The face is
 * decorative (alt=""), lazy-loaded and sized up front, so nothing shifts as it loads. A private character keeps the
 * name-only treatment: no face, no link, plain text. Pure, so it renders in server and client components.
 */
export default function CharacterName({ character: c, label, avatar = true, link = true, size = 22, strong = false, className }: Props) {
  const text = label ?? c.name;
  const name = strong ? <strong className="char-name-text">{text}</strong> : <span className="char-name-text">{text}</span>;
  if (c.private) return <span className={`char-name is-private${className ? ` ${className}` : ""}`}>{name}</span>;
  const face = avatar ? <Avatar seed={c.id} name={c.name} hue={c.hue ?? null} house={c.house ?? false} portraitSrc={c.portrait ?? null} photoSrc={c.photo ?? null} size={size} decorative round /> : null;
  const cls = `char-name${avatar ? " has-face" : ""}${className ? ` ${className}` : ""}`;
  if (!link) {
    return (
      <span className={cls}>
        {face}
        {name}
      </span>
    );
  }
  return (
    <Link className={`${cls} char-name-link`} href={`/characters/${encodeURIComponent(c.id)}`}>
      {face}
      {name}
    </Link>
  );
}
