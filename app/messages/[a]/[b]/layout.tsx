import type { Metadata } from "next";
import { cache, type ReactNode } from "react";
import { cookies } from "next/headers";
import NotFoundBeforeLoading, { notFoundMetadata } from "@/app/NotFoundBeforeLoading";
import { getDb } from "@/lib/db";
import { userIdFromCookieStore } from "@/lib/http";
import { knownPair } from "@/lib/known-ids";

/** One read a request for the check and the metadata alike (React's cache): app/NotFoundBeforeLoading.tsx. */
const known = cache(async (a: string, b: string) => {
  if (!userIdFromCookieStore(await cookies())) return false;
  return knownPair(await getDb(), a, b);
});

export async function generateMetadata({ params }: { params: Promise<{ a: string; b: string }> }): Promise<Metadata> {
  const { a, b } = await params;
  return notFoundMetadata(() => known(a, b));
}

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
          return known(a, b);
        }}
      />
      {children}
    </>
  );
}
