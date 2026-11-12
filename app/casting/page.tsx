import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { AUDITION_MIN_DATES, castingBoard } from "@/lib/auditions";
import { getDb } from "@/lib/db";
import { userIdFromCookieStore } from "@/lib/http";
import { HOUSE_MIN, SURVIVORS, seasonCastSize } from "@/lib/season-cast";
import { pageMetadata } from "@/lib/seo";
import CastingBoard from "./CastingBoard";

export const dynamic = "force-dynamic";

const DESCRIPTION = "People's own characters, auditioning for next month's cast on Botchelor. Vote for the one you want on the show.";

export const metadata: Metadata = pageMetadata({ title: "Casting: who's on next month's Botchelor", description: DESCRIPTION, path: "/casting" });

const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

/**
 * Casting (/casting): next month's auditions (lib/auditions.ts), most votes first. People's characters only: the
 * shortlisted ones with the most votes take the open places on the cast when the month starts.
 */
export default async function CastingPage() {
  const viewer = userIdFromCookieStore(await cookies());
  const board = await castingBoard(await getDb(), viewer);
  const size = seasonCastSize();
  const open = Math.max(0, size - HOUSE_MIN);
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
          <CastingBoard board={board} viewer={viewer} />
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
