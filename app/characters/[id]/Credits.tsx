import Link from "next/link";
import { ROLE_LABEL, type AuditionStanding, type CharacterCredit } from "@/lib/profile/credits";
import { datesCount, yesesTail } from "@/lib/rules";
import { english, msg, type T } from "@/lib/i18n/translate";

const AUDITION: Record<AuditionStanding, string> = {
  open: msg("Auditioned: waiting to hear"),
  approved: msg("Auditioned: shortlisted"),
  rejected: msg("Auditioned: not this time"),
  withdrawn: msg("Audition withdrawn"),
};

/** "14 dates, 6 ending in a yes to another" (lib/rules.ts yesesTail). */
function tally(c: CharacterCredit): string {
  if (!c.dates) return "";
  return `${datesCount(c.dates)}${yesesTail(c.dates, c.second_dates)}`;
}

/**
 * On the show (lib/profile/credits.ts): every season this character has been in, as what, and what came of it. The
 * public record for everyone; its owner also reads how an audition stands. Nothing to press: each season links to its
 * own page. Absent when there is nothing to say.
 */
export default function Credits({ credits, first, t = english }: { credits: CharacterCredit[]; first: string; t?: T }) {
  if (!credits.length) return null;
  return (
    <section className="card character-credits" id="credits" aria-labelledby="credits-title">
      <h2 id="credits-title">{t("On the show")}</h2>
      <ul className="credits-list">
        {credits.map((c) => {
          const facts = [tally(c), ...c.honours.map((h) => h.label)].filter(Boolean);
          // An audition alone isn't a part in the season: the line is the audition, not "dated on the show".
          const part = c.role === "guest" && c.dates === 0 && c.audition ? t(AUDITION[c.audition]) : `${t(ROLE_LABEL[c.role])}${c.withdrawn ? ` ${t("(left the cast)")}` : ""}`;
          return (
            <li key={c.season_id} className="credit" data-credit-role={c.role}>
              <p className="credit-head">
                <Link href={c.path} data-track="credit-season">
                  {c.number ? `${t("Season {n}", { n: c.number })} · ` : ""}
                  {c.label}
                </Link>
                {/* No dot before it: the row wraps on a phone, and a dot would start the second line. The gap parts them. */}
                {c.format_title && <span className="muted">{c.format_title}</span>}
                {c.when === "now" && <span className="chip">{t("On now")}</span>}
                {c.when === "next" && <span className="chip">{t("Coming up")}</span>}
              </p>
              <p className="credit-part">
                <strong>{part}</strong>
                {facts.length > 0 && <span className="muted"> · {facts.join(" · ")}</span>}
              </p>
              {c.audition && !(c.role === "guest" && c.dates === 0) && <p className="muted small">{t(AUDITION[c.audition])} {t("(only you see this)")}</p>}
            </li>
          );
        })}
      </ul>
      <p className="muted small">{t("What {name} has been in, from dates that aired.", { name: first })}</p>
    </section>
  );
}
