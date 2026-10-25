"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { MediaRequest as Made } from "@/lib/adult/request-log";
import MediaTags from "./MediaTags";

/**
 * A media item's title that, for an admin, opens what made it: the prompt, the model and the request sent
 * (lib/adult/request-log.ts; David, 2026-10-24: "so we can track why it fails"). Hidden until the title is clicked;
 * for anyone else the title is just the title.
 */
/** Whether the viewer is an admin, for every MediaRequest under it (the scene page's gallery, reels and storyboard). */
export const MediaAdmin = createContext(false);

export function MediaRequest({ id, admin, children, className }: { id: string; admin?: boolean; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const inAdmin = useContext(MediaAdmin);
  if (!(admin ?? inAdmin)) return <span className={className}>{children}</span>;
  return (
    <>
      <button type="button" className={`linklike ad-request-title${className ? ` ${className}` : ""}`} onClick={() => setOpen(true)} title="What made it: the prompt and the request sent">
        {children}
      </button>
      {open && <RequestOverlay id={id} onClose={() => setOpen(false)} />}
    </>
  );
}

function RequestOverlay({ id, onClose }: { id: string; onClose: () => void }) {
  const [made, setMade] = useState<Made | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // The parent's handler changes with each of its renders (a gallery polls): only the id loads it again.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    let live = true;
    fetch(`/api/admin/after-dark/media/${encodeURIComponent(id)}/request`)
      .then(async (res) => {
        if (!live) return;
        if (!res.ok) return setError(res.status === 404 ? "Nothing kept for this one." : `It couldn't be loaded (${res.status}).`);
        setMade((await res.json()) as Made);
      })
      .catch(() => live && setError("That didn't reach the server."));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    window.addEventListener("keydown", onKey);
    return () => {
      live = false;
      window.removeEventListener("keydown", onKey);
    };
  }, [id]);

  const copy = () => {
    if (!made) return;
    void navigator.clipboard?.writeText(JSON.stringify(made, null, 2)).then(() => setCopied(true));
  };

  return (
    <div className="ad-request-backdrop" role="dialog" aria-modal="true" aria-label="What made it" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ad-request">
        <div className="ad-request-head">
          <strong>What made it</strong>
          <span className="small muted">{id}</span>
          <button type="button" className="button-ghost small" onClick={copy} disabled={!made}>
            {copied ? "Copied" : "Copy all"}
          </button>
          <button type="button" className="button-ghost small" onClick={onClose}>
            Close
          </button>
        </div>
        {error && <p className="small muted">{error}</p>}
        {!made && !error && <p className="small muted">Loading…</p>}
        {made && (
          <>
            <dl className="ad-request-facts small">
              <dt>Kind</dt>
              <dd>
                {made.kind} · {made.status}
              </dd>
              <dt>Model</dt>
              <dd>
                {made.model ?? "—"} · {made.provider ?? "—"}
                {made.fell_back ? " (fell back)" : ""}
              </dd>
              <dt>Made</dt>
              <dd>{new Date(made.created_at).toLocaleString()}</dd>
              {made.source_image && (
                <>
                  <dt>From</dt>
                  <dd>{made.source_image}</dd>
                </>
              )}
              {made.shoot?.error && (
                <>
                  <dt>Error</dt>
                  <dd>{made.shoot.error}</dd>
                </>
              )}
            </dl>
            <h3 className="small">Prompt</h3>
            <pre className="ad-request-pre">{made.prompt ?? "—"}</pre>
            <h3 className="small">Request sent</h3>
            {made.request?.length ? (
              made.request.map((r, i) => (
                <div key={i}>
                  <p className="small muted">POST {r.at}</p>
                  <pre className="ad-request-pre">{JSON.stringify(r.body, null, 2)}</pre>
                </div>
              ))
            ) : (
              <p className="small muted">Not kept: made before requests were kept (2026-10-24), or on a path that doesn't keep one.</p>
            )}
            <h3 className="small">What it shows</h3>
            <MediaTags id={made.id} />
            {made.shoot && (
              <>
                <h3 className="small">Studio shoot · {made.shoot.kind}</h3>
                <pre className="ad-request-pre">{JSON.stringify(made.shoot.choices, null, 2)}</pre>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
