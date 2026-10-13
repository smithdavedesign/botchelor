"use client";

import { useEffect, useState } from "react";

/** A copyable absolute link to one of the app's own pages (episode share links, league invites). */
export default function ShareLink({ path, label = "Link" }: { path: string; label?: string }) {
  const [url, setUrl] = useState(path);
  const [copied, setCopied] = useState(false);
  useEffect(() => setUrl(window.location.origin + path), [path]);
  return (
    <div className="share">
      <input type="text" readOnly value={url} aria-label={label} onFocus={(e) => e.currentTarget.select()} />
      <button
        type="button"
        className="secondary"
        onClick={async () => {
          await navigator.clipboard?.writeText(url);
          setCopied(true);
        }}
      >
        {copied ? "Copied" : "Copy link"}
      </button>
    </div>
  );
}
