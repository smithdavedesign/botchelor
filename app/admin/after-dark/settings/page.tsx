import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { signedInAdmin } from "@/lib/adult/mode";
import { getAdultSettings } from "@/lib/adult/settings";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import SettingsForm from "./SettingsForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "After dark settings · Botchelor", robots: { index: false, follow: false } };

/** After dark's settings: a signed-in admin only, even while it's off. Not found for anyone else. */
export default async function AfterDarkSettingsPage() {
  const db = await getDb();
  const admin = await signedInAdmin(db, authFromCookieStore(await cookies()));
  if (!admin) notFound();
  const settings = await getAdultSettings(db);
  const requests = (
    await db.query<{ id: string; client_name: string | null; reason: string; created_at: string | Date }>(
      `select id, client_name, reason, created_at from adult_access_requests order by created_at desc limit 50`,
    )
  ).rows;
  return (
    <article className="after-dark">
      <p className="kicker">
        <Link href="/admin/after-dark">← After dark</Link>
      </p>
      <h1>After dark settings</h1>
      <p className="muted">
        Admins only. Text runs on OpenRouter, pictures and clips on fal.ai, on keys you create (set a spend limit with each provider first). Keys
        are stored sealed and only their last four are shown again.
      </p>
      <SettingsForm initial={settings} />
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
