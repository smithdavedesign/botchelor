import Link from "next/link";
import { ALL_HOUSE_CHARACTERS } from "@/lib/house";

export type RibbonFace = { id: string; name: string; src: string };

/**
 * The house cast as the ribbon shows them: every house character with a committed house-look portrait
 * (public/cast/house-*-v5.webp, PG, reviewed). Barnaby joined the house through the database, so he isn't in lib/house.ts,
 * but his portrait was committed with the rest (4f46cb59) and his page is live.
 */
export const HOUSE_RIBBON: readonly RibbonFace[] = [...ALL_HOUSE_CHARACTERS, { id: "house-barnaby", name: "Barnaby Thorne" }].map((c) => ({
  id: c.id,
  name: c.name,
  src: `/cast/${c.id}-v5.webp`,
}));

/** "Captain Odalys Reyes" is Odalys under her face. */
export const ribbonName = (name: string): string => name.replace(/^(Captain|Dr\.?|Sir|Lady)\s+/, "").split(/\s+/)[0];

function Faces({ faces, copy }: { faces: readonly RibbonFace[]; copy?: boolean }) {
  return (
    <ul className="face-ribbon-list" aria-hidden={copy ? "true" : undefined}>
      {faces.map((f) => (
        <li key={f.id}>
          <Link href={`/characters/${f.id}`} className="face-ribbon-face" tabIndex={copy ? -1 : undefined} aria-label={copy ? undefined : f.name}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a static public asset, reviewed and committed */}
            <img src={f.src} alt="" width={96} height={128} loading="lazy" decoding="async" />
            <span aria-hidden="true">{ribbonName(f.name)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * The house cast in a slow ribbon (the visual pop audit, 2026-11-20): a CSS-only marquee of the house portraits, the
 * list twice so it loops without a seam (the copy hidden from screen readers and out of the tab order). It stops while a
 * pointer is on it or a face has focus, and for good with its Pause switch (a checkbox: no script); under reduced motion
 * it's a still, wrapped row. PG portraits only, never After Dark's. Complete at rest: nothing waits to be seen.
 */
export default function FaceRibbon({ title = "The house cast", faces = HOUSE_RIBBON }: { title?: string; faces?: readonly RibbonFace[] }) {
  return (
    <section className="face-ribbon" aria-label={title}>
      <div className="face-ribbon-head">
        <p className="kicker">{title}</p>
        <label className="face-ribbon-pause">
          <input type="checkbox" /> Pause
        </label>
      </div>
      <div className="face-ribbon-window">
        <div className="face-ribbon-track">
          <Faces faces={faces} />
          <Faces faces={faces} copy />
        </div>
      </div>
    </section>
  );
}
