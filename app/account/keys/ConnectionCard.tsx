import type { ReactNode } from "react";
import type { PlainError } from "@/lib/connections-shared";
import ProviderMark from "./ProviderMark";

/**
 * How a card reads at a glance (docs/PRDs/connections.md "Card states"): no key of yours, working, being checked, needs
 * attention, at its cap or on the free model meanwhile (amber), or paused (admin: a provider cooling down).
 */
export type CardTone = "unset" | "ok" | "checking" | "error" | "warn" | "paused";

/**
 * One connection's card, the way Zapier and Raycast show a connection: the provider's mark, what it's for, a pill with
 * its state, one status line, its key's last four and when it was checked and last used, and what went wrong in plain
 * words with the fix. The Connections page (one per job) and the admin's After Dark providers view both use it. No
 * hooks, so a server page can render it as it is.
 */
export default function ConnectionCard({
  id,
  title,
  subtitle,
  provider,
  tone,
  pill,
  status,
  meta = [],
  error = null,
  meter = null,
  children,
}: {
  id: string;
  title: string;
  subtitle?: ReactNode;
  provider: string | null;
  tone: CardTone;
  pill: string;
  status?: ReactNode;
  meta?: string[];
  error?: PlainError | null;
  /** M3: this month's spend against the cap ("$8.10 of $10 this month"), drawn as a bar; amber past 80%, full at the cap. */
  meter?: { spent: number; cap: number; level: "ok" | "warn" | "over"; label: string } | null;
  children?: ReactNode;
}) {
  return (
    <section className={`card connection-card tone-${tone}`} id={id} aria-labelledby={`${id}-title`}>
      <header className="connection-head">
        <ProviderMark provider={provider} />
        <div className="connection-titles">
          <h2 id={`${id}-title`}>{title}</h2>
          {subtitle ? <p className="muted small">{subtitle}</p> : null}
        </div>
        <span className={`connection-pill tone-${tone}`}>{pill}</span>
      </header>
      {status ? <p className="connection-status">{status}</p> : null}
      {meta.length > 0 && <p className="connection-meta muted small">{meta.join(" · ")}</p>}
      {meter && (
        <div
          className={`usage-meter level-${meter.level}`}
          role="meter"
          aria-label="This month's spend against the cap"
          aria-valuemin={0}
          aria-valuemax={meter.cap}
          aria-valuenow={Math.min(meter.spent, meter.cap)}
          aria-valuetext={meter.label}
        >
          <span style={{ width: `${Math.min(100, Math.round((meter.spent / meter.cap) * 100))}%` }} />
        </div>
      )}
      {error && (
        <p className="connection-error" role="status">
          {error.message}
          {error.fix &&
            (error.fix.href ? (
              <>
                {" "}
                →{" "}
                <a href={error.fix.href} target="_blank" rel="noopener noreferrer">
                  {error.fix.label}
                </a>
              </>
            ) : (
              <> → {error.fix.label}</>
            ))}
        </p>
      )}
      {children}
    </section>
  );
}
