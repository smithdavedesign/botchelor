"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { queueEvent } from "@/app/engagement";
import { requestJson } from "@/app/request";

/**
 * "Hear from {first}" on the home page's phone (app/CharacterPhone.tsx), for an owner who never opted in to their
 * character's texts: the same call as the verdict card's button (POST /api/companion/after-date,
 * lib/after-date-text.ts). Their character texts them about its last date and the thread opens; the tap is the opt-in
 * for its later texts. Companions sit behind the 18+ gate and, for a guest, a free-reply count: a refusal says what to do.
 */
export default function CharacterPhoneHear({ episodeId, label, quiet = false }: { episodeId: string; label: string; /** The second button, beside "Watch". */ quiet?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; fix: { href: string; label: string } | null } | null>(null);

  async function hear() {
    setBusy(true);
    setError(null);
    try {
      const { ok, data, message } = await requestJson("/api/companion/after-date", { episode_id: episodeId });
      if (ok && typeof data.href === "string") {
        // The funnel's "Heard from their character" (lib/engagement.ts), from the home page this time.
        queueEvent("after_date_text_opened", { sent: data.sent === true, from: "home" });
        router.push(data.href);
        return;
      }
      const fix =
        data.error === "age_gate"
          ? { href: `/gate?from=${encodeURIComponent("/")}`, label: "Confirm your age →" }
          : data.error === "sign_in" || data.error === "guest_used_up"
            ? { href: `/account?next=${encodeURIComponent("/")}`, label: "Make a free account →" }
            : null;
      setError({ message, fix });
    } catch {
      setError({ message: "Network error. Try again.", fix: null });
    }
    setBusy(false);
  }

  return (
    <>
      <button type="button" className={quiet ? "button-ghost" : "primary"} onClick={() => void hear()} disabled={busy} data-track="home-phone-hear">
        {busy ? "Opening…" : label}
      </button>
      {error && (
        <span className="error small char-phone-error" role="alert">
          {error.message}{" "}
          {error.fix && (
            <Link href={error.fix.href} data-track="home-phone-hear-fix">
              {error.fix.label}
            </Link>
          )}
        </span>
      )}
    </>
  );
}
