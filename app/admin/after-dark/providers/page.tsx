import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import ConnectionCard, { type CardTone } from "@/app/account/keys/ConnectionCard";
import LocalTime from "@/app/account/keys/LocalTime";
import { billingOverview, configuredProcessors, PROCESSOR_INFO } from "@/lib/adult/billing";
import { signedInAdmin } from "@/lib/adult/mode";
import ClearFlagButton from "./ClearFlagButton";
import { lockedForCookies } from "@/lib/adult/privacy";
import { houseProviderStatus, type HouseCard } from "@/lib/adult/provider-status";
import { ago, maskKey } from "@/lib/connections-shared";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "After Dark providers · Botchelor", robots: { index: false, follow: false } };

const TONE: Record<HouseCard["state"], CardTone> = { ready: "ok", paused: "paused", no_key: "unset", standby: "unset" };

/** What "last used" means for each: the writer's last step, the check's last pass, everyone else's last picture or video. */
const LAST: Record<HouseCard["provider"], string> = {
  openrouter: "last wrote a step",
  venice: "last made something",
  replicate: "last made something",
  fal: "last made something",
  hive: "last passed a picture",
};

/** A status line with its pause's end in the viewer's own time ("back around 5:00 PM"), where it has one. */
function statusOf(c: HouseCard) {
  if (!c.until) return c.status;
  const at = `${new Date(c.until).toISOString().slice(11, 16)} UTC`;
  const [before, after] = c.status.split(at);
  return after === undefined ? (
    c.status
  ) : (
    <>
      {before}
      <LocalTime iso={c.until} />
      {after}
    </>
  );
}

/**
 * After Dark's providers, live (docs/PRDs/connections.md "The admin's view"): one card per house provider, the same card
 * the Connections page uses, read-only. Status comes from adult_media_cooldowns (Hive's daily-limit pause, Venice and
 * Replicate cooling down) and what each last made. The keys are changed on the settings page. A signed-in admin only,
 * behind the After Dark PIN like the rest; not found for anyone else.
 */
export default async function AfterDarkProvidersPage() {
  const db = await getDb();
  const store = await cookies();
  const admin = await signedInAdmin(db, authFromCookieStore(store));
  if (!admin || (await lockedForCookies(db, admin, store))) notFound();
  const cards = await houseProviderStatus(db);
  const billing = await billingOverview(db);
  const processors = configuredProcessors();
  const now = Date.now();
  return (
    <article className="after-dark connections">
      <p className="kicker">
        <Link href="/after-dark">← After Dark</Link> · <Link href="/admin/after-dark/settings">Settings</Link>
      </p>
      <h1>Providers</h1>
      <p className="muted">
        What After Dark runs on, and how each one is right now. These are the house&apos;s keys: nobody&apos;s own key reaches After Dark. Change
        a key or a model on the <Link href="/admin/after-dark/settings">settings page</Link>.
      </p>
      <div className="connection-grid">
        {cards.map((c) => (
          <ConnectionCard
            key={c.provider}
            id={`provider-${c.provider}`}
            title={c.label}
            subtitle={c.what}
            provider={c.provider}
            tone={TONE[c.state]}
            pill={c.pill}
            status={statusOf(c)}
            meta={[
              ...(c.last4 ? [maskKey(c.last4)] : []),
              ...(c.model ? [c.model] : []),
              c.last_used_at ? `${LAST[c.provider]} ${ago(c.last_used_at, now)}` : "not used yet",
            ]}
          />
        ))}
      </div>
      <Billing overview={billing} processors={processors} />
    </article>
  );
}

const when = (iso: string | null) => (iso ? `${iso.slice(0, 16).replace("T", " ")} UTC` : "—");

/**
 * Subscriptions and the processors' latest postbacks (lib/adult/billing.ts): who is subscribed, until when, with which
 * processor and how their age was declared; every postback and what came of it; and the accounts a chargeback or refund
 * flagged, which can't subscribe again until an admin has looked.
 */
function Billing({ overview, processors }: { overview: Awaited<ReturnType<typeof billingOverview>>; processors: string[] }) {
  return (
    <section id="billing" data-admin-billing>
      <h2>Subscriptions</h2>
      <p className="muted">
        {processors.length
          ? `Billing is on: ${processors.map((p) => PROCESSOR_INFO[p as keyof typeof PROCESSOR_INFO].label).join(", then ")}.`
          : "Billing is off: no processor is configured (docs/after-dark.md \"Billing\" lists the settings)."}
      </p>
      {overview.flags.some((f) => !f.reviewed_at) && (
        <>
          <h3>Waiting for review</h3>
          <ul className="list">
            {overview.flags
              .filter((f) => !f.reviewed_at)
              .map((f) => (
                <li key={f.user_id} className="card">
                  <code>{f.user_id}</code> · {f.reason} on {f.processor}, {when(f.flagged_at)} <ClearFlagButton userId={f.user_id} />
                </li>
              ))}
          </ul>
        </>
      )}
      {overview.subscriptions.length ? (
        <div style={{ overflowX: "auto" }}>
          <table className="ad-pairs">
            <thead>
              <tr>
                <th>Account</th>
                <th>Status</th>
                <th>Until</th>
                <th>Processor</th>
                <th>Since</th>
                <th>Age</th>
              </tr>
            </thead>
            <tbody>
              {overview.subscriptions.map((s) => (
                <tr key={s.user_id}>
                  <td>
                    <code>{s.user_id.slice(0, 8)}</code>
                    {s.flagged ? ` (flagged: ${s.flagged})` : ""}
                  </td>
                  <td>{s.status}</td>
                  <td>{when(s.period_end)}</td>
                  <td>{s.provider ?? "—"}</td>
                  <td>{when(s.subscribed_at)}</td>
                  <td>{[s.age_method, s.age_country].filter(Boolean).join(", ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">No subscriptions yet.</p>
      )}
      <h3>Latest postbacks</h3>
      {overview.events.length ? (
        <div style={{ overflowX: "auto" }}>
          <table className="ad-pairs">
            <thead>
              <tr>
                <th>When</th>
                <th>Processor</th>
                <th>Meant</th>
                <th>Sent as</th>
                <th>Outcome</th>
                <th>Account</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {overview.events.map((e, i) => (
                <tr key={`${e.received_at}-${i}`}>
                  <td>{when(e.received_at)}</td>
                  <td>{e.processor}</td>
                  <td>{e.kind}</td>
                  <td>
                    <code>{e.raw_event}</code>
                  </td>
                  <td>{e.outcome}</td>
                  <td>{e.user_id ? <code>{e.user_id.slice(0, 8)}</code> : "—"}</td>
                  <td>{e.amount ? `${e.amount} ${e.currency ?? ""}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">None received yet.</p>
      )}
    </section>
  );
}
