import { avatarPalette, initials } from "@/lib/avatar";
import { characterPortrait } from "@/lib/portraits";

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
};

/**
 * A character's avatar. A house character with a reviewed portrait (lib/portraits.ts) shows that image;
 * everyone else (every visitor OC) gets the gradient tile with a soft motif and their initials. Pure (no
 * hooks, no client directive), so it renders in both server and client components.
 */
export default function Avatar({ seed, name, hue, size = 48, house = false }: Props) {
  const r = size * 0.28;
  const portrait = characterPortrait(seed);
  if (portrait) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a static public asset; no loader/optimizer needed
      <img
        src={portrait}
        alt={`${name} portrait`}
        width={size}
        height={size}
        decoding="async"
        className={`avatar avatar-portrait${house ? " avatar-house" : ""}`}
        style={{ borderRadius: r, width: size, height: size }}
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
      role="img"
      aria-label={`${name} avatar`}
      className={`avatar${house ? " avatar-house" : ""}`}
      style={{ borderRadius: r, flex: "0 0 auto" }}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={p.from} />
          <stop offset="100%" stopColor={p.to} />
        </linearGradient>
      </defs>
      <rect width="100" height="100" rx="28" fill={`url(#${id})`} />
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
