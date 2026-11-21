"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Avatar from "@/app/Avatar";
import Icon from "@/app/Icon";
import Sheet from "@/app/Sheet";
import { requestJson } from "@/app/request";
// Types and the block sentences only: the picks are worked out on the server (lib/auditions.ts auditionPicks).
import type { AuditionPick } from "@/lib/auditions";
import { AUDITION_BLOCKS } from "@/lib/audition-words";

const SIGN_IN = "/account?next=%2Fcasting";
const first = (name: string) => name.split(/\s+/)[0];

/**
 * /casting's open places as buttons (David, 2026-11-21: "a user should be able to click the plus sign and choose one of
 * the characters to submit for audition"): a press opens a sheet of the person's own characters. One that can audition
 * applies right there, with the same consent the character page asks for (the button carries it, as AuditionPanel's
 * does); one that can't says what stands in its way and links to its page to fix it. Signed out, the place says to
 * sign in; with no characters yet, the sheet sends them to make one.
 */
export default function OpenSlots({ count, picks, noun, label }: { count: number; picks: AuditionPick[] | null; noun: string | null; label: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const role = noun ? `a ${noun}` : "a cast member";
  const ready = (picks ?? []).filter((p) => p.blocks.length === 0);

  async function apply(p: AuditionPick) {
    setBusy(p.id);
    setError(null);
    const r = await requestJson(`/api/characters/${p.id}/audition`, { consent: true }).catch(() => null);
    setBusy(null);
    if (!r?.ok) return setError(r?.message || "That didn't go through. Try again.");
    setApplied(p.name);
    router.refresh();
  }

  const slot = (i: number) => (
    <li key={`open-${i}`} className="casting-slot is-open is-pickable">
      {picks === null ? (
        <Link className="casting-slot-pick" href={SIGN_IN} data-track="casting-slot-sign-in">
          <SlotFace />
          <SlotText noun={noun} />
          <span className="sr-only">: sign in to put your character up</span>
        </Link>
      ) : (
        <button type="button" className="casting-slot-pick" onClick={() => { setError(null); setApplied(null); setOpen(true); }} aria-haspopup="dialog" data-track="casting-slot-pick">
          <SlotFace />
          <SlotText noun={noun} />
          <span className="sr-only">: choose one of your characters</span>
        </button>
      )}
    </li>
  );

  return (
    <>
      {Array.from({ length: count }, (_, i) => slot(i))}
      <Sheet open={open} onClose={() => setOpen(false)} title={applied ? `${first(applied)} is in` : `Put up ${role} for ${label}`}>
        {applied ? (
          <>
            <p>
              {applied} is up for {label}. The producers look at every one, and the votes decide who takes the places. You can withdraw it from its page any time.
            </p>
            <p className="cta-row">
              <button type="button" className="primary" onClick={() => setOpen(false)}>
                See the board
              </button>
            </p>
          </>
        ) : !picks?.length ? (
          <>
            <p>You don&apos;t have a character yet. Make one in a sentence, take it on a few dates, then put it up here.</p>
            <p className="cta-row">
              <Link className="button primary" href="/create" data-track="casting-slot-create">
                Make a character
              </Link>
            </p>
          </>
        ) : (
          <>
            {ready.length > 0 && (
              <p className="small">
                Applying puts your character up as {role} for {label}. If the producers shortlist it and it gets the votes, for that month anyone can take
                it on a date by name (the show pays), the show books it into its dates and the cast group chat, and its sheet is locked until the month
                ends. You can withdraw it any time.
              </p>
            )}
            <ul className="casting-pick-list">
              {picks.map((p) => (
                <li key={p.id} className="casting-pick">
                  <Avatar seed={p.id} name={p.name} hue={p.hue ?? 0} portraitSrc={p.portrait} size={48} decorative />
                  <span className="casting-pick-text">
                    <strong>{p.name}</strong>
                    {p.blocks.length > 0 && <span className="muted small">{AUDITION_BLOCKS[p.blocks[0]]}</span>}
                  </span>
                  {p.blocks.length === 0 ? (
                    <button type="button" className="primary small" disabled={busy !== null} onClick={() => void apply(p)} data-track="audition" data-track-from="casting-slot">
                      {busy === p.id ? "Applying…" : `Apply ${first(p.name)}`}
                    </button>
                  ) : p.blocks[0] === "sign_in" ? (
                    <Link className="button secondary small" href={SIGN_IN}>
                      Sign in
                    </Link>
                  ) : (
                    <Link className="button secondary small" href={`/characters/${p.id}`}>
                      Open {first(p.name)}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
            {error && (
              <p className="error small" role="alert">
                {error}
              </p>
            )}
          </>
        )}
      </Sheet>
    </>
  );
}

function SlotFace() {
  return (
    <span className="casting-slot-face" aria-hidden="true">
      <Icon name="plus" />
    </span>
  );
}

function SlotText({ noun }: { noun: string | null }) {
  return (
    <span className="casting-slot-text">
      <strong>Open</strong>
      <span className="muted small">{noun ? `a ${noun}: your character?` : "your character?"}</span>
    </span>
  );
}
