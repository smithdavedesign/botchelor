import { Face, TieLine, TieList } from "@/app/StoryMap";
import type { CircleData } from "@/lib/story-map";

/**
 * One character's circle this week (lib/story-map.ts circleOf / loadCircle): them in the middle, up to six people
 * round them, each joined by the strongest tie between the two, and the same ties as a list (which is what a screen
 * reader gets; the drawing is aria-hidden). From the shared story map, so it shows only what the map may show.
 *
 * Plain and synchronous: the data comes in as props, so a page that renders in one pass (the character page) can put
 * `loadCircle(db, id)` in its own Promise.all and render `{circle && <Circle circle={circle} />}`. Nothing to show is
 * the loader's null, never an empty box.
 */

const SIZE = 300;
const C = SIZE / 2;
const R_CENTER = 40;
const R_AROUND = 27;
const RING = 104;

export default function Circle({ circle, title, id = "circle" }: { circle: CircleData; title?: string; id?: string }) {
  const { center, around } = circle;
  const n = around.length;
  const spots = around.map((a, i) => {
    // From the top, clockwise; one or two sit beside the centre so their names don't meet its own.
    const deg = (n <= 2 ? 180 : -90) + (360 / n) * i;
    const rad = (deg * Math.PI) / 180;
    return { ...a, x: Math.round(C + RING * Math.cos(rad)), y: Math.round(C - 8 + RING * Math.sin(rad)), r: R_AROUND };
  });
  const mid = { x: C, y: C - 8, r: R_CENTER };
  const headId = `${id}-head`;
  // One or two people sit on the centre's own row: the drawing is that row, not a square that is mostly empty.
  const box = n <= 2 ? `0 ${mid.y - R_CENTER - 10} ${SIZE} ${R_CENTER + R_AROUND + 56}` : `0 0 ${SIZE} ${SIZE}`;
  return (
    <section id={id} className="story-circle" aria-labelledby={headId} data-track-area="story-circle">
      <h2 id={headId} className="section">
        {title ?? `${center.name}'s circle this week`}
      </h2>
      <div className="story-circle-body">
        <TieList ties={around.map((a) => a.tie)} className="story-circle-list" />
        <svg className="story-circle-svg" viewBox={box} role="presentation" aria-hidden="true" focusable="false">
          {spots.map((s) => (
            <TieLine key={s.tie.id} tie={s.tie} from={mid} to={s} />
          ))}
          {spots.map((s) => (
            <Face key={s.person.id} p={s.person} x={s.x} y={s.y} r={s.r} scope={id} />
          ))}
          <Face p={center} x={mid.x} y={mid.y} r={mid.r} scope={id} named={false} />
        </svg>
      </div>
      {circle.more > 0 && (
        <p className="muted small story-circle-more">
          And {circle.more} more this week.
        </p>
      )}
    </section>
  );
}
