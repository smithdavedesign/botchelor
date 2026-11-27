"use client";

import type { CharacterExtras } from "@/lib/extras";
import { moveTitle, SHOW_FIELDS, showReadiness, type ShowField } from "@/lib/show-ready";
import type { SetExtras } from "./DetailsStep";

/**
 * "Ready for the show" on the builder's review (lib/show-ready.ts): which of the show's format moves this character
 * can already carry, and the one or two details that would unlock more, each a jump back to where it's filled in.
 * Optional and never blocking: a character with none of it still dates and still gets cast.
 */
export default function ShowReadyPanel({
  extras,
  setExtras,
  name,
  jump,
}: {
  extras: CharacterExtras;
  setExtras: SetExtras;
  name: string;
  jump: (to: "voice" | "details") => void;
}) {
  const r = showReadiness(extras);
  const who = name.trim() || "they";
  const asks = r.asks.filter((f) => f !== "villain_ok").slice(0, 3);
  const unlockedBy = (f: ShowField) => r.unlock.filter((u) => u.missing.includes(f)).map((u) => moveTitle(u.move));
  return (
    <section className="card show-ready" aria-labelledby="show-ready-title">
      <h3 id="show-ready-title">
        <span aria-hidden>🎬 </span>Ready for the show <span className="badge">{r.score}%</span>
      </h3>
      <span className="meter-track" role="meter" aria-label="Ready for the show" aria-valuemin={0} aria-valuemax={100} aria-valuenow={r.score}>
        <span className="meter-fill" style={{ width: `${r.score}%` }} />
      </span>
      {r.ready.length > 0 && (
        <p className="small">
          {who === "they" ? "They" : who} can already carry: {r.ready.map(moveTitle).join(", ")}.
        </p>
      )}
      {asks.length > 0 && (
        <ul className="list small">
          {asks.map((f) => {
            const meta = SHOW_FIELDS[f];
            const unlocks = unlockedBy(f);
            return (
              <li key={f}>
                <button type="button" className="link-button" onClick={() => jump(meta.step === "voice" ? "voice" : "details")}>
                  Add “{meta.label}”
                </button>{" "}
                <span className="muted">for {meta.why}{unlocks.length ? ` (unlocks ${unlocks.join(", ")})` : ""}.</span>
              </li>
            );
          })}
        </ul>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={extras.villain_ok === true}
          onChange={(e) => setExtras((p) => ({ ...p, villain_ok: e.target.checked ? true : undefined }))}
        />
        <span>
          Happy for the show to make {who === "they" ? "them" : who} a season&apos;s villain.{" "}
          <span className="muted small">Only ever from their real record (who they clash with on dates), never invented. Off by default.</span>
        </span>
      </label>
    </section>
  );
}
