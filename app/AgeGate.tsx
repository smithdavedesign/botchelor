"use client";

import type { FormEvent } from "react";
import { ADULT_COOKIE, ADULT_COOKIE_MAX_AGE, safeFrom } from "@/lib/age";

/**
 * The 18+ entry lock: a full-screen overlay covering the page until the visitor confirms they're an adult.
 * Progressive enhancement — the plain form posts to /api/age and works with JavaScript off; with JS, it sets
 * the remembered cookie and navigates straight back, so there's no redirect round-trip. "Leave" sends anyone
 * under 18 away. A self-attestation (the standard age gate), not a security boundary.
 */
export default function AgeGate({
  from,
  backdrop = false,
  behind = null,
  afterDark = false,
}: {
  from: string;
  /** The show is drawn blurred behind the question (app/gate/page.tsx), so the overlay lets it show through. */
  backdrop?: boolean;
  /** The date their link was for, named on the card: what they're one tap from. */
  behind?: { names: string; title: string | null } | null;
  /** After Dark's own host: its own words, saying plainly that it's explicit (2026-11-07 audit, item 21). */
  afterDark?: boolean;
}) {
  const dest = safeFrom(from);

  function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    // The same name and life as the server's (lib/age.ts adultCookie); a script can't set HttpOnly, which is the one difference.
    document.cookie = `${ADULT_COOKIE}=1; Path=/; Max-Age=${ADULT_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
    window.location.assign(dest);
  }

  return (
    <div className={`age-gate${backdrop ? " has-backdrop" : ""}`} role="dialog" aria-modal="true" aria-labelledby="age-gate-title">
      <div className="age-gate-card">
        <p className="age-gate-brand">{afterDark ? "Botchelor After Dark" : "Botchelor"}</p>
        <h1 id="age-gate-title">Are you 18 or older?</h1>
        {afterDark ? (
          <p>
            After Dark is <strong>explicit</strong>: sex scenes, nude pictures and videos between{" "}
            <strong>fictional adult characters</strong>, written and drawn by AI. It is for <strong>adults (18+) only</strong>, and only
            where adult content is legal for you to see.
          </p>
        ) : (
          <p>
            Botchelor is a comedic blind-date show starring <strong>fictional adult characters</strong>, written by AI.
            It is for <strong>adults (18+) only</strong>.
          </p>
        )}
        {behind && (
          <p className="age-gate-behind">
            🎬 One tap from <strong>{behind.names}</strong>
            {behind.title ? <>: “{behind.title}”</> : null}
          </p>
        )}
        <form action="/api/age" method="post" className="age-gate-actions" onSubmit={confirm}>
          <input type="hidden" name="from" value={dest} />
          <button type="submit" className="age-gate-enter">
            {afterDark ? "Yes — I'm 18 or older, show me" : <>Yes — I&apos;m 18 or older, enter</>}
          </button>
          <a className="age-gate-leave" href="https://www.google.com" rel="noopener noreferrer">
            No — take me away
          </a>
        </form>
        <p className="age-gate-fine">
          {afterDark
            ? "By entering you confirm you are 18 or older, that explicit adult content is legal where you are and that you want to see it, and that everything here is fiction. We remember your answer on this device so you won't be asked again."
            : "By entering you confirm you are 18 or older and agree that everything here is fiction. We remember your answer on this device so you won't be asked again."}
        </p>
      </div>
    </div>
  );
}
