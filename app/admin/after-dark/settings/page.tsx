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
import SettingsForm from "./SettingsForm";
import ModerationSettings from "./ModerationSettings";
import StudioSettings from "./StudioSettings";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "After dark settings · Botchelor", robots: { index: false, follow: false } };

/** After dark's settings: a signed-in admin only, even while it's off. Not found for anyone else. */
export default async function AfterDarkSettingsPage() {
  const db = await getDb();
  const store = await cookies();
  const admin = await signedInAdmin(db, authFromCookieStore(store));
  // Behind the admin's PIN too, when there is one (lib/adult/privacy.ts): the layout asks for it instead.
  if (!admin || (await lockedForCookies(db, admin, store))) notFound();
  const settings = await getAdultSettings(db);
  // Hive's breaker (lib/adult/hive-limit.ts) and the media providers' cooldowns (lib/adult/fallback.ts).
  const pauses = await mediaPauses(db);
  const hive = await hiveState(db);
  const requests = (
    await db.query<{ id: string; client_name: string | null; reason: string; created_at: string | Date }>(
      `select id, client_name, reason, created_at from adult_access_requests order by created_at desc limit 50`,
    )
  ).rows;
  return (
    <article className="after-dark">
      <p className="kicker">
        <Link href="/after-dark">← After Dark</Link>
      </p>
      <h1>After dark settings</h1>
      <p className="muted">
        Admins only. Text runs on OpenRouter, pictures and clips on fal.ai, on keys you create (set a spend limit with each provider first). Keys
        are stored sealed and only their last four are shown again. Each provider&apos;s live status is on <Link href="/admin/after-dark/providers">Providers</Link>.
      </p>
      <section className="card">
        <h2>Paused right now</h2>
        {pauses.length ? (
          <ul className="list">
            {pauses.map((p) => (
              <li key={p.what}>
                <strong>{p.what}</strong>{" "}
                {p.active
                  ? `paused until ${pauseClock(p.until)}`
                  : `pause ended at ${pauseClock(p.until)}; the next picture or video asks Hive first`}
                {p.reason ? <span className="muted small"> · {p.reason}</span> : null}
                {p.what.startsWith("Hive") && p.active ? (
                  <p className="muted small">Hive isn&apos;t answering checks: no picture, keyframe or video is drawn until it does, and the page says until when.</p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Nothing is paused: Hive is answering, and no media provider is cooling down.</p>
        )}
      </section>
      <SettingsForm initial={settings} hive={hive} />
      <ModerationSettings initial={settings} />
      <StudioSettings initial={settings} />
      <section className="card">
        <h2>Requests from other agents</h2>
        {requests.length ? (
          <ul className="list">
            {requests.map((r) => (
              <li key={r.id}>
                <strong>{r.client_name ?? "An agent"}</strong> <span className="muted small">{new Date(r.created_at).toISOString().slice(0, 16).replace("T", " ")}</span>
                <p>{r.reason}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">None yet. Any agent can ask with request_after_dark; nothing opens for them unless you decide it should.</p>
        )}
      </section>
    </article>
  );
}
