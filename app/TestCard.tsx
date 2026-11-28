/**
 * The show's test card (2026-11-28, Dave: "technical difficulties" screens): the colour bars a channel puts up when
 * something's gone wrong, in the show's own colours, with a "Please stand by" plate. Decorative: the words beside it say
 * what happened. Styles are app/ux/broadcast.css .test-card.
 */
export default function TestCard({ plate = "Please stand by" }: { plate?: string }) {
  return (
    <div className="test-card" aria-hidden="true">
      <div className="test-card-bars">
        {Array.from({ length: 7 }, (_, i) => (
          <span key={i} />
        ))}
      </div>
      <div className="test-card-strip">
        {Array.from({ length: 7 }, (_, i) => (
          <span key={i} />
        ))}
      </div>
      <span className="test-card-plate">{plate}</span>
    </div>
  );
}
