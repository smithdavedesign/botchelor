"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { trackConversion } from "@/app/conversion";
import DateConfirm from "@/app/DateConfirm";
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
  // David, 2026-10-23: the owner may say where (else the place they agreed by text, else the show picks).
  const [place, setPlace] = useState("");
  // Booking spends a date, so it asks first in a sheet (2026-10-31 UX audit, C2): "date" plans one, "accept" books theirs.
  const [confirm, setConfirm] = useState<null | { kind: "date" } | { kind: "accept"; id: string }>(null);
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
      (data) => {
        if (typeof data.id !== "string") return router.refresh();
        // A date started from here counts like one from /create, RepoHQ's activation included (app/conversion.ts).
        trackConversion("date_started", { mode: "partner" });
        router.push(`/episodes/${data.id}?play=1`);
      },
    );
  const propose = () => run(() => requestJson(`/api/couples/${pair[0]}/${pair[1]}/proposal`, { character_id: next.mine.id }), () => router.refresh());
  const close = (id: string) => run(() => requestJson(`/api/couples/${pair[0]}/${pair[1]}/proposal`, { proposal_id: id }, "DELETE"), () => router.refresh());

  return (
    <section className="card next-date" aria-labelledby="next-date-title">
      <h2 id="next-date-title">Their next date</h2>
      {next.plan.length > 0 && o.kind !== "second_date" && (
        <p className="muted">
          {next.plan_place ? "They agreed by text: " : "Their plan from last time: "}
          {next.plan.map((p) => `“${p}”`).join(" ")}
          {next.plan_place && (
            <>
              {" "}
              Their next date happens there: <strong>{next.plan_place}</strong>.
            </>
          )}
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
          <p className="action-hint">
            <button type="button" className="primary" onClick={() => setConfirm({ kind: "date" })}>
              📅 Plan {me}&apos;s date with {them}
            </button>
          </p>
        </>
      )}

      {o.kind === "propose" && o.theirs_pending && (
        <>
          <p>
            💌 <strong>{them}&apos;s creator proposed a date with {me}.</strong>
          </p>
          <p className="action-hint">
            <button type="button" className="primary" onClick={() => setConfirm({ kind: "accept", id: o.theirs_pending!.id })} disabled={busy}>
              Accept and book it
            </button>{" "}
            <button type="button" className="button-ghost" onClick={() => void close(o.theirs_pending!.id)} disabled={busy}>
              Not this time
            </button>{" "}
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

      {o.kind === "unavailable" &&
        (o.taken ? (
          // One of theirs is with someone else and wants only them: the badge, why, and where to change it.
          <p className="taken-note" role="note">
            <span className="badge taken-tag">💍 {o.taken.partner ? `With ${shortName(o.taken.partner.name)}` : "Taken"}</span> {o.message}{" "}
            <Link href={`/characters/${o.taken.id}#partners-${o.taken.id}`}>Change it on {me}&apos;s page</Link>
          </p>
        ) : (
          <p className="muted">{o.message}</p>
        ))}

      {o.kind !== "unavailable" && o.kind !== "planned" && hasNudge && (
        <p className="muted small">
          <a
            href="#nudge"
            onClick={() => {
              const fold = document.getElementById("nudge");
              if (fold instanceof HTMLDetailsElement) fold.open = true;
            }}
          >
            Leave {me} a nudge first
          </a>
          : it goes into their next date together.
        </p>
      )}

      {message && !confirm && (
        <p className={message.error ? "error" : "muted"} role="status">
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
        open={confirm !== null}
        onClose={() => {
          setConfirm(null);
          setMessage(null);
        }}
        title={confirm?.kind === "accept" ? "Book the date they proposed?" : `Plan ${me}'s date`}
        lede={
          <>
            <strong>{me}</strong> meets <strong>{them}</strong> again, and they&apos;ll remember every date so far. The show films it and decides how it ends.
          </>
        }
        sendLabel={confirm?.kind === "accept" ? "Accept and book it" : `Send ${me} on the date`}
        busyLabel="Booking…"
        busy={busy}
        error={message?.error ? { text: message.text, shop: message.shop } : null}
        onSend={() => void book(confirm?.kind === "accept" ? { proposal_id: confirm.id } : place.trim() ? { place: place.trim() } : {})}
      >
        {confirm?.kind === "date" && (
          <label className="next-date-place">
            Where? <span className="muted small">(optional)</span>
            <input
              type="text"
              name="place"
              maxLength={80}
              value={place}
              placeholder={next.plan_place ?? "the night market, my place, under the old footbridge…"}
              onChange={(e) => setPlace(e.target.value)}
            />
          </label>
        )}
      </DateConfirm>
    </section>
  );
}
