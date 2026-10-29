import type { Metadata } from "next";
import Link from "next/link";
import { myRequests } from "@/lib/showcase-social";
import { getDb } from "@/lib/db";
import { parseFilters } from "@/lib/showcase";
import ShowcaseBrowser from "./ShowcaseBrowser";
import { pageViewer } from "./viewer";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Showcase: pictures and clips from Botchelor's creators",
  description: "Pictures, clips and date reels of original characters, published by the people who made them. Filter by character, creator, pose, place and more.",
  alternates: { canonical: "/showcase" },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** The creator showcase (lib/showcase.ts, docs/PRDs/showcase.md): everything its creators chose to publish. */
export default async function ShowcasePage({ searchParams }: Props) {
  const db = await getDb();
  const viewer = await pageViewer(db);
  return (
    <main className="showcase-page">
      <h1>Showcase</h1>
      <p className="muted">Pictures, clips and date reels their creators chose to share. Everything here was made with AI, and every character is a fictional adult.</p>
      {viewer.id && (await myRequests(db, viewer.id)).length > 0 && (
        <p className="notice">
          📣 Someone wants to share a picture with one of your characters. <Link href="/showcase/requests">See what&apos;s waiting on you</Link>
        </p>
      )}
      <ShowcaseBrowser db={db} viewer={viewer} base="/showcase" filters={parseFilters(await searchParams)} />
    </main>
  );
}
