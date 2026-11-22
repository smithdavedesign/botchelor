"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { requestJson } from "@/app/request";
import { PROMPT_MAX, type MyPrompt } from "@/lib/studio/library";
import { okJson } from "@/lib/ok-json";

/** What saving one said: kept, or why not (`signIn`: they need an account first). */
export type SaveOutcome = { ok: true } | { ok: false; message: string; signIn?: boolean };

type MyPromptsState = {
  /** An account session (read by the page on the server): signed out, nothing asks /api/library, which answers accounts only. */
  signedIn: boolean;
  /** Their own prompts, newest first; null until read (and always, signed out). */
  prompts: MyPrompt[] | null;
  /** Whether these words are kept already, as the library compares them (one line, any case). */
  has: (text: string) => boolean;
  save: (text: string) => Promise<SaveOutcome>;
  remove: (id: string) => Promise<void>;
};

/** A prompt's words as the library compares them (lib/studio/library.ts savePrompt): one line, within the length, any case. */
export const promptKey = (text: string) => text.trim().replace(/\s+/g, " ").slice(0, PROMPT_MAX).toLowerCase();

const MyPromptsContext = createContext<MyPromptsState | null>(null);

/**
 * The /prompts article, holding the viewer's own prompts, read once for the page: Your prompts at the top and every
 * card's Save share them, so a card already kept says "Saved ✓" after a reload, and one saved from a card shows at the
 * top at once.
 */
export function MyPromptsArticle({ signedIn, className, children }: { signedIn: boolean; className?: string; children: ReactNode }) {
  const [prompts, setPrompts] = useState<MyPrompt[] | null>(null);
  // A session that ran out after the page was drawn: the library's 401 says so, and the page reads as signed out.
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    fetch("/api/library")
      .then((r) => {
        if (r.status === 401 && live) setExpired(true);
        return okJson(r);
      })
      .then((d) => {
        if (live && d) setPrompts(d.library.prompts as MyPrompt[]);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [signedIn]);
  const account = signedIn && !expired;
  const save = useCallback(
    async (text: string): Promise<SaveOutcome> => {
      if (!account) return { ok: false, message: "Sign in to keep prompts.", signIn: true };
      const res = await requestJson("/api/library", { action: "save_prompt", text, mode: "safe" }).catch(() => null);
      if (!res) return { ok: false, message: "That didn't reach the server." };
      if (res.status === 401) {
        setExpired(true);
        return { ok: false, message: "Sign in to keep prompts.", signIn: true };
      }
      if (!res.ok) return { ok: false, message: res.message };
      // The same words again come back as the one they kept (the library keeps one copy): it stays where it was.
      const item = res.data.item as MyPrompt;
      setPrompts((cur) => (cur?.some((p) => p.id === item.id) ? cur.map((p) => (p.id === item.id ? item : p)) : [item, ...(cur ?? [])]));
      return { ok: true };
    },
    [account],
  );
  const remove = useCallback(async (id: string) => {
    const res = await requestJson("/api/library", { action: "delete", kind: "prompt", id }).catch(() => null);
    if (res?.ok) setPrompts((cur) => (cur ?? []).filter((p) => p.id !== id));
  }, []);
  const value = useMemo<MyPromptsState>(() => {
    const kept = new Set((prompts ?? []).map((p) => promptKey(p.text)));
    return { signedIn: account, prompts, has: (text) => kept.has(promptKey(text)), save, remove };
  }, [account, prompts, save, remove]);
  return (
    <article className={className}>
      <MyPromptsContext.Provider value={value}>{children}</MyPromptsContext.Provider>
    </article>
  );
}

/** The page's own prompts; null outside MyPromptsArticle (read as signed out). */
export const useMyPrompts = (): MyPromptsState | null => useContext(MyPromptsContext);
