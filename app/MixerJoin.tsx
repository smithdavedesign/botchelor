"use client";

import { useEffect, useState } from "react";

type Status = { mixer: { id: string; venue: string; singles: number } | null; mine_in?: string[]; min: number; max: number };

/**
 * "Join tonight's mixer" for one of your characters (group dates M2 on the web): 4–6 singles, each meets its two
 * neighbours for six lines; joining is the consent, and it spends one of your dates when the night runs.
 */
export default function MixerJoin({ characterId, first }: { characterId: string; first: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

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
    try {
      const res = await fetch("/api/mixer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, character_id: characterId }),
      });
      const body = (await res.json().catch(() => ({}))) as { message?: string; runs?: string };
      if (!res.ok) setNote(body.message ?? "That didn't work; try again in a moment.");
      else setNote(action === "join" ? `${first} is in. ${body.runs ?? ""}` : `${first} is out; nothing was spent.`);
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
  return (
    <p className="notice mixer-join">
      🍸{" "}
      {m ? (
        <>
          Tonight&apos;s mixer: {m.venue.charAt(0).toLowerCase() + m.venue.slice(1)}, {m.singles}/{status.max} singles in
          {m.singles >= status.min ? " · runs within the hour" : ` · runs once ${status.min} are in`}.{" "}
        </>
      ) : (
        <>No mixer open yet: joining opens tonight&apos;s. </>
      )}
      {inIt ? (
        <button type="button" className="small" onClick={() => void act("leave")} disabled={busy}>
          Take {first} out
        </button>
      ) : (
        <button type="button" className="small primary" onClick={() => void act("join")} disabled={busy || (m ? m.singles >= status.max : false)}>
          {busy ? "…" : `Put ${first} in`}
        </button>
      )}
      <span className="muted"> Six lines with each of two singles; one of your dates when it runs. Everyone there joins {first}&apos;s memory.</span>
      {note && (
        <span className="muted" role="status">
          {" "}
          {note}
        </span>
      )}
    </p>
  );
}
