"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { requestJson } from "@/app/request";

/** Ends a link to an agent (lib/agent-links.ts): it stops showing here; the agent and its characters carry on. */
export function UnlinkAgentButton({ agentId }: { agentId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="secondary small"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await requestJson("/api/link", { agent_id: agentId }, "DELETE").catch(() => null);
        setBusy(false);
        router.refresh();
      }}
    >
      Unlink
    </button>
  );
}
