import type { ReactNode } from "react";
import { knownPairOnce } from "@/app/known-once";
import NotFoundBeforeLoading from "@/app/NotFoundBeforeLoading";

/**
 * A thread is its owners' alone: without a visitor id, or between unknown characters, it's a real 404, decided before
 * ./loading.tsx answers (app/NotFoundBeforeLoading.tsx).
 */
export default function ThreadLayout({ children, params }: { children: ReactNode; params: Promise<{ a: string; b: string }> }) {
  return (
    <>
      <NotFoundBeforeLoading
        known={async () => {
          const { a, b } = await params;
          return knownPairOnce(a, b);
        }}
      />
      {children}
    </>
  );
}
