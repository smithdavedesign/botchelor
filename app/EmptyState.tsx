import Link from "next/link";
import type { ReactNode } from "react";

type Action = { href: string; label: string };

/**
 * An empty list that says what to do next (UX round B, 2026-11-07): an emoji, one line on why it's empty, one clear
 * action and, at most, one other way on. Every empty list should end in a step, never a dead end.
 */
export default function EmptyState({
  emoji,
  title,
  children,
  action,
  secondary,
}: {
  emoji: string;
  title: string;
  children?: ReactNode;
  action?: Action | ReactNode;
  secondary?: Action;
}) {
  const isAction = (a: unknown): a is Action => typeof a === "object" && a !== null && "href" in a && "label" in a;
  return (
    <div className="empty-state">
      <span className="empty-state-emoji" aria-hidden="true">
        {emoji}
      </span>
      <p className="empty-state-title">{title}</p>
      {children && <p className="muted small empty-state-body">{children}</p>}
      {(action || secondary) && (
        <p className="empty-state-actions">
          {isAction(action) ? (
            <Link className="button small" href={action.href}>
              {action.label}
            </Link>
          ) : (
            action
          )}
          {secondary && (
            <Link className="button-ghost small" href={secondary.href}>
              {secondary.label}
            </Link>
          )}
        </p>
      )}
    </div>
  );
}
