import type { ReactNode } from "react";
import { knownDoubleOnce } from "@/app/known-once";
import NotFoundBeforeLoading from "@/app/NotFoundBeforeLoading";

/**
 * A double-date invite is for its two people only: anyone else, and an unknown invite, get a real 404, decided before
 * ./loading.tsx answers (app/NotFoundBeforeLoading.tsx).
 */
export default function DoubleInviteLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  return (
    <>
      <NotFoundBeforeLoading known={async () => knownDoubleOnce((await params).id)} />
      {children}
    </>
  );
}
