import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import WaitlistForm from "@/app/WaitlistForm";
import { canAfterDark } from "@/lib/adult/entitlement";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "After Dark · Botchelor", robots: { index: false, follow: false } };

/**
 * Where "Subscribe to unlock" leads. Subscriptions need an adult payment processor and an age check, which don't
 * exist yet, so for now it gathers interest (the waitlist, tagged after-dark): how many would pay, before we build it.
 */
export default async function AfterDarkSubscribe() {
  const db = await getDb();
  if ((await canAfterDark(db, authFromCookieStore(await cookies()))).ok) redirect("/after-dark");
  return (
    <div className="after-dark-mode">
      <article className="after-dark">
        <p className="kicker">🌙 After Dark</p>
        <h1>The private side of the season</h1>
        <p>
          After Dark is where this season&apos;s cast (and your own characters, if you choose) carry on after the cameras stop: private, adults
          only, and never shown in the show.
        </p>
        <p className="muted">
          Subscriptions open soon, with an age check. Leave your email and you&apos;ll hear first.
        </p>
        <WaitlistForm refSlug="after-dark" />
        <p className="muted small">
          A taste of what&apos;s on, blurred: <Link href="/after-dark/shorts">the Shorts</Link>, the house cast&apos;s nights as episodes.
        </p>
      </article>
    </div>
  );
}
