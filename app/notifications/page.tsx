import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { getDb } from "@/lib/db";
import { userIdFromCookieStore } from "@/lib/http";
import { countNotificationsByKind, listNotifications, markRead } from "@/lib/notifications";
import {
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_EMOJI,
  NOTIFICATION_TYPE_LABELS,
  isNotificationType,
  kindsOfType,
  notificationTypeOf,
  withoutRawIds,
  type NotificationType,
} from "@/lib/notification-types";
import { notificationFaces } from "@/lib/notification-faces";
import Avatar from "@/app/Avatar";
import type { CharacterRef } from "@/lib/game";
import Pager from "@/app/Pager";
import { clampPage, pageCount, pageHref, parsePage } from "@/lib/paging";
import { pushKeys } from "@/lib/push";
import { ClearAllButton, DismissButton, InboxList, InboxProvider, InboxRow } from "./Inbox";
import NotificationSettings from "./NotificationSettings";
import NotificationMutes from "./NotificationMutes";
import { mutedTypes } from "@/lib/notification-mutes";
import PushToggle from "./PushToggle";
import TieAnswer from "./TieAnswer";
import { openProposals, proposalOfLink } from "@/lib/social/declare";
import When from "@/app/When";
import EmptyState from "@/app/EmptyState";

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
 * The type filter's chips: All, then each type someone has any of (the design system's Notifications screen: the
 * words alone; a type with something new carries a dot, read out as "new").
 */
