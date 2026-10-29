"use client";

import { useState } from "react";
import { requestJson } from "@/app/request";
import { CONTENT_REPORT_CATEGORIES } from "@/lib/content-reports-shared";

const LABEL: Record<(typeof CONTENT_REPORT_CATEGORIES)[number], string> = {
  minor: "Looks like someone under 18",
  real_person: "A real person",
  non_consent: "Used without its owner's say",
  intimate_image: "A real intimate image",
  copyright: "My copyright",
  other: "Something else",
};

/** Report a showcase post (lib/showcase-moderation.ts): a serious report takes it out of sight until an admin looks. */
export default function ReportPost({ postId }: { postId: string }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<(typeof CONTENT_REPORT_CATEGORIES)[number]>("other");
  const [details, setDetails] = useState("");
  const [done, setDone] = useState<string | null>(null);
  async function send() {
    const res = await requestJson(`/api/showcase/posts/${postId}/report`, { category, details: details || null }).catch(() => null);
    setDone(res?.ok ? `Thanks: it's with the moderators${res.data.held ? ", and it's out of sight until they look" : ""}. ${String(res.data.promise ?? "")}` : "That didn't go through. Try /report instead.");
  }
  if (done) return <p className="muted small" role="status">{done}</p>;
  if (!open)
    return (
      <button type="button" className="linklike small" onClick={() => setOpen(true)}>
        Report
      </button>
    );
  return (
    <fieldset className="showcase-form">
      <legend className="small">What's wrong?</legend>
      <select value={category} onChange={(e) => setCategory(e.target.value as typeof category)} aria-label="What's wrong">
        {CONTENT_REPORT_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {LABEL[c]}
          </option>
        ))}
      </select>
      <textarea rows={2} maxLength={2000} placeholder="Anything that helps (optional)" value={details} onChange={(e) => setDetails(e.target.value)} aria-label="Details" />
      <button type="button" className="primary small" onClick={() => void send()}>
        Send the report
      </button>
    </fieldset>
  );
}
