"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { requestJson } from "../request";

/** Where the Signed-in card's line and /contact point (#delete-account), which opens the fold. */
export const DELETE_ACCOUNT_ID = "delete-account";
/** The word typed to unlock the button. Case doesn't matter: a phone capitalises the first letter. */
export const DELETE_WORD = "DELETE";
export const deleteWordTyped = (typed: string): boolean => typed.trim().toUpperCase() === DELETE_WORD;

/**
 * Delete the account (DELETE /api/me, lib/account.ts deleteAccount), folded at the foot of /account: housekeeping stays out
 * of the way of the page's real jobs. Opened, it says what goes and what stays the way deleteAccount does it, and the
 * button unlocks once DELETE is typed. A plan Stripe still renews is said before anyone starts (`plan`, from the page),
 * and again if the server answers plan_renews (409): deleting doesn't stop Stripe's charges, so it's cancel first, or
 * delete anyway on purpose. Done, it signs out (a fresh anonymous identity, as Sign out does) and goes home.
 */
export default function DeleteAccount({ plan = "none", portal = null }: { /** The Companion Plan's state (lib/paid-plans.ts planState). */ plan?: "none" | "active" | "cancelled" | "lapsed"; /** Stripe's billing portal (lib/paid-plans.ts portalLink). */ portal?: string | null }) {
  const fold = useRef<HTMLDetailsElement>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The server's word that a plan still renews: then the button becomes "Delete anyway".
  const [renews, setRenews] = useState<{ manage: string | null } | null>(null);

  // Arriving at /account#delete-account, or following that link on the page: open the fold and bring it into view.
  useEffect(() => {
    const openOnHash = () => {
      if (window.location.hash !== `#${DELETE_ACCOUNT_ID}` || !fold.current) return;
      fold.current.open = true;
      fold.current.scrollIntoView?.({ block: "start" });
    };
    openOnHash();
    window.addEventListener("hashchange", openOnHash);
    return () => window.removeEventListener("hashchange", openOnHash);
  }, []);

  async function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deleteWordTyped(typed) || busy) return;
    setBusy(true);
    setError(null);
    const r = await requestJson("/api/me", renews ? { confirm: true, plan_renews: true } : { confirm: true }, "DELETE").catch(() => null);
    if (r?.ok) {
      setDone(true);
      // The account is gone; the cookie still names it. Sign out for a fresh anonymous identity, then home, drawn anew.
      await requestJson("/api/auth/logout").catch(() => {});
      window.location.assign("/");
      return;
    }
    setBusy(false);
    if (r?.data.error === "plan_renews") {
      setRenews({ manage: typeof r.data.manage === "string" ? r.data.manage : portal });
      return;
    }
    setError(r ? `${r.message} Nothing was deleted.` : "Network error. Nothing was deleted: try again.");
  }

  const cancelAt = renews?.manage ?? portal;
  const planWarning = renews !== null || plan === "active";
  return (
    <details ref={fold} className="ux-fold account-delete" id={DELETE_ACCOUNT_ID}>
      <summary>Delete my account</summary>
      <div className="account-delete-body">
        <p>This deletes your account and what&apos;s kept under it, for good. There&apos;s no undo.</p>
        <ul>
          <li>
            <strong>Goes:</strong> your sign-in, the characters that never went on a date (with their pictures), your companion
            conversations with what each companion remembers and your call records, the endings you called, your votes, points
            and badges, and your settings.
          </li>
          <li>
            <strong>Stays, without you:</strong> the dates your characters went on, since they belong to the other side too. Those
            characters keep their public card there with no owner, closed to new dates; everything private about them goes.
            {plan !== "none" && " Your Companion Plan's billing record (the plan and the address you paid with, nothing you said) is kept while Stripe may still charge it."}
          </li>
          <li>
            <strong>Not refunded:</strong> dates you bought and haven&apos;t used go with the account. For a refund, ask us first (
            <Link href="/terms#refunds">refunds</Link>).
          </li>
        </ul>
        <p className="muted small">
          Want a copy first? <a href="/api/me/export">Download your data</a>.
        </p>
        {planWarning && (
          <p className="notice" role={renews ? "alert" : undefined} data-plan-renews>
            Your Companion Plan still renews, and deleting your account doesn&apos;t stop Stripe&apos;s charges. Cancel it first
            {cancelAt ? (
              <>
                {" "}
                in{" "}
                <a href={cancelAt} rel="noopener">
                  Stripe&apos;s billing portal
                </a>
              </>
            ) : (
              <>, with the link in Stripe&apos;s receipt email</>
            )}
            {renews ? ", or delete anyway below." : "."}
          </p>
        )}
        <form onSubmit={remove}>
          <label>
            Type {DELETE_WORD} to confirm
            <input
              type="text"
              name="confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              disabled={busy || done}
            />
          </label>
          <button type="submit" className="button-danger" disabled={!deleteWordTyped(typed) || busy || done}>
            {done ? "Deleted. Going home…" : busy ? "Deleting…" : renews ? "Delete anyway" : "Delete my account for good"}
          </button>
        </form>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
