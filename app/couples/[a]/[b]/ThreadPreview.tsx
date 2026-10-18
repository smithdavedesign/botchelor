import Link from "next/link";
import Avatar from "@/app/Avatar";
import type { CharacterRef } from "@/lib/game";
import { shortName } from "@/lib/names";
import type { End } from "@/lib/relationships";
import { isText, type ChainItem } from "@/lib/text-chain-shared";

/** How many of the newest texts the couple page shows before the way into the whole thread. */
export const PREVIEW_TEXTS = 3;

/**
 * Their texts on the couple page, for owners: the newest few and the way into the thread (/messages), so the texts
 * live in one place (David, 2026-10-18) while this page keeps their dates, arc and plans.
 */
export default function ThreadPreview({
  items,
  characters,
  mine,
  thread,
}: {
  items: ChainItem[];
  characters: Record<End, CharacterRef>;
  mine: End;
  thread: string;
}) {
  const texts = items.filter(isText).slice(-PREVIEW_TEXTS);
  const me = characters[mine];
  return (
    <section className="card thread-preview" id="texts" aria-labelledby="texts-title">
      <div className="section-head">
        <h2 id="texts-title">Their texts</h2>
        <Link className="button small" href={thread}>
          💬 Open the thread
        </Link>
      </div>
      {texts.length ? (
        <ul className="thread-preview-list">
          {texts.map((t) => {
            const c = characters[t.who];
            return (
              <li key={t.id} className={`thread-preview-msg${t.who === mine ? " is-mine" : ""}`}>
                <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} portraitSrc={c.portrait} size={26} />
                <p>
                  <strong>{shortName(c.name)}</strong> {t.text}
                </p>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted">No texts yet. The morning after a date they text each other, and {shortName(me.name)} keeps texting the ones it likes.</p>
      )}
      <p className="muted small">Only the characters&apos; owners see their texts.</p>
    </section>
  );
}
