import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { userIdFromCookieStore } from "@/lib/http";
import { myRequests } from "@/lib/showcase-social";
import Requests from "./Requests";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Showcase requests", robots: { index: false } };

/** Showcase posts with their characters in them, waiting on their OK (lib/showcase-social.ts). */
export default async function RequestsPage() {
  const id = userIdFromCookieStore(await cookies());
  return (
    <main className="showcase-page">
      <h1>Showcase requests</h1>
      <p className="muted">Someone wants to publish a picture or clip with one of your characters in it. Nothing goes up without your OK.</p>
      {id ? <Requests initial={await myRequests(await getDb(), id)} /> : <p><Link href="/account">Sign in</Link> to see what&apos;s waiting on you.</p>}
      <p><Link href="/showcase">Back to the showcase</Link></p>
    </main>
  );
}
