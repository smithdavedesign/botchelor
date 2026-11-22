import type { Metadata } from "next";
import { cache, type ReactNode } from "react";
import NotFoundBeforeLoading, { notFoundMetadata } from "@/app/NotFoundBeforeLoading";
import { getDb } from "@/lib/db";
import { knownCouple } from "@/lib/known-ids";

/** One read a request for the check and the metadata alike (React's cache): app/NotFoundBeforeLoading.tsx. */
const known = cache(async (a: string, b: string) => knownCouple(await getDb(), a, b));

export async function generateMetadata({ params }: { params: Promise<{ a: string; b: string }> }): Promise<Metadata> {
  const { a, b } = await params;
  return notFoundMetadata(() => known(a, b));
}

/** A pair that never dated or matched is a real 404, decided before ./loading.tsx answers (app/NotFoundBeforeLoading.tsx). */
export default function CoupleLayout({ children, params }: { children: ReactNode; params: Promise<{ a: string; b: string }> }) {
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
