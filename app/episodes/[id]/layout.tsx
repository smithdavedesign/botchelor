import type { ReactNode } from "react";
import { knownEpisodeOnce } from "@/app/known-once";
import NotFoundBeforeLoading from "@/app/NotFoundBeforeLoading";

/** An unknown date (and its report card) is a real 404, decided before ./loading.tsx answers (app/NotFoundBeforeLoading.tsx). */
export default function EpisodeLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  return (
    <>
      <NotFoundBeforeLoading known={async () => knownEpisodeOnce((await params).id)} />
      {children}
    </>
  );
}
