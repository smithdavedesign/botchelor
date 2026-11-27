"use client";

import { useEffect, useState } from "react";
import { requestJson } from "@/app/request";
import { useAction } from "@/app/useAction";

type Pal = { id: string; name: string };

/** Write a letter: one of your characters, someone they've dated, and the words. It arrives hours later. */
export default function Compose({ mine, max, hours, replyTo }: { mine: Pal[]; max: number; hours: number; replyTo?: { id: string; from: string; to: Pal } | null }) {
  const { busy, error, run } = useAction();
  const [from, setFrom] = useState(replyTo?.from ?? mine[0]?.id ?? "");
  const [pals, setPals] = useState<Pal[] | null>(replyTo ? [replyTo.to] : null);
  const [to, setTo] = useState(replyTo?.to.id ?? "");
  const [body, setBody] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (replyTo || !from) return;
    let live = true;
    fetch(`/api/letters?pals=${encodeURIComponent(from)}`)
      .then((r) => r.json())
      .then((d: { pals?: Pal[] }) => {
        if (!live) return;
        setPals(d.pals ?? []);
        setTo(d.pals?.[0]?.id ?? "");
      })
      .catch(() => live && setPals([]));
    return () => {
      live = false;
    };
  }, [from, replyTo]);

  if (!mine.length) return <p className="muted">Make a character and send them on a date first: letters are for characters who&apos;ve met.</p>;
  if (sent) return <p className="notice">Sent. It arrives in about {hours} hours.</p>;

  const send = () =>
    run(async () => {
      const r = await requestJson("/api/letters", { from_character: from, to_character: to, body, reply_to: replyTo?.id ?? null });
      if (r.ok) setSent(true);
      return r;
    });

  return (
    <form
      className="letter-compose"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      <div className="letter-row">
        <label>
          From
          <select value={from} onChange={(e) => setFrom(e.target.value)} disabled={!!replyTo}>
            {mine.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          To
          <select value={to} onChange={(e) => setTo(e.target.value)} disabled={!!replyTo || !pals?.length}>
            {(pals ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {pals && pals.length === 0 && <p className="muted small">No one to write to yet: this character hasn&apos;t dated anyone else&apos;s character.</p>}
      <label className="letter-body">
        <span className="sr-only">Your letter</span>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={8} maxLength={max} placeholder="Dear…" required />
      </label>
      <p className="muted small">
        {body.length} / {max}. In your character&apos;s own words: no links, and PG like the show.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="button" disabled={busy || !to || body.trim().length < 20}>
        {replyTo ? "Send the reply" : "Send the letter"}
      </button>
    </form>
  );
}
