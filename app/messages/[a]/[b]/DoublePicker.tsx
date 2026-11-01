"use client";

import Link from "next/link";
import { useState } from "react";
import Sheet from "@/app/Sheet";

type Option = { character_id: string; name: string; partner_id: string; partner_name: string; kind?: "yours" | "theirs"; near?: boolean };

/**
 * "Make it a double" on the thread (group dates M1b): this couple plus one of your other characters, who brings a
 * house date (two of your dates, both tables book at once), or another creator's couple from the social graph — the
 * ones near you first — who get the invite (each side spends one date if they accept). Each table is its own episode.
 * 2026-10-31 UX audit: an item in the thread's ⋯ that opens a modal (it was a second button beside Book date, and the
 * two crowded a phone's header).
 */
export default function DoublePicker({ mineId, themId }: { mineId: string; themId: string }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Option[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [booked, setBooked] = useState<string | null>(null);
  const [invited, setInvited] = useState<string | null>(null);

  async function show() {
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

  const yours = (options ?? []).filter((o) => o.kind !== "theirs");
  const theirs = (options ?? []).filter((o) => o.kind === "theirs");
  return (
    <>
      <button type="button" role="menuitem" className="thread-menu-item" data-close onClick={() => void show()}>
        <span aria-hidden="true">💞</span> Make it a double date
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Make it a double date">
        <p className="muted">Two couples, one table: each couple&apos;s date is its own episode, and everyone remembers everyone.</p>
        {booked ? (
          <p role="status" className="double-done">
            💞💞 Both tables are booked.{" "}
            <Link className="button small" href={`/episodes/${booked}?play=1`}>
              Watch the double
            </Link>
          </p>
        ) : invited ? (
          <p role="status">
            💌 Invited {invited}. You&apos;ll get a notification when their creator answers; nothing is spent unless it books.
          </p>
        ) : options === null ? (
          <p className="muted">Finding couples…</p>
        ) : options.length === 0 ? (
          <p className="muted">
            No couple to sit with yet. <Link href="/create">Make another character</Link> to bring one of your own, or check back as couples start dating.
          </p>
        ) : (
          <>
            {yours.length > 0 && (
              <div className="double-group">
                <p className="small">Bring one of yours: two of your dates, both tables book now.</p>
                {yours.map((o) => (
                  <button key={o.character_id} type="button" className="small" onClick={() => void book(o)} disabled={busy}>
                    {busy ? "Booking…" : `+ ${o.name} × ${o.partner_name}`}
                  </button>
                ))}
              </div>
            )}
            {theirs.length > 0 && (
              <div className="double-group">
                <p className="small">Or invite a couple: each side spends one date if they say yes. ★ = near you (you&apos;ve dated one of them).</p>
                {theirs.map((o) => (
                  <button key={`${o.character_id}-${o.partner_id}`} type="button" className="small" onClick={() => void book(o)} disabled={busy}>
                    {busy ? "…" : `${o.near ? "★ " : ""}Invite ${o.name} × ${o.partner_name}`}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {error && (
          <p className="sheet-error" role="alert">
            {error}
          </p>
        )}
      </Sheet>
    </>
  );
}
