"use client";

import { useEffect, useRef, useState } from "react";
import RoseSeal from "@/app/RoseSeal";
import { cue } from "./cues";

/**
 * A vote that lands like one (2026-11-28, Dave: "voting that feels like voting"): when a viewer's pick changes to a
 * new one, a ballot drops into the box, the rose seal stamps it, and a "Your vote is in" plate comes up for a few
 * seconds (app/ux/broadcast.css .vote-cast). Never on a page load with a vote already in: only the moment it's cast.
 * The plate is a polite live region, so a screen reader hears it too. Put it right after the ballot.
 */
export default function VoteCast({ pick, label = "Your vote is in" }: { pick: string | null | undefined; label?: string }) {
  const before = useRef(pick ?? null);
  const [cast, setCast] = useState(0);
  useEffect(() => {
    const now = pick ?? null;
    if (now && now !== before.current) {
      setCast((n) => n + 1);
      cue("vote");
    }
    before.current = now;
  }, [pick]);
  useEffect(() => {
    if (!cast) return;
    const t = window.setTimeout(() => setCast(0), 3200);
    return () => window.clearTimeout(t);
  }, [cast]);
  return (
    <span className="vote-cast" role="status">
      {cast > 0 && (
        <span key={cast} className="vote-cast-show">
          <span className="vote-box" aria-hidden="true">
            <span className="vote-ballot" />
          </span>
          <span className="vote-cast-plate">
            <RoseSeal size="sm" className="vote-seal" />
            {label}
          </span>
        </span>
      )}
    </span>
  );
}
