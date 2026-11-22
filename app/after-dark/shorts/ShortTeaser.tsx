import Link from "next/link";
import Avatar from "@/app/Avatar";
import { billingOn } from "@/lib/adult/billing";
import type { ShortTeaser } from "@/lib/adult/shorts";
import { fillerLines } from "@/lib/adult/teaser";
import { shortName } from "@/lib/names";
import styles from "./shorts.module.css";

/**
 * A Short as someone After Dark isn't open to sees it (lib/adult/shorts.ts): the show's PG portraits of the two of them,
 * the title (held to the show's PG check when it was published), the length, and neutral filler under the blur. Never a
 * line of the night, never its cover or video: a CSS blur hides nothing from view-source, so none of it is sent.
 */
export function ShortTeaserCard({ short, filler = 3 }: { short: ShortTeaser; filler?: number }) {
  return (
    <li className={`card ad-teaser ${styles.card}`}>
      <div className={styles.faces} aria-hidden="true">
        <Avatar seed={short.a.id} name={short.a.name} house size={44} decorative />
        <Avatar seed={short.b.id} name={short.b.name} house size={44} decorative />
      </div>
      <p className={styles.title}>{short.title}</p>
      <p className={`muted small ${styles.meta}`}>
        {shortName(short.a.name)} × {shortName(short.b.name)} · {short.lines} lines, after the cameras stop
        {/* #1132: one of the two has left the cast since it was published. */}
        {short.earlier ? ` · ${short.earlier}` : ""}
      </p>
      <div className="ad-blur" aria-hidden="true">
        {fillerLines(filler, short.id).map((l, i) => (
          <p key={i}>{l}</p>
        ))}
      </div>
    </li>
  );
}

/**
 * The way to unlock it: a subscription once a processor can sell one (lib/adult/billing.ts billingOn); until then the
 * invite-only beta, and nothing offered for sale (the 2026-11-22 audit: it sold a subscription nobody could buy).
 */
export function SubscribeToUnlock() {
  const selling = billingOn();
  return (
    <p className={styles.subscribe}>
      <Link className={`button primary ${styles.unlock}`} href="/after-dark/subscribe">
        {selling ? "Subscribe to unlock" : "Ask for an invite"}
      </Link>
      <span className="muted small">
        Adults only: the private side of this season. {selling ? "Episodes are included in the subscription." : "It's invite-only while it's in beta."}
      </span>
    </p>
  );
}
