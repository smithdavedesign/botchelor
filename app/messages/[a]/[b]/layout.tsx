import type { ReactNode } from "react";
import { cookies } from "next/headers";
import NotFoundBeforeLoading from "@/app/NotFoundBeforeLoading";
import { getDb } from "@/lib/db";
import { userIdFromCookieStore } from "@/lib/http";
import { knownPair } from "@/lib/known-ids";

/**
 * A thread is its owners' alone: without a visitor id, or between unknown characters, it's a real 404, decided before
 * ./loading.tsx answers (app/NotFoundBeforeLoading.tsx).
 */
export default function ThreadLayout({ children, params }: { children: ReactNode; params: Promise<{ a: string; b: string }> }) {
  return (
    <>
      <NotFoundBeforeLoading
        known={async () => {
          if (!userIdFromCookieStore(await cookies())) return false;
          const { a, b } = await params;
          return knownPair(await getDb(), a, b);
        }}
      />
      {children}
    </>
  );
}
