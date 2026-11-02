import Link from "next/link";
import { SHIFT_DAYS, type ChemistryShift, type ChemistryShifts } from "@/lib/chemistry-shifts";

function Row({ s }: { s: ChemistryShift }) {
  return (
    <li>
      <Link href={`/couples/${s.lo}/${s.hi}`}>
        {s.a} &amp; {s.b}
      </Link>
      <span className={`chem-shift-num ${s.shift > 0 ? "up" : "down"}`}>
        {s.before} → {s.now} ({s.shift > 0 ? "+" : "−"}
        {Math.abs(s.shift)})
      </span>
    </li>
  );
}

/** The week's biggest chemistry shifts (lib/chemistry-shifts.ts) on /watch: the couples warming up and going cold. */
export default function ChemistryShiftsPanel({ shifts }: { shifts: ChemistryShifts }) {
  if (!shifts.up.length && !shifts.down.length) return null;
  return (
    <section className="watch-section" aria-labelledby="chem-shifts">
      <h2 id="chem-shifts">Biggest chemistry shifts this week</h2>
      <div className="chem-shifts">
        {shifts.up.length > 0 && (
          <div>
            <h3>
              <span aria-hidden="true">🔥</span> Heating up
            </h3>
            <ul>
              {shifts.up.map((s) => (
                <Row key={`${s.lo}-${s.hi}`} s={s} />
              ))}
            </ul>
          </div>
        )}
        {shifts.down.length > 0 && (
          <div>
            <h3>
              <span aria-hidden="true">🧊</span> Cooling off
            </h3>
            <ul>
              {shifts.down.map((s) => (
                <Row key={`${s.lo}-${s.hi}`} s={s} />
              ))}
            </ul>
          </div>
        )}
      </div>
      <p className="muted small">How far each couple&apos;s chemistry meter moved with their public dates in the last {SHIFT_DAYS} days.</p>
    </section>
  );
}
