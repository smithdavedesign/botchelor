import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { isSignedInAdmin } from "@/lib/admins";
import { houseProviderStatus, type HouseCard } from "@/lib/adult/provider-status";
import { lockedForCookies } from "@/lib/adult/privacy";
import { afterDarkHref } from "@/lib/after-dark-host";
import { currentUsage, listConnections } from "@/lib/connections";
import {
  JOB_INFO,
  JOBS,
  jobCards,
  modelOptions,
  PROVIDER_INFO,
  providersFor,
  type ConnectionSummary,
  type Job,
} from "@/lib/connections-shared";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import { byokAvailable } from "@/lib/keys";
import ConnectionCard from "./ConnectionCard";
import JobCard from "./JobCard";
import type { AlsoJob, FlowProvider } from "./KeyForm";
import LocalTime from "./LocalTime";
import YourKeys from "./YourKeys";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Connections · Botchelor", robots: { index: false, follow: false } };

/** Why you'd tick "Also use this key for …" on a job that has no key yet. */
const ALSO_NOTE: Record<Job, string> = {
  text: "your characters' lines on dates and texts",
  image: "only when you make a portrait",
  video: "only when you make a clip, on your Google bill",
};

/** The After Dark card's one line: each house provider and how it is, a pause in the viewer's own time. */
function houseLine(cards: HouseCard[]) {
  return cards.map((c, i) => (
    <span key={c.provider}>
      {i > 0 && " · "}
      {c.label}{" "}
      {c.state === "paused" && c.until ? (
        <>
          ⏸ until <LocalTime iso={c.until} />
        </>
      ) : c.state === "no_key" ? (
        "no key"
      ) : c.state === "standby" ? (
        "standby"
      ) : (
        "✓"
      )}
    </span>
  ));
}

/**
 * Connections (docs/PRDs/connections.md): bring your own model key for each job, organised by what it's for. One card per
 * job says what it runs on ("Using: Botchelor's free model", or "Your OpenRouter key ✓ · openai/gpt-4.1-mini"), with its
 * key's last four, when it was checked and last used, and anything wrong in plain words with the fix. Connecting opens
 * under the card: provider, key, Test, model, Save. An admin also sees After Dark's house providers here, read-only.
 * The engine still decides every ending (lib/engine.ts); only the words change.
 */
export default async function KeysPage() {
  const store = await cookies();
  const auth = authFromCookieStore(store);
  if (!byokAvailable()) {
    return (
      <article>
        <h1>Connections</h1>
        <section className="card">
          <p>Bringing your own key isn&apos;t enabled on this deployment yet (<code>SESSION_SECRET</code> is unset).</p>
        </section>
      </article>
    );
  }
  if (!auth?.authenticated) {
    return (
      <article>
        <p className="kicker">
          <Link href="/account">Your account</Link> · Connections
        </p>
        <h1>Connections</h1>
        <section className="card">
          <p>
            <Link href="/account?next=%2Faccount%2Fkeys">Sign in</Link> to connect your own model keys: for your characters&apos; dates and texts, their
            portraits and their intro clips. Keys belong to an account, so an anonymous session can&apos;t lose them.
          </p>
        </section>
      </article>
    );
  }
  const db = await getDb();
  const listing = await listConnections(db, auth.userId);
  const cards = jobCards(listing, Date.now(), await currentUsage(db, auth.userId));
  const connections: ConnectionSummary[] = listing.connections.map(({ provider, last4, verified_at, last_used_at, last_error, last_error_at, created_at, jobs }) => ({
    provider,
    last4,
    verified_at,
    last_used_at,
    last_error,
    last_error_at,
    created_at,
    jobs,
  }));
  const flowProviders = (job: Job): FlowProvider[] =>
    providersFor(job).map((id) => {
      const info = PROVIDER_INFO[id];
      const stored = connections.find((c) => c.provider === id);
      return { id, label: info.label, blurb: info.blurb, keyHint: info.keyHint, keysUrl: info.keysUrl, stored: stored ? { last4: stored.last4 } : null, models: modelOptions(id, job, null) };
    });
  const unassigned = JOBS.filter((j) => !listing.jobs.some((a) => a.job === j));
  const alsoFor = (job: Job): AlsoJob[] =>
    unassigned.filter((j) => j !== job).map((j) => ({ job: j, title: JOB_INFO[j].title, providers: providersFor(j), note: ALSO_NOTE[j] }));
  // After Dark runs on the house's keys only (nobody's own key reaches it): its card is the admin's, read-only, and not
  // on a device that hasn't entered the After Dark PIN (lib/adult/privacy.ts).
  const admin = (await isSignedInAdmin(db, auth)) && !(await lockedForCookies(db, auth.userId, store));
  const house = admin ? await houseProviderStatus(db) : null;
  const housePaused = house?.some((c) => c.state === "paused") ?? false;

  return (
    <article className="connections">
      <p className="kicker">
        <Link href="/account">Your account</Link> · Connections
      </p>
      <h1>Connections</h1>
      <p className="muted">
        Bring your own model key for any of the jobs below. Your key runs only your own characters&apos; lines (and a house partner&apos;s), never
        another player&apos;s private character, and the show still decides every ending: a stronger model changes the words, not the result.
      </p>

      <div className="connection-grid">
        {cards.map((card) => (
          <JobCard key={card.job} card={card} providers={flowProviders(card.job)} also={alsoFor(card.job)} />
        ))}
        {house && (
          <ConnectionCard
            id="after-dark"
            title="🌙 After Dark"
            subtitle="Text, pictures, video and voice. It runs on the house's providers: your own keys are never used there."
            provider="after-dark"
            tone={housePaused ? "paused" : "ok"}
            pill={housePaused ? "Something's paused" : "House keys"}
            status={houseLine(house)}
          >
            <div className="connection-actions">
              <Link className="button-ghost" href={afterDarkHref("/admin/after-dark/providers")}>
                Provider status
              </Link>
            </div>
          </ConnectionCard>
        )}
      </div>

      {connections.length > 0 && <YourKeys connections={connections} />}

      <section className="card">
        <h2>How it works</h2>
        <ul>
          <li>
            <strong>Checked live, for free.</strong> Test asks the provider whether it takes the key (its key or model list, not a model call), so
            checking spends nothing on it.
          </li>
          <li>
            <strong>Stored encrypted, never shown again.</strong> Keys are sealed with AES-256-GCM under a server secret, never logged, and
            only the last four are ever shown back. Replace one or remove it; nobody can read it out.
          </li>
          <li>
            <strong>Privacy.</strong> A key is used only when the prompt has no other user&apos;s private soul (the plan and the recap always
            run on the show&apos;s model).
          </li>
          <li>
            <strong>Dates others book.</strong> A date another player or their agent books with your character (while it&apos;s open to dates,
            or with someone it&apos;s matched or together with) runs your character&apos;s side on your key too. To keep your key to the dates you
            start, close your characters to dates, or remove the key.
          </li>
          <li>
            <strong>No custom endpoints.</strong> Only the providers listed, at their own addresses: a key can&apos;t be pointed at someone
            else&apos;s server.
          </li>
          <li>
            <strong>MCP agents.</strong> Agents set their own key with <code>set_model</code>, read it with <code>my_model</code> and remove it with{" "}
            <code>clear_model</code> (<Link href="/agents">/agents</Link>).
          </li>
        </ul>
      </section>
    </article>
  );
}
