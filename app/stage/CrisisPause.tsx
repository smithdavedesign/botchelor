import type { ReactNode } from "react";
import CrisisNotice from "@/app/CrisisNotice";
import type { CrisisResources } from "@/lib/crisis";

/**
 * The self-harm protocol's pause on a live stage (docs/safety-protocol.md), the same on every one: who to call or text,
 * what's paused, and the person's two ways on. A step-in date and a companion conversation both use it.
 */
export default function CrisisPause({
  resources,
  paused,
  carryOn,
  leave,
  busy,
  className,
}: {
  resources: CrisisResources;
  /** What's paused, said plainly: "The date is paused. Nothing more is said in character until you choose." */
  paused: string;
  carryOn: { label: string; onClick: () => void };
  /** The way out: a button or a link, styled as the quieter choice. */
  leave: ReactNode;
  busy: boolean;
  className?: string;
}) {
  return (
    <div className={["crisis-pause", className].filter(Boolean).join(" ")}>
      <CrisisNotice resources={resources} />
      <p className="small">{paused}</p>
      <p className="cta-row">
        <button type="button" className="button secondary" onClick={carryOn.onClick} disabled={busy}>
          {carryOn.label}
        </button>
        {leave}
      </p>
    </div>
  );
}
