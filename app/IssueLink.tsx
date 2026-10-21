"use client";

import { useEffect, useState } from "react";

const REPO = "https://github.com/smithdavedesign/botchelor";

/**
 * True in the admin's browser: the one holding the admin password, as /admin keeps it. The repo is private, so a GitHub
 * link would be a 404 for anyone else: they see the issue number and its status instead.
 */
function useAdminBrowser(): boolean {
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    try {
      setAdmin(Boolean(localStorage.getItem("bz_frontier")));
    } catch {
      /* storage blocked: not the admin's browser */
    }
  }, []);
  return admin;
}

/** One issue on GitHub, for the admin. */
export default function IssueLink({ issue }: { issue: number }) {
  if (!useAdminBrowser()) return null;
  return (
    <a className="issue-link" href={`${REPO}/issues/${issue}`} target="_blank" rel="noreferrer">
      #{issue} on GitHub ↗
    </a>
  );
}

/** Every agent-feedback issue, for the section's footer. */
export function IssuesLink() {
  if (!useAdminBrowser()) return null;
  return (
    <>
      {" "}
      · <a href={`${REPO}/issues?q=is%3Aissue+label%3Aagent-feedback`} target="_blank" rel="noreferrer">every gripe on GitHub ↗</a>
    </>
  );
}
