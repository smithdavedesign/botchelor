import type { ReactNode } from "react";
import NotFoundBeforeLoading from "@/app/NotFoundBeforeLoading";
import { getDb } from "@/lib/db";
import { knownEpisode } from "@/lib/known-ids";

/** An unknown date (and its report card) is a real 404, decided before ./loading.tsx answers (app/NotFoundBeforeLoading.tsx). */
export default function EpisodeLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  return (
    <>
      <NotFoundBeforeLoading known={async () => knownEpisode(await getDb(), (await params).id)} />
      {children}
    </>
  );
}
