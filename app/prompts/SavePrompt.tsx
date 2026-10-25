"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";

/**
 * Keeps one library prompt in the viewer's own prompts (lib/studio/library.ts), where both Studios' "Your prompts" row
 * offers it. Signed-out: says how to keep it. A prompt the Studio's safe words don't allow says so instead.
 */
export default function SavePrompt({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | { error: string }>("idle");
  return (
    <>
      <button
        type="button"
        className="button-ghost prompt-save"
        disabled={state === "saving" || state === "saved"}
        onClick={async () => {
          setState("saving");
          const res = await requestJson("/api/library", { action: "save_prompt", text, mode: "safe" }).catch(() => null);
          if (!res) return setState({ error: "That didn't reach the server." });
          if (res.status === 401) return setState({ error: "Sign in to keep prompts." });
          setState(res.ok ? "saved" : { error: res.message });
        }}
      >
        <span aria-live="polite">{state === "saved" ? "Saved ✓" : state === "saving" ? "Saving…" : "Save"}</span>
      </button>
      {typeof state === "object" && (
        <span className="small error prompt-save-note" role="status">
          {state.error === "Sign in to keep prompts." ? (
            <>
              <a href="/account">Sign in</a> to keep prompts.
            </>
          ) : (
            state.error
          )}
        </span>
      )}
    </>
  );
}
