"use client";

import { useEffect, useState } from "react";

/**
 * How many of people's notes nobody has looked at yet (lib/user-feedback.ts newUserFeedbackCount), beside the link on
 * /admin. Asks with the saved admin password, or as a signed-in admin account; shows nothing to anyone else.
 */
export default function NewFeedbackCount() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    let key = "";
    try {
      key = localStorage.getItem("bz_frontier") ?? "";
    } catch {
      /* private mode: an admin account still works */
    }
    fetch("/api/admin/feedback/people?count=1", { headers: key ? { "x-frontier-key": key } : {} })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { new_count?: number } | null) => setCount(typeof body?.new_count === "number" ? body.new_count : null))
      .catch(() => {});
  }, []);

  if (count === null) return null;
  return count > 0 ? <span className="badge">{count} new</span> : <span className="muted small">(nothing new)</span>;
}
