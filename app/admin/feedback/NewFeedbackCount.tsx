"use client";

import { useEffect, useState } from "react";
import { okJson } from "@/lib/ok-json";

/**
 * How many of people's notes nobody has looked at yet (lib/user-feedback.ts newUserFeedbackCount), beside the link on
 * /admin. Asks as a signed-in admin account (lib/admin-auth.ts); shows nothing to anyone else.
 */
export default function NewFeedbackCount() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/admin/feedback/people?count=1")
      .then(okJson)
      .then((body: { new_count?: number } | null) => setCount(typeof body?.new_count === "number" ? body.new_count : null))
      .catch(() => {});
  }, []);

  if (count === null) return null;
  return count > 0 ? <span className="badge">{count} new</span> : <span className="muted small">(nothing new)</span>;
}
