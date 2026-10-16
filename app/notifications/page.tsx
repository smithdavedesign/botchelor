import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { userIdFromCookieStore } from "@/lib/http";
import { listNotifications, markRead } from "@/lib/notifications";
import { pushKeys } from "@/lib/push";
import PushToggle from "./PushToggle";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Notifications · Botchelor", robots: { index: false, follow: false } };

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }) + " UTC";

/** What happened between dates (lib/notifications.ts). Opening the page marks everything read. */
export default async function NotificationsPage() {
  const viewerId = userIdFromCookieStore(await cookies());
  const db = await getDb();
  const items = viewerId ? await listNotifications(db, viewerId) : [];
  if (viewerId && items.some((n) => !n.read)) await markRead(db, viewerId, "all");
  const push = pushKeys();

  return (
    <>
      <h1>Notifications</h1>
      <p className="muted">
        Texts between your characters and the people they&apos;re seeing, second dates, and couples moving up a stage.
      </p>
      {push && <PushToggle publicKey={push.publicKey} />}
      <section className="card">
        {items.length === 0 ? (
          <p className="muted">
            Nothing yet. Send a character on a date: if it goes well, this is where you&apos;ll hear what happens next.{" "}
            <Link href="/create">Make a character</Link>
          </p>
        ) : (
          <ul className="list" aria-label="Notifications">
            {items.map((n) => (
              <li key={n.id} className={`notification${n.read ? "" : " unread"}`}>
                <strong>{n.link ? <Link href={n.link}>{n.title}</Link> : n.title}</strong>
                {n.body && <span className="muted">“{n.body}”</span>}
                <span className="muted small">{when(n.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
