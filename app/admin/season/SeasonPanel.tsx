"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import CharacterName from "@/app/CharacterName";

type Slot = { character_id: string; name: string; slot: number; source: "dealt" | "survivor" | "new" | "fan" | "lead" | "suitor"; house?: boolean; portrait?: string | null };
type Botchelor = {
  leads: { id: string; name: string }[];
  this_season: {
    runs: boolean;
    lead: { id: string; name: string } | null;
    override: string | null;
    suitors: { id: string; name: string; in: boolean }[];
    ceremonies: { week: number; held_on: string; finale: boolean; eliminated_by_vote: { name: string } | null; eliminated_by_lead: { name: string } | null; final_rose: { name: string } | null; votes: number; total: number }[];
  };
  next_season: { runs: boolean; override: string | null; override_name: string | null };
  casting?: { switched_on: boolean; now: { phase: "season" | "preseason"; month: string; lead: { id: string; name: string }; roses_at: string } | null };
  premiere?: {
    switched_on: boolean;
    pilot_on: boolean;
    hour: number;
    next: { sunday: string; time_words: string; kind: "pilot" | "weekly"; lead: { name: string }; suitor: { name: string } | null; room_path: string | null; state: string } | null;
    would_pick: { id: string; name: string } | null;
    last: { sunday: string; built: boolean; note: string | null; tries: number } | null;
  } | null;
};
type Candidate = {
  character_id: string;
  name: string;
  archetype: string | null;
  status: "pending" | "approved" | "rejected";
  portrait: string | null;
  check_note: string | null;
};
type Audition = { character_id: string; name: string; status: "open" | "approved" | "rejected"; votes: number; aired: number; portrait: string | null };
type View = {
  this_season: { id: string; label: string; format: string; cast: Slot[] };
  next_season: {
    id: string;
    label: string;
    format: string;
    generate_from_day: number;
    candidates: Candidate[];
    auditions: Audition[];
    ballot?: { slug: string; votes: number }[];
  };
  formats: { slug: string; label: string; title?: string; lead?: boolean }[];
  botchelor?: Botchelor;
  note?: string | null;
};

/** The Sunday premiere's quiet line (lib/sunday-premiere.ts premiereAdminView): the next one, its suitor, whether it's built. */
function PremiereStatus({ p }: { p: NonNullable<Botchelor["premiere"]> }) {
  const { next, would_pick: pick, last } = p;
  const who = next?.suitor ? next.suitor.name : pick ? `${pick.name} if picked now` : "nobody to pick yet";
  return (
    <p className="small" data-premiere-status={!p.switched_on ? "off" : next ? (next.room_path ? "built" : "scheduled") : "none"}>
      <strong>Sunday premiere</strong> (lib/sunday-premiere.ts):{" "}
      {!p.switched_on ? (
        "switched off (SUNDAY_PREMIERE=0)."
      ) : next ? (
        <>
          {next.kind === "pilot" ? "the pilot" : "next"}, {next.sunday} at {next.time_words}: {next.lead.name} with {who};{" "}
          {next.room_path ? (
            <>
              built (<Link href={next.room_path}>its room</Link>, {next.state}).
            </>
          ) : (
            "not built yet (the :20 pass the hour before builds it)."
          )}
        </>
      ) : (
        `none ahead (no lead season with its lead picked${p.pilot_on ? "" : "; the pilot is off"}).`
      )}
      {last && !last.built && last.note ? ` Last: ${last.sunday} not built (${last.note}, ${last.tries} ${last.tries === 1 ? "try" : "tries"}).` : ""}
    </p>
  );
}

const SOURCE: Record<Slot["source"], string> = { dealt: "dealt", survivor: "stayed on", new: "new", fan: "fan pick", lead: "the lead", suitor: "suitor" };

