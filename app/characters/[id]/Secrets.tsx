import type { CastSecrets } from "@/lib/cast-secrets";
import { SECRET_EVERY } from "@/lib/cast-secrets";
import { english, type T } from "@/lib/i18n/translate";

/**
 * A cast member's hidden secrets this season (lib/cast-secrets.ts): the ones out so far, and a lock for each still to
 * come, with how many more public dates until the next. Or (own) what a creator says their character is hiding (Go
 * deeper): those come out only when one slips on a date, so no count. Server-rendered, nothing to click.
 */
export function Secrets({ name, secrets, t = english }: { name: string; secrets: CastSecrets & { own?: boolean }; t?: T }) {
  const locked = secrets.total - secrets.out.length;
  return (
    <section className="card cast-secrets" id="secrets" aria-labelledby="secrets-title">
      <div className="section-head">
        <h2 id="secrets-title">🤫 {t("Secrets")}</h2>
        <span className="muted">
          {t("{n} of {total} out", { n: secrets.out.length, total: secrets.total })}
        </span>
      </div>
      <ul className="cast-secrets-list">
        {secrets.out.map((s, i) => (
          <li key={i}>
            <span aria-hidden="true">🔓</span> {s.secret}
            {s.voted && (
              <>
                {" "}
                <span className="chip">🗳️ {t("Voted out by the audience")}</span>
              </>
            )}
          </li>
        ))}
        {Array.from({ length: locked }, (_, i) => (
          <li key={`locked-${i}`} className="muted cast-secret-locked">
            <span aria-hidden="true">🔒</span>{" "}
            {secrets.own
              ? t("Still hidden")
              : i === 0 && secrets.next_in !== null
              ? secrets.next_in === 1
                ? t("Comes out after 1 more public date")
                : t("Comes out after {n} more public dates", { n: secrets.next_in })
              : t("Still hidden")}
          </li>
        ))}
      </ul>
      <p className="muted small">
        {secrets.own
          ? secrets.total === 1
            ? t("{name} is hiding something. One only comes out when a date draws it out of them, once that date airs.", { name })
            : t("{name} is hiding {n} things. One only comes out when a date draws it out of them, once that date airs.", { name, n: secrets.total })
          : t("{name} has {n} this season. One comes out for every {every} of their dates that air, and on Sundays the audience can vote one out.", { name, n: secrets.total, every: SECRET_EVERY })}
      </p>
    </section>
  );
}
