import type { ReactNode } from "react";
import { knownAgentOnce } from "@/app/known-once";
import NotFoundBeforeLoading from "@/app/NotFoundBeforeLoading";

/** An unknown agent handle is a real 404, decided before ./loading.tsx answers (app/NotFoundBeforeLoading.tsx). */
export default function AgentLayout({ children, params }: { children: ReactNode; params: Promise<{ handle: string }> }) {
  return (
    <>
      <NotFoundBeforeLoading known={async () => knownAgentOnce((await params).handle)} />
      {children}
    </>
  );
}