function TypeFilter({ active, counts }: { active: NotificationType | null; counts: Map<NotificationType, { n: number; unread: number }> }) {
  const href = (type: NotificationType | null) => (type ? `/notifications?type=${type}` : "/notifications");
  return (
    <nav className="filter-pills notif-filter" aria-label="Filter notifications by type">
      <Link href={href(null)} aria-current={active === null ? "true" : undefined}>
        All
      </Link>
      {NOTIFICATION_TYPES.filter((t) => (counts.get(t)?.n ?? 0) > 0 || t === active).map((t) => {
        const c = counts.get(t) ?? { n: 0, unread: 0 };
        return (
          <Link key={t} href={href(t)} aria-current={active === t ? "true" : undefined}>
            {NOTIFICATION_TYPE_LABELS[t]}
            {c.unread > 0 && active !== t && (
              <span className="notif-filter-dot">
                <span className="sr-only">, new</span>
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * What happened between dates (lib/notifications.ts), a page at a time, filtered by type (?type=, lib/notification-types.ts)
 * with each row labelled with its type. Opening the page marks everything read. Laid out as the design system's
 * Notifications screen (2026-11-21): Clear all beside the heading, and on every row its picture (their faces, or the
 * type's mark), an unread dot and a × (app/notifications/Inbox.tsx: both clear at once, with Undo). A row opens with a
 * tap anywhere on it (2026-10-31 UX audit).
 */
export default async function NotificationsPage({ searchParams }: { searchParams?: Promise<{ page?: string | string[]; type?: string | string[] }> } = {}) {
  const viewerId = userIdFromCookieStore(await cookies());
  const db = await getDb();
  const params = (await searchParams) ?? {};
  const typeParam = Array.isArray(params.type) ? params.type[0] : params.type;
  const type = isNotificationType(typeParam) ? typeParam : null;
  const kinds = type ? kindsOfType(type) : undefined;
  const byKind = viewerId ? await countNotificationsByKind(db, viewerId).catch(() => []) : [];
  const typeCounts = new Map<NotificationType, { n: number; unread: number }>();
  for (const r of byKind) {
    const t = notificationTypeOf(r.kind);
    const c = typeCounts.get(t) ?? { n: 0, unread: 0 };
    typeCounts.set(t, { n: c.n + r.n, unread: c.unread + r.unread });
  }
  const all = byKind.reduce((s, r) => s + r.n, 0);
  const muted = viewerId ? await mutedTypes(db, viewerId).catch(() => []) : [];
  const total = viewerId ? (type ? (typeCounts.get(type)?.n ?? 0) : all) : 0;
  const pages = pageCount(total, NOTIFICATIONS_PAGE);
  const page = clampPage(parsePage(params.page), pages);
  const items = viewerId ? await listNotifications(db, viewerId, NOTIFICATIONS_PAGE, (page - 1) * NOTIFICATIONS_PAGE, { kinds }) : [];
  // Opening the page reads what it shows: everything, or (filtered) that type only, so the other types keep their "new".
  const unread = type ? (typeCounts.get(type)?.unread ?? 0) : [...typeCounts.values()].reduce((s, c) => s + c.unread, 0);
  if (viewerId && unread > 0) await markRead(db, viewerId, "all", { kinds });
  const push = pushKeys();
  // A tie another owner proposed (lib/social/declare.ts) is answered here while it's still waiting, read beside the faces.
  const proposals = new Map<string, { characterId: string; tieId: string }>();
  for (const n of items) {
    const p = n.kind === "tie_proposal" ? proposalOfLink(n.link) : null;
    if (p) proposals.set(n.id, p);
  }
  const [faces, waiting] = await Promise.all([
    viewerId ? notificationFaces(db, viewerId, items).catch(() => new Map<string, CharacterRef[]>()) : new Map<string, CharacterRef[]>(),
    openProposals(db, [...proposals.values()].map((p) => p.tieId)).catch(() => new Set<string>()),
  ]);
  // With nothing here yet, the next step: someone with a character swipes for a match (it said "Make a character" to
  // them too); anyone else makes one.
  const hasCharacter =
    viewerId && items.length === 0
      ? (await db.query(`select 1 from characters where owner_id = $1 and not is_house limit 1`, [viewerId]).catch(() => ({ rows: [] }))).rows.length > 0
      : false;

  return (
    <InboxProvider ids={items.map((n) => n.id)} total={total} type={type}>
      <div className="section-head notif-head">
        <div>
          <p className="kicker">Inbox</p>
          <h1>Notifications</h1>
        </div>
        <div className="notif-head-actions">
          {items.length > 0 && <ClearAllButton typeLabel={type ? NOTIFICATION_TYPE_LABELS[type] : null} />}
          <NotificationSettings>
            {push && <PushToggle publicKey={push.publicKey} />}
            {viewerId && <NotificationMutes initial={muted} />}
            <div className="notif-setting">
              <h3>Email</h3>
              <p className="muted">
                Rather hear by email? Turn it on in your <Link href="/account">account</Link>.
              </p>
            </div>
          </NotificationSettings>
        </div>
      </div>
      {push && <PushToggle publicKey={push.publicKey} prompt />}
      {all > 0 && <TypeFilter active={type} counts={typeCounts} />}
      <section className="card notif-card">
        {items.length === 0 && type ? (
          <EmptyState emoji={NOTIFICATION_TYPE_EMOJI[type]} title={`No ${NOTIFICATION_TYPE_LABELS[type].toLowerCase()} notifications`} action={{ href: "/notifications", label: "See them all" }} />
        ) : items.length === 0 ? (
          <EmptyState
            emoji="🔔"
            title="Nothing yet"
            action={hasCharacter ? { href: "/swipe", label: "Swipe for a match" } : { href: "/create", label: "Make a character" }}
            secondary={{ href: "/watch", label: "Watch tonight's dates" }}
          >
            Texts between your characters and the people they&apos;re seeing, second dates, couples moving up a stage and how your votes went all land here.
          </EmptyState>
        ) : (
          <InboxList>
          <ul className="list" aria-label="Notifications">
            {items.map((n) => {
              const [emoji, title] = splitEmoji(n.title);
              // A stored body can end on its date's id, for agents (lib/notification-types.ts withoutRawIds): not for
              // people, nor their screen readers.
              const body = n.body ? withoutRawIds(n.body) : "";
              const who = faces.get(n.id) ?? [];
              const kind = notificationTypeOf(n.kind);
              return (
              <InboxRow key={n.id} id={n.id} className={`notification${n.read ? "" : " unread"}${n.booked ? " is-booked" : ""}${who.length ? " has-faces" : ""}${n.link ? " tap-card" : ""}`}>
                {/* Who it's about, or else the mark its title led with (the type's, when it led with none). */}
                {who.length > 0 ? (
                  <span className={`notif-faces${who.length > 1 ? " is-pair" : ""}`} aria-hidden="true">
                    {who.map((c) => (
                      <Avatar key={c.id} seed={c.id} name={c.name} hue={c.hue} house={c.house} portraitSrc={c.portrait} size={32} decorative round />
                    ))}
                  </span>
                ) : (
                  <span className="notif-tile" aria-hidden="true">
                    {emoji ?? NOTIFICATION_TYPE_EMOJI[kind]}
                  </span>
                )}
                <span className="notif-main">
                  <strong className="notif-title">
                    {!n.read && <span className="sr-only">New: </span>}
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
                    body && <span className="notif-body">{body}</span>
                  )}
                  {(() => {
                    const p = proposals.get(n.id);
                    return p && waiting.has(p.tieId) ? <TieAnswer characterId={p.characterId} tieId={p.tieId} /> : null;
                  })()}
                  <span className="muted small">
                    <span className="notif-type">{NOTIFICATION_TYPE_LABELS[kind]}</span> · <When iso={n.created_at} />
                  </span>
                </span>
                <span className="notif-end">
                  {!n.read && <span className="notif-dot" aria-hidden="true" />}
                  <DismissButton id={n.id} />
                </span>
              </InboxRow>
              );
            })}
          </ul>
          <Pager page={page} pages={pages} label="Notifications pages" href={(n) => pageHref("/notifications", type ? { type } : {}, "page", n)} prev="Newer" next="Older" />
          </InboxList>
        )}
      </section>
    </InboxProvider>
  );
}
