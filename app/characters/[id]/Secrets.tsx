import type { CastSecrets } from "@/lib/cast-secrets";
import { SECRET_EVERY } from "@/lib/cast-secrets";

/**
 * A cast member's hidden secrets this season (lib/cast-secrets.ts): the ones out so far, and a lock for each still to
 * come, with how many more public dates until the next. Server-rendered, nothing to click.
 */
export function Secrets({ name, secrets }: { name: string; secrets: CastSecrets }) {
  const locked = secrets.total - secrets.out.length;
  return (
    <section className="card cast-secrets" id="secrets" aria-labelledby="secrets-title">
      <div className="section-head">
        <h2 id="secrets-title">🤫 Secrets</h2>
        <span className="muted">
          {secrets.out.length} of {secrets.total} out
        </span>
      </div>
      <ul className="cast-secrets-list">
        {secrets.out.map((s, i) => (
          <li key={i}>
            <span aria-hidden="true">🔓</span> {s.secret}
          </li>
        ))}
        {Array.from({ length: locked }, (_, i) => (
          <li key={`locked-${i}`} className="muted cast-secret-locked">
            <span aria-hidden="true">🔒</span>{" "}
            {i === 0 && secrets.next_in !== null
              ? `Comes out after ${secrets.next_in} more public ${secrets.next_in === 1 ? "date" : "dates"}`
              : "Still hidden"}
          </li>
        ))}
      </ul>
      <p className="muted small">
        {name} has {secrets.total} this season. One comes out for every {SECRET_EVERY} of their dates that air.
      </p>
    </section>
  );
}
