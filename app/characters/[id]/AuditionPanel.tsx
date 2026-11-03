"use client";

import Link from "next/link";
import { requestJson } from "@/app/request";
import { useAction } from "@/app/useAction";
import { AUDITION_BLOCKS } from "@/lib/audition-words";
import type { MyAudition } from "@/lib/auditions";

/**
 * The owner's audition for next month's cast (lib/auditions.ts): what stands in the way, the button with what being
 * cast means, or how the audition's going and a way out.
 */
export default function AuditionPanel({ id, name, audition: a }: { id: string; name: string; audition: MyAudition }) {
  const { busy, error, run } = useAction();
  const url = `/api/characters/${id}/audition`;
  const live = a.status === "open" || a.status === "approved";
  if (a.on_cast) {
    const until = new Date(a.on_cast.until).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
    return (
      <section className="card audition-panel" aria-labelledby="audition-head">
        <p className="kicker">On the cast · {a.on_cast.label}</p>
        <h2 id="audition-head">🎬 {name} is on the show</h2>
        <p className="small">
          For {a.on_cast.label}, anyone can take {name} on a date by name, the show books it into the lobby&apos;s dates, and viewers can
          back it. Its sheet is locked until {until}. If it&apos;s one of the two best-loved when the month ends, it stays on.
        </p>
        <p>
          <button
            type="button"
            className="button-ghost small"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Take ${name} off the show? It leaves the cast now and can't come back this month.`)) run(() => requestJson(url, {}, "DELETE"));
            }}
          >
            Take it off the show
          </button>
        </p>
        {error && <p className="error small" role="alert">{error}</p>}
      </section>
    );
  }
  return (
    <section className="card audition-panel" aria-labelledby="audition-head">
      <p className="kicker">Casting · {a.label}</p>
      <h2 id="audition-head">{live ? `${name} is auditioning` : `Put ${name} on the show`}</h2>
      {live ? (
        <>
          <p className="small">
            {a.status === "approved" ? <span className="chip">Shortlisted</span> : <span className="chip">Waiting on the producers</span>}{" "}
            {a.votes} vote{a.votes === 1 ? "" : "s"} so far. The shortlisted auditions with the most votes join the {a.label} cast when the month starts.{" "}
            <Link href="/casting">Share the casting page</Link> to get votes.
          </p>
          <p>
            <button type="button" className="button-ghost small" disabled={busy} onClick={() => run(() => requestJson(url, {}, "DELETE"))}>
              Withdraw
            </button>
          </p>
        </>
      ) : a.blocks.length ? (
        <>
          <p className="muted small">People&apos;s characters can audition for next month&apos;s cast. Before {name} can:</p>
          <ul className="small">
            {a.blocks.map((b) => (
              <li key={b}>{AUDITION_BLOCKS[b]}</li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <p className="small">
            Audition {name} for the {a.label} cast. If the producers shortlist it and it gets the votes, for that month anyone can take
            it on a date by name (the show pays), the show books it into the lobby&apos;s dates and the cast group chat, and its sheet
            is locked until the month ends. You can withdraw it any time.
          </p>
          <p>
            <button type="button" className="primary" disabled={busy} onClick={() => run(() => requestJson(url, { consent: true }))} data-track="audition">
              Audition for {a.label}
            </button>
          </p>
        </>
      )}
      {error && <p className="error small" role="alert">{error}</p>}
    </section>
  );
}
