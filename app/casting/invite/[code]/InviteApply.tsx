"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { trackConversion } from "@/app/conversion";
import { queueEvent } from "@/app/engagement";
import { requestJson } from "@/app/request";

type Credit = { handle: string; display_name: string };

/**
 * Applies one of the person's characters with the invite (POST /api/casting/invite/[code]): the terms are above the
 * button, so pressing it is the consent. Without a creator name yet, two small optional fields set one (the credit on
 * its page and its casting card). `retry`: the same character's audition date, tried again.
 */
export default function InviteApply({
  code,
  characters,
  credit,
  lead,
  retry = false,
}: {
  code: string;
  characters: { id: string; name: string }[];
  credit: Credit | null;
  /** The lead's first name, when there's one to meet. */
  lead: string | null;
  retry?: boolean;
}) {
  const router = useRouter();
  const [pick, setPick] = useState(characters[0]?.id ?? "");
  const [form, setForm] = useState<Credit>({ handle: "", display_name: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = characters.find((c) => c.id === pick) ?? characters[0];
  const first = chosen ? chosen.name.trim().split(/\s+/)[0] : "";
  const handle = form.handle.trim();
  const displayName = form.display_name.trim();
  // Both or neither: a creator page needs a handle and a name.
  const half = !credit && !retry && Boolean(handle) !== Boolean(displayName);

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const res = await requestJson(`/api/casting/invite/${encodeURIComponent(code)}`, {
        character_id: pick,
        consent: true,
        ...(!credit && !retry && handle && displayName ? { credit: { handle, display_name: displayName } } : {}),
      });
      if (!res.ok) {
        setError(res.message);
        setBusy(false);
        return;
      }
      const date = res.data.date as { booked?: boolean; fresh?: boolean } | undefined;
      // The engagement log's own event (lib/engagement.ts), counted under the visit's source (an invite's is "invite").
      queueEvent(retry ? "casting_invite_retry" : "casting_invite_applied", { booked: Boolean(date?.booked) });
      // The show booked their audition date: a date started, for the funnel and its by-source table.
      if (date?.booked && date.fresh) trackConversion("date_started", { mode: "casting_invite" });
      router.refresh();
      setBusy(false);
    } catch {
      setError("That didn't reach the server. Try again in a moment.");
      setBusy(false);
    }
  }

  return (
    <form
      className="casting-invite-apply"
      onSubmit={(e) => {
        e.preventDefault();
        if (!half) void apply();
      }}
    >
      {!retry && characters.length > 1 && (
        <label>
          <span className="small">Which character?</span>
          <select value={pick} onChange={(e) => setPick(e.target.value)}>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {!retry &&
        (credit ? (
          <p className="muted small">
            We credit you as <Link href={`/creators/${credit.handle}`}>{credit.display_name}</Link> (@{credit.handle}).
          </p>
        ) : (
          <fieldset className="casting-invite-credit">
            <legend className="small">Your creator name (optional)</legend>
            <input type="text" maxLength={40} placeholder="Name to credit you by" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} aria-label="Name to credit you by" />
            <input type="text" maxLength={24} placeholder="handle (letters, numbers, _)" value={form.handle} onChange={(e) => setForm({ ...form, handle: e.target.value })} aria-label="Handle for your creator page" />
            <p className="muted small">It goes on your character&apos;s page and its casting card, linked to your own creator page. Public, and never your login name or email. Leave it empty to stay unnamed.</p>
          </fieldset>
        ))}
      <button type="submit" className="primary" disabled={busy || !pick || half} data-track={retry ? "casting-invite-retry" : "casting-invite-apply"}>
        {busy ? (retry ? "Booking…" : "Applying…") : retry ? `🌹 Book ${first}'s date${lead ? ` with ${lead}` : ""}` : `🌹 Apply with ${first}`}
      </button>
      {!retry && <p className="muted small">Applying means you agree to the terms above.</p>}
      {half && <p className="muted small">Fill in both the name and the handle, or neither.</p>}
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
