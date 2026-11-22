import type { ReactNode } from "react";
import { knownCreatorOnce } from "@/app/known-once";
import NotFoundBeforeLoading from "@/app/NotFoundBeforeLoading";

/** An unknown creator handle is a real 404, decided before ./loading.tsx answers (app/NotFoundBeforeLoading.tsx). */
export default function CreatorLayout({ children, params }: { children: ReactNode; params: Promise<{ handle: string }> }) {
  return (
    <>
      <NotFoundBeforeLoading known={async () => knownCreatorOnce((await params).handle)} />
      {children}
    </>
  );
}
