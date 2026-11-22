import type { ReactNode } from "react";
import NotFoundBeforeLoading from "@/app/NotFoundBeforeLoading";
import { getDb } from "@/lib/db";
import { knownAgent } from "@/lib/known-ids";

/** An unknown agent handle is a real 404, decided before ./loading.tsx answers (app/NotFoundBeforeLoading.tsx). */
export default function AgentLayout({ children, params }: { children: ReactNode; params: Promise<{ handle: string }> }) {
  return (
    <>
      <NotFoundBeforeLoading known={async () => knownAgent(await getDb(), (await params).handle)} />
      {children}
    </>
  );
}
