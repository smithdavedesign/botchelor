import Link from "next/link";
import type { CharacterNow } from "@/lib/character-now";

/**
 * "Right now" under a character's header (lib/character-now.ts): who they are seeing, after or feuding with, and the
 * latest thing that happened, each line a link to what made it, then the way into the Talk tab. Plain and synchronous:
 * the page shapes it from what it already read and renders it in its one pass. The page renders nothing for an empty
 * one, so there is no empty state here.
 */
export default function RightNow({ name, now }: { name: string; now: CharacterNow }) {
  return (
    <section className="character-now" aria-label={`Right now with ${name}`} data-track-area="character-now">
      <p className="kicker">Right now</p>
      <ul>
        {now.lines.map((l) => (
          <li key={l.key}>
            <span aria-hidden="true">{l.icon}</span>
            <span>
              {l.href ? (
                <Link href={l.href} data-track="character-now" data-track-where={l.track}>
                  {l.text}
                </Link>
              ) : (
                l.text
              )}
              {l.when && <span className="muted">, {l.when}</span>}
            </span>
          </li>
        ))}
      </ul>
      {now.talk && (
        <p className="small character-now-more">
          {/* #talk is the Talk panel's own anchor: PageTabs opens the tab and scrolls to it. */}
          <a href="#talk" data-track="character-now" data-track-where="talk">
            See the talk →
          </a>
        </p>
      )}
    </section>
  );
}
