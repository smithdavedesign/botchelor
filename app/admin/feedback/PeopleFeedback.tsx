"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PeopleSummary, TrendDay, UserFeedbackRow } from "@/lib/user-feedback";
import { CATEGORY_LABELS, FEEDBACK_CATEGORIES, FEEDBACK_NOTE_MAX, FEEDBACK_STATUSES, type FeedbackCategory, type FeedbackStatus } from "@/lib/user-feedback-shared";

type Period = "7" | "30" | "90" | "all" | "custom";
type Filters = {
  period: Period;
  from: string;
  to: string;
  category: "" | FeedbackCategory;
  min: string;
  max: string;
  status: "" | FeedbackStatus;
  ours: boolean;
};
type Data = { summary: PeopleSummary; trend: TrendDay[]; items: UserFeedbackRow[]; new_count: number };

const START: Filters = { period: "30", from: "", to: "", category: "", min: "", max: "", status: "", ours: false };
const PERIODS: [Period, string][] = [
  ["7", "Last 7 days"],
  ["30", "Last 30 days"],
  ["90", "Last 90 days"],
  ["all", "All time"],
  ["custom", "Dates…"],
];
const STATUS_LABELS: Record<FeedbackStatus, string> = { new: "New", seen: "Seen", done: "Done" };
const FLAG_LABELS: Record<string, string> = { sexual: "sexual", minor: "a minor", real_person: "a real person", innuendo: "innuendo" };

/** The filter as the API's query string; empty boxes are left out (they mean "any"). */
function query(f: Filters, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  if (f.period === "custom") {
    if (f.from) p.set("from", f.from);
    if (f.to) p.set("to", f.to);
  } else {
    p.set("days", f.period);
  }
  if (f.category) p.set("category", f.category);
  if (f.status) p.set("status", f.status);
  if (f.min) p.set("min", f.min);
  if (f.max) p.set("max", f.max);
  if (f.ours) p.set("ours", "1");
  for (const [k, v] of Object.entries(extra)) p.set(k, v);
  return p.toString();
}

/** The admin password saved by the other admin panels in this browser, if any (an admin account works without it). */
function adminHeaders(): Record<string, string> {
  try {
    const key = localStorage.getItem("bz_frontier");
    return key ? { "x-frontier-key": key } : {};
  } catch {
    return {};
  }
}

const when = (iso: string) => new Date(iso).toLocaleString();
const shortDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * A sparkline: one series over the period's days, in the quiet ink, with the latest point in the accent. Each day is a
 * hover target with its own tooltip; the table under the tiles has the same numbers for anyone who can't hover.
 */
