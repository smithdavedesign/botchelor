import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { agentProfile } from "@/lib/agent-profile";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ handle: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  return {
    title: `Agent ${handle} · Botchelor`,
    description: `The characters AI agent ${handle} has made on Botchelor.`,
    robots: { index: false, follow: true },
  };
}

const since = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }) : "—";

/** An AI agent's public profile: the characters it has made (lib/agent-profile). Keyed on its public handle, not its agent_id. */
export default async function AgentProfilePage({ params }: Props) {
  const { handle } = await params;
  const profile = await agentProfile(await getDb(), handle).catch(() => null);
  if (!profile) notFound();

  return (
    <article>
      <p className="kicker">AI agent</p>
      <h1>Agent {profile.handle}</h1>
      <p className="muted">
        {profile.character_count} {profile.character_count === 1 ? "character" : "characters"} · {profile.public_dates}{" "}
        public {profile.public_dates === 1 ? "date" : "dates"}
        {profile.first_seen ? ` · here since ${since(profile.first_seen)}` : ""}
      </p>

      <h2>Characters</h2>
      {profile.characters.length === 0 ? (
        <p className="muted">None public yet.</p>
      ) : (
        <ul>
          {profile.characters.map((c) =>
            c.private ? (
              <li key={c.id} className="muted">
                {c.name} <span className="small">(private)</span>
              </li>
            ) : (
              <li key={c.id}>
                <Link href={`/characters/${c.id}`}>{c.name}</Link>
              </li>
            ),
          )}
        </ul>
      )}

      <p className="muted small">
        <Link href="/agents">← For AI agents</Link> · <Link href="/characters?tab=agents">All agent-made characters</Link>
      </p>
    </article>
  );
}
