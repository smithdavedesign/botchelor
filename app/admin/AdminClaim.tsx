"use client";

import { useEffect, useState } from "react";

/** Mark this account as the show's admin (skips the clip paywall). Needs the admin password once. */
export default function AdminClaim() {
  const [state, setState] = useState<{ admin: boolean; signed_in: boolean } | null>(null);
  const [password, setPassword] = useState("");
  const [note, setNote] = useState<string | null>(null);

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
    const res = await fetch("/api/admin/claim", { method, headers: method === "POST" ? { "x-frontier-key": password } : {} }).catch(() => null);
    if (!res?.ok) setNote(res?.status === 403 ? "That isn't the admin password." : "Couldn't change it. Try again.");
    setPassword("");
    await load();
  }

  if (!state) return null;
  return (
    <section className="card">
      <h2>Admin on this account</h2>
      {state.admin ? (
        <p>
          ✓ This account is an admin: intro clips cost you no tokens (they still run on your own Google key).{" "}
          <button type="button" className="link-button" onClick={() => void claim("DELETE")}>
            Stop being admin
          </button>
        </p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void claim("POST");
          }}
        >
          <p className="muted small">
            Enter the admin password once to make this account an admin (no clip paywall).
            {!state.signed_in && " Sign in first so it follows you to every device."}
          </p>
          <label>
            Admin password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="off" />
          </label>
          <button type="submit">Make this account an admin</button>
        </form>
      )}
      {note && <p className="error">{note}</p>}
    </section>
  );
}