/** The review queue: next month's candidates with their portraits, and this month's cast. Admin account or password. */
export default function SeasonPanel() {
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const headers = (): Record<string, string> => {
    try {
      const key = localStorage.getItem("bz_frontier");
      return key ? { "x-frontier-key": key } : {};
    } catch {
      return {};
    }
  };

  async function call(body?: Record<string, unknown>) {
    setError(null);
    const res = await fetch("/api/admin/season", body ? { method: "POST", headers: { "content-type": "application/json", ...headers() }, body: JSON.stringify(body) } : { headers: headers() });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return setError(data.message ?? "Not authorized.");
    setView(data as View);
  }

  useEffect(() => {
    call().catch(() => setError("Network error."));
  }, []);

  async function act(key: string, body: Record<string, unknown>) {
    setBusy(key);
    await call(body).catch(() => setError("Network error."));
    setBusy(null);
  }

  if (error && !view) return <p className="error">{error}</p>;
  if (!view) return <p className="muted">Loading…</p>;
  const live = view.next_season.candidates.filter((c) => c.status !== "rejected");
  return (
    <>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {view.note && (
        <p className="muted" role="status">
          {view.note}
        </p>
      )}
      <section className="card">
        <h2>Next season: {view.next_season.label}</h2>
        {view.next_season.candidates.length === 0 && (
          <p className="muted">No candidates yet. The daily job writes them from the {view.next_season.generate_from_day}th, or write them now.</p>
        )}
        <ul className="season-candidates">
          {view.next_season.candidates.map((c) => (
            <li key={c.character_id} className={`season-candidate is-${c.status}`}>
              {c.portrait ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.portrait} alt={`Portrait of ${c.name}`} />
              ) : (
                <p className="muted small">No portrait{c.check_note ? `: ${c.check_note}` : ""}</p>
              )}
              <p>
                <Link href={`/characters/${c.character_id}`}>
                  <strong>{c.name}</strong>
                </Link>{" "}
                <span className="muted">{c.archetype}</span> <span className="badge">{c.status}</span>
              </p>
              <p>
                <button type="button" className="primary small" disabled={busy !== null || c.status === "approved"} onClick={() => act(`a-${c.character_id}`, { action: "approve", character_id: c.character_id })}>
                  Approve
                </button>{" "}
                <button type="button" className="button-ghost small" disabled={busy !== null || c.status === "rejected"} onClick={() => act(`r-${c.character_id}`, { action: "reject", character_id: c.character_id })}>
                  Reject
                </button>{" "}
                <button type="button" className="button-ghost small" disabled={busy !== null} onClick={() => act(`p-${c.character_id}`, { action: "portrait", character_id: c.character_id })}>
                  {busy === `p-${c.character_id}` ? "Painting…" : "New portrait"}
                </button>
              </p>
            </li>
          ))}
        </ul>
        <p>
          <button type="button" className="primary" disabled={busy !== null || live.length >= 3} onClick={() => act("generate", { action: "generate" })}>
            {busy === "generate" ? "Writing… (a minute or two)" : live.length ? "Write replacements" : "Write the candidates now"}
          </button>
        </p>
      </section>
      <section className="card">
        <h2>Auditions for {view.next_season.label}</h2>
        <p className="muted small">
          People&apos;s own characters (lib/auditions.ts). Approved ones take the open places by votes, before the
          candidates above. Owners hear either way. <Link href="/casting">The public page</Link>.
        </p>
        {view.next_season.auditions.length === 0 && <p className="muted">No auditions yet.</p>}
        <ul className="season-candidates">
          {view.next_season.auditions.map((a) => (
            <li key={a.character_id} className={`season-candidate is-${a.status === "open" ? "pending" : a.status}`}>
              {a.portrait ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.portrait} alt={`Portrait of ${a.name}`} />
              ) : (
                <p className="muted small">No portrait</p>
              )}
              <p>
                <Link href={`/characters/${a.character_id}`}>
                  <strong>{a.name}</strong>
                </Link>{" "}
                <span className="muted">
                  {a.votes} vote{a.votes === 1 ? "" : "s"} · {a.aired} dates
                </span>{" "}
                <span className="badge">{a.status === "open" ? "waiting" : a.status}</span>
              </p>
              <p>
                <button type="button" className="primary small" disabled={busy !== null || a.status === "approved"} onClick={() => act(`aa-${a.character_id}`, { action: "audition", character_id: a.character_id, verdict: "approved" })}>
                  Approve
                </button>{" "}
                <button type="button" className="button-ghost small" disabled={busy !== null || a.status === "rejected"} onClick={() => act(`ar-${a.character_id}`, { action: "audition", character_id: a.character_id, verdict: "rejected" })}>
                  Turn down
                </button>
              </p>
            </li>
          ))}
        </ul>
      </section>
      <section className="card">
        <h2>This season: {view.this_season.label}</h2>
        <ol>
          {view.this_season.cast.map((s) => (
            <li key={s.character_id}>
              <CharacterName character={{ id: s.character_id, name: s.name, house: s.house, portrait: s.portrait ?? null }} /> <span className="muted">· {SOURCE[s.source]}</span>
            </li>
          ))}
        </ol>
      </section>
      <section className="card">
        <h2>Format</h2>
        <p className="muted small">
          How a season runs (venues, weekly twists, recoupling nights). With no pick here, next season runs the viewers&apos;
          ballot winner (/reunion, at least 3 votes), else classic. A pick here always wins.
        </p>
        {([
          ["This season", view.this_season],
          ["Next season", view.next_season],
        ] as const).map(([title, season]) => (
          <div key={season.id} className="season-format-row">
            <p className="season-format-head">
              <strong>{title}</strong> <span className="muted">· {season.label}</span>
            </p>
            <div className="segmented" role="group" aria-label={`${title} format`}>
              {view.formats.map((f) => {
                const on = season.format === f.slug;
                return (
                  <button
                    key={f.slug}
                    type="button"
                    className="segmented-tab"
                    aria-pressed={on}
                    disabled={busy !== null}
                    onClick={() => {
                      if (!on) act(`f-${season.id}-${f.slug}`, { action: "format", season_id: season.id, slug: f.slug });
                    }}
                  >
                    {f.title ?? f.slug}
                  </button>
                );
              })}
            </div>
            <p className="muted small season-format-note">
              Announces itself as “{view.formats.find((f) => f.slug === season.format)?.label}”
            </p>
          </div>
        ))}
        {view.next_season.ballot && (
          <p className="muted small">
            Viewers&apos; ballot for {view.next_season.label}:{" "}
            {view.next_season.ballot.some((b) => b.votes > 0)
              ? view.next_season.ballot
                  .filter((b) => b.votes > 0)
                  .map((b) => `${view.formats.find((f) => f.slug === b.slug)?.title ?? b.slug} ${b.votes}`)
                  .join(" · ")
              : "no votes yet"}
          </p>
        )}
        <p>
          <button type="button" className="button-ghost small" disabled={busy !== null} onClick={() => act("recoupling", { action: "recoupling" })}>
            {busy === "recoupling" ? "Running the night…" : "Stage a recoupling night now"}
          </button>{" "}
          <span className="muted small">Off-cycle test: seats the cast and their season partners, runs the room tonight, house-paid.</span>
        </p>
      </section>
      {view.botchelor && (view.botchelor.this_season.runs || view.botchelor.next_season.runs || view.formats.some((f) => f.lead && (f.slug === view.this_season.format || f.slug === view.next_season.format))) && (
        <section className="card">
          <h2>The Botchelor: the lead and the suitors</h2>
          <p className="muted small">
            One lead from the house cast dates people&apos;s characters; a rose ceremony every Sunday sends two home (lib/ceremony.ts). By default
            the lead is last season&apos;s most reviewed survivor, picked with the cast on the 1st; a pick here overrides it. Suitors: approved
            auditions by votes, then the house&apos;s own agent-made characters with the most public dates.
          </p>
          {([
            ["This season", view.this_season, view.botchelor.this_season.override],
            ["Next season", view.next_season, view.botchelor.next_season.override],
          ] as const).map(([title, season, override]) => (
            <p key={season.id}>
              <strong>{title}&apos;s lead</strong> ({season.label}):{" "}
              <select
                aria-label={`${title}'s lead`}
                value={override ?? ""}
                disabled={busy !== null}
                onChange={(e) => act(`lead-${season.id}`, { action: "lead", season_id: season.id, character_id: e.target.value || null })}
              >
                <option value="">Default (most reviewed survivor)</option>
                {view.botchelor!.leads.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </p>
          ))}
          {view.botchelor.casting && (
            <p className="small" data-casting-status>
              <strong>Open casting</strong> (lib/casting.ts):{" "}
              {!view.botchelor.casting.switched_on
                ? "switched off (OPEN_CASTING=0)."
                : view.botchelor.casting.now
                  ? `open. A new character's first speed date goes to ${view.botchelor.casting.now.lead.name} (${view.botchelor.casting.now.phase === "season" ? "this season's lead" : `${view.botchelor.casting.now.month}'s lead, the preseason`}); roses for the walk-ons every Sunday at the ceremony hour.`
                  : "closed. It opens when this season runs as The Botchelor, or as soon as next season is set to The Botchelor and its lead is picked above (the default lead is only known on the 1st)."}
            </p>
          )}
          {view.botchelor.premiere && <PremiereStatus p={view.botchelor.premiere} />}
          {view.botchelor.this_season.lead && (
            <p>
              <strong>Lead now:</strong> <CharacterName character={view.botchelor.this_season.lead} />
              {" · "}
              <strong>Suitors:</strong>{" "}
              {view.botchelor.this_season.suitors.length
                ? view.botchelor.this_season.suitors.map((s, i) => (
                    <span key={s.id}>
                      {i > 0 ? ", " : ""}
                      <CharacterName character={s} />
                      {s.in ? "" : " (went home)"}
                    </span>
                  ))
                : "none yet"}
            </p>
          )}
          {view.botchelor.this_season.ceremonies.length > 0 && (
            <ol>
              {view.botchelor.this_season.ceremonies.map((c) => (
                <li key={c.held_on}>
                  {c.finale ? "Finale" : `Week ${c.week}`} ({c.held_on}):{" "}
                  {c.final_rose
                    ? `the final rose to ${c.final_rose.name}`
                    : [c.eliminated_by_vote && `${c.eliminated_by_vote.name} by vote (${c.votes}/${c.total})`, c.eliminated_by_lead && `${c.eliminated_by_lead.name} by the lead`].filter(Boolean).join(", ")}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </>
  );
}
