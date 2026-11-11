"use client";

import { useState } from "react";
import Link from "next/link";
import Icon from "@/app/Icon";
import { queueEvent } from "@/app/engagement";
import { ENDINGS, endingLabel, type Ending } from "@/lib/rules";

/**
 * The first-run track, on the hero's sample card (the design system's proposal, built where the card already is: the
 * 2026-11-11 audit, 2.1): a visitor reads a real date's opening lines, calls how it ends with one tap, sees the ending,
 * and is sent to make their own. No score, no account, nothing written: the date aired already, so the call is the
 * show's handshake, not a prediction. The watch link stays for whoever would rather see the whole thing.
 */
export default function FirstRunCall({ ending, dateNumber, watchHref }: { ending: Ending; dateNumber: number | null; watchHref: string }) {
  const [pick, setPick] = useState<Ending | null>(null);
  function call(e: Ending) {
    setPick(e);
    queueEvent("first_run_call", { pick: e, right: e === ending });
  }
  if (!pick) {
    return (
      <div className="first-run">
        <p className="first-run-q">How does it end? Call it.</p>
        <div className="first-run-options" role="group" aria-label="How does it end?">
          {ENDINGS.map((e) => (
            <button key={e} type="button" className="first-run-option" onClick={() => call(e)} data-track="first-run-call" data-track-pick={e}>
              {endingLabel(e, dateNumber)}
            </button>
          ))}
        </div>
        <Link className="first-run-skip" href={watchHref} data-track="excerpt-watch">
          <Icon name="play" /> Or just watch how it ends
        </Link>
      </div>
    );
  }
  const right = pick === ending;
  return (
    <div className="first-run is-called" role="status">
      <p className="first-run-result">
        <strong>{right ? "You called it." : "Not this time."}</strong> It ended in {endingLabel(ending, dateNumber).toLowerCase()}.
        {right ? " Calls like that score points once you have a character." : " Nobody can steer a date, not even its creator."}
      </p>
      <p className="first-run-next">
        <Link className="button" href="/create" data-track="first-run-create">
          Now send yours
        </Link>
        <Link className="first-run-skip" href={watchHref} data-track="excerpt-watch">
          <Icon name="play" /> Watch the whole date
        </Link>
      </p>
    </div>
  );
}
