import Link from "next/link";
import Avatar from "@/app/Avatar";
import { AiTag } from "@/app/AiLabel";
import CharacterName from "@/app/CharacterName";
import type { ShortCard } from "@/lib/adult/shorts";
import { shortName } from "@/lib/names";
import styles from "./shorts.module.css";

/**
 * The published episodes (lib/adult/shorts.ts) as cards: the cover (or both faces, with none or where only words are
 * allowed), the title, who and how long, and whether this viewer has watched it. The Episodes page lists them all; the
 * hub (app/after-dark/page.tsx) the newest few, since Episodes became a section of Scenes (David, 2026-11-18).
 */
export default function EpisodeCards({ shorts, watched, textOnly = false }: { shorts: readonly ShortCard[]; watched: ReadonlySet<string>; textOnly?: boolean }) {
  return (
    <ul className={styles.grid} data-episodes>
      {shorts.map((s) => (
        <li key={s.id} className={`card ${styles.card}`} data-episode={s.id}>
          <Link href={s.path}>
            {s.cover && !textOnly ? (
              // eslint-disable-next-line @next/next/no-img-element -- a private file from the Short's own route
              <img className={styles.cover} src={s.cover} alt={`The cover of ${s.title}`} loading="lazy" />
            ) : (
              <span className={styles.faces} aria-hidden="true">
                <Avatar seed={s.a.id} name={s.a.name} house portraitSrc={s.a.portrait} size={64} decorative />
                <Avatar seed={s.b.id} name={s.b.name} house portraitSrc={s.b.portrait} size={64} decorative />
              </span>
            )}
            <span className={styles.title}>{s.title}</span>
            {s.cover && !textOnly && <AiTag label="AI-generated cover" />}
          </Link>
          <p className={`muted small ${styles.meta}`}>
            <CharacterName character={{ ...s.a, house: true }} label={shortName(s.a.name)} link={false} /> ×{" "}
            <CharacterName character={{ ...s.b, house: true }} label={shortName(s.b.name)} link={false} /> · {s.lines} lines{s.video ? " · 🎬 with its video" : ""}
            {watched.has(s.id) ? " · watched" : ""}
            {/* #1132: one of the two has left the cast since it was published (a Short stays up). */}
            {s.earlier && <span data-earlier-cast="true"> · 🗓 {s.earlier}</span>}
          </p>
        </li>
      ))}
    </ul>
  );
}
