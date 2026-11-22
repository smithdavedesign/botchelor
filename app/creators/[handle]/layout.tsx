import type { ReactNode } from "react";
import NotFoundBeforeLoading from "@/app/NotFoundBeforeLoading";
import { getDb } from "@/lib/db";
import { knownCreator } from "@/lib/known-ids";

/** An unknown creator handle is a real 404, decided before ./loading.tsx answers (app/NotFoundBeforeLoading.tsx). */
export default function CreatorLayout({ children, params }: { children: ReactNode; params: Promise<{ handle: string }> }) {
  return (
    <>
      <NotFoundBeforeLoading known={async () => knownCreator(await getDb(), (await params).handle)} />
      {children}
    </>
  );
}
