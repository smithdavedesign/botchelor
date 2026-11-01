"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Status = {
  mixer: { id: string; venue: string; singles: number } | null;
  mine_in?: string[];
  recent?: { character_id: string; episode_id: string; venue: string }[];
  min: number;
  max: number;
};

/**
 * "Join tonight's mixer" for one of your characters (group dates M2 on the web): 4–6 singles, each meets its two
 * neighbours for six lines; joining is the consent, and it spends one of your dates when the night runs.
 */
export default function MixerJoin({ characterId, first }: { characterId: string; first: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [shop, setShop] = useState(false);

  async function load() {
    try {
      const res = await fetch("/api/mixer");
      setStatus((await res.json()) as Status);
    } catch {
      setStatus(null);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function act(action: "join" | "leave") {
    setBusy(true);
    setNote(null);
    setShop(false);
    try {
      const res = await fetch("/api/mixer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, character_id: characterId }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string; runs?: string; shop_path?: string };
      if (!res.ok) {
        setNote(body.message ?? "That didn't work; try again in a moment.");
        setShop(Boolean(body.shop_path));
      } else
        setNote(
          action === "join"
            ? `${first} is in. ${body.runs ?? ""} You'll get a notification with ${first}'s date when it runs.`
            : `${first} is out; nothing was spent.`,
        );
      await load();
    } catch {
      setNote("That didn't work; try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;
  const inIt = status.mine_in?.includes(characterId) ?? false;
  const m = status.mixer;
  // The last night this character went to (within two days): its own date from it, so the result isn't only in a notice.
  const last = status.recent?.find((r) => r.character_id === characterId);
  // A row, not a sentence with a button in it (2026-10-31 UX audit): what it is, where it stands, then the one button.
  return (
    <section className="card invite-row mixer-join" aria-label="Tonight's mixer">
      <span className="invite-row-icon" aria-hidden="true">
        🍸
      </span>
      <div className="invite-row-text">
        <strong>Tonight&apos;s mixer</strong>
        <span className="muted small">
          {m
            ? `${m.venue} · ${m.singles}/${status.max} singles in · ${m.singles >= status.min ? "runs within the hour" : `runs once ${status.min} are in`}`
            : `None open yet: putting ${first} in opens tonight's`}
        </span>
        <span className="muted small">Six lines with each of two singles, for one of your dates. They&apos;ll remember each other.</span>
        {last && (
          <span className="small">
            {first}&apos;s last one: <Link href={`/episodes/${last.episode_id}`}>watch their date</Link> ·{" "}
            <Link href={`/characters/${characterId}/relationships#met-title`}>who they met</Link>
          </span>
        )}
        {note && (
          <span className="muted small" role="status">
            {note} {shop && <Link href="/shop">Get dates</Link>}
          </span>
        )}
      </div>
      {inIt ? (
        <button type="button" className="button-ghost small" onClick={() => void act("leave")} disabled={busy}>
          Take {first} out
        </button>
      ) : (
        <button type="button" className="secondary small" onClick={() => void act("join")} disabled={busy || (m ? m.singles >= status.max : false)}>
          {busy ? "…" : `Put ${first} in`}
        </button>
      )}
    </section>
  );
}
