"use client";

import { useRef, type FormEvent } from "react";
import { useOverlay } from "./useOverlay";
import Avatar from "./Avatar";
import { ADULT_COOKIE, ADULT_COOKIE_MAX_AGE, safeFrom } from "@/lib/age";

/** One of the pair on the card: enough to draw their face. */
export type GateFace = { id: string; name: string; hue: number | null; portrait: string | null; house: boolean };
/** The date drawn behind the gate (app/gate/page.tsx), shown on the card: both faces, "A × B" and its title. */
export type GatePair = { a: GateFace; b: GateFace; title: string | null; target: boolean };

/**
 * The 18+ entry lock: a full-screen overlay covering the page until the visitor confirms they're an adult.
 * Progressive enhancement — the plain form posts to /api/age and works with JavaScript off; with JS, it sets
 * the remembered cookie and navigates straight back, so there's no redirect round-trip. "Leave" sends anyone
 * under 18 away. A self-attestation (the standard age gate), not a security boundary.
 *
 * Since the PG show opened without it (2026-11-14, proxy.ts UNGATED_*), the gate meets visitors on their way to
 * swiping, matches, companions, the shop and the like, so it sells (2026-11-14 design audit): the date behind it at the
 * top of the card (both faces, "A × B", its title) and one line on what the show is, before the question. After Dark's
 * gate keeps its own words and never shows the show's pair. On a phone the card is a bottom sheet, the show above it.
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
  /** The date behind the gate, on the card; `target` when it's the date their link was for ("One tap from"). */
  behind?: GatePair | null;
  /** After Dark's own host: its own words, saying plainly that it's explicit (2026-11-07 audit, item 21). */
  afterDark?: boolean;
}) {
  const dest = safeFrom(from);
  // The show's pair only: After Dark asks in its own words, with nothing of the show on its card.
  const pair = afterDark ? null : behind;
  // The site header stays sharp above a blurred page: while the question is up everything outside it is inert (Tab stays
  // in the card, the ☰ can't be used to slip past) and the page doesn't scroll (2026-11-20 mobile audit, A8). Nothing
  // closes it but an answer.
  const gate = useRef<HTMLDivElement>(null);
  useOverlay(true, { root: gate, outside: false });

  function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    // The same name and life as the server's (lib/age.ts adultCookie); a script can't set HttpOnly, which is the one difference.
    document.cookie = `${ADULT_COOKIE}=1; Path=/; Max-Age=${ADULT_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
    window.location.assign(dest);
  }

  return (
    <div ref={gate} className={`age-gate${backdrop ? " has-backdrop" : ""}`} role="dialog" aria-modal="true" aria-labelledby="age-gate-title">
      <div className="age-gate-card">
        {pair && (
          <div className="age-gate-pair">
            <span className="age-gate-faces" aria-hidden="true">
              <Avatar seed={pair.a.id} name={pair.a.name} hue={pair.a.hue} house={pair.a.house} portraitSrc={pair.a.portrait} size={64} decorative round />
              <Avatar seed={pair.b.id} name={pair.b.name} hue={pair.b.hue} house={pair.b.house} portraitSrc={pair.b.portrait} size={64} decorative round />
            </span>
            <p className="age-gate-pair-names">
              {pair.target ? <>🎬 One tap from </> : null}
              <strong>{`${pair.a.name} × ${pair.b.name}`}</strong>
            </p>
            {pair.title && <p className="age-gate-pair-title">“{pair.title}”</p>}
          </div>
        )}
        <p className="age-gate-brand">{afterDark ? "Botchelor After Dark" : "Botchelor"}</p>
        {/* What it is, before the question (the 2026-11-14 design audit): the same sentence as before, moved above it. */}
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
        <h1 id="age-gate-title">Are you 18 or older?</h1>
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
