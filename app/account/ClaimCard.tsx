"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";

export type ClaimCardProps = { names: string[]; dates: number; conversations: number; pictures: number };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Nell", "Nell and Sable", "Nell, Sable and 3 more". */
export function namesLine(names: string[]): string {
  if (names.length <= 2) return names.join(" and ");
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/** What comes with the characters, in words: only the kinds there are any of. */
export function comesWith(p: Pick<ClaimCardProps, "dates" | "conversations" | "pictures">): string {
  const parts = [p.dates ? plural(p.dates, "date") : "", p.conversations ? plural(p.conversations, "conversation") : "", p.pictures ? plural(p.pictures, "Studio picture") : ""].filter(Boolean);
  if (!parts.length) return "";
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * The one-time offer after signing in from a browser that had made characters without an account
 * (lib/account-claim.ts). Nothing moves until the button is pressed; "Not now" drops the offer. Which identity is
 * meant is in a cookie this page can't read: the buttons send no id. Once they are in, the page loads again with a
 * line saying so (app/account/page.tsx, ?claimed=).
 */
export default function ClaimCard({ names, dates, conversations, pictures }: ClaimCardProps) {
  const [state, setState] = useState<"offer" | "busy" | "gone">("offer");
  const [error, setError] = useState<string | null>(null);
  const n = names.length;
  const them = n === 1 ? names[0] : "them";
  const withThem = comesWith({ dates, conversations, pictures });

  if (state === "gone") return null;

  const answer = async (body: { confirm: true } | { decline: true }) => {
    setState("busy");
    setError(null);
    const res = await requestJson("/api/me/claim", body).catch(() => null);
    if ("decline" in body) {
      setState("gone");
      return;
    }
    if (res?.ok) {
      // The whole page again: the account's lists are read when it loads, and the notice at the top says what came in.
      window.location.assign(`/account?claimed=${Number(res.data.characters) || n}`);
      return;
    }
    setError(res?.message ?? "That didn't go through, and nothing was moved. Try again.");
    setState("offer");
  };

  return (
    <section className="card" data-claim-card>
      <h2>You made {plural(n, "character")} before signing in</h2>
      <p>
        {namesLine(names)}
        {withThem ? `, with ${withThem}` : ""}. Bring {them} into this account?
      </p>
      <p className="muted small">Votes, predictions and free dates stay where they were, so nothing is counted twice. This offer lasts half an hour and is made once.</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="account-actions">
        <button type="button" disabled={state === "busy"} onClick={() => answer({ confirm: true })}>
          {state === "busy" ? "Bringing them in…" : n === 1 ? `Bring ${names[0]} in` : "Bring them in"}
        </button>
        <button type="button" className="button-ghost" disabled={state === "busy"} onClick={() => answer({ decline: true })}>
          Not now
        </button>
      </div>
    </section>
  );
}
