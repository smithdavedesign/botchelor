"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { requestJson } from "@/app/request";
import type { ArcQuestion } from "@/lib/arcs";
import { POINTS_PER_ARC } from "@/lib/rules";

/** Follow a couple (lib/follows.ts). */
export function FollowButton({ pair, following, followers }: { pair: [string, string]; following: boolean; followers: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function toggle() {
    setBusy(true);
    await requestJson(`/api/couples/${pair[0]}/${pair[1]}/follow`, {}, following ? "DELETE" : "POST").catch(() => null);
    setBusy(false);
    router.refresh();
  }
  return (
    <p className="couple-follow action-hint">
      <button type="button" className={following ? "button-ghost" : "secondary"} onClick={toggle} disabled={busy} aria-pressed={following}>
        {following ? "Following ✓" : "🔔 Follow this couple"}
      </button>{" "}
      <span className="muted small">
        {followers === 1 ? "1 follower" : `${followers} followers`} · hear when they go on another date
      </span>
    </p>
  );
}

/** "Will they make it to date N?" (lib/arcs.ts). */
export function ArcCard({ pair, names, q }: { pair: [string, string]; names: string; q: ArcQuestion }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function call(pick: "yes" | "no") {
    setBusy(true);
    setError(null);
    const res = await requestJson(`/api/couples/${pair[0]}/${pair[1]}/arc`, { pick }).catch(() => null);
    setBusy(false);
    if (!res) return setError("Network error. Try again.");
    if (!res.ok) return setError(res.message);
    router.refresh();
  }
  const total = q.yes + q.no;
  return (
    <section className="card">
      <h2>🔮 Will they make it to date {q.target}?</h2>
      <p className="muted">
        A right call earns {POINTS_PER_ARC} points (they count in your leagues). It settles when they get there, when
        they break up, or after three weeks.
      </p>
      {total > 0 && (
        <p className="muted small">
          {q.yes} say yes · {q.no} say no
        </p>
      )}
      {q.my_pick !== null ? (
        <p>
          Your call: <strong>{q.my_pick ? "they'll make it" : "they won't"}</strong>.
        </p>
      ) : q.can_predict ? (
        <p>
          {/* The same weight for both answers: a filled Yes nudged the call. */}
          <button type="button" className="secondary" onClick={() => call("yes")} disabled={busy}>
            Yes, they will
          </button>{" "}
          <button type="button" className="secondary" onClick={() => call("no")} disabled={busy}>
            No, they won&apos;t
          </button>
        </p>
      ) : q.reason === "owner" ? (
        <p className="muted small">You own one of {names}, so this call is for everyone else.</p>
      ) : q.reason === "breakup" ? (
        <p className="muted small">They&apos;ve broken up: no arc to call right now.</p>
      ) : null}
      {q.settled.length > 0 && (
        <ul className="list">
          {q.settled.map((s) => (
            <li key={s.target} className="muted small">
              Date {s.target}: you said {s.pick ? "yes" : "no"}, they {s.outcome ? "made it" : "didn't"}
              {s.points ? ` (+${s.points})` : ""}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

/** Copy a page's link (or share it, where the browser can: then it says Share). A couple's, a character's. */
export function CopyLink({ path, title }: { path: string; title: string }) {
  const [done, setDone] = useState(false);
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare(typeof navigator.share === "function"), []);
  async function share() {
    const url = new URL(path, window.location.origin).toString();
    if (navigator.share) {
      await navigator.share({ title, url }).catch(() => null);
      return;
    }
    const ok = await navigator.clipboard.writeText(url).then(() => true).catch(() => false);
    setDone(ok);
  }
  return (
    <button type="button" className="link-button" onClick={() => void share()}>
      {done ? "Link copied ✓" : canShare ? "🔗 Share" : "🔗 Copy link"}
    </button>
  );
}
