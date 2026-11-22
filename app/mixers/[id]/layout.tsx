import type { ReactNode } from "react";
import NotFoundBeforeLoading from "@/app/NotFoundBeforeLoading";
import { getDb } from "@/lib/db";
import { knownMixer } from "@/lib/known-ids";

/** An unknown or called-off mixer is a real 404, decided before ./loading.tsx answers (app/NotFoundBeforeLoading.tsx). */
export default function MixerLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  return (
    <>
      <NotFoundBeforeLoading known={async () => knownMixer(await getDb(), (await params).id)} />
      {children}
    </>
  );
}
