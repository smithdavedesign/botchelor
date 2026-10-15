"use client";

import type { FormEvent } from "react";
import { safeFrom } from "@/lib/age";

const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * The 18+ entry lock: a full-screen overlay covering the page until the visitor confirms they're an adult.
 * Progressive enhancement — the plain form posts to /api/age and works with JavaScript off; with JS, it sets
 * the remembered cookie and navigates straight back, so there's no redirect round-trip. "Leave" sends anyone
 * under 18 away. A self-attestation (the standard age gate), not a security boundary.
 */
export default function AgeGate({ from }: { from: string }) {
  const dest = safeFrom(from);

  function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `bz_adult=1; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax${secure}`;
    window.location.assign(dest);
  }

  return (
    <div className="age-gate" role="dialog" aria-modal="true" aria-labelledby="age-gate-title">
      <div className="age-gate-card">
        <p className="age-gate-brand">Botchelor</p>
        <h1 id="age-gate-title">Are you 18 or older?</h1>
        <p>
          Botchelor is a comedic blind-date show starring <strong>fictional adult characters</strong>, written by AI.
          It is for <strong>adults (18+) only</strong>.
        </p>
        <form action="/api/age" method="post" className="age-gate-actions" onSubmit={confirm}>
          <input type="hidden" name="from" value={dest} />
          <button type="submit" className="age-gate-enter">
            Yes — I&apos;m 18 or older, enter
          </button>
          <a className="age-gate-leave" href="https://www.google.com" rel="noopener noreferrer">
            No — take me away
          </a>
        </form>
        <p className="age-gate-fine">
          By entering you confirm you are 18 or older and agree that everything here is fiction. We remember your answer
          on this device so you won&apos;t be asked again.
        </p>
      </div>
    </div>
  );
}
