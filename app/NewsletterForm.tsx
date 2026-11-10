"use client";

import { useState, type FormEvent } from "react";
import { trackConversion } from "./conversion";
import { requestJson } from "./request";

/**
 * The Sunday letter's sign-up (lib/newsletter.ts): an address and the 18+ box, in the site footer and on /newsletter.
 * The answer is the same whether the address was new or already on the list, so all it ever says is to check the inbox.
 */
export default function NewsletterForm({ place }: { place: "footer" | "page" }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setState("busy");
    setError(null);
    try {
      const { status, message } = await requestJson("/api/newsletter", { email: String(form.get("email") ?? ""), attest: form.get("attest") === "on" });
      if (status === 201) {
        trackConversion("newsletter_signup", { place });
        setState("done");
        return;
      }
      setError(message);
    } catch {
      setError("Network error. Try again.");
    }
    setState("idle");
  }

  if (state === "done") {
    return (
      <p className="notice newsletter-done" role="status">
        Check your inbox: the letter starts once you click the link in our email. Nothing comes until you do.
      </p>
    );
  }

  const id = `newsletter-${place}`;
  return (
    <form className={`newsletter-form newsletter-form-${place}`} onSubmit={submit}>
      <label htmlFor={`${id}-email`} className={place === "footer" ? "sr-only" : undefined}>
        Email
      </label>
      <div className="newsletter-row">
        <input id={`${id}-email`} type="email" name="email" required maxLength={254} autoComplete="email" placeholder={place === "footer" ? "Your email" : undefined} />
        <button type="submit" className={place === "footer" ? "secondary" : undefined} disabled={state === "busy"}>
          {state === "busy" ? "Signing up…" : "Sign up"}
        </button>
      </div>
      <label className="check">
        <input type="checkbox" name="attest" required />
        <span>I&apos;m 18 or older.</span>
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
