import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { castingBoard } from "@/lib/auditions";
import { getDb } from "@/lib/db";
import { userIdFromCookieStore } from "@/lib/http";
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
  return (
    <article className="casting-page">
      <header>
        <p className="kicker">Casting · {board.label}</p>
        <h1>Who&apos;s on next month&apos;s show?</h1>
        <p className="lede">
          These are characters people made, auditioning for the {board.label} cast. Vote for the one you want to watch. When the
          month starts on {day(board.closes_at)}, the shortlisted auditions with the most votes take the open places on the cast:
          anyone can date them by name, and they&apos;re on the show all month.
        </p>
        <p className="small">
          <strong>Got a character?</strong> Open its page and press <em>Audition for {board.label}</em>.{" "}
          <Link href="/account">Your characters</Link>
        </p>
      </header>
      <CastingBoard board={board} viewer={viewer} />
    </article>
  );
}
