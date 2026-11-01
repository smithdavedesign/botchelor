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
import NotificationSettings from "./NotificationSettings";
import PushToggle from "./PushToggle";
import When from "@/app/When";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Notifications · Botchelor", robots: { index: false, follow: false } };

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
 * can be cleared, or all at once from ⚙ Settings. A row opens with a tap anywhere on it (2026-10-31 UX audit).
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
      <div className="section-head notif-head">
        <h1>Notifications</h1>
        <NotificationSettings canClear={items.length > 0}>
          {push && <PushToggle publicKey={push.publicKey} />}
          <div className="notif-setting">
            <h3>Email</h3>
            <p className="muted">
              Rather hear by email? Turn it on in your <Link href="/account">account</Link>.
            </p>
          </div>
        </NotificationSettings>
      </div>
      {push && <PushToggle publicKey={push.publicKey} prompt />}
      <section className="card">
        {items.length === 0 ? (
          <p className="muted">
            Nothing yet. Texts between your characters and the people they&apos;re seeing, second dates and couples moving up a stage all
            land here. <Link href="/create">Make a character</Link>
          </p>
        ) : (
          <>
          <ul className="list" aria-label="Notifications">
            {items.map((n) => {
              const [emoji, title] = splitEmoji(n.title);
              const who = faces.get(n.id) ?? [];
              return (
              <li key={n.id} className={`notification${n.read ? "" : " unread"}${n.booked ? " is-booked" : ""}${who.length ? " has-faces" : ""}${n.link ? " tap-card" : ""}`}>
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
                  {n.link ? (
                    <Link className="stretch" href={n.link}>
                      {title}
                    </Link>
                  ) : (
                    title
                  )}
                </strong>
                {n.booked ? (
                  // A "Book it" notice whose date has been booked since (lib/notifications.ts withBookings).
                  <span className="notification-booked">
                    ✓ {n.body} <Link href={`/episodes/${n.booked.episode_id}`}>{n.booked.status === "ready" ? "Watch it" : n.booked.performed === "show" ? "Watch it being filmed" : "See the date"}</Link>
                  </span>
                ) : (
                  n.body && <span className="notif-body">{n.body}</span>
                )}
                <span className="muted small">
                  <When iso={n.created_at} /> · <ClearNotifications id={n.id} />
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
