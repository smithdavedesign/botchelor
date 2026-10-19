import type { Metadata } from "next";
import Link from "next/link";
import SeasonPanel from "./SeasonPanel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Seasons · Admin · Botchelor", robots: { index: false, follow: false } };

/** Admin: this month's cast and next month's generated newcomers, to approve or reject before the 1st (lib/season-gen.ts). */
export default function AdminSeasonPage() {
  return (
    <article>
      <p className="kicker">
        <Link href="/admin">Admin</Link> · Seasons
      </p>
      <h1>The season&apos;s cast</h1>
      <p className="muted">
        A season is a month. On the 1st the two best-reviewed of the cast stay on and two newcomers join. From the 20th the
        show writes three candidates for next month (sheet, voice, soul, a portrait checked by Hive); approve the two you
        want. If nobody reviews them by the 1st, the ones whose portrait passed the check go on so the season still starts.
      </p>
      <SeasonPanel />
    </article>
  );
}
