"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { requestJson } from "@/app/request";
import { SecondDate } from "@/app/episodes/[id]/Afterglow";
import type { NextDate as NextDateData } from "@/lib/date-proposals";
import { shortName } from "@/lib/names";

/**
 * An owner's next move for this couple (lib/date-proposals.ts): book their second date, send them on another date,
 * or propose one to the other character's creator (and answer theirs).
 */
export default function NextDate({ pair, next, hasNudge }: { pair: [string, string]; next: NextDateData; hasNudge: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean; shop?: boolean } | null>(null);
  const me = shortName(next.mine.name);
  const them = shortName(next.them.name);
  const o = next.option;

  async function run(call: () => ReturnType<typeof requestJson>, onOk: (data: Record<string, unknown>) => void) {
    setBusy(true);
    setMessage(null);
    const res = await call().catch(() => null);
    setBusy(false);
    if (!res) return setMessage({ text: "Network error. Try again.", error: true });
    if (!res.ok) return setMessage({ text: res.message, error: true, shop: res.status === 429 || res.status === 402 });
    onOk(res.data);
  }
  const book = (extra: Record<string, unknown> = {}) =>
    run(
      () => requestJson("/api/episodes", { character_id: next.mine.id, partner_id: next.them.id, ...extra }),
      (data) => (typeof data.id === "string" ? router.push(`/episodes/${data.id}?play=1`) : router.refresh()),
    );
  const propose = () => run(() => requestJson(`/api/couples/${pair[0]}/${pair[1]}/proposal`, { character_id: next.mine.id }), () => router.refresh());
  const close = (id: string) => run(() => requestJson(`/api/couples/${pair[0]}/${pair[1]}/proposal`, { proposal_id: id }, "DELETE"), () => router.refresh());

  return (
    <section className="card next-date" aria-labelledby="next-date-title">
      <h2 id="next-date-title">Their next date</h2>
      {next.plan.length > 0 && o.kind !== "second_date" && (
        <p className="muted">
          Their plan from last time: {next.plan.map((p) => `“${p}”`).join(" ")}
        </p>
      )}

      {o.kind === "second_date" && next.last_episode_id && <SecondDate episodeId={next.last_episode_id} state={o.state} />}

      {o.kind === "planned" && (
        <p className="notice">
          💞 Their next date is booked. <Link href={`/episodes/${o.episode_id}`}>Watch it</Link>
        </p>
      )}

      {o.kind === "date" && (
        <>
          <p className="muted">
            {o.after === "not_mutual"
              ? `They didn't both want another date last time. You can still send ${me} out with ${them}: they'll remember last time.`
              : o.after === "not_ready"
                ? "Their last date is still being filmed. You can book the next one now."
                : `${them} is ${next.them.house ? "on the show" : "open to dates"}, and they'll remember every date so far.`}
          </p>
          <p>
            <button type="button" className="primary" onClick={() => void book()} disabled={busy}>
              {busy ? "Booking…" : `Send ${me} on a date with ${them}`}
            </button>{" "}
            <span className="muted small">1 token, like any date.</span>
          </p>
        </>
      )}

      {o.kind === "propose" && o.theirs_pending && (
        <>
          <p>
            💌 <strong>{them}&apos;s creator proposed a date with {me}.</strong>
          </p>
          <p>
            <button type="button" className="primary" onClick={() => void book({ proposal_id: o.theirs_pending!.id })} disabled={busy}>
              {busy ? "Booking…" : "Accept and book it"}
            </button>{" "}
            <button type="button" className="button-ghost" onClick={() => void close(o.theirs_pending!.id)} disabled={busy}>
              Not this time
            </button>{" "}
            <span className="muted small">Accepting books it: 1 token, like any date.</span>
          </p>
        </>
      )}

      {o.kind === "propose" && !o.theirs_pending && o.mine_pending && (
        <p className="muted">
          You proposed a date. Waiting for {them}&apos;s creator to accept (they have a week).{" "}
          <button type="button" className="link-button" onClick={() => void close(o.mine_pending!.id)} disabled={busy}>
            Take it back
          </button>
        </p>
      )}

      {o.kind === "propose" && !o.theirs_pending && !o.mine_pending && (
        <>
          <p className="muted">
            {them} isn&apos;t open to dates, so their creator decides. Propose one: they accept to book it (and pay its token), or
            say not this time.
          </p>
          <p>
            <button type="button" className="primary" onClick={() => void propose()} disabled={busy}>
              {busy ? "Proposing…" : `Propose a date with ${them}`}
            </button>
          </p>
        </>
      )}

      {o.kind === "unavailable" && <p className="muted">{o.message}</p>}

      {o.kind !== "unavailable" && o.kind !== "planned" && hasNudge && (
        <p className="muted small">
          <a href="#nudge">Leave {me} a nudge first</a>: it goes into their next date together.
        </p>
      )}

      {message && (
        <p className={message.error ? "error" : "muted"} role="status">
          {message.text}
          {message.shop && (
            <>
              {" "}
              <Link href="/shop">Get tokens</Link>
            </>
          )}
        </p>
      )}
    </section>
  );
}
