import type { ReactNode } from "react";
import { knownCoupleOnce } from "@/app/known-once";
import NotFoundBeforeLoading from "@/app/NotFoundBeforeLoading";

/** A pair that never dated or matched is a real 404, decided before ./loading.tsx answers (app/NotFoundBeforeLoading.tsx). */
export default function CoupleLayout({ children, params }: { children: ReactNode; params: Promise<{ a: string; b: string }> }) {
  return (
    <>
      <NotFoundBeforeLoading
        known={async () => {
          const { a, b } = await params;
          return knownCoupleOnce(a, b);
        }}
      />
      {children}
    </>
  );
}
