"use client";

import { shortName } from "@/lib/names";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { requestJson } from "@/app/request";
import CrisisNotice, { crisisFrom } from "@/app/CrisisNotice";
import type { CrisisResources } from "@/lib/crisis";

/**
 * An owner's standing note to their character about this person (lib/between-dates.ts): it colours their texts and
 * goes into their next date together, then it's used.
 */
export default function NudgeForm({ pair, characterId, name, other, current }: { pair: [string, string]; characterId: string; name: string; other: string; current: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [crisis, setCrisis] = useState<CrisisResources | null>(null);
  const path = `/api/couples/${pair[0]}/${pair[1]}/nudge`;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const note = String(new FormData(event.currentTarget).get("note") ?? "");
    setBusy(true);
    setError(null);
    const res = await requestJson(path, { character_id: characterId, note }).catch(() => null);
    setBusy(false);
    if (!res) return setError("Network error. Try again.");
    // The note read as wanting to hurt themselves (lib/crisis.ts): the help stays on screen (no refresh to wipe it).
    const help = crisisFrom(res.data);
    setCrisis(help);
    if (help) {
      if (!res.ok) setError(res.message);
      return;
    }
    if (!res.ok) return setError(res.message);
    router.refresh();
  }

  async function clear() {
    setBusy(true);
    await requestJson(path, { character_id: characterId }, "DELETE").catch(() => null);
    setBusy(false);
    router.refresh();
  }

  return (
    <form onSubmit={save} className="nudge-form">
      <label>
        A note for {shortName(name)} about {shortName(other)}
        <input
          type="text"
          name="note"
          maxLength={140}
          defaultValue={current ?? ""}
          placeholder="Bring up the boat. Ask about the anthology."
          required
        />
      </label>
      <p className="muted small">
        Private. It shapes their texts and goes into their next date together, then it&apos;s used. {shortName(name)} never says it outright.
      </p>
      <button type="submit" disabled={busy}>
        {current ? "Change the note" : "Leave the note"}
      </button>{" "}
      {current && (
        <button type="button" className="link-button" onClick={clear} disabled={busy}>
          Remove it
        </button>
      )}
      {error && <p className="error">{error}</p>}
      {crisis && <CrisisNotice resources={crisis} onClose={() => setCrisis(null)} />}
    </form>
  );
}
