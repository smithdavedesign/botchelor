import { bondReachedLine, bondSinceWords, type BondMark, type StepInBond } from "@/lib/adult/step-in-bond";

/**
 * How well the viewer and this character know each other (lib/adult/step-in-bond.ts), in the scene's header: the
 * level's name and a thin bar toward the next, and on a tap or a key what it's made of. Quiet on purpose: it sits with
 * the place and the roleplay's line, it's never a banner, and it says itself that it only goes up (no streak to keep,
 * nothing to buy). A fold, not a script, so it works before the page comes alive.
 */
export function BondChip({ bond, name }: { bond: StepInBond; name: string }) {
  const made = bondSinceWords(bond.since);
  const about = `How well you and ${name} know each other: ${bond.name}`;
  return (
    <details className="ad-si-bond" data-step-in-bond={bond.level}>
      <summary aria-label={`${about}. What it's made of`} title={about}>
        <span className="ad-si-bond-name">{bond.name}</span>
        <span className="ad-si-bond-bar" aria-hidden="true">
          <span style={{ width: `${Math.round(bond.progress * 100)}%` }} />
        </span>
      </summary>
      <p className="muted small" data-step-in-bond-since>
        {made.length ? `${made.join(" · ")}.` : `You and ${name} have only just met.`}
        {bond.kept ? " Scenes you've since deleted still count." : ""} {bond.next ? `Next: ${bond.next.name}.` : "That's as well as two people get to know each other here."} It comes from the time you
        spend together, and it only ever goes up.
      </p>
    </details>
  );
}

/** Said once, under the reply that crossed into a level: one line, never a modal, gone with the next reply. */
export function BondReached({ bond, name }: { bond: StepInBond; name: string }) {
  if (!bond.reached) return null;
  return (
    <p className="ad-si-bond-up" role="status" data-step-in-bond-reached={bond.level}>
      {bondReachedLine(name, bond.level)}
    </p>
  );
}

/** The small mark a list shows beside a character the viewer has stepped in with: the level's name. Nothing for strangers. */
export function BondMarkTag({ mark, className = "" }: { mark: BondMark | null | undefined; className?: string }) {
  if (!mark) return null;
  return (
    <span className={`ad-bond-mark ${className}`.trim()} data-bond-level={mark.level} title="How well you two know each other, from the time you've spent in scenes together">
      {mark.name}
    </span>
  );
}
