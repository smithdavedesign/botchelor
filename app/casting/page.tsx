import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import Avatar from "@/app/Avatar";
import Icon from "@/app/Icon";
import { AUDITION_MIN_DATES, castingBoard } from "@/lib/auditions";
import { getDb } from "@/lib/db";
import { listMyCharacters } from "@/lib/game";
import { userIdFromCookieStore } from "@/lib/http";
import { HOUSE_MIN, SURVIVORS, seasonCastCards, seasonCastSize, type CastCard } from "@/lib/season-cast";
import { pageMetadata } from "@/lib/seo";
import CastingBoard from "./CastingBoard";

export const dynamic = "force-dynamic";

const DESCRIPTION = "People's own characters, auditioning for next month's cast on Botchelor. Vote for the one you want on the show.";

export const metadata: Metadata = pageMetadata({ title: "Casting: who's on next month's Botchelor", description: DESCRIPTION, path: "/casting" });

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

/**
 * No auditions yet: the places as slots, so the empty board still shows what's being cast for (the lift, 2026-11-13: one
 * plain box over a blank column). This month's cast in the taken slots, the open places as dashed empty ones, and the
 * one step: make a character to audition, or go to your own when you have one.
 */
function CastingSlots({ label, cast, size, open, hasOwn }: { label: string; cast: CastCard[]; size: number; open: number; hasOwn: boolean }) {
  return (
    <section className="card casting-empty" aria-labelledby="casting-empty-title">
      <h2 id="casting-empty-title">No auditions yet for {label}</h2>
      <p className="muted">
        Be the first: open one of your characters and press <em>Audition</em>. Next month has {size} places; the {SURVIVORS} most loved of this
        month&apos;s cast stay on, and {open} {open === 1 ? "place is" : "places are"} open to people&apos;s characters.
      </p>
      <ul className="casting-slots" aria-label="This month's cast, and next month's open places">
        {cast.slice(0, size).map((c) => (
          <li key={c.id} className="casting-slot is-taken tap-card">
            <Avatar seed={c.id} name={c.name} hue={c.hue} house={!c.fan} portraitSrc={c.portrait} size={56} decorative />
            <span className="casting-slot-text">
              <Link className="stretch" href={`/characters/${c.id}`}>
                <strong>{c.name}</strong>
              </Link>
              <span className="muted small">{c.archetype} · on this month&apos;s cast</span>
            </span>
          </li>
        ))}
        {Array.from({ length: open }, (_, i) => (
          <li key={`open-${i}`} className="casting-slot is-open">
            <span className="casting-slot-face" aria-hidden="true">
              <Icon name="plus" />
            </span>
            <span className="casting-slot-text">
              <strong>Open</strong>
              <span className="muted small">your character?</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="cta-row">
        {hasOwn ? (
          <Link href="/account" className="button" data-track="casting-empty-yours">
            Your characters
          </Link>
        ) : (
          <Link href="/create" className="button" data-track="casting-empty-create">
            Make a character to audition
          </Link>
        )}
      </p>
    </section>
  );
}

/**
 * Casting (/casting): next month's auditions (lib/auditions.ts), most votes first. People's characters only: the
 * shortlisted ones with the most votes take the open places on the cast when the month starts.
 */
export default async function CastingPage() {
  const viewer = userIdFromCookieStore(await cookies());
  const db = await getDb();
  const board = await castingBoard(db, viewer);
  const size = seasonCastSize();
  const open = Math.max(0, size - HOUSE_MIN);
  // Only an empty board draws the slots, so a board with auditions costs nothing more.
  const [cast, own] = board.auditions.length
    ? [[], []]
    : await Promise.all([seasonCastCards(db).catch(() => [] as CastCard[]), viewer ? listMyCharacters(db, viewer, 1).catch(() => []) : Promise.resolve([])]);
  // The page as the design system draws it (all-screens board, 2026-11-11): the auditions, and beside them how a
  // character gets in and how to put one up. The rules are lib/season-cast.ts pickCast's, in words.
  return (
    <article className="casting-page page-wide">
      <header>
        <p className="kicker">Casting · {board.label}</p>
        <h1>Who&apos;s on next month&apos;s show?</h1>
        <p className="lede">
          These are characters people made, auditioning for the {board.label} cast. Vote for the one you want to watch: one vote a
          viewer, and voting again moves it.
        </p>
      </header>
      <div className="casting-layout">
        <div className="casting-main">
          {board.auditions.length ? <CastingBoard board={board} viewer={viewer} /> : <CastingSlots label={board.label} cast={cast} size={size} open={open} hasOwn={own.length > 0} />}
        </div>
        <aside className="casting-rail" aria-label="How casting works">
          <section className="card casting-rules">
            <h2>How a character gets in</h2>
            <ol>
              <li>
                Each season is a month, and its cast has <strong>{size} places</strong>. Anyone can date a cast member by name, all
                month.
              </li>
              <li>
                The last season&apos;s <strong>{SURVIVORS} most loved</strong> stay on, by their reviews.
              </li>
              <li>
                When the month starts on {day(board.closes_at)}, the <strong>shortlisted</strong> auditions with the most votes take
                up to {open} of the open places.
              </li>
              <li>House newcomers fill whatever is left.</li>
              <li>Votes and reviews never change a date, the odds or anyone&apos;s points.</li>
            </ol>
          </section>
          <section className="card casting-yours">
            <h2>Got a character?</h2>
            <p className="small">
              Open its page and press <em>Audition for {board.label}</em>. People&apos;s own characters only, with{" "}
              {AUDITION_MIN_DATES} public dates first so voters have something to judge. You can withdraw it at any time.
            </p>
            <Link href="/account" className="button secondary small">
              Your characters
            </Link>
          </section>
        </aside>
      </div>
    </article>
  );
}
