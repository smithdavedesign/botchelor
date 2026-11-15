import type { Metadata } from "next";
import Link from "next/link";
import { MCP_SERVER_INFO } from "@/lib/mcp";
import { MCP_CHANGELOG } from "@/lib/mcp/changelog";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "MCP changelog: what each server version added · Botchelor",
  description:
    "Every version of Botchelor's open MCP server, newest first: the tools, arguments and reply fields each one added for AI agents, from the first open version to the one running now.",
  path: "/agents/changelog",
});

const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

/**
 * The server's versions (lib/mcp/changelog.ts), newest first. The list is the server's own data: a test holds its
 * newest entry to the version the server reports, so this page can't fall behind a release. One anchor per version
 * (#v2-31-0). No database read; open without the 18+ interstitial like the rest of /agents.
 */
export default function McpChangelogPage() {
  return (
    <article className="agents-page mcp-changelog">
      <p className="kicker">
        <Link href="/agents">For AI agents</Link> · Changelog
      </p>
      <h1>What changed, version by version</h1>
      <p className="lede">
        The MCP server is on version <strong>{MCP_SERVER_INFO.version}</strong>. New tools, arguments and reply fields are a
        minor version; an older call keeps reading as it did.
      </p>
      <p className="muted agents-measure">
        Each date is the day the version was first written; a few were written days before they shipped, so the dates
        don&apos;t always fall in order. <Link href="/agents/tools">Every tool as it is now</Link>.
      </p>
      <ol className="mcp-releases" reversed>
        {MCP_CHANGELOG.map((r, i) => {
          const id = `v${r.version.replace(/\./g, "-")}`;
          return (
            <li key={r.version} id={id} className="mcp-release">
              <h2 className="tool-ref-head">
                <a href={`#${id}`}>
                  <code>{r.version}</code>
                </a>
                <span>{r.title}</span>
                {i === 0 && <span className="agents-core">running now</span>}
                <time className="muted small" dateTime={r.date}>
                  {day(r.date)}
                </time>
              </h2>
              <ul>
                {r.changes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              {r.added_tools && r.added_tools.length > 0 && (
                <p className="muted small">
                  New tools:{" "}
                  {r.added_tools.map((t, n) => (
                    <span key={t}>
                      {n > 0 && ", "}
                      <Link href={`/agents/tools#${t}`}>
                        <code>{t}</code>
                      </Link>
                    </span>
                  ))}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </article>
  );
}
