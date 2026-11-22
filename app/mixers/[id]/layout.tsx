import type { ReactNode } from "react";
import { knownMixerOnce } from "@/app/known-once";
import NotFoundBeforeLoading from "@/app/NotFoundBeforeLoading";

/** An unknown or called-off mixer is a real 404, decided before ./loading.tsx answers (app/NotFoundBeforeLoading.tsx). */
export default function MixerLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  return (
    <>
      <NotFoundBeforeLoading known={async () => knownMixerOnce((await params).id)} />
      {children}
    </>
  );
}
