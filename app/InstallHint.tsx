"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { INSTALL_HINT_KEY, installSteps, platformOf, shouldShowInstallHint, type InstallChoice, type Platform } from "@/lib/pwa";

/** Chrome's install prompt (Android, desktop): kept until the person taps Install. */
type InstallPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

/** The hint waits for the page to settle before it slides up. */
const DELAY_MS = 2500;

const read = (): string | null => {
  try {
    return localStorage.getItem(INSTALL_HINT_KEY);
  } catch {
    return null; // private mode, blocked storage
  }
};
/** Remembered for the tab too, so blocked storage still means once per visit, not once per page. */
let rememberedThisTab: InstallChoice | null = null;
const write = (choice: InstallChoice) => {
  rememberedThisTab = choice;
  try {
    localStorage.setItem(INSTALL_HINT_KEY, choice);
  } catch {
    /* private mode: once per visit, then */
  }
};

/**
 * "Install the app", for phones (lib/pwa.ts): installed, Botchelor opens from the Home Screen like an app, and on
 * an iPhone its notifications only come through that way. It shows once, on one page, and never again after that; ×
 * or installing says so for good, in localStorage. Never on After Dark's pages, the admin pages or the 18+ gate, and
 * it steps aside wherever the floating Feedback button does (app/globals.css).
 */
export default function InstallHint() {
  const pathname = usePathname() ?? "/";
  const [show, setShow] = useState<{ platform: Platform } | null>(null);
  const [how, setHow] = useState(false);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const shownOn = useRef<string | null>(null);

  // Chrome offers its own prompt when the page can be installed: hold it for the Install button, unless the hint is done.
  useEffect(() => {
    const onPrompt = (e: Event) => {
      if (read() || rememberedThisTab) return;
      e.preventDefault();
      setPrompt(e as InstallPrompt);
    };
    const onInstalled = () => {
      write("installed");
      setShow(null);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    // One page only: moving on puts it away for good (it was already counted as shown once it was on screen).
    if (shownOn.current && shownOn.current !== pathname) {
      setShow(null);
      setHow(false);
      return;
    }
    const timer = window.setTimeout(() => {
      const nav = window.navigator as Navigator & { standalone?: boolean };
      const ok = shouldShowInstallHint({
        pathname,
        phone: window.matchMedia("(pointer: coarse) and (max-width: 820px)").matches,
        standalone: window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true,
        stored: read() ?? rememberedThisTab,
        ua: nav.userAgent,
      });
      if (!ok) return;
      shownOn.current = pathname;
      setShow({ platform: platformOf(nav.userAgent, nav.maxTouchPoints) });
    }, DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  // Counted as shown only once it's really on screen (it hides wherever the Feedback button does), so the one chance
  // isn't spent behind a full-screen view.
  useEffect(() => {
    const el = card.current;
    if (!show || !el || typeof IntersectionObserver === "undefined") return;
    const seen = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      seen.disconnect();
      if (!read()) write("shown");
    });
    seen.observe(el);
    return () => seen.disconnect();
  }, [show]);

  if (!show) return null;

  async function install() {
    const p = prompt;
    if (!p) return setHow(true);
    setPrompt(null);
    await p.prompt().catch(() => {});
    const choice = await p.userChoice.catch(() => ({ outcome: "dismissed" as const }));
    write(choice.outcome === "accepted" ? "installed" : "dismissed");
    setShow(null);
  }

  function dismiss() {
    write("dismissed");
    setShow(null);
  }

  return (
    <div ref={card} className="install-hint" role="region" aria-label="Install the app" onKeyDown={(e) => e.key === "Escape" && dismiss()}>
      {/* eslint-disable-next-line @next/next/no-img-element -- the app's own PG icon, a static file */}
      <img src="/icons/icon-192.png" alt="" width={36} height={36} />
      <p>
        <strong>Install Botchelor</strong>
        <span className="muted"> On your Home Screen, with notifications when they text.</span>
      </p>
      {prompt ? (
        <button type="button" className="small" onClick={() => void install()}>
          Install
        </button>
      ) : (
        <button type="button" className="secondary small" aria-expanded={how} onClick={() => setHow((h) => !h)}>
          How
        </button>
      )}
      <button type="button" className="beta-toast-x" aria-label="Not now" onClick={dismiss}>
        ×
      </button>
      {how && <p className="install-hint-how">{installSteps(show.platform)}</p>}
    </div>
  );
}
