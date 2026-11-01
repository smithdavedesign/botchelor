"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { requestJson } from "@/app/request";
import { JOB_INFO, type JobCard as JobCardView, type PlainError } from "@/lib/connections-shared";
import ConnectionCard, { type CardTone } from "./ConnectionCard";
import KeyForm, { type AlsoJob, type FlowProvider } from "./KeyForm";

const TONE: Record<JobCardView["state"], CardTone> = { unset: "unset", connected: "ok", error: "error", over_cap: "warn", fallback: "warn" };

/**
 * One job's card on the Connections page, with what can be done from it: Connect (the flow opens under it), and for a
 * job with a key, Change, Check (test the stored key live again: the card says "Checking…" meanwhile) and going back
 * to no key (the free model, for dates).
 */
export default function JobCard({ card, providers, also }: { card: JobCardView; providers: FlowProvider[]; also: AlsoJob[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [error, setError] = useState<PlainError | null>(null);
  const info = JOB_INFO[card.job];
  // A failed Check shows at once; once the page has caught up, the server's card (its state and pill) says it.
  const localOnly = error !== null && card.error === null;
  const shownError = card.error ?? error;

  async function checkNow() {
    if (!card.provider) return;
    setChecking(true);
    setNote(null);
    setError(null);
    const r = await requestJson("/api/me/connections/check", { provider: card.provider }).catch(() => null);
    setChecking(false);
    const d = (r?.data ?? {}) as { ok?: boolean; error?: PlainError };
    if (r?.ok && d.ok) {
      setNote({ ok: true, text: "✓ Works: checked just now." });
      router.refresh();
    } else if (d.error) {
      setError(d.error);
      router.refresh(); // the card's status and meta lines come from the server: "failed just now", no ✓
    } else setNote({ ok: false, text: r?.message ?? "Couldn't reach Botchelor. Try again." });
  }

  async function stop() {
    const back = info.free ? `back on ${info.free}` : "not set up again";
    if (!confirm(`Stop using your key for ${info.title}? It goes ${back}. The key stays stored for anything else it does.`)) return;
    setBusy(true);
    const r = await requestJson("/api/me/connections", { job: card.job }, "DELETE").catch(() => null);
    setBusy(false);
    if (r?.ok) router.refresh();
    else setNote({ ok: false, text: r?.message ?? "Couldn't reach Botchelor. Try again." });
  }

  return (
    <ConnectionCard
      id={info.anchor}
      title={card.title}
      subtitle={card.what}
      provider={card.provider}
      tone={checking ? "checking" : localOnly ? "error" : card.state === "connected" && card.usage?.level === "warn" ? "warn" : TONE[card.state]}
      pill={checking ? "Checking…" : localOnly ? "Needs attention" : card.pill}
      status={card.status}
      meta={card.meta}
      error={shownError}
      meter={
        card.usage && card.usage.cap !== null && card.usage.level !== "none"
          ? { spent: card.usage.spent, cap: card.usage.cap, level: card.usage.level, label: card.usage.line }
          : null
      }
    >
      <div className="connection-actions">
        {card.state === "unset" ? (
          <button type="button" className="secondary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? "Cancel" : card.reusable.length ? "Connect a key" : "Connect"}
          </button>
        ) : (
          <>
            <button type="button" className="secondary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
              {open ? "Cancel" : "Change"}
            </button>
            <button type="button" className="secondary" onClick={checkNow} disabled={checking}>
              Check
            </button>
            <button type="button" className="link-button danger" onClick={stop} disabled={busy}>
              {info.free ? `Use ${info.free}` : "Stop using it"}
            </button>
          </>
        )}
      </div>
      {note && <p className={`byok-status ${note.ok ? "ok" : "err"}`}>{note.text}</p>}
      {open && (
        <KeyForm
          job={card.job}
          jobTitle={card.title}
          providers={providers}
          current={{ provider: card.provider, model: card.model, feel: card.feel, cap: card.cap }}
          also={also}
          onDone={() => setOpen(false)}
        />
      )}
    </ConnectionCard>
  );
}
