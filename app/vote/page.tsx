import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The short link a clip ends on ("Vote what they do next: botchelor.com/vote"; competitor review 2026-11-08, #1). It
 * lands on tonight's situation vote on /watch (app/SituationVote.tsx), keeping where it came from for the engagement
 * log (lib/engagement.ts reads utm_*): a clip's own ?s=tiktok (or youtube, instagram) wins, else it's "clip".
 */
export default async function Vote({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const raw = typeof params.s === "string" ? params.s.toLowerCase() : "";
  const source = /^[a-z0-9_-]{1,24}$/.test(raw) ? raw : "clip";
  redirect(`/watch?utm_source=${source}&utm_medium=clip&utm_campaign=vote#situation`);
}
