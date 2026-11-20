"use client";

import { createContext, useContext } from "react";

/**
 * The builder's issues by input (app/create/sheet-issues.ts FieldPlace.key → what to say), handed down so every step's
 * inputs can mark themselves without threading a prop through each step component.
 */
export const IssueContext = createContext<ReadonlyMap<string, string>>(new Map());

/** The issue lookup for this form: `issue(key)` is the message for that input, or undefined. */
export function useIssues(): (key: string) => string | undefined {
  const issues = useContext(IssueContext);
  return (key) => issues.get(key);
}

/** The attributes an input carries when it has an issue: marked invalid, and described by the message under it. */
export function invalidProps(message: string | undefined, key: string): { "aria-invalid"?: true; "aria-describedby"?: string } {
  return message ? { "aria-invalid": true, "aria-describedby": `issue-${key}` } : {};
}

/**
 * The message under an input that won't pass the show's check (nothing when it passes). Hidden from the accessibility
 * tree on its own: it often sits inside the input's <label>, and would become part of the input's name; the input reads it
 * as its description instead (invalidProps' aria-describedby).
 */
export function FieldIssue({ k }: { k: string }) {
  const message = useContext(IssueContext).get(k);
  if (!message) return null;
  return (
    <span id={`issue-${k}`} className="field-issue" aria-hidden="true">
      {message}
    </span>
  );
}
