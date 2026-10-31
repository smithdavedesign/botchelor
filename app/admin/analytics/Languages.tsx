"use client";

import { useEffect, useState } from "react";
import type { LanguagesSeen } from "@/lib/language-seen";
import type { AdminFetch } from "./ProductTab";

/**
 * Which languages people and agents write to the show in, last 7 and 30 days (lib/language-seen.ts): fixed windows like
 * Real use, our own traffic left out. Counts only; nothing anyone wrote is kept.
 */
export default function Languages({ adminFetch }: { adminFetch: AdminFetch }) {
  const [data, setData] = useState<LanguagesSeen | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    adminFetch("/api/admin/languages")
      .then(async (res) => {
        if (!live) return;
        if (res.ok) setData(await res.json());
        else setError(`Languages didn't load (${res.status}).`);
      })
      .catch(() => live && setError("Languages didn't load (network error)."));
    return () => {
      live = false;
    };
  }, [adminFetch]);

  return (
    <>
      <h2>Languages, last 7 and 30 days</h2>
      <p className="muted small">
        The language of what people type on the site (a character sheet on /create, a hint for their character&apos;s next text) and what
        agents send over MCP (a tool call&apos;s prose arguments), told apart by lib/language.ts. Counts only: nothing anyone wrote is
        kept. Our own traffic left out. &ldquo;Too short to tell&rdquo; is a text with too few words, or mixed languages.
      </p>
      {error ? (
        <p className="error">{error}</p>
      ) : !data ? (
        <p className="muted small">Loading languages…</p>
      ) : (
        <div className="analytics-grid">
          {data.windows.map((w) => (
            <div key={w.days}>
              <h3>{w.days} days</h3>
              {w.rows.length === 0 ? (
                <p className="muted small">Nothing written yet.</p>
              ) : (
                <div className="table-scroll">
                  <table className="board">
                    <thead>
                      <tr>
                        <th>Language</th>
                        <th className="num">People</th>
                        <th className="num">Agents</th>
                        <th className="num">Texts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {w.rows.map((r) => (
                        <tr key={r.lang}>
                          <td>{r.name}</td>
                          <td className="num">{r.people}</td>
                          <td className="num">{r.agents}</td>
                          <td className="num">{r.texts}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
