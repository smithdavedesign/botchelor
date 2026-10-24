"use client";

import type { CrisisResources } from "@/lib/crisis";

/** The resources from a reply (lib/crisis.ts `crisis_resources`), or null when there are none or they aren't shaped right. */
export function crisisFrom(data: unknown): CrisisResources | null {
  const c = (data as { crisis_resources?: unknown } | null)?.crisis_resources as CrisisResources | undefined;
  return c && typeof c.message === "string" && Array.isArray(c.lines) ? c : null;
}

/**
 * Shown when someone's own words read as wanting to hurt themselves (lib/crisis.ts, the self-harm protocol at /safety):
 * who to call or text, and that the characters are AI. Calm and dismissible; nothing else on the page changes.
 */
export default function CrisisNotice({ resources, onClose }: { resources: CrisisResources; onClose?: () => void }) {
  return (
    <aside className="crisis-notice" role="alert" aria-label="Help is available">
      <p>{resources.message}</p>
      <ul>
        {resources.lines.map((l) => (
          <li key={l.region}>
            <strong>{l.region}:</strong>{" "}
            <a href={l.href} target="_blank" rel="noopener noreferrer">
              {l.how}
            </a>
          </li>
        ))}
      </ul>
      <p className="muted small">
        If you&apos;re in danger right now, call your local emergency number. <a href={resources.protocol}>How we handle this</a>
        {onClose && (
          <>
            {" · "}
            <button type="button" className="button-ghost small" onClick={onClose}>
              Close
            </button>
          </>
        )}
      </p>
    </aside>
  );
}
