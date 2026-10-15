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

/**
 * Owner-only controls on a character's card: the full editor (every field, /characters/[id]/edit), the
 * open-to-dates switch, Pro portrait/clip generation on the owner's own key, and delete.
 */
export default function OwnerControls(props: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
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
    setMessage("Generating a portrait on your key…");
    const { ok, status, message } = await requestJson(`/api/characters/${props.id}/portrait`, {}, "POST").catch(() => ({ ok: false, status: 0, message: "Network error." }));
    setBusy(false);
    if (ok) {
      setMessage(null);
      router.refresh();
    } else if (status === 400) {
      setMessage("Add an OpenAI image key on your account first.");
    } else {
      setMessage(message);
    }
  }

  async function generateClip() {
    setBusy(true);
    setMessage("Starting a clip on your key (video takes a minute or two)…");
    const start = await requestJson(`/api/characters/${props.id}/clip`, {}, "POST").catch(() => ({ ok: false, status: 0 }));
    if (!start.ok) {
      setBusy(false);
      setMessage(start.status === 400 ? "Add an OpenAI image key on your account first." : "Couldn't start the clip.");
      return;
    }
    // Poll until the provider finishes (bounded), then show it. A render can take a couple of minutes.
    for (let i = 0; i < 40; i++) {
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
        setMessage("The provider couldn't make this clip.");
        return;
      }
    }
    setBusy(false);
    setMessage("Still rendering — refresh the page in a minute to see your clip.");
  }

  async function remove() {
    if (!confirm(`Delete ${props.name}? This can't be undone. If they've already aired in an episode, that episode stays but is no longer yours.`)) return;
    setBusy(true);
    const { ok } = await requestJson(`/api/characters/${props.id}`, {}, "DELETE").catch(() => ({ ok: false }));
    setBusy(false);
    if (ok) router.push("/account");
  }

  return (
    <section className="card owner-controls">
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
      <p className="muted small">
        <span className="pro-tag">✨ Pro</span>{" "}
        <button type="button" className="link-button" onClick={generatePortrait} disabled={busy}>
          Generate a portrait
        </button>{" "}
        ·{" "}
        <button type="button" className="link-button" onClick={generateClip} disabled={busy}>
          Generate a clip
        </button>{" "}
        <span>(on your own key)</span> ·{" "}
        <button type="button" className="link-button danger" onClick={remove} disabled={busy}>
          Delete
        </button>
      </p>
      {message && <p className="muted small">{message}</p>}
    </section>
  );
}
