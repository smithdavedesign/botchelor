import type { ReactNode } from "react";
import { cookies } from "next/headers";
import NotFoundBeforeLoading from "@/app/NotFoundBeforeLoading";
import { getDb } from "@/lib/db";
import { userIdFromCookieStore } from "@/lib/http";
import { knownDouble } from "@/lib/known-ids";

/**
 * A double-date invite is for its two people only: anyone else, and an unknown invite, get a real 404, decided before
 * ./loading.tsx answers (app/NotFoundBeforeLoading.tsx).
 */
export default function DoubleInviteLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  return (
    <>
      <NotFoundBeforeLoading
        known={async () => {
          const viewerId = userIdFromCookieStore(await cookies());
          return viewerId ? knownDouble(await getDb(), (await params).id, viewerId) : false;
        }}
      />
      {children}
    </>
  );
}
