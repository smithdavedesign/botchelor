"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Avatar from "@/app/Avatar";
import { queueEvent } from "@/app/engagement";
import PushToggle from "@/app/notifications/PushToggle";
import { requestJson } from "@/app/request";
import type { CharacterRef } from "@/lib/game";
import ShareEnding from "./ShareEnding";

export type VerdictCardProps = {
  episodeId: string;
  endingLabel: string;
  /** The creator's own character (the one that will text), and the one it dated. */
  you: CharacterRef;
  partner: CharacterRef;
  /** Its own reflection on the date (episodes.reflections, best effort): the preview of the first text. */
  preview: string | null;
  /** The site's VAPID public key, when push is set up (lib/push.ts): the "Tell me when they text" row. */
  pushKey: string | null;
  onRestart: () => void;
};

const firstNameOf = (name: string) => name.trim().split(/\s+/)[0] || name;

/**
 * The end of a creator's just-filmed date (the 2026-11-14 core plan, PR2): the one moment with feeling gets a next step.
 * The ending, who they dated, a line of what their character thought, and "Hear from {first}": the character texts them
 * about the date in its companion thread (POST /api/companion/after-date, lib/after-date-text.ts), which is also the
 * opt-in for its later texts. Under it, notifications for when it texts (email where push can't work here), the share
 * every viewer gets, and Watch again. Keeps `.theater-verdict` and `.ending`: scripts/clips/daily-clip.mjs records up to
 * them.
 */
export default function VerdictCard({ episodeId, endingLabel, you, partner, preview, pushKey, onRestart }: VerdictCardProps) {
  const router = useRouter();
  const first = firstNameOf(you.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signIn, setSignIn] = useState(false);

  async function hear() {
    setBusy(true);
    setError(null);
    setSignIn(false);
    try {
      const { ok, data, message } = await requestJson("/api/companion/after-date", { episode_id: episodeId });
      if (ok && typeof data.href === "string") {
        // The funnel's "Heard from their character" (lib/engagement.ts): the thread opened, with the text in it.
        queueEvent("after_date_text_opened", { sent: data.sent === true });
        router.push(data.href);
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
    <div className="theater-verdict verdict-card">
      <p className="ending">{endingLabel}</p>
      <div className="verdict-pair" aria-hidden="true">
        <Avatar seed={you.id} name={you.name} hue={you.hue} house={you.house} portraitSrc={you.portrait} size={44} round />
        <span className="verdict-x">×</span>
        <Avatar seed={partner.id} name={partner.name} hue={partner.hue} house={partner.house} portraitSrc={partner.portrait} size={44} round />
      </div>
      <p className="verdict-names">
        <strong>{you.name}</strong> and <strong>{partner.name}</strong>
      </p>
      {preview ? (
        <blockquote className="verdict-preview">
          <span className="verdict-preview-who">{first}, afterwards:</span> “{preview}”
        </blockquote>
      ) : (
        <p className="verdict-will-text">{first} will text you about it.</p>
      )}
      <p className="verdict-actions">
        <button type="button" className="primary" onClick={() => void hear()} disabled={busy} data-track="hear-from">
          {busy ? "Opening…" : `Hear from ${first}`}
        </button>
      </p>
      {error && (
        <p className="error small">
          {error}
          {signIn && (
            <>
              {" "}
              <Link href={`/account?next=${encodeURIComponent(`/episodes/${episodeId}?play=1`)}`} data-track="hear-from-signup">
                Make a free account →
              </Link>
            </>
          )}
        </p>
      )}
      {pushKey && (
        <PushToggle
          publicKey={pushKey}
          prompt
          emailFallback
          title={`Tell me when ${first} texts`}
          body="One notification when your character texts you, even with the site closed."
        />
      )}
      <p className="muted verdict-again">
        That&apos;s how it ended.{" "}
        <button type="button" className="linklike" onClick={onRestart}>
          Watch again
        </button>
      </p>
      {/* The share where the feeling is (2026-11-11 growth plan): spoiler-free, like every viewer's share. */}
      <ShareEnding episodeId={episodeId} names={[you.name, partner.name]} kind="viewer" />
    </div>
  );
}
