"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useBookDate } from "@/app/couples/[a]/[b]/useBookDate";
import type { NextStep } from "@/lib/inbox";
import { shortName } from "@/lib/names";

type Props = {
  next: NextStep | null;
  mine: { id: string; name: string };
  them: { id: string; name: string };
  /** The couple page, when they have one (a pair that has only texted doesn't). */
  story: string | null;
  back: string;
};

/**
 * The thread's action bar: the one thing to do next, right where the texts are (David, 2026-10-18). Both want a date:
 * book it here. It's being filmed: watch it live. It's done: watch it, and their story for what comes next.
 */
export default function ThreadNext({ next, mine, them, story, back }: Props) {
  const { book, busy, message } = useBookDate(mine.id, them.id);
  if (!next) return null;
  const a = shortName(mine.name);
  const b = shortName(them.name);
  const storyLink = story && (
    <Link className="thread-next-link" href={story}>
      Their story
    </Link>
  );

  let body: ReactNode = null;
  if (next.kind === "book") {
    body = (
      <>
        <span className="thread-next-text">📅 They both want a date</span>
        <button type="button" className="primary small" onClick={() => void book()} disabled={busy}>
          {busy ? "Booking…" : "Book it"}
        </button>
        {storyLink}
      </>
    );
  } else if (next.kind === "filming") {
    body = (
      <>
        <span className="thread-next-text">🎬 Their date is on now</span>
        <Link className="button small" href={`/episodes/${next.episode_id}?play=1`}>
          Watch live
        </Link>
        {storyLink}
      </>
    );
  } else if (next.kind === "dated") {
    body = (
      <>
        <span className="thread-next-text">{next.aired ? "🎬 Their latest date" : "🎬 Their date is ready"}</span>
        <Link className="button small" href={`/episodes/${next.episode_id}`}>
          ▶ Watch it
        </Link>
        {storyLink}
      </>
    );
  } else if (next.kind === "declined") {
    body = (
      <>
        <span className="thread-next-text muted">Not this time: {next.by === "you" ? a : b} isn&apos;t feeling it</span>
        <Link className="thread-next-link" href={back}>
          Back to matches
        </Link>
      </>
    );
  } else {
    body = <span className="thread-next-text muted">Waiting for {next.on === "you" ? a : b} to answer about a date</span>;
  }

  return (
    <div className="thread-next" role="region" aria-label="What's next">
      {body}
      {message && (
        <p className="error thread-next-error" role="alert">
          {message.text} {message.shop && <Link href="/shop">Get tokens</Link>}
        </p>
      )}
    </div>
  );
}
