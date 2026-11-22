import type { Metadata } from "next";
import { cache, type ReactNode } from "react";
import NotFoundBeforeLoading, { notFoundMetadata } from "@/app/NotFoundBeforeLoading";
import { getDb } from "@/lib/db";
import { knownCreator } from "@/lib/known-ids";

/** One read a request for the check and the metadata alike (React's cache): app/NotFoundBeforeLoading.tsx. */
const known = cache(async (handle: string) => knownCreator(await getDb(), handle));

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const { handle } = await params;
  return notFoundMetadata(() => known(handle));
}

/** An unknown creator handle is a real 404, decided before ./loading.tsx answers (app/NotFoundBeforeLoading.tsx). */
export default function CreatorLayout({ children, params }: { children: ReactNode; params: Promise<{ handle: string }> }) {
  return (
    <>
      <NotFoundBeforeLoading known={async () => known((await params).handle)} />
      {children}
    </>
  );
}
