import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { userIdFromCookieStore } from "@/lib/http";
import { countNotifications, listNotifications, markRead } from "@/lib/notifications";
import { notificationFaces } from "@/lib/notification-faces";
import Avatar from "@/app/Avatar";
import type { CharacterRef } from "@/lib/game";
import Pager from "@/app/Pager";
import { clampPage, pageCount, pageHref, parsePage } from "@/lib/paging";
import { pushKeys } from "@/lib/push";
import ClearNotifications from "./ClearNotifications";
import PushToggle from "./PushToggle";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Notifications · Botchelor", robots: { index: false, follow: false } };

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" }) + " UTC";

/** A title's leading emoji ("💬 Dex texted Sam"), kept outside its link so the underline runs under words only. */
const LEAD_EMOJI = /^((?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:[\uFE0F\u200D]|\p{Extended_Pictographic}|\p{Emoji_Modifier})*)\s+/u;
function splitEmoji(title: string): [string | null, string] {
  const m = title.match(LEAD_EMOJI);
  return m ? [m[1], title.slice(m[0].length)] : [null, title];
}

/** Notifications: this many a page (?page=N), newest first. */
const NOTIFICATIONS_PAGE = 10;

/**
 * What happened between dates (lib/notifications.ts), a page at a time. Opening the page marks everything read; each
 * can be cleared, or all at once.
 */
export default async function NotificationsPage({ searchParams }: { searchParams?: Promise<{ page?: string | string[] }> } = {}) {
  const viewerId = userIdFromCookieStore(await cookies());
  const db = await getDb();
  const total = viewerId ? await countNotifications(db, viewerId) : 0;
  const pages = pageCount(total, NOTIFICATIONS_PAGE);
  const page = clampPage(parsePage((await searchParams)?.page), pages);
  const items = viewerId ? await listNotifications(db, viewerId, NOTIFICATIONS_PAGE, (page - 1) * NOTIFICATIONS_PAGE) : [];
  if (viewerId && (await countNotifications(db, viewerId, { unread: true })) > 0) await markRead(db, viewerId, "all");
  const push = pushKeys();
  const faces = viewerId ? await notificationFaces(db, viewerId, items).catch(() => new Map<string, CharacterRef[]>()) : new Map<string, CharacterRef[]>();

  return (
    <>
      <h1>Notifications</h1>
      <p className="muted">
        Texts between your characters and the people they&apos;re seeing, second dates, and couples moving up a stage.
      </p>
      {push && <PushToggle publicKey={push.publicKey} />}
      <p className="muted small">
        Rather hear by email? Turn it on in your <Link href="/account">account</Link>.
      </p>
      <section className="card">
        {items.length === 0 ? (
          <p className="muted">
            Nothing yet. Send a character on a date: if it goes well, this is where you&apos;ll hear what happens next.{" "}
            <Link href="/create">Make a character</Link>
          </p>
        ) : (
          <>
          <div className="section-head notification-actions">
            <h2>Latest</h2>
            <ClearNotifications />
          </div>
          <ul className="list" aria-label="Notifications">
            {items.map((n) => {
              const [emoji, title] = splitEmoji(n.title);
              const who = faces.get(n.id) ?? [];
              return (
              <li key={n.id} className={`notification${n.read ? "" : " unread"}${n.booked ? " is-booked" : ""}${who.length ? " has-faces" : ""}`}>
                {who.length > 0 && (
                  <span className={`notif-faces${who.length > 1 ? " is-pair" : ""}`} aria-hidden="true">
                    {who.map((c) => (
                      <Avatar key={c.id} seed={c.id} name={c.name} hue={c.hue} house={c.house} portraitSrc={c.portrait} size={32} decorative round />
                    ))}
                  </span>
                )}
                <strong className="notif-title">
                  {emoji && (
                    <span className="notif-emoji" aria-hidden="true">
                      {emoji}
                    </span>
                  )}
                  {n.link ? <Link href={n.link}>{title}</Link> : title}
                </strong>
                {n.booked ? (
                  // A "Book it" notice whose date has been booked since (lib/notifications.ts withBookings).
                  <span className="notification-booked">
                    ✓ {n.body} <Link href={`/episodes/${n.booked.episode_id}`}>{n.booked.status === "ready" ? "Watch it" : n.booked.performed === "show" ? "Watch it being filmed" : "See the date"}</Link>
                  </span>
                ) : (
                  n.body && <span className="muted">“{n.body}”</span>
                )}
                <span className="muted small">
                  {when(n.created_at)} · <ClearNotifications id={n.id} />
                </span>
              </li>
              );
            })}
          </ul>
          <Pager page={page} pages={pages} label="Notifications pages" href={(n) => pageHref("/notifications", {}, "page", n)} prev="Newer" next="Older" />
          </>
        )}
      </section>
    </>
  );
}
