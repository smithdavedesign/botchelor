import Link from "next/link";
import { alternativePath, type Alternative } from "@/lib/alternatives";
import { ALTERNATIVE_APPS_CHECKED, checkedDay, FACT_LABELS, NAMES_NOTE, pageForApp, shownFacts, type AlternativeApp, type AppFact } from "@/lib/alternative-apps";

/**
 * A quiet link to the page that says something: ours in the site, another app's in a new tab and never followed. A
 * fact that rests on two pages has "source" and "source 2".
 */
function Source({ app, href, what, second = false }: { app: AlternativeApp; href: string; what: string; second?: boolean }) {
  const label = (
    <>
      {second ? "source 2" : "source"}
      <span className="sr-only">{`: ${app.name}, ${what}`}</span>
    </>
  );
  return app.self ? (
    <Link className="muted small" href={href}>
      {label}
    </Link>
  ) : (
    <a className="muted small" href={href} rel="nofollow noopener" target="_blank">
      {label}
    </a>
  );
}

/**
 * The apps people use instead of the page's own (lib/alternative-apps.ts), under the hero: alphabetical, each a block
 * of facts from its own site with a link to where it says so, and no pictures, marks, scores or verdicts. Blocks stack
 * at every width; each app's facts use the press page's list, one column on a phone. Its links are quiet: the page's
 * one loud button stays "Bring your character". `now` decides which dated facts still show (lib/alternative-apps.ts).
 */
export default function AlternativeApps({ alt, apps, now = new Date() }: { alt: Alternative; apps: readonly AlternativeApp[]; now?: Date }) {
  return (
    <section className="card alt-apps" aria-labelledby="alt-apps-title">
      <h2 id="alt-apps-title">{`${apps.length} apps people use instead of ${alt.name}`}</h2>
      <p className="muted small">
        In alphabetical order. Every fact is from the app&apos;s own site, checked on{" "}
        <time dateTime={ALTERNATIVE_APPS_CHECKED}>{checkedDay()}</time>, with a link to where it says so. Prices and rules
        change, so check there before you pay.
      </p>
      <ul className="alt-apps-list">
        {apps.map((app) => {
          const page = app.self ? undefined : pageForApp(app.id);
          const facts = shownFacts(app, now);
          return (
            <li key={app.id} className="alt-app">
              <h3>
                {app.self ? (
                  <Link href={app.home}>{app.name}</Link>
                ) : (
                  <a href={app.home} rel="nofollow noopener" target="_blank">
                    {app.name}
                  </a>
                )}
                {app.self && <span className="muted small"> (this site)</span>}
              </h3>
              <p>
                {app.about} <Source app={app} href={app.aboutSource ?? app.home} what="what it is" />
              </p>
              {facts.length > 0 && (
                <dl className="press-facts">
                  {facts.map((f) => (
                    <FactRow key={`${f.kind}-${f.source}-${f.value}`} app={app} label={FACT_LABELS[f.kind]} fact={f} />
                  ))}
                </dl>
              )}
              {page && (
                <p className="muted small">
                  <Link href={alternativePath(page)}>{`Moving from ${app.name}`}</Link>
                </p>
              )}
            </li>
          );
        })}
      </ul>
      <p className="muted small">{NAMES_NOTE}</p>
    </section>
  );
}

function FactRow({ app, label, fact }: { app: AlternativeApp; label: string; fact: AppFact }) {
  const what = label.toLowerCase();
  return (
    <>
      <dt>{label}</dt>
      <dd>
        {fact.value} <Source app={app} href={fact.source} what={what} />
        {fact.also && (
          <>
            <span className="muted small"> · </span>
            <Source app={app} href={fact.also} what={what} second />
          </>
        )}
      </dd>
    </>
  );
}
