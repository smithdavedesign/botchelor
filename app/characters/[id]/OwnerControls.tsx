"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { requestJson } from "../../request";

type Props = {
  id: string;
  name: string;
  /** Whether other creators (people or agents) may ask this character out by name. */
  openToDates: boolean;
};

type Message = { text: string; error?: boolean };

/**
 * Owner-only controls on a character's card: the full editor (every field, /characters/[id]/edit), the
 * open-to-dates switch, Pro portrait generation on the owner's own key, and delete. Clips show as "coming soon"
 * while they move to a new video model (OpenAI retired Sora 2: lib/image.ts CLIPS_RETIRED).
 */
export default function OwnerControls(props: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [openToDates, setOpenToDates] = useState(props.openToDates);

  async function toggleOpenToDates() {
    const next = !openToDates;
    setOpenToDates(next);
    setBusy(true);
    const { ok } = await requestJson(`/api/characters/${props.id}`, { open_to_dates: next }, "PATCH").catch(() => ({ ok: false }));
    setBusy(false);
    if (ok) router.refresh();
    else setOpenToDates(!next);
  }

  async function generatePortrait() {
    setBusy(true);
    setMessage({ text: "Generating a portrait on your key…" });
    const { ok, status, message } = await requestJson(`/api/characters/${props.id}/portrait`, {}, "POST").catch(() => ({ ok: false, status: 0, message: "Network error." }));
    setBusy(false);
    if (ok) {
      setMessage(null);
      router.refresh();
    } else if (status === 400) {
      setMessage({ text: "Add an OpenAI image key on your account first.", error: true });
    } else {
      setMessage({ text: message, error: true });
    }
  }

  async function remove() {
    if (!confirm(`Delete ${props.name}? This can't be undone. If they've already aired in an episode, that episode stays but is no longer yours.`)) return;
    setBusy(true);
    const { ok } = await requestJson(`/api/characters/${props.id}`, {}, "DELETE").catch(() => ({ ok: false }));
    setBusy(false);
    if (ok) router.push("/account");
  }

  return (
    <section className="card owner-controls" aria-label={`Your character: ${props.name}`} aria-busy={busy}>
      <div className="owner-head">
        <p className="muted">This is your character.</p>
        <Link className="button" href={`/characters/${props.id}/edit`}>
          ✏️ Edit {props.name.split(" ")[0]}
        </Link>
      </div>
      <p className="muted small">
        Change anything — name, sheet, voice, look, details, private soul. What they&apos;ve learned from their dates stays.
      </p>
      <p className="muted small">
        {openToDates ? "💌 Open to dates: other creators (people and AI agents) can ask them out by name." : "Only on blind dates for now."}{" "}
        <button type="button" className="link-button" onClick={toggleOpenToDates} disabled={busy} aria-pressed={openToDates}>
          {openToDates ? "Close to dates" : "Open to dates"}
        </button>
      </p>
      <div className="owner-actions">
        <span className="pro-tag">✨ Pro</span>
        <ul className="owner-action-list">
          <li>
            <button type="button" className="link-button" onClick={generatePortrait} disabled={busy}>
              Generate a portrait
            </button>{" "}
            <span className="owner-hint">(on your own key)</span>
          </li>
          <li>
            {/* Clips paused while they move to a new video model (lib/image.ts CLIPS_RETIRED). */}
            <button type="button" className="link-button" disabled aria-describedby="clip-soon" title="OpenAI retired the video model clips ran on; they're moving to a new one.">
              Generate a clip
            </button>{" "}
            <span id="clip-soon" className="badge">Coming soon</span>
          </li>
        </ul>
      </div>
      <div className="owner-danger">
        <button type="button" className="link-button danger" onClick={remove} disabled={busy}>
          Delete
        </button>
      </div>
      <p className={message?.error ? "owner-message error" : "owner-message muted small"} role="status" aria-live="polite">
        {message?.text}
      </p>
    </section>
  );
}
