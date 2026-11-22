import DareVote from "./DareVote";
import SituationVote from "./SituationVote";
import type { DareBoard } from "@/lib/dares";
import type { SituationBoard } from "@/lib/situations";

/**
 * Tonight's two votes as one card on home (the 2026-11-21 product review: an owner's home stacked ten modules, two of
 * them near-identical ballots one under the other). The situation and the dare keep their own questions, choices and
 * last results (app/SituationVote.tsx, app/DareVote.tsx, each as a `part`), under one heading and inside one frame:
 * side by side on a wide screen, one after the other between, and on a phone side by side again in one sideways row
 * (the 2026-11-22 audit: stacked, the card was two of a phone's seven screens). A night with only one of them shows
 * that one as the card it always was. /watch keeps the two as separate cards in its own grid of ballots.
 */
export default function TonightVotes({
  situation,
  dares,
  now,
  insider = false,
}: {
  situation: SituationBoard | null;
  dares: DareBoard | null;
  now: number;
  insider?: boolean;
}) {
  if (!situation && !dares) return null;
  if (!situation) return <DareVote board={dares!} insider={insider} />;
  if (!dares) return <SituationVote board={situation} now={now} insider={insider} />;
  return (
    <section id="tonight-votes" className="card situation tonight-votes" aria-labelledby="tonight-votes-head">
      <div className="tonight-votes-head">
        <p className="kicker">Tonight · you pick</p>
        <h2 id="tonight-votes-head">Tonight&apos;s two votes</h2>
      </div>
      <div className="tonight-votes-parts scroll-row">
        <SituationVote board={situation} now={now} insider={insider} part />
        <DareVote board={dares} insider={insider} part />
      </div>
    </section>
  );
}
