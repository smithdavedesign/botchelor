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
  /** Intro clips (Veo on the owner's Google key): whether they're an admin (no tokens), their bought tokens, and whether they have a Google key. */
  clip?: { admin: boolean; boughtTokens: number; hasKey: boolean; cost: number };
};

type Message = { text: string; error?: boolean; link?: { href: string; label: string } };

/**
 * Owner-only controls on a character's card: the full editor (every field, /characters/[id]/edit), the
 * open-to-dates switch, Pro portrait generation on the owner's own key, a 4-second intro clip (Veo on their own
 * Google key, behind the bought-token paywall unless they're an admin; lib/video.ts), and delete.
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

  async function generateClip() {
    setBusy(true);
    setMessage({ text: "Starting a clip on your Google key (Veo takes a minute or two)…" });
    const start = await requestJson(`/api/characters/${props.id}/clip`, {}, "POST").catch(() => ({ ok: false, status: 0, message: "Network error.", data: {} as Record<string, unknown> }));
    if (!start.ok) {
      setBusy(false);
      if (start.status === 402) setMessage({ text: start.message ?? "A clip costs bought tokens.", error: true, link: { href: "/shop", label: "Get tokens" } });
      else if (start.status === 400) setMessage({ text: start.message ?? "Add a Google key first.", error: true, link: { href: "/account", label: "Add a Google key" } });
      else setMessage({ text: start.message ?? "Google couldn't start the clip.", error: true });
      return;
    }
    // Poll until Google finishes (bounded), then show it. A render can take a couple of minutes.
    for (let i = 0; i < 45; i++) {
      await new Promise((r) => setTimeout(r, 6000));
      const res = await fetch(`/api/characters/${props.id}/clip`).then((r) => r.json()).catch(() => ({ status: "rendering" }));
      if (res.status === "ready") {
        setBusy(false);
        setMessage(null);
        router.refresh();
        return;
      }
      if (res.status === "failed") {
        setBusy(false);
        setMessage({ text: `${res.message ?? "Google couldn't make this clip."}${res.refunded ? " Your token was refunded." : ""}`, error: true });
        return;
      }
    }
    setBusy(false);
    setMessage({ text: "Still rendering — refresh the page in a minute to see your clip." });
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
          {props.clip && (
            <li>
              <button type="button" className="link-button" onClick={generateClip} disabled={busy}>
                Generate a 4-second clip
              </button>{" "}
              <span className="owner-hint">
                {props.clip.admin
                  ? "(admin: no tokens; ~$0.20 on your Google key)"
                  : `(${props.clip.cost} bought token${props.clip.cost === 1 ? "" : "s"} + ~$0.20 on your Google key; you have ${props.clip.boughtTokens})`}
                {!props.clip.hasKey && (
                  <>
                    {" "}
                    · <Link href="/account">add a Google key</Link>
                  </>
                )}
              </span>
            </li>
          )}
        </ul>
      </div>
      <div className="owner-danger">
        <button type="button" className="link-button danger" onClick={remove} disabled={busy}>
          Delete
        </button>
      </div>
      <p className={message?.error ? "owner-message error" : "owner-message muted small"} role="status" aria-live="polite">
        {message?.text}
        {message?.link && (
          <>
            {" "}
            <Link href={message.link.href}>{message.link.label}</Link>
          </>
        )}
      </p>
    </section>
  );
}
