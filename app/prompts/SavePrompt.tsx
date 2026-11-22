"use client";

import { useState } from "react";
import { useMyPrompts } from "./MyPromptsContext";

/**
 * Keeps one library prompt in the viewer's own prompts (lib/studio/library.ts), where both Studios' "Your prompts" row
 * offers it. One they keep already says "Saved ✓", after a reload too (the page's own list, MyPromptsContext.tsx).
 * Signed out: says how to keep it, without asking the server. A prompt the Studio's safe words don't allow says so instead.
 */
export default function SavePrompt({ text }: { text: string }) {
  const my = useMyPrompts();
  const [state, setState] = useState<"idle" | "saving" | { error: string; signIn?: boolean }>("idle");
  const saved = my?.has(text) ?? false;
  return (
    <>
      <button
        type="button"
        className="button-ghost small prompt-save"
        disabled={state === "saving" || saved}
        onClick={async () => {
          if (!my?.signedIn) return setState({ error: "Sign in to keep prompts.", signIn: true });
          setState("saving");
          const res = await my.save(text);
          setState(res.ok ? "idle" : { error: res.message, signIn: res.signIn });
        }}
      >
        <span aria-live="polite">{saved ? "Saved ✓" : state === "saving" ? "Saving…" : "Save"}</span>
      </button>
      {typeof state === "object" && (
        <span className="small error prompt-save-note" role="status">
          {state.signIn ? (
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
