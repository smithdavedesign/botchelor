import Link from "next/link";
import PhoneFrame from "@/app/PhoneFrame";
import type { CharacterRef } from "@/lib/game";
import { shortName } from "@/lib/names";
import type { End } from "@/lib/relationships";
import type { ChainItem } from "@/lib/text-chain-shared";
import Thread from "./Thread";

/** How much of it the phone holds: the newest dates and what came with them. The whole list of dates is on the page. */
export const PUBLIC_THREAD_ITEMS = 12;

/**
 * What two characters have sent each other, for anyone watching them (2026-11-16): each aired public date with its
 * photo (the real one an owner made, else the show's snapshot) and the small gifts between them
 * (lib/text-chain.ts publicKeepsakes). Never an owner's text: those stay their owners', and the bar at the bottom says
 * so. A house couple has no owners, so its thread also carries each aired date's morning-after texts
 * (publicHouseThread, HOUSE_ROOM_TEXTS): the page passes them in. Server-rendered, no script: it opens on the newest by
 * laying out from the bottom (app/ux/show.css).
 */
export default function PublicThread({
  items,
  characters,
  today,
  texted,
}: {
  items: readonly ChainItem[];
  characters: Record<End, CharacterRef>;
  today: string;
  /** Someone owns one of them, so they text, and those texts are private. */
  texted: boolean;
}) {
  const names = `${shortName(characters.lo.name)} and ${shortName(characters.hi.name)}`;
  // Never open on half a date: start the newest stretch at a date's marker.
  let from = Math.max(0, items.length - PUBLIC_THREAD_ITEMS);
  while (from > 0 && from < items.length && items[from].kind !== "date") from++;
  const shown = items.slice(from >= items.length ? Math.max(0, items.length - PUBLIC_THREAD_ITEMS) : from);
  return (
    <section className="phone-card couple-texts-locked" id="texts" aria-labelledby="texts-title">
      <h2 id="texts-title">Their texts</h2>
      <PhoneFrame short>
        <div className="phone-messages phone-messages-latest" role="region" aria-label={`What ${names} have sent each other`} tabIndex={0}>
          <div className="phone-messages-flow">
            {shown.length < items.length && <p className="phone-start">Earlier dates are in Their dates</p>}
            <Thread items={shown} me={null} characters={characters} today={today} />
          </div>
        </div>
        <p className="phone-compose">{texted ? "🔒 Their texts are private" : `💬 Only ${names} can text here`}</p>
      </PhoneFrame>
      {texted && (
        <p className="muted small phone-key-hint">
          The photos and gifts are for everyone. Only the characters&apos; owners read what {names} text each other. <Link href="/create">Make a character</Link> and you&apos;ll read every text it sends.
        </p>
      )}
    </section>
  );
}
