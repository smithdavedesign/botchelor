import { avatarPalette, initials } from "@/lib/avatar";
import { characterPortrait } from "@/lib/portraits";
import CharacterName from "@/app/CharacterName";

type Props = {
  /** Stable seed for the gradient; use the character id so the avatar never changes (and so a house
   *  character resolves to its reviewed portrait). */
  seed: string;
  name: string;
  /** 1..360 to force a hue; 0/undefined derives one from the seed. */
  hue?: number | null;
  size?: number;
  /** A house character gets a small ring so it reads as the show's own cast. */
  house?: boolean;
  /** A BYOK-generated portrait to show instead of the drawn tile (served from /api/assets/<id>): pass the
   *  character's `portrait` wherever it's drawn, or an OC that has one shows its initials instead. */
  portraitSrc?: string | null;
  /** A realistic headshot that wins over the reviewed portrait too (After Dark: the face the viewer keeps for them). */
  photoSrc?: string | null;
  /** Next to the character's name (app/CharacterName.tsx): hidden from screen readers, which read the name instead. */
  decorative?: boolean;
  /** A circle instead of the rounded tile (the small inline face before a name). */
  round?: boolean;
};

/**
 * A character's avatar. A house character with a reviewed portrait (lib/portraits.ts) shows that image; an
 * OC shows its generated portrait when it has one, and otherwise the gradient tile with a soft motif and its
 * initials. Pure (no hooks, no client directive), so it renders in both server and client components.
 */
export default function Avatar({ seed, name, hue, size = 48, house = false, portraitSrc = null, photoSrc = null, decorative = false, round = false }: Props) {
  const r = round ? "50%" : size * 0.28;
  // A house character's reviewed file first: its ledger row (when it has one) only redirects to that same file.
  // Then an OC's BYOK-generated portrait (the owner's own, provider-moderated).
  const portrait = photoSrc ?? characterPortrait(seed) ?? sized(portraitSrc, size);
  if (portrait) {
    // The tile's own gradient under the picture, so a face still loading (they're lazy) reads as theirs, not a blank box.
    const p = avatarPalette(seed, hue);
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a static public asset; no loader/optimizer needed
      <img
        src={portrait}
        alt={decorative ? "" : `${name} portrait`}
        width={size}
        height={size}
        decoding="async"
        loading="lazy"
        className={`avatar avatar-portrait${house ? " avatar-house" : ""}${photoSrc ? " avatar-photo" : ""}`}
        style={{ borderRadius: r, width: size, height: size, background: `linear-gradient(135deg, ${p.from}, ${p.to})` }}
      />
    );
  }
  const p = avatarPalette(seed, hue);
  const id = `av-${seed.replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : `${name} avatar`}
      aria-hidden={decorative ? true : undefined}
      className={`avatar${house ? " avatar-house" : ""}`}
      // The same gradient as a background: the fill's url(#id) resolves to the first element with that id, and when
      // that one sits in a hidden subtree (the theater's scene on a phone) the tile would otherwise render empty.
      style={{ borderRadius: r, flex: "0 0 auto", background: `linear-gradient(135deg, ${p.from}, ${p.to})` }}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={p.from} />
          <stop offset="100%" stopColor={p.to} />
        </linearGradient>
      </defs>
      <rect width="100" height="100" rx={round ? 50 : 28} fill={`url(#${id})`} />
      <circle cx="78" cy="22" r="30" fill={p.soft} opacity="0.25" />
      <circle cx="20" cy="86" r="22" fill="#000" opacity="0.08" />
      <text
        x="50"
        y="54"
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="40"
        fontWeight="800"
        fill={p.ink}
        fontFamily="system-ui, sans-serif"
      >
        {initials(name)}
      </text>
    </svg>
  );
}

/** A generated portrait (/api/assets/<id>) at about twice its drawn size, for sharp screens, instead of the 1024px original. */
function sized(src: string | null, size: number): string | null {
  if (!src || !src.startsWith("/api/assets/") || src.includes("?")) return src;
  return `${src}?w=${Math.ceil(size * 2)}`;
}