function Sparkline({ days, value, label, unit }: { days: TrendDay[]; value: (d: TrendDay) => number | null; label: string; unit: (v: number) => string }) {
  const W = 132;
  const H = 34;
  const PAD = 5;
  const points = days.map((d, i) => ({ i, v: value(d), day: d.day })).filter((p): p is { i: number; v: number; day: string } => p.v !== null);
  if (days.length < 2 || points.length < 2) return null;
  const top = Math.max(...points.map((p) => p.v));
  const bottom = Math.min(0, ...points.map((p) => p.v));
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / (days.length - 1);
  const y = (v: number) => H - PAD - ((v - bottom) * (H - 2 * PAD)) / (top - bottom || 1);
  const end = points[points.length - 1];
  const slot = (W - 2 * PAD) / (days.length - 1);
  return (
    <svg className="pf-spark" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={label}>
      <polyline
        points={points.map((p) => `${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle className="pf-spark-end" cx={x(end.i)} cy={y(end.v)} r={4} />
      {points.map((p) => (
        <rect key={p.day} className="pf-spark-hit" x={x(p.i) - slot / 2} y={0} width={slot} height={H}>
          <title>{`${shortDay(p.day)}: ${unit(p.v)}`}</title>
        </rect>
      ))}
    </svg>
  );
}

/**
 * The People tab (lib/user-feedback.ts): what people send with "Give us feedback". The numbers for the filter (notes,
 * new, average rating, NPS) with a per-day trend, the notes themselves, each one's status and the owner's note, and a
 * CSV of the same notes. Works with the saved admin password or a signed-in admin account.
 */
export default function PeopleFeedback() {
  const [filters, setFilters] = useState<Filters>(START);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const latest = useRef(0);

  const load = useCallback(async (f: Filters) => {
    // Typing a rating filter fires a load per keystroke: only the newest answer is shown.
    const mine = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/feedback/people?${query(f)}`, { headers: adminHeaders() });
      const body = await res.json().catch(() => ({}));
      if (mine !== latest.current) return;
      if (res.ok) {
        setData(body as Data);
        setNeedsPassword(false);
      } else if (res.status === 403) {
        setNeedsPassword(true);
      } else {
        setError(body.issues?.[0]?.message ?? body.message ?? "That didn't load.");
      }
    } catch {
      if (mine === latest.current) setError("Network error.");
    } finally {
      if (mine === latest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(filters);
  }, [filters, load]);

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((f) => ({ ...f, [key]: value }));

  async function signIn() {
    try {
      localStorage.setItem("bz_frontier", password.trim());
    } catch {
      /* private mode: it still works for this page */
    }
    setPassword("");
    await load(filters);
  }

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    const res = await fetch("/api/admin/feedback/people", {
      method: "PATCH",
      headers: { "content-type": "application/json", ...adminHeaders() },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (!res?.ok) setError((await res?.json().catch(() => ({})))?.message ?? "That didn't save.");
    return Boolean(res?.ok);
  }

  async function setStatus(id: string, status: FeedbackStatus) {
    setBusyId(id);
    if (await patch({ id, status })) await load(filters);
    setBusyId(null);
  }

  async function saveNote(row: UserFeedbackRow) {
    setBusyId(row.id);
    const note = notes[row.id] ?? row.note ?? "";
    if (await patch({ id: row.id, note: note.trim() ? note : null })) {
      setData((d) => (d ? { ...d, items: d.items.map((r) => (r.id === row.id ? { ...r, note: note.trim() || null } : r)) } : d));
      // Saved: the box shows the stored note again, so Save waits for the next edit.
      setNotes((n) => {
        const next = { ...n };
        delete next[row.id];
        return next;
      });
    }
    setBusyId(null);
  }

  async function markAllSeen(ids: string[]) {
    setBusyId("all");
    if (await patch({ ids, status: "seen" })) await load(filters);
    setBusyId(null);
  }

  async function exportCsv() {
    setError(null);
    const res = await fetch(`/api/admin/feedback/people?${query(filters, { format: "csv" })}`, { headers: adminHeaders() }).catch(() => null);
    if (!res?.ok) {
      setError("The export didn't work.");
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "botchelor-feedback.csv";
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  if (needsPassword) {
    return (
      <section className="card">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void signIn();
          }}
        >
          <label htmlFor="people-password">Admin password</label>
          <input id="people-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button type="submit" className="small" disabled={!password.trim()}>
            Sign in
          </button>
        </form>
        <p className="muted small">Or sign in with an admin account.</p>
      </section>
    );
  }

  const s = data?.summary;
  const unseen = data?.items.filter((r) => r.status === "new").map((r) => r.id) ?? [];
  const busyDays = data?.trend.filter((d) => d.count > 0) ?? [];
  const peak = Math.max(0, ...(data?.trend.map((d) => d.count) ?? []));

  return (
    <section className={loading && data ? "pf-loading" : undefined} aria-busy={loading}>
      <form className="pf-filters" onSubmit={(e) => e.preventDefault()} aria-label="Filter the notes">
        <div>
          <label htmlFor="pf-period">When</label>
          <select id="pf-period" value={filters.period} onChange={(e) => set("period", e.target.value as Period)}>
            {PERIODS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {filters.period === "custom" && (
          <>
            <div>
              <label htmlFor="pf-from">From</label>
              <input id="pf-from" type="date" value={filters.from} onChange={(e) => set("from", e.target.value)} />
            </div>
            <div>
              <label htmlFor="pf-to">To</label>
              <input id="pf-to" type="date" value={filters.to} onChange={(e) => set("to", e.target.value)} />
            </div>
          </>
        )}
        <div>
          <label htmlFor="pf-category">About</label>
          <select id="pf-category" value={filters.category} onChange={(e) => set("category", e.target.value as Filters["category"])}>
            <option value="">Anything</option>
            {FEEDBACK_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="pf-min">Rating from</label>
          <input id="pf-min" type="number" inputMode="numeric" min={0} max={10} value={filters.min} onChange={(e) => set("min", e.target.value)} />
        </div>
        <div>
          <label htmlFor="pf-max">to</label>
          <input id="pf-max" type="number" inputMode="numeric" min={0} max={10} value={filters.max} onChange={(e) => set("max", e.target.value)} />
        </div>
        <div>
          <label htmlFor="pf-status">Status</label>
          <select id="pf-status" value={filters.status} onChange={(e) => set("status", e.target.value as Filters["status"])}>
            <option value="">Any</option>
            {FEEDBACK_STATUSES.map((st) => (
              <option key={st} value={st}>
                {STATUS_LABELS[st]}
              </option>
            ))}
          </select>
        </div>
        <label className="check">
          <input type="checkbox" checked={filters.ours} onChange={(e) => set("ours", e.target.checked)} />
          Include our own tests
        </label>
      </form>
      <div className="pf-actions">
        <button type="button" className="secondary small" onClick={() => void load(filters)}>
          Refresh
        </button>
        <button type="button" className="secondary small" onClick={() => void exportCsv()} disabled={!s?.count}>
          Export CSV
        </button>
        {unseen.length > 0 && (
          <button type="button" className="secondary small" disabled={busyId === "all"} onClick={() => void markAllSeen(unseen)}>
            Mark these {unseen.length} seen
          </button>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {s && data && (
        <>
          <div className="pf-tiles">
            <div className="pf-tile">
              <span className="pf-tile-label">Notes</span>
              <span className="pf-tile-value">{s.count}</span>
              <span className="pf-tile-sub">
                {s.accounts} from accounts, {s.count - s.accounts} anonymous
              </span>
              <Sparkline
                days={data.trend}
                value={(d) => d.count}
                label={`Notes per day over ${data.trend.length} days, at most ${peak} in a day`}
                unit={(v) => `${v} note${v === 1 ? "" : "s"}`}
              />
            </div>
            <div className="pf-tile">
              <span className="pf-tile-label">New</span>
              <span className="pf-tile-value">{s.new}</span>
              <span className="pf-tile-sub">{data.new_count} new in all, our tests aside</span>
            </div>
            <div className="pf-tile">
              <span className="pf-tile-label">Average rating</span>
              <span className="pf-tile-value">{s.average === null ? "–" : `${s.average}/10`}</span>
              <span className="pf-tile-sub">
                from {s.rated} rating{s.rated === 1 ? "" : "s"}
              </span>
              <Sparkline days={data.trend} value={(d) => d.average} label={`Average rating per day over ${data.trend.length} days`} unit={(v) => `${v} out of 10`} />
            </div>
            <div className="pf-tile">
              <span className="pf-tile-label">NPS</span>
              <span className="pf-tile-value">{s.nps === null ? "–" : s.nps > 0 ? `+${s.nps}` : s.nps}</span>
              <span className="pf-tile-sub">
                {s.promoters} would recommend, {s.passives} neutral, {s.detractors} wouldn&apos;t
              </span>
            </div>
          </div>
          <p className="small muted">
            {FEEDBACK_CATEGORIES.map((c) => `${CATEGORY_LABELS[c]} ${s.by_category[c]}`).join(" · ")}
            {s.flagged > 0 ? ` · ${s.flagged} flagged by the content filter` : ""}
          </p>
          {busyDays.length > 0 && (
            <details>
              <summary className="small">Day by day</summary>
              <table className="pf-days small">
                <thead>
                  <tr>
                    <th scope="col">Day (UTC)</th>
                    <th scope="col">Notes</th>
                    <th scope="col">Average rating</th>
                  </tr>
                </thead>
                <tbody>
                  {busyDays.map((d) => (
                    <tr key={d.day}>
                      <td>{d.day}</td>
                      <td>{d.count}</td>
                      <td>{d.average ?? "–"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}

          {data.items.length === 0 && <p className="muted">No notes for these filters yet.</p>}
          {data.items.length > 0 && data.items.length < s.count && (
            <p className="small muted">
              The newest {data.items.length} of {s.count}. The CSV has them all.
            </p>
          )}
          <ul className="list">
            {data.items.map((r) => {
              const draft = notes[r.id] ?? r.note ?? "";
              return (
                <li key={r.id} className={`card pf-note${r.status === "new" ? " is-new" : ""}`}>
                  <p className="small muted">
                    <time dateTime={r.created_at}>{when(r.created_at)}</time> · <span className="chip">{CATEGORY_LABELS[r.category]}</span> ·{" "}
                    {r.rating === null ? "no rating" : <strong>{r.rating}/10</strong>} · {r.account ? "account" : "anonymous"}
                    {r.page ? (
                      <>
                        {" "}· <a href={r.page}>{r.page}</a>
                      </>
                    ) : null}
                    {r.viewport ? ` · ${r.viewport}` : ""}
                    {r.version ? ` · ${r.version.slice(0, 7)}` : ""}
                    {r.flagged && (
                      <>
                        {" "}· <span className="chip pf-flag">flagged: {FLAG_LABELS[r.flag_reason ?? ""] ?? "content"}</span>
                      </>
                    )}
                    {r.ours && (
                      <>
                        {" "}· <span className="chip">our test</span>
                      </>
                    )}
                  </p>
                  {r.message ? <p className="pf-message">{r.message}</p> : <p className="muted">A rating, no words.</p>}
                  {r.email && (
                    <p className="small">
                      Reply to <a href={`mailto:${r.email}`}>{r.email}</a>
                    </p>
                  )}
                  {r.user_agent && <p className="small muted pf-ua">{r.user_agent}</p>}
                  <div className="pf-triage">
                    <div>
                      <label htmlFor={`pf-status-${r.id}`}>Status</label>
                      <select id={`pf-status-${r.id}`} value={r.status} disabled={busyId === r.id} onChange={(e) => void setStatus(r.id, e.target.value as FeedbackStatus)}>
                        {FEEDBACK_STATUSES.map((st) => (
                          <option key={st} value={st}>
                            {STATUS_LABELS[st]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="pf-note-field">
                      <label htmlFor={`pf-note-${r.id}`}>Your note</label>
                      <textarea
                        id={`pf-note-${r.id}`}
                        rows={1}
                        maxLength={FEEDBACK_NOTE_MAX}
                        value={draft}
                        onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                      />
                    </div>
                    <button type="button" className="secondary small" disabled={busyId === r.id || draft === (r.note ?? "")} onClick={() => void saveNote(r)}>
                      Save note
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
