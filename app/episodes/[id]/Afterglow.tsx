"use client";

import { shortName } from "@/lib/names";
import { takenNote } from "@/lib/partners-shared";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Avatar from "@/app/Avatar";
import DateConfirm from "@/app/DateConfirm";
import { requestJson } from "@/app/request";
import type { CharacterRef, EpisodeView } from "@/lib/game";
import { afterglowVerdictKind, dateLabel } from "@/lib/rules";
import type { SecondDateState } from "@/lib/second-date";

type Props = {
  episodeId: string;
  characters: [CharacterRef, CharacterRef];
  afterglow: NonNullable<EpisodeView["afterglow"]>;
  /** Where their second date stands (lib/second-date.ts), for this owner. */
  secondDate?: SecondDateState | null;
  /** Which date this was for the couple (lib/rules dateNumberOf): after their third, the one they'd skip is a fourth. */
  dateNumber?: number | null;
};

/** The one-line mutual verdict, built client-side from each side's wants_another (never a model call). */
function verdictLine(verdict: { a_wants: boolean; b_wants: boolean }, names: [string, string], dateNumber?: number | null): string {
  switch (afterglowVerdictKind(verdict.a_wants, verdict.b_wants)) {
    case "mutual_yes":
      return "It was mutual — you both want to see each other again. 💘";
    case "mutual_no":
      return `No ${dateLabel(Math.max(1, dateNumber ?? 1) + 1).toLowerCase()}: neither of them is feeling it.`;
    case "one_sided": {
      const keen = verdict.a_wants ? names[0] : names[1];
      const cool = verdict.a_wants ? names[1] : names[0];
      return `It was one-sided — ${keen} wants another date, ${cool} doesn't.`;
    }
  }
}

/**
 * M11 — the afterglow, for the characters' owners only: the morning-after texts and whether the interest was
 * mutual, shown as soon as they exist. No owner has to open it or agree first.
 */
export default function Afterglow({ episodeId, characters, afterglow, secondDate, dateNumber }: Props) {
  const [a, b] = characters;
  const names: [string, string] = [a.name, b.name];
  // These texts open the couple's text chain, which carries on between dates (lib/text-chain.ts).
  const thread = a.id < b.id ? `/messages/${a.id}/${b.id}` : `/messages/${b.id}/${a.id}`;

  return (
    <section className="card afterglow">
      <h2>The afterglow</h2>
      <p className="muted">The morning after, your characters kept texting. Only the characters&apos; owners see this.</p>
      {afterglow.verdict && <p className="ending">{verdictLine(afterglow.verdict, names, dateNumber)}</p>}
      {afterglow.thread.map((line, i) => {
        const who = line.side === "a" ? a : b;
        return (
          <div key={i} className={`turn turn-${line.side}`}>
            <Avatar seed={who.id} name={who.name} hue={who.hue} house={who.house} portraitSrc={who.portrait} size={30} />
            <div className="turn-body">
              <p className="turn-line">
                <strong>{who.name}</strong> {line.text}
              </p>
            </div>
          </div>
        );
      })}
      <p className="small">
        <Link href={thread}>💬 Read all their texts, on their phone</Link>
      </p>
      {secondDate?.mutual && <SecondDate episodeId={episodeId} state={secondDate} />}
    </section>
  );
}

/**
 * The second date, when they both want one: the plan from their texts, and one click to book it (a token, like any
 * date). If the other character's creator has to agree too, this owner's yes waits for theirs.
 */
export function SecondDate({ episodeId, state }: { episodeId: string; state: SecondDateState }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean; shop?: boolean } | null>(null);
  const first = shortName(state.partner_name);
  // A booking that spends a date asks first (2026-10-31 UX audit, B5); a yes that waits for theirs, or a free one, doesn't.
  const [asking, setAsking] = useState(false);

  async function plan() {
    setBusy(true);
    setMessage(null);
    const res = await requestJson(`/api/episodes/${episodeId}/second-date`, {}).catch(() => null);
    setBusy(false);
    if (!res) return setMessage({ text: "Network error. Try again.", error: true });
    if (res.status === 200 && typeof res.data.id === "string") return router.push(`/episodes/${res.data.id}?play=1`);
    if (res.status === 202) {
      setMessage({ text: res.message });
      return router.refresh();
    }
    setMessage({ text: res.message, error: true, shop: res.status === 429 || res.status === 402 });
  }

  const next = dateLabel(state.next_date_number).toLowerCase();
  if (state.planned_episode_id) {
    return (
      <p className="notice">
        💞 Their {next} is booked. <Link href={`/episodes/${state.planned_episode_id}`}>Watch it</Link>
      </p>
    );
  }
  if (state.reason === "taken") {
    // They both want one, but yours is with someone else and wants only them: the tag, why, and where to change it.
    const mine = shortName(state.my_character_name);
    return (
      <p className="taken-note" role="note">
        <span className="badge taken-tag">💍 {state.taken_with ? `With ${shortName(state.taken_with)}` : "Taken"}</span> They both want a {next}, but{" "}
        {takenNote(mine, state.taken_with ?? null)} <Link href={`/characters/${state.my_character_id}#partners-${state.my_character_id}`}>Change it on {mine}&apos;s page</Link>
      </p>
    );
  }
  if (!state.can_plan) return null;
  const waiting = state.needs_their_yes && state.you_asked && !state.they_asked;
  const books = state.they_asked || !state.needs_their_yes;
  const spends = books && !state.free;
  return (
    <div className="second-date">
      <h3>They both want a {next}</h3>
      {state.plan.length > 0 && (
        <p className="muted">
          Their plan: {state.plan.map((p) => `“${p}”`).join(" ")}
        </p>
      )}
      {waiting ? (
        <p className="muted">You said yes. Waiting for {first}&apos;s creator to say yes too.</p>
      ) : (
        <>
          {state.they_asked && <p className="muted">{first}&apos;s creator already said yes.</p>}
          {/* The button on its own line and the cost under it (it wrapped raggedly beside it). */}
          <p className="action-hint">
          <button type="button" className="primary" onClick={spends ? () => (setMessage(null), setAsking(true)) : plan} disabled={busy}>
            {busy && !spends ? "Booking…" : books ? `Plan the ${next}` : `Say yes to a ${next} with ${first}`}
          </button>{" "}
          <span className="muted small">
            {state.needs_their_yes && !state.they_asked
              ? `Free to say yes; whoever completes it books it${state.free ? " (free for you: your second date this week is on the show)" : " with 1 date"}.`
              : state.free
                ? "Free: your second date this week is on the show. It happens where they planned it."
                : "1 date, like any other. It happens where they planned it."}
          </span>
          </p>
        </>
      )}
      {message && !asking && (
        <p className={message.error ? "error" : "muted"}>
          {message.text}
          {message.shop && (
            <>
              {" "}
              <Link href="/shop">Get more dates</Link>
            </>
          )}
        </p>
      )}
      <DateConfirm
        open={asking}
        onClose={() => {
          if (!busy) setAsking(false);
        }}
        title={`Plan their ${next}?`}
        lede={
          <>
            <strong>{shortName(state.my_character_name)}</strong> and <strong>{first}</strong> both want it. It happens where they planned it, and the show decides how it ends.
          </>
        }
        sendLabel={`Plan the ${next}`}
        busyLabel="Booking…"
        busy={busy}
        error={message?.error ? { text: message.text, shop: message.shop } : null}
        onSend={() => void plan()}
      />
    </div>
  );
}
