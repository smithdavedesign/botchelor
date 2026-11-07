import Link from "next/link";
import type { ThisWeekCard } from "@/lib/season-format";

/**
 * "This week on Botchelor" (lib/season-format.ts): the season's announcement on week 1, and this week's twist, in
 * producer voice. $0: every line is a template from the season format's calendar. It points at next season's ballot
 * (lib/season-vote.ts) on the Seasons tab.
 */
export default function ThisWeek({ card, picked }: { card: ThisWeekCard; picked?: { title: string; votes: number; total: number } | null }) {
  return (
    <section className="card watch-this-week" id="this-week" aria-labelledby="this-week-head" data-track-area="this-week">
      <p className="kicker">This week on Botchelor</p>
      <h2 id="this-week-head">{card.label}</h2>
      {card.announce && <p>{card.announce}</p>}
      {card.announce && picked && (
        <p className="small watch-picked">
          🗳️ Picked by the viewers: <strong>{picked.title}</strong>, {picked.votes} of {picked.total} votes.
        </p>
      )}
      <p className="muted small">{card.tease}</p>
      <p className="small">
        <Link href="/reunion#next-season">Vote on next season&apos;s show →</Link>
      </p>
    </section>
  );
}
