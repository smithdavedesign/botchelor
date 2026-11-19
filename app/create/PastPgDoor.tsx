"use client";

import { useEffect, useRef } from "react";
import { queueEvent } from "@/app/engagement";
import { PAST_PG_COPY, type PastPgDoor as Door } from "@/lib/adult/past-pg";

/**
 * The past-PG door on /create (lib/adult/past-pg.ts says who sees it): a character refused for going past PG gets two ways
 * on instead of a dead end. "Keep them PG" takes them to the bio, where their words already are; After Dark is the
 * invite request (or the subscription, once a payment processor is set up) carrying source=past_pg. `place` is where
 * the refusal came from: the one-sentence box ("express") or the save ("save"). Shown once per refusal: `past_pg_door`
 * counts it, and each choice is counted by its data-track name (app/engagement.ts), like every other control.
 */
export default function PastPgDoor({ door, place }: { door: Door; place: "express" | "save" }) {
  const counted = useRef(false);
  useEffect(() => {
    if (counted.current) return;
    counted.current = true;
    queueEvent("past_pg_door", { place, kind: door.kind });
  }, [place, door.kind]);
  const toBio = () => {
    const bio = document.querySelector<HTMLTextAreaElement>('textarea[name="bio"]');
    if (!bio) return;
    bio.scrollIntoView({ block: "center" });
    bio.focus();
  };
  return (
    <div className="past-pg-door" data-past-pg-door={place}>
      <p>
        <strong>{PAST_PG_COPY.lead}</strong> {PAST_PG_COPY.choose}
      </p>
      <div className="past-pg-choices">
        <button type="button" className="secondary small" data-track="past-pg-keep" onClick={toBio}>
          {PAST_PG_COPY.keep}
        </button>
        <span className="muted small">{PAST_PG_COPY.keepHint}</span>
      </div>
      <p className="past-pg-ad">
        🌙 {PAST_PG_COPY.adLead}{" "}
        {door.kind === "invite" ? (
          <>
            {PAST_PG_COPY.invite}{" "}
            <a href={door.href} data-track="past-pg-after-dark">
              {PAST_PG_COPY.inviteLink}
            </a>
            .
          </>
        ) : (
          <a className="button small" href={door.href} data-track="past-pg-after-dark">
            {PAST_PG_COPY.join}
          </a>
        )}
      </p>
    </div>
  );
}
