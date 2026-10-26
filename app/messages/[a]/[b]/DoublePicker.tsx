"use client";

import Link from "next/link";
import { useState } from "react";

type Option = { character_id: string; name: string; partner_id: string; partner_name: string; kind?: "yours" | "theirs"; near?: boolean };

/**
 * "Make it a double" on the thread (group dates M1b): this couple plus one of your other characters, who brings a
 * house date (two of your dates, both tables book at once), or another creator's couple from the social graph — the
 * ones near you first — who get the invite (each side spends one date if they accept). Each table is its own episode.
 */
export default function DoublePicker({ mineId, themId }: { mineId: string; themId: string }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Option[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booked, setBooked] = useState<string | null>(null);
  const [invited, setInvited] = useState<string | null>(null);

  async function load() {
    setOpen(true);
    setError(null);
    if (options) return;
    try {
      const res = await fetch(`/api/doubles?excluding=${mineId},${themId}`);
      const body = (await res.json().catch(() => ({}))) as { options?: Option[] };
      setOptions(body.options ?? []);
    } catch {
      setOptions([]);
    }
  }

  async function book(o: Option) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/doubles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ character_id: mineId, partner_id: themId, with_character: o.character_id, with_partner: o.partner_id }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string; episode_a?: string; invited?: string };
      if (!res.ok) setError(body.message ?? "That didn't work; try again in a moment.");
      else if (body.invited) setInvited(`${o.name} × ${o.partner_name}`);
      else setBooked(body.episode_a ?? null);
    } catch {
      setError("That didn't work; try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  if (invited) {
    return (
      <span className="thread-action muted" role="status">
        💞💞 Invited {invited}. You&apos;ll hear when their booker answers; nothing is spent unless it books.
      </span>
    );
  }
  if (booked) {
    return (
      <span className="thread-action">
        <Link className="button small" href={`/episodes/${booked}?play=1`}>
          💞💞 Watch the double
        </Link>
      </span>
    );
  }
  return (
    <span className="thread-action">
      {!open ? (
        <button type="button" className="small" onClick={() => void load()}>
          💞💞 Double?
        </button>
      ) : options === null ? (
        <span className="muted">…</span>
      ) : options.length === 0 ? (
        <span className="muted">No couple to sit with yet: make another character on /create, or come back when couples are dating.</span>
      ) : (
        <span className="row-actions">
          {options.some((o) => o.kind !== "theirs") && <span className="muted">Bring one of yours (two of your dates, books now): </span>}
          {options
            .filter((o) => o.kind !== "theirs")
            .map((o) => (
              <button key={o.character_id} type="button" className="small" onClick={() => void book(o)} disabled={busy}>
                {busy ? "Booking…" : `+ ${o.name} × ${o.partner_name}`}
              </button>
            ))}
          {options.some((o) => o.kind === "theirs") && <span className="muted"> Or invite a couple (each side spends one date if they say yes): </span>}
          {options
            .filter((o) => o.kind === "theirs")
            .map((o) => (
              <button key={`${o.character_id}-${o.partner_id}`} type="button" className="small" onClick={() => void book(o)} disabled={busy}>
                {busy ? "…" : `${o.near ? "★ " : ""}Invite ${o.name} × ${o.partner_name}`}
              </button>
            ))}
        </span>
      )}
      {error && (
        <span className="thread-action-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
