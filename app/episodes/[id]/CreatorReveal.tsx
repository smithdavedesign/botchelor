"use client";

import type { FormEvent } from "react";
import { ProfileFields, saveProfileFrom } from "@/app/ProfileFields";
import { requestJson } from "@/app/request";
import { useAction } from "@/app/useAction";

type Props = {
  episodeId: string;
  consented: boolean;
  consents: number;
  needed: number;
  revealed: boolean;
  hasName: boolean;
  /** The date is with a premium house character, which only its buyers can pick. */
  premiumPartner: boolean;
};

/** The mutual-consent identity reveal, shown to an episode's creators only. */
export default function CreatorReveal({
  episodeId,
  consented,
  consents,
  needed,
  revealed,
  hasName,
  premiumPartner,
}: Props) {
  const { busy, error, run } = useAction();
  const pair = needed > 1;

  function agree(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(async () => {
      if (!hasName) {
        const failure = await saveProfileFrom(form);
        if (failure) return failure;
      }
      return requestJson("/api/reveal", { episode_id: episodeId });
    });
  }

  if (revealed) {
    return (
      <section className="card">
        <p className="notice">{pair ? "You both agreed: your names are on the episode." : "Your name is on the episode."}</p>
      </section>
    );
  }

  return (
    <section className="card">
      <h2>Who made this?</h2>
      {consented ? (
        <p className="muted">You agreed to show your name. It appears only when the other creator agrees too.</p>
      ) : (
        <form onSubmit={agree}>
          <p>
            {pair
              ? "Creators stay anonymous. If you both agree, everyone sees your display names next to your characters."
              : "You're anonymous. Agree to show your display name next to your character."}
            {pair && consents > 0 && " The other creator has already agreed."}
          </p>
          <p className="muted">
            Your name is shown as your character&apos;s creator, so anyone who sees that character in another episode
            will know it&apos;s yours too.
            {premiumPartner &&
              " This date is with a premium house character, and only buyers can pick them. While few people own one, revealing yourself here hints that their other dates may be yours too."}
          </p>
          {!hasName && <ProfileFields />}
          <button type="submit" disabled={busy}>
            {pair ? "I agree to reveal us" : "Show my name"}
          </button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
