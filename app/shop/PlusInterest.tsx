"use client";

import { useEffect, useState, type FormEvent } from "react";
import { queueEvent } from "@/app/engagement";
import { requestJson } from "@/app/request";
import { PLUS_PITCH, type PlusPlace } from "@/lib/plus-interest";

const STORAGE_KEY = "bz_plus_interest";

/** Whether this browser already tapped the tile (a per-viewer convenience: the server has the row). */
function remembered(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The "Botchelor Plus" intent tile (lib/plus-interest.ts): what the plan would be, that it doesn't exist yet, and one
 * button, "Tell me when it opens", which becomes "We'll tell you" once tapped. With the Sunday letter open, an optional
 * email goes on the letter's list (the letter is how the news would reach them), with the letter's own 18+ box. Nothing
 * is charged; the tile is a $0 demand test. `compact`: the version inside the out-of-dates wall.
 */
export default function PlusInterest({ place, newsletter, compact = false }: { place: PlusPlace; newsletter: boolean; compact?: boolean }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [withEmail, setWithEmail] = useState(false);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (remembered()) setState("done");
  }, []);

  async function tell(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const address = String(form.get("email") ?? "").trim();
    setState("busy");
    setError(null);
    try {
      const { status, message } = await requestJson("/api/plus-interest", { place, email: address, attest: form.get("attest") === "on" });
      if (status === 201) {
        queueEvent("plus_interest", { place, with_email: address !== "" });
        setWithEmail(address !== "");
        setState("done");
        try {
          localStorage.setItem(STORAGE_KEY, "1");
        } catch {
          /* a private window: the button still changes for this page */
        }
        return;
      }
      setError(message);
    } catch {
      setError("Network error. Try again.");
    }
    setState("idle");
  }

  const id = `plus-${place}`;
  return (
    <div className={compact ? "plus-tile is-compact" : "plus-tile"} data-plus-interest={place}>
      <p className="plus-tile-head">
        <strong>{PLUS_PITCH.name}</strong> <span className="badge">coming</span>
      </p>
      <p className="plus-tile-what">
        {PLUS_PITCH.price}: {PLUS_PITCH.gives.join(", ")}.
      </p>
      <p className="muted small">{PLUS_PITCH.honest}</p>
      {state === "done" ? (
        <p className="notice plus-tile-done" role="status">
          We&apos;ll tell you.{withEmail && " Check your inbox: the email we sent has the link that confirms your address."}
        </p>
      ) : (
        <form className="plus-tile-form" onSubmit={tell}>
          {newsletter && (
            <>
              <label htmlFor={`${id}-email`} className="small">
                Your email <span className="muted">(optional: it goes on the Sunday letter&apos;s list, confirmed by a click, and that letter is how we&apos;d tell you)</span>
              </label>
              <input id={`${id}-email`} type="email" name="email" maxLength={254} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              {email.trim() !== "" && (
                <label className="check">
                  <input type="checkbox" name="attest" required />
                  <span>I&apos;m 18 or older.</span>
                </label>
              )}
            </>
          )}
          <button type="submit" className="secondary" disabled={state === "busy"} data-track="plus-interest">
            {state === "busy" ? "Noting…" : "Tell me when it opens"}
          </button>
          {error && (
            <p className="error small" role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
