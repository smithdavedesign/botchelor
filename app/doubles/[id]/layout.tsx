import type { Metadata } from "next";
import { cache, type ReactNode } from "react";
import { cookies } from "next/headers";
import NotFoundBeforeLoading, { notFoundMetadata } from "@/app/NotFoundBeforeLoading";
import { getDb } from "@/lib/db";
import { userIdFromCookieStore } from "@/lib/http";
import { knownDouble } from "@/lib/known-ids";

/** One read a request for the check and the metadata alike (React's cache): app/NotFoundBeforeLoading.tsx. */
const known = cache(async (id: string) => {
  const viewerId = userIdFromCookieStore(await cookies());
  return viewerId ? knownDouble(await getDb(), id, viewerId) : false;
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return notFoundMetadata(() => known(id));
}

/**
 * A double-date invite is for its two people only: anyone else, and an unknown invite, get a real 404, decided before
 * ./loading.tsx answers (app/NotFoundBeforeLoading.tsx).
 */
export default function DoubleInviteLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  return (
    <>
      <NotFoundBeforeLoading known={async () => known((await params).id)} />
      {children}
    </>
  );
}
