"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { requestJson } from "@/app/request";

/**
 * Starts (or reopens) your thread with a character (app/api/companion) and goes to it. A guest past what they can try
 * without an account (a few characters, a few replies) gets the reason and the way on: a free account.
 */
export default function TalkButton({ characterId, name, label, className = "button secondary" }: { characterId: string; name: string; label?: string; className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signIn, setSignIn] = useState(false);
  async function talk() {
    setBusy(true);
    setError(null);
    setSignIn(false);
    try {
      const { ok, data, message } = await requestJson("/api/companion", { character_id: characterId });
      if (ok && typeof data.thread_id === "string") {
        router.push(`/companion/${data.thread_id}`);
        return;
      }
      setError(message);
      setSignIn(data.error === "sign_in" || data.error === "guest_used_up");
    } catch {
      setError("Network error. Try again.");
    }
    setBusy(false);
  }
  return (
    <>
      <button type="button" className={className} onClick={() => void talk()} disabled={busy} data-track="companion-open">
        {busy ? `Opening…` : (label ?? `Talk with ${name}`)}
      </button>
      {error && (
        <p className="error small">
          {error}
          {signIn && (
            <>
              {" "}
              <Link href={`/account?next=${encodeURIComponent(`/characters/${characterId}`)}`} data-track="companion-guest-signup">
                Make a free account →
              </Link>
            </>
          )}
        </p>
      )}
    </>
  );
}
