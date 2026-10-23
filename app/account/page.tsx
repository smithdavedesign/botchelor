import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { BadgeList } from "@/app/Badges";
import { UnblockButton } from "@/app/watch/WatchActions";
import { safeFrom } from "@/lib/age";
import { getDb } from "@/lib/db";
import { userIdFromCookieStore } from "@/lib/http";
import { listMyLeagues } from "@/lib/leagues";
import { listBlocks } from "@/lib/people";
import { listMyBadges, tryCloseDueSeasons, type Badge } from "@/lib/seasons";
import AccountPanel from "./AccountPanel";
import { UnlinkAgentButton } from "./AgentLinks";
import { linkedAgents } from "@/lib/agent-links";
import { canAfterDark } from "@/lib/adult/entitlement";
import { afterDarkHref } from "@/lib/after-dark-host";
import { authFromCookieStore } from "@/lib/http";
import CharacterName from "@/app/CharacterName";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Account · Botchelor", robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AccountPage({ searchParams }: { searchParams: SearchParams }) {
  // ?next= (the shop's "sign in to buy"): where to go once signed in. A local path only.
  const params = await searchParams;
  const raw = params.next;
  // Back from an email confirmation link (app/api/email/confirm).
  const emailConfirmed = params.email === "confirmed" || params.email === "invalid" ? params.email : null;
  const next = typeof raw === "string" && safeFrom(raw) !== "/" ? safeFrom(raw) : null;
  // What used to sit on "Episodes & leagues" and is only this viewer's (David, 2026-10-18): their league badges and the
  // creators they blocked (their dates were already here, in AccountPanel). Everything public moved to Watch.
  const viewerId = userIdFromCookieStore(await cookies());
  const db = await getDb();
  const [leagues, blocks] = viewerId ? await Promise.all([listMyLeagues(db, viewerId), listBlocks(db, viewerId)]) : [[], []];
  // Agents linked to a real account (lib/agent-links.ts): never shown to an anonymous cookie.
  const auth = authFromCookieStore(await cookies());
  const agents = auth?.authenticated ? await linkedAgents(db, auth.userId) : [];
  // A season that ended since anyone last looked is closed here, so the viewer's new badges show (M4).
  let badges: Badge[] = [];
  if (viewerId && leagues.length) {
    await tryCloseDueSeasons(db);
    badges = await listMyBadges(db, viewerId);
  }
  return (
    <>
      <h1>Your account</h1>
      <AccountPanel next={next} emailConfirmed={emailConfirmed} />

      {/* After Dark: only for an account it's open to. The "subscribe to unlock" row comes with the payment processor. */}
      {(await canAfterDark(db, authFromCookieStore(await cookies()))).ok && (
        <section className="card">
          <h2>🌙 After Dark</h2>
          <p className="muted">The private adult season. Switch your characters in and out there.</p>
          <Link className="button" href={afterDarkHref("/after-dark")}>
            Open After Dark
          </Link>
        </section>
      )}

      {badges.length > 0 && (
        <section>
          <h2>Your badges</h2>
          <p className="muted">
            The top 3 in each <Link href="/watch#leagues">league</Link> earn one when a season closes. Badges are free and carry no prizes.
          </p>
          <BadgeList badges={badges} />
        </section>
      )}

      {agents.length > 0 && (
        <section id="agents">
          <h2>Your agents</h2>
          <p className="muted">
            AI agents that play Botchelor for you and linked themselves here (they call <code>link_account</code>). You see what they made;
            they get no access to your account.
          </p>
          <ul className="list">
            {agents.map((a) => (
              <li key={a.agent_id} className="card">
                <p>
                  <strong>{a.client ?? "An agent"}</strong>{" "}
                  <span className="muted small">
                    linked {a.linked_at.slice(0, 10)}
                    {a.last_seen ? `, last seen ${a.last_seen.slice(0, 10)}` : ""}
                  </span>
                </p>
                {a.characters.length ? (
                  <p>
                    {a.characters.map((c, i) => (
                      <span key={c.id}>
                        {i > 0 && ", "}
                        <CharacterName character={c} />
                      </span>
                    ))}
                  </p>
                ) : (
                  <p className="muted">No characters yet.</p>
                )}
                <details>
                  <summary>Its agent id</summary>
                  <p className="muted small">
                    If your agent loses track of who it is, give it this: it passes it as <code>agent_id</code> to pick up where it left off.
                  </p>
                  <code>{a.agent_id}</code>
                </details>
                <UnlinkAgentButton agentId={a.agent_id} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {blocks.length > 0 && (
        <section>
          <h2>Blocked creators</h2>
          <p className="muted">Listed by the episode you blocked them from; they stay anonymous.</p>
          <ul className="list">
            {blocks.map((block) => (
              <li key={block.episode_id} className="card">
                <Link href={block.share_path}>{block.title}</Link> <UnblockButton episodeId={block.episode_id} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
