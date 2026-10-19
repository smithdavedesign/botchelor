"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ProfileFields, saveProfileFrom } from "@/app/ProfileFields";
import { requestJson } from "@/app/request";

/** Starts a league and goes to its page, where the invite link is. */
export function CreateLeagueForm({ hasName }: { hasName: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const failure = hasName ? null : await saveProfileFrom(form);
      if (failure) return setError(failure);
      const result = await requestJson("/api/leagues", { name: String(form.get("league_name") ?? "") });
      if (!result.ok) return setError(result.message);
      router.push(String(result.data.invite_path));
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={create}>
      <h3>Start a league with friends</h3>
      <p className="muted">A monthly leaderboard for your group. Share its link to invite people.</p>
      <label>
        League name
        <input type="text" name="league_name" required maxLength={40} />
      </label>
      {!hasName && <ProfileFields />}
      <button type="submit" disabled={busy}>
        Start a league
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}

export function UnblockButton({ episodeId }: { episodeId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="secondary small"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await requestJson("/api/blocks", { episode_id: episodeId }, "DELETE").catch(() => null);
        setBusy(false);
        router.refresh();
      }}
    >
      Unblock
    </button>
  );
}
