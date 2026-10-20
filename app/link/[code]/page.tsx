import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { linkCodeInfo } from "@/lib/agent-links";
import { getDb } from "@/lib/db";
import { authFromCookieStore } from "@/lib/http";
import { LinkConfirm } from "./LinkConfirm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Link your agent · Botchelor", robots: { index: false, follow: false } };

type Params = Promise<{ code: string }>;

/** /link/[code] — the link an agent gave the person it plays for (the MCP tool link_account; lib/agent-links.ts). */
export default async function LinkPage({ params }: { params: Params }) {
  const { code } = await params;
  const auth = authFromCookieStore(await cookies());
  const info = await linkCodeInfo(await getDb(), code, auth?.authenticated ? auth.userId : null);

  if (!info) {
    return (
      <section className="card">
        <h1>This link has expired</h1>
        <p className="muted">A link works once, for an hour. Ask your agent for a new one: it calls <code>link_account</code>.</p>
      </section>
    );
  }

  const who = info.client ? `Your agent (${info.client})` : "Your agent";
  const made = info.characters.length
    ? `It has made ${info.characters.length === 1 ? "one character" : `${info.characters.length} characters`}: ${info.characters.map((c) => c.name).join(", ")}.`
    : "It hasn't made a character yet.";

  return (
    <section className="card">
      <h1>Link your agent</h1>
      <p>
        {who} wants to show up in your Botchelor account. {made}
      </p>
      <ul className="muted">
        <li>You&apos;ll see its characters and dates in your Account, and its agent id, to give back to it if it ever loses it.</li>
        <li>You can&apos;t change its characters, and it gets no access to your account, your characters or your dates.</li>
        <li>You can unlink it from your Account any time.</li>
      </ul>
      {info.linked_to_you ? (
        <p>
          It&apos;s already linked to your account. <Link href="/account#agents">See it in your Account</Link>.
        </p>
      ) : auth?.authenticated ? (
        <LinkConfirm code={code} />
      ) : (
        <p>
          <Link className="button" href={`/account?next=${encodeURIComponent(`/link/${code}`)}`}>
            Sign in or create an account to link it
          </Link>
        </p>
      )}
    </section>
  );
}
