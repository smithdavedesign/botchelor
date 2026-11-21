import Link from "next/link";
import Avatar from "@/app/Avatar";
import FaceLoop from "@/app/FaceLoop";
import type { CastCard } from "@/lib/season-cast";
import styles from "./LeadFace.module.css";

/** The face's size in the hero: the page's one big face. */
const SIZE = 184;

/**
 * A lead season's lead, big in the casting hero (David 2026-11-20: "add the face loops to casting too"). The hero asks
 * who dates the lead, and this shows them: their face, moving where they have a loop (app/FaceLoop.tsx), with their
 * name and billing. Their slot below stays: this is the poster, that is the place.
 */
export default function LeadFace({ lead, month }: { lead: Pick<CastCard, "id" | "name" | "hue" | "fan" | "portrait" | "archetype">; month: string }) {
  return (
    <figure className={styles.lead}>
      <FaceLoop id={lead.id} radius={SIZE * 0.28}>
        <Avatar seed={lead.id} name={lead.name} hue={lead.hue} house={!lead.fan} portraitSrc={lead.portrait} size={SIZE} decorative eager />
      </FaceLoop>
      <figcaption className={styles.caption}>
        <span className="kicker">{`${month}'s lead`}</span>
        <Link className={styles.name} href={`/characters/${lead.id}`}>
          {lead.name}
        </Link>
        <span className={styles.role}>{lead.archetype}</span>
      </figcaption>
    </figure>
  );
}
