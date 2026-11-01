"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { requestJson } from "@/app/request";
import { setupStep } from "@/lib/adult/picture-notes";
import type { Readiness, SetupOffer } from "@/lib/adult/readiness";

/** A setup draws faces and bodies and checks each: a couple of minutes at most (the Studio's own limit). */
const SETUP_TIMEOUT_MS = 290_000;

/** What the button says it costs: the character's first setup included, otherwise the Recast and Body reference prices. */
export function setupPrice(offer: SetupOffer): string {
  if (offer.free) return "included";
  return offer.tokens === 0 ? "no tokens" : `${offer.tokens} token${offer.tokens === 1 ? "" : "s"}`;
}

/** What one tap does, in a line: what it draws, or that it picks the face already there. */
export function setupWords(r: Pick<Readiness, "face" | "body">, offer: SetupOffer): string {
  const parts = [!r.face ? (offer.baseline ? "picks the face already drawn" : "draws faces and picks one") : "", !r.body ? "draws a body reference from the face and picks it" : ""].filter(Boolean);
  const n = offer.pictures;
  return `It ${parts.join(", then ")}${n ? ` (${n} picture${n === 1 ? "" : "s"}, each checked)` : ""}. You can switch to another in the Studio after.`;
}

/**
 * "Set up for pictures" (#1207; David, 2026-11-01) where a night's "needs a face and a body" note shows: one tap that
 * draws and picks a face and a body (lib/adult/studio.ts setUpForPictures), each character's first one included; "Use
 * this face" when a face is already drawn for them; and a link to the Studio step for what's missing. The page is read
 * again after, so the checklist and the night's notes follow.
 */
export default function SetupForPictures({ r }: { r: Readiness }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"setup" | "face" | null>(null);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const offer = r.setup;
  const step = setupStep(r);
  const first = r.name.split(/\s+/)[0];

  async function setUp() {
    setBusy("setup");
    setNote(null);
    let timedOut = false;
    const res = await requestJson("/api/admin/after-dark/studio", { action: "setup", character_id: r.id }, "POST", { timeoutMs: SETUP_TIMEOUT_MS }).catch((err: unknown) => {
      timedOut = err instanceof DOMException && err.name === "TimeoutError";
      return null;
    });
    setBusy(null);
    if (timedOut) return setNote({ text: `That took too long and was stopped. If pictures were made they're in ${first}'s Studio in a minute.`, error: true });
    if (!res) return setNote({ text: "That didn't reach the server. Check your connection and try again.", error: true });
    if (!res.ok) return setNote({ text: res.message, error: true });
    const setup = res.data.setup as { ready?: boolean } | undefined;
    setNote({ text: typeof res.data.message === "string" ? res.data.message : `${first} is set up.`, error: setup?.ready === false });
    router.refresh();
  }

  async function useFace(imageId: string) {
    setBusy("face");
    setNote(null);
    const res = await requestJson("/api/admin/after-dark/face", { character_id: r.id, image_id: imageId }).catch(() => null);
    setBusy(null);
    if (!res?.ok) return setNote({ text: res?.message ?? "Couldn't pick that face.", error: true });
    setNote({ text: `Every picture of ${first} now keeps this face.` });
    router.refresh();
  }

  return (
    <div className="ad-setup-offer">
      {offer && (
        <p className="ad-setup-offer-row">
          <button type="button" className="primary small" disabled={Boolean(busy) || offer.drawing} onClick={() => void setUp()}>
            {busy === "setup" || offer.drawing ? "Setting up… about a minute" : `✨ Set up ${first} for pictures · ${setupPrice(offer)}`}
          </button>
          {offer.baseline && !r.face && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- private, presigned media */}
              <img className="ad-setup-thumb" src={`/api/admin/after-dark/media/${offer.baseline}?w=160`} alt={`${first}'s face, drawn already`} />
              <button type="button" className="button-ghost small" disabled={Boolean(busy)} onClick={() => void useFace(offer.baseline!)}>
                Use this face
              </button>
            </>
          )}
        </p>
      )}
      {offer && <p className="muted small">{setupWords(r, offer)}</p>}
      {step && (
        <p className="small">
          <a href={step.href} className="ad-start-setup">{offer ? `Or do it yourself in the Studio: ${step.label.toLowerCase()} →` : `${step.label} in ${first}'s Studio →`}</a>
        </p>
      )}
      {note && (
        <p className={note.error ? "error small" : "muted small"} role={note.error ? "alert" : "status"}>
          {note.text}
        </p>
      )}
    </div>
  );
}
