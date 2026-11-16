import Link from "next/link";
import type { ReactNode } from "react";
import Avatar from "@/app/Avatar";
import DatePhoto from "@/app/companion/[id]/DatePhoto";
import type { CharacterRef } from "@/lib/game";
import { shortName } from "@/lib/names";
import type { End } from "@/lib/relationships";
import { dayLabel, type ChainDate, type ChainGift, type ChainItem, type ChainPhoto } from "@/lib/text-chain-shared";

/**
 * A moment in the thread that isn't a text: the match, the yes to a date, a date's morning-after texts waiting for it to
 * air (David, 2026-11-02: they "don't show in the text thread"), and one side never answering them ("a label saying
 * ghosted").
 */
function eventLine(item: Extract<ChainItem, { kind: "event" }>, characters: Record<End, CharacterRef>): string {
  switch (item.event) {
    case "matched":
      return "💘 It's a match";
    case "date_agreed":
      return "📅 They agreed to a date";
    case "afterglow_held": {
      const n = item.count ?? 0;
      return `🌅 ${n === 1 ? "A text" : `${n} texts`} from the morning after: here once the date airs`;
    }
    case "ghosted":
      return `👻 ${shortName(characters[item.who ?? "lo"].name)} never replied`;
  }
}

/** What a gift's line says: who left whom what (lib/character-gifts.ts). */
export const giftLine = (gift: ChainGift, characters: Record<End, CharacterRef>): string =>
  `${shortName(characters[gift.who].name)} left ${shortName(characters[gift.who === "lo" ? "hi" : "lo"].name)} ${gift.name}`;

/**
 * The thread: a day label when the day changes, each date as a card with its photo behind it, "the morning after"
 * before its texts, the texts as bubbles grouped while one of them keeps texting, and a gift as its line, the giver's
 * note and what the other said back. `me` is whose phone it is (its texts on the right); null for someone watching the
 * two of them, where both sit on the left with their faces. No hooks: it renders on the server (the couple page's
 * public phone) and inside the phone that scrolls and polls (TextPhone).
 */
export default function Thread({ items, me, characters, today }: { items: readonly ChainItem[]; me: End | null; characters: Record<End, CharacterRef>; today: string }) {
  const startsMorning = (i: number) => {
    const t = items[i];
    if (t?.kind !== "text" || t.source !== "afterglow") return false;
    const p = items[i - 1];
    return !(p?.kind === "text" && p.source === "afterglow" && p.episode_id === t.episode_id);
  };
  // Something is drawn between items i-1 and i: a new day, a date, a photo, a gift, a moment (a match, a yes), or the start of a morning after.
  const breakBefore = (i: number) => i === 0 || items[i].day !== items[i - 1].day || items[i].kind !== "text" || items[i - 1].kind !== "text" || startsMorning(i);
  const sameSender = (i: number, j: number) => {
    const x = items[i];
    const y = items[j];
    return x?.kind === "text" && y?.kind === "text" && x.who === y.who;
  };
  /** One bubble's row: this phone's character on the right, the other (or both, for someone watching) with a face. */
  const row = (key: string, who: End, body: ReactNode, edges = " starts ends") => {
    const mineSide = who === me;
    const c = characters[who];
    return (
      <div key={key} className={`phone-msg ${mineSide ? "phone-msg-me" : "phone-msg-them"}${edges}`}>
        {!mineSide && <Avatar seed={c.id} name={c.name} hue={c.hue} house={c.house} portraitSrc={c.portrait} size={26} />}
        {body}
      </div>
    );
  };
  const said = (who: End, text: ReactNode) => (
    <p className="phone-bubble">
      <span className="sr-only">{shortName(characters[who].name)}: </span>
      {text}
    </p>
  );

  const out: ReactNode[] = [];
  items.forEach((item, i) => {
    if (i === 0 || item.day !== items[i - 1].day) {
      out.push(
        <p key={`day:${item.id}`} className="phone-day">
          {dayLabel(item.day, today)}
        </p>,
      );
    }
    if (item.kind === "date") {
      out.push(<DateCard key={item.id} date={item} />);
      return;
    }
    if (item.kind === "event") {
      out.push(
        <p key={item.id} className="phone-note phone-event">
          {eventLine(item, characters)}
        </p>,
      );
      return;
    }
    if (item.kind === "photo") {
      out.push(row(item.id, item.who, <PhotoMessage photo={item} said={said(item.who, item.text)} />));
      return;
    }
    if (item.kind === "gift") {
      const other: End = item.who === "lo" ? "hi" : "lo";
      out.push(
        <p key={item.id} className="phone-note phone-event phone-gift">
          <span aria-hidden="true">🎁</span> {giftLine(item, characters)}
        </p>,
        row(`${item.id}:note`, item.who, said(item.who, item.note)),
        row(`${item.id}:reply`, other, said(other, item.reply)),
      );
      return;
    }
    if (startsMorning(i)) {
      out.push(
        <p key={`morning:${item.id}`} className="phone-note">
          ☀️ The morning after
        </p>,
      );
    }
    const starts = breakBefore(i) || !sameSender(i - 1, i);
    const ends = i === items.length - 1 || breakBefore(i + 1) || !sameSender(i, i + 1);
    out.push(
      row(
        item.id,
        item.who,
        <p className="phone-bubble">
          <span className="sr-only">{shortName(characters[item.who].name)}: </span>
          {/* A photo sent from the Studio (lib/adult/shares.ts): dressed, checked, a show asset like a portrait. */}
          {item.photo && (
            // eslint-disable-next-line @next/next/no-img-element -- an approved show asset, sized by the bubble
            <img className="phone-photo" src={item.photo} alt={`A photo from ${shortName(characters[item.who].name)}`} loading="lazy" />
          )}
          {item.text}
        </p>,
        `${starts ? " starts" : ""}${ends ? " ends" : ""}`,
      ),
    );
  });
  return <>{out}</>;
}

/** The date's photo and the sender's line under it (lib/date-photo.ts): one tap on the photo opens the date. */
function PhotoMessage({ photo, said }: { photo: ChainPhoto; said: ReactNode }) {
  return (
    <div className="phone-photo-msg">
      <DatePhoto src={photo.src} alt={photo.alt} href={`/episodes/${photo.episode_id}`} track="couple-date-photo" />
      {said}
    </div>
  );
}

function DateCard({ date }: { date: ChainDate }) {
  return (
    <div className="phone-date">
      <p className="phone-date-title">
        🎬 Date {date.number} · {date.venue}
      </p>
      <p className="phone-date-ending">
        Ending: {date.ending_label}
        {!date.aired && <span className="badge">not aired yet</span>}
      </p>
      <Link href={`/episodes/${date.episode_id}`}>▶ Watch it</Link>
    </div>
  );
}
