"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import FeedbackModal from "./FeedbackModal";
import { BETA_PROMPT_KEY, betaPromptDue, OPEN_FEEDBACK_EVENT, openFeedback, promptPathBlocked } from "@/lib/user-feedback-shared";

/**
 * The floating Feedback button is there "for now" (David, 2026-10-22: "add a floating one too for now"). Set this to
 * false to take it away; the footer's "Give us feedback" link stays either way.
 */
export const FLOATING_FEEDBACK_BUTTON = true;

/** The beta prompt waits for the page to settle before asking, and asks the server at most this often per tab. */
const PROMPT_DELAY_MS = 2500;
const PROMPT_CHECK_EVERY_MS = 2 * 60_000;
const PROMPT_CHECKED_KEY = "bz_beta_prompt_checked";

type PromptFacts = { used_it: boolean; seen_on_account: boolean; agent: boolean };

const read = (store: () => Storage, key: string): string | null => {
  try {
    return store().getItem(key);
  } catch {
    return null; // private mode, blocked storage
  }
};
const write = (store: () => Storage, key: string, value: string) => {
  try {
    store().setItem(key, value);
  } catch {
    /* private mode: the prompt may ask again in another visit, which is fine */
  }
};

/** The footer's "Give us feedback": a button (it opens a dialog) dressed exactly like the links beside it. */
export function FeedbackLink() {
  return (
    <button type="button" className="link-button footer-link" aria-haspopup="dialog" onClick={openFeedback}>
      Give us feedback
    </button>
  );
}

/**
 * People's way to send feedback, on every page (mounted once, in the root layout): the modal, the floating button, and
 * the one-time beta prompt after a person's first date of their own airs (lib/user-feedback-shared.ts betaPromptDue).
 * The button and the prompt step aside wherever they'd cover the show's own controls; that list lives in one CSS rule
 * (app/globals.css, "people's feedback"). Never on the 18+ gate.
 */
export default function FeedbackDock() {
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const lastPath = useRef(pathname);
  const toast = useRef<HTMLDivElement>(null);
  const fab = useRef<HTMLButtonElement>(null);

  const show = useCallback(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }, []);
  const hide = useCallback(() => {
    setOpen(false);
    // Focus goes back to what opened it; the prompt's button is gone once used, so then to the floating button. After
    // the sheet has closed, since the button is hidden while it's up.
    const back = opener.current?.isConnected ? opener.current : fab.current;
    opener.current = null;
    window.setTimeout(() => back?.focus(), 0);
  }, []);

  // Anything can open it: the footer link, the button, the prompt.
  useEffect(() => {
    window.addEventListener(OPEN_FEEDBACK_EVENT, show);
    return () => window.removeEventListener(OPEN_FEEDBACK_EVENT, show);
  }, [show]);

  // ?feedback=1 on any page opens it, so a post or an email can link straight to it.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("feedback") === "1") show();
  }, [show]);

  // Following a link closes it; what they typed waits for next time.
  useEffect(() => {
    if (pathname === lastPath.current) return;
    lastPath.current = pathname;
    setOpen(false);
  }, [pathname]);

  // The beta prompt: once their first date has aired, ask once (localStorage here, the account on the server).
  useEffect(() => {
    if (prompt || read(() => localStorage, BETA_PROMPT_KEY) || promptPathBlocked(pathname)) return;
    const checked = Number(read(() => sessionStorage, PROMPT_CHECKED_KEY) ?? 0);
    if (Date.now() - checked < PROMPT_CHECK_EVERY_MS) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      write(() => sessionStorage, PROMPT_CHECKED_KEY, String(Date.now()));
      const facts = (await fetch("/api/feedback", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((body: { prompt?: PromptFacts } | null) => body?.prompt ?? null)
        .catch(() => null)) as PromptFacts | null;
      if (cancelled || !facts) return;
      const due = betaPromptDue({
        usedIt: facts.used_it,
        seenOnAccount: facts.seen_on_account,
        agent: facts.agent,
        seenHere: Boolean(read(() => localStorage, BETA_PROMPT_KEY)),
        blocked: promptPathBlocked(window.location.pathname),
      });
      if (due) setPrompt(true);
    }, PROMPT_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pathname, prompt]);

  // It counts as shown the first time it's really on screen: CSS hides it in a theater or on the swipe deck, and an
  // IntersectionObserver only fires once it can be seen, so the one chance isn't spent behind a full-screen view.
  useEffect(() => {
    const el = toast.current;
    if (!prompt || !el || typeof IntersectionObserver === "undefined") return;
    const seen = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      seen.disconnect();
      write(() => localStorage, BETA_PROMPT_KEY, new Date().toISOString());
      void fetch("/api/feedback/prompt", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => {});
    });
    seen.observe(el);
    return () => seen.disconnect();
  }, [prompt]);

  if (pathname === "/gate") return null;

  return (
    <>
      {FLOATING_FEEDBACK_BUTTON && (
        <button ref={fab} type="button" className="feedback-fab" aria-haspopup="dialog" onClick={show}>
          <span className="feedback-fab-icon" aria-hidden="true">
            💬
          </span>
          Feedback
        </button>
      )}
      {/* Always in the page, so a screen reader hears the prompt when it arrives. */}
      <div aria-live="polite">
        {prompt && (
          <div
            ref={toast}
            className={`beta-toast${FLOATING_FEEDBACK_BUTTON ? "" : " no-fab"}`}
            role="region"
            aria-label="Botchelor beta"
            onKeyDown={(e) => e.key === "Escape" && setPrompt(false)}
          >
            <p>Botchelor&apos;s in beta: how&apos;s it going?</p>
            <button
              type="button"
              onClick={() => {
                setPrompt(false);
                show();
              }}
            >
              Tell us
            </button>
            <button type="button" className="beta-toast-x" aria-label="Dismiss" onClick={() => setPrompt(false)}>
              ×
            </button>
          </div>
        )}
      </div>
      <FeedbackModal open={open} onClose={hide} page={pathname} />
    </>
  );
}
