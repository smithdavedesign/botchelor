import type { ReactNode } from "react";
import NotFoundBeforeLoading from "@/app/NotFoundBeforeLoading";
import { getDb } from "@/lib/db";
import { knownCouple } from "@/lib/known-ids";

/** A pair that never dated or matched is a real 404, decided before ./loading.tsx answers (app/NotFoundBeforeLoading.tsx). */
export default function CoupleLayout({ children, params }: { children: ReactNode; params: Promise<{ a: string; b: string }> }) {
  return (
    <>
      <NotFoundBeforeLoading
        known={async () => {
          const { a, b } = await params;
          return knownCouple(await getDb(), a, b);
        }}
      />
      {children}
    </>
  );
}
