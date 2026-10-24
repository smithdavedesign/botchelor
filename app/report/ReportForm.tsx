"use client";

import { useId, useState, type FormEvent } from "react";
import {
  CONTENT_REPORT_CATEGORIES,
  CONTENT_REPORT_DETAILS_MAX,
  CONTENT_REPORT_EMAIL_MAX,
  CONTENT_REPORT_LABELS,
  CONTENT_REPORT_TARGET_MAX,
  type ContentReportCategory,
} from "@/lib/content-reports-shared";
import { requestJson } from "../request";

/** The complaint and takedown form (POST /api/content-reports). `what` prefills the link or id, e.g. from ?what=. */
export default function ReportForm({ what }: { what: string | null }) {
  const id = useId();
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [promise, setPromise] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setState("busy");
    setError(null);
    try {
      const { status, data, message } = await requestJson("/api/content-reports", {
        category: String(form.get("category") ?? "other") as ContentReportCategory,
        target: String(form.get("target") ?? ""),
        details: String(form.get("details") ?? ""),
        email: String(form.get("email") ?? ""),
        website: String(form.get("website") ?? ""),
      });
      if (status === 201) {
        setPromise(typeof data.promise === "string" ? data.promise : null);
        setState("done");
        return;
      }
      setError(message);
    } catch {
      setError("Network error. Try again, or email us.");
    }
    setState("idle");
  }

  if (state === "done") {
    return (
      <section className="card" role="status">
        <p className="notice">
          Thank you. We&apos;ve got your report and a person will look at it. We aim to act on it within{" "}
          {promise ?? "7 business days"}. If you left an email, we&apos;ll reply there.
        </p>
      </section>
    );
  }

  return (
    <form className="card" onSubmit={submit}>
      <label htmlFor={`${id}-category`}>Why are you reporting it?</label>
      <select id={`${id}-category`} name="category" required defaultValue="">
        <option value="" disabled>
          Pick one
        </option>
        {CONTENT_REPORT_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {CONTENT_REPORT_LABELS[c]}
          </option>
        ))}
      </select>

      <label htmlFor={`${id}-target`}>What is it? A link, or a character&apos;s or episode&apos;s name or id</label>
      <input id={`${id}-target`} name="target" type="text" maxLength={CONTENT_REPORT_TARGET_MAX} defaultValue={what ?? ""} />

      <label htmlFor={`${id}-details`}>What&apos;s wrong with it?</label>
      <textarea id={`${id}-details`} name="details" rows={5} maxLength={CONTENT_REPORT_DETAILS_MAX} />

      <label htmlFor={`${id}-email`}>
        Your email, if you&apos;d like a reply <span className="feedback-optional">Optional</span>
      </label>
      <input id={`${id}-email`} name="email" type="email" autoComplete="email" inputMode="email" maxLength={CONTENT_REPORT_EMAIL_MAX} />

      {/* The honeypot: hidden from people and screen readers, so only a script filling every box fills it. */}
      <div className="feedback-hp" aria-hidden="true">
        <label htmlFor={`${id}-website`}>Website</label>
        <input id={`${id}-website`} name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <p className="muted small">
        Give us a link or a few words, or both. We keep what you send, and your email only to reply.
      </p>
      <button type="submit" disabled={state === "busy"}>
        {state === "busy" ? "Sending…" : "Send the report"}
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
