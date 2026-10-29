"use client";

/**
 * A bigger shoot as it lands (the creator suite; lib/adult/studio.ts advanceShoot): a slot for every picture asked, each
 * one developing in as it's kept, how many so far, and a bar. Pictures fade in, never blur in (discreet mode's blur stays
 * as it is), and reduced motion keeps them still.
 */
export default function ShootReveal({ asked, made, pictures, src, label, started }: { asked: number; made: number; pictures: string[]; src: (id: string) => string; label: string; started: string }) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(started).getTime()) / 60_000));
  return (
    <section className="studio-reveal card" aria-label={`${label}: ${made} of ${asked}`}>
      <p className="studio-reveal-head">
        <strong>{label}</strong>{" "}
        <span className="muted small" role="status" aria-live="polite">
          {made} of {asked} so far{minutes ? ` · ${minutes} min` : ""} · you can leave and come back
        </span>
      </p>
      <div className="studio-reveal-bar" aria-hidden="true">
        <span style={{ width: `${Math.round((100 * made) / Math.max(1, asked))}%` }} />
      </div>
      <ul className="studio-reveal-grid">
        {Array.from({ length: asked }, (_, i) => {
          const id = pictures[i];
          return (
            <li key={id ?? `slot-${i}`}>
              {id ? (
                // eslint-disable-next-line @next/next/no-img-element -- private, presigned media
                <img className="studio-develop" src={src(id)} alt={`${label}, picture ${i + 1}`} loading="lazy" />
              ) : (
                <span className="studio-skeleton" aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
