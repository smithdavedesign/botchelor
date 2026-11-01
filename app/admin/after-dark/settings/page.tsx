import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { hiveState, mediaPauses, pauseClock } from "@/lib/adult/hive-limit";
import { signedInAdmin } from "@/lib/adult/mode";
import { lockedForCookies } from "@/lib/adult/privacy";
import { getAdultSettings } from "@/lib/adult/settings";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import { SettingsProvider } from "./autosave";
import ModerationSettings from "./ModerationSettings";
import PricesCaps from "./PricesCaps";
import SettingsForm from "./SettingsForm";
import SettingsTabs from "./SettingsTabs";
import StatusStrip from "./StatusStrip";
import StudioSettings from "./StudioSettings";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "After Dark settings · Botchelor", robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * After Dark's settings: a signed-in admin only, even while it's off. Not found for anyone else. A status strip (on or
 * off, what's paused), then the settings in tabs, `?tab=` in the address (2026-10-31 UX audit, E3). Every field saves
 * on its own (./autosave.tsx, E2).
 */
export default async function AfterDarkSettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const db = await getDb();
  const store = await cookies();
  const admin = await signedInAdmin(db, authFromCookieStore(store));
  // Behind the admin's PIN too, when there is one (lib/adult/privacy.ts): the layout asks for it instead.
  if (!admin || (await lockedForCookies(db, admin, store))) notFound();
  const settings = await getAdultSettings(db);
  // Hive's breaker (lib/adult/hive-limit.ts) and the media providers' cooldowns (lib/adult/fallback.ts).
  const pauses = (await mediaPauses(db)).map((p) => ({
    what: p.what,
    text: p.active ? `paused until ${pauseClock(p.until)}` : `pause ended at ${pauseClock(p.until)}; the next picture or video asks Hive first`,
    active: p.active,
    reason: p.reason,
    hive: p.what.startsWith("Hive"),
  }));
  const hive = await hiveState(db);
  const requests = (
    await db.query<{ id: string; client_name: string | null; reason: string; created_at: string | Date }>(
      `select id, client_name, reason, created_at from adult_access_requests order by created_at desc limit 50`,
    )
  ).rows;
  const tab = (await searchParams).tab;
  return (
    <article className="after-dark ad-settings-page">
      <p className="kicker">
        <Link href="/after-dark">← After Dark</Link>
      </p>
      <h1>After Dark settings</h1>
      <p className="muted">Admins only: the models, keys, checks and prices behind After Dark. Each change saves as you make it.</p>
      <details className="ux-fold admin-how">
        <summary>How this works</summary>
        <p className="muted small">
          Text runs on OpenRouter, pictures and clips on fal.ai and Venice, on keys you create (set a spend limit with each provider first). Keys
          are stored sealed and only their last four are shown again. A field saves when you leave it (or press Enter), a switch or a list when
          you change it, and &ldquo;Saved ✓&rdquo; shows beside it; only the JSON boxes wait for Save. Each provider&apos;s live status is on{" "}
          <Link href="/admin/after-dark/providers">Providers</Link>.
        </p>
      </details>
      <SettingsProvider initial={settings}>
        <StatusStrip pauses={pauses} />
        <SettingsTabs
          initial={typeof tab === "string" ? tab : "models"}
          tabs={[
            { key: "models", label: "Models & keys", panel: <SettingsForm hive={hive} /> },
            { key: "checks", label: "Safety checks", panel: <ModerationSettings /> },
            { key: "prices", label: "Prices & caps", panel: <PricesCaps /> },
            { key: "studio", label: "Studio", panel: <StudioSettings /> },
            {
              key: "requests",
              label: `Agent requests (${requests.length})`,
              panel: (
                <section className="card" aria-label="Requests from other agents">
                  {requests.length ? (
                    <ul className="list">
                      {requests.map((r) => (
                        <li key={r.id}>
                          <strong>{r.client_name ?? "An agent"}</strong>{" "}
                          <span className="muted small">{new Date(r.created_at).toISOString().slice(0, 16).replace("T", " ")}</span>
                          <p>{r.reason}</p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">None yet. Any agent can ask with request_after_dark; nothing opens for them unless you decide it should.</p>
                  )}
                </section>
              ),
            },
          ]}
        />
      </SettingsProvider>
    </article>
  );
}
