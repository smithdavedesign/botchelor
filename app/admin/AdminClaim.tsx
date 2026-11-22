"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Mark this account as the show's admin (skips the clip paywall, opens the admin pages). Needs the admin password once:
 * typed here and sent with that one request, never kept. Shows nothing to a visitor who isn't signed in.
 */
export default function AdminClaim() {
  const [state, setState] = useState<{
    admin: boolean;
    signed_in: boolean;
  } | null>(null);
  const [password, setPassword] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [topUp, setTopUp] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function grant() {
    setBusy(true);
    setTopUp(null);
    const res = await fetch("/api/admin/tokens", { method: "POST" }).catch(
      () => null,
    );
    const data = res?.ok
      ? ((await res.json()) as {
          granted: number;
          allowance: { free_left: number; pack_left: number };
        })
      : null;
    setBusy(false);
    setTopUp(
      data
        ? `Added ${data.granted}. You have ${data.allowance.free_left + data.allowance.pack_left} tokens now.`
        : "Couldn't add them. Try again.",
    );
    router.refresh(); // the token meter in the nav
  }

  const load = () =>
    fetch("/api/admin/claim")
      .then((r) => r.json())
      .then(setState)
      .catch(() => setState(null));
  useEffect(() => {
    void load();
  }, []);

  async function claim(method: "POST" | "DELETE") {
    setNote(null);
    const res = await fetch("/api/admin/claim", {
      method,
      headers: method === "POST" ? { "x-frontier-key": password } : {},
    }).catch(() => null);
    if (!res?.ok)
      setNote(
        res?.status === 403
          ? "That isn't the admin password."
          : res?.status === 401
            ? "Sign in first: an admin is an account."
            : "Couldn't change it. Try again.",
      );
    setPassword("");
    await load();
    // The admin pages ask the server who's an admin (./signed-in-admin.ts): let them ask again.
    if (res?.ok) router.refresh();
  }

  if (!state || (!state.admin && !state.signed_in)) return null;
  return (
    <section className="card">
      <h2>Admin on this account</h2>
      {state.admin ? (
        <>
          <p>
            ✓ This account is an admin: intro clips cost you no tokens (they
            still run on your own Google key).{" "}
            <button
              type="button"
              className="link-button"
              onClick={() => void claim("DELETE")}
            >
              Stop being admin
            </button>
          </p>
          <p>
            <button type="button" onClick={() => void grant()} disabled={busy}>
              {busy ? "Adding…" : "Add 20 free tokens"}
            </button>{" "}
            <span className="muted small">
              For testing: free dates on this account, never an order or
              revenue.
            </span>
            {topUp && (
              <span className="muted small" role="status">
                {" "}
                {topUp}
              </span>
            )}
          </p>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void claim("POST");
          }}
        >
          <p className="muted small">
            Enter the admin password once to make this account an admin (no clip
            paywall).
          </p>
          <label>
            Admin password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="off"
            />
          </label>
          <button type="submit">Make this account an admin</button>
        </form>
      )}
      {note && <p className="error">{note}</p>}
    </section>
  );
}
