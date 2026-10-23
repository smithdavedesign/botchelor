import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import ConnectionCard, { type CardTone } from "@/app/account/keys/ConnectionCard";
import LocalTime from "@/app/account/keys/LocalTime";
import { signedInAdmin } from "@/lib/adult/mode";
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
    </article>
  );
}
