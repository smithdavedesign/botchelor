"use client";

import Link from "next/link";
import { useState } from "react";
import { saveConsent } from "@/lib/consent";

/** Asks visitors in consent regions before Google Analytics may set cookies (lib/consent.ts). */
export default function ConsentBanner() {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  const choose = (granted: boolean) => {
    saveConsent(granted);
    setOpen(false);
  };
  return (
    <div className="consent-banner" role="region" aria-label="Cookie choice">
      <p>
        May we use Google Analytics cookies to see which pages people use? Nothing you type is ever sent.{" "}
        <Link href="/privacy">Privacy</Link>
      </p>
      <div className="consent-actions">
        <button type="button" className="secondary small" onClick={() => choose(false)}>
          No thanks
        </button>
        <button type="button" className="small" onClick={() => choose(true)}>
          Allow
        </button>
      </div>
    </div>
  );
}

/** The privacy page's switch, so anyone (in any region) can change their choice later. */
export function ConsentChoice() {
  const [saved, setSaved] = useState<string | null>(null);
  const choose = (granted: boolean) => {
    saveConsent(granted);
    setSaved(granted ? "Analytics cookies allowed." : "Analytics cookies turned off.");
  };
  return (
    <div className="consent-actions">
      <button type="button" className="secondary small" onClick={() => choose(false)}>
        Turn off analytics cookies
      </button>
      <button type="button" className="small" onClick={() => choose(true)}>
        Allow analytics cookies
      </button>
      {saved && <span role="status">{saved}</span>}
    </div>
  );
}
