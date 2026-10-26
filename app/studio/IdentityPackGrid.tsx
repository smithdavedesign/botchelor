"use client";

import { useState } from "react";
import { IDENTITY_VIEWS, type IdentityViewId } from "@/lib/studio/identity-views";

type Pack = Partial<Record<IdentityViewId, { id: string; stale: boolean }>>;

/**
 * The identity pack (the creator suite; lib/studio/identity-views.ts), the same in both Studios: their eight views, each
 * drawn from the face they keep. Draw them all, the missing ones, or the ones picked (a tap on a view), each for its
 * share of the price. A view drawn from an earlier face says so and isn't used until it's drawn again.
 */
export default function IdentityPackGrid({
  pack,
  name,
  price,
  src,
  busy,
  onDraw,
  uses,
}: {
  pack: Pack;
  name: string;
  /** What drawing `views` of them costs, as words ("2 tokens", "free for admins"). */
  price: (views: number) => string;
  src: (id: string) => string;
  busy: boolean;
  onDraw: (views: IdentityViewId[]) => void;
  /** What the pack is for, in this Studio. */
  uses: string;
}) {
  const [picked, setPicked] = useState<IdentityViewId[]>([]);
  const missing = IDENTITY_VIEWS.filter((v) => !pack[v.id] || pack[v.id]!.stale).map((v) => v.id);
  const have = IDENTITY_VIEWS.length - missing.length;
  const toggle = (v: IdentityViewId) => setPicked((x) => (x.includes(v) ? x.filter((y) => y !== v) : [...x, v]));
  const draw = (views: IdentityViewId[]) => {
    setPicked([]);
    onDraw(views);
  };
  return (
    <section className="studio-identity-pack" aria-label={`${name}'s identity pack`}>
      <p className="studio-identity-head">
        <strong>Identity pack</strong> <span className="muted small">{have ? `${have} of ${IDENTITY_VIEWS.length} views` : "Not drawn yet"}</span>
      </p>
      <p className="muted small">{uses}</p>
      <ul className="studio-identity-grid">
        {IDENTITY_VIEWS.map((v) => {
          const view = pack[v.id];
          const on = picked.includes(v.id);
          return (
            <li key={v.id} className={`studio-identity-view${view?.stale ? " stale" : ""}${on ? " picked" : ""}`}>
              <button type="button" className="studio-identity-pick" aria-pressed={on} disabled={busy} onClick={() => toggle(v.id)} title={on ? "Not this one" : "Pick it to redraw"}>
                {view ? (
                  // eslint-disable-next-line @next/next/no-img-element -- private, presigned media
                  <img src={src(view.id)} alt={`${name}, ${v.label.toLowerCase()}`} loading="lazy" />
                ) : (
                  <span className="studio-identity-empty" aria-hidden="true">
                    ＋
                  </span>
                )}
                <span className="studio-identity-label small">
                  {on ? "✓ " : ""}
                  {v.label}
                </span>
                {view?.stale && <span className="studio-identity-note small">earlier face</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="studio-identity-actions">
        {picked.length > 0 ? (
          <button type="button" className="primary small" disabled={busy} onClick={() => draw(picked)}>
            Redraw {picked.length} · {price(picked.length)}
          </button>
        ) : missing.length === IDENTITY_VIEWS.length ? (
          <button type="button" className="primary small" disabled={busy} onClick={() => draw(missing)}>
            Draw all {IDENTITY_VIEWS.length} · {price(IDENTITY_VIEWS.length)}
          </button>
        ) : missing.length > 0 ? (
          <button type="button" className="primary small" disabled={busy} onClick={() => draw(missing)}>
            Draw the {missing.length === 1 ? "one" : missing.length} still to do · {price(missing.length)}
          </button>
        ) : (
          <span className="muted small">All {IDENTITY_VIEWS.length} drawn. Tap a view to redraw it.</span>
        )}
        {busy && <span className="muted small">Drawing… a minute or two.</span>}
      </div>
    </section>
  );
}
