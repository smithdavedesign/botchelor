"use client";

import { useCallback, useEffect, useState } from "react";
import type { SpendView } from "@/lib/spend";
import { addMonths, CATEGORIES, CATEGORY_LABEL, EVERY, monthOf, type Category, type Every, type Kind } from "@/lib/spend-shared";

const usd = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });
const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const EVERY_LABEL: Record<Every, string> = { once: "Once", month: "Every month", year: "Every year" };
const STATE_LABEL = { live: "Live", no_key: "No key", no_api: "No billing API", error: "Didn't answer" } as const;

const headers = (json = false): Record<string, string> => {
  let key = "";
  try {
    key = localStorage.getItem("bz_frontier") ?? "";
  } catch {
    /* private mode: an admin account still works */
  }
  return { ...(key ? { "x-frontier-key": key } : {}), ...(json ? { "content-type": "application/json" } : {}) };
};

type Draft = { kind: Kind; category: Category; provider: string; label: string; usd: string; every: Every; starts_on: string; ends_on: string; note: string };
const today = () => new Date().toISOString().slice(0, 10);
const EMPTY: Draft = { kind: "cost", category: "api", provider: "", label: "", usd: "", every: "once", starts_on: today(), ends_on: "", note: "" };

/**
 * The spend tracker: the month's totals, its costs and income line by line, six months side by side, each provider's
 * balance, and every entry with a form to add one. Reuses the admin password saved in this browser, like the other panels.
 */
export default function SpendPanel() {
  const [month, setMonth] = useState(() => monthOf(new Date()));
  const [view, setView] = useState<SpendView | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);

  const load = useCallback(async (m: string) => {
    const res = await fetch(`/api/admin/spend?month=${m}`, { headers: headers() }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    if (res?.ok) {
      setView(body as SpendView);
      setNote(null);
    } else setNote(res ? (body.message ?? "Not authorized.") : "Network error.");
  }, []);
  useEffect(() => {
    void load(month);
  }, [month, load]);

  async function post(payload: unknown, done: (body: Record<string, unknown>) => string) {
    setBusy(true);
    const res = await fetch("/api/admin/spend", { method: "POST", headers: headers(true), body: JSON.stringify(payload) }).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (res?.ok) {
      setNote(done(body));
      await load(month);
      return true;
    }
    setNote(body.message ?? (body.error === "bad_entry" ? "Check the entry: every field but the end and the note is needed." : "Couldn't save."));
    return false;
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(draft.usd);
    if (!Number.isFinite(amount) || amount < 0) return setNote("The amount needs to be a number.");
    const entry = { ...draft, usd: amount, ends_on: draft.every === "once" || !draft.ends_on ? null : draft.ends_on, note: draft.note.trim() || null };
    if (await post({ action: "add", entry }, () => `Added: ${draft.label}.`)) setDraft({ ...EMPTY, kind: draft.kind, category: draft.category });
  }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  if (!view) return <section className="card">{note ? <p className="muted">{note}</p> : <p className="muted">Loading…</p>}</section>;
  const s = view.summary;
  const costs = view.month_entries.filter((e) => e.kind === "cost");
  const entered = view.month_entries.filter((e) => e.kind === "income");
  const isNow = month === monthOf(new Date());

  return (
    <>
      <div className="spend-months">
        <button type="button" className="secondary small" onClick={() => setMonth(addMonths(month, -1))}>
          ← {monthName(addMonths(month, -1))}
        </button>
        <strong>{monthName(month)}</strong>
        {!isNow && (
          <button type="button" className="secondary small" onClick={() => setMonth(addMonths(month, 1))}>
            {monthName(addMonths(month, 1))} →
          </button>
        )}
      </div>

      <div className="kpi-grid">
        <div className="kpi">
          <span className="kpi-label">Costs</span>
          <span className="kpi-value">{usd(s.costs.total)}</span>
          <span className="kpi-sub">
            API {usd(s.costs.api)} · infra {usd(s.costs.infra)} · other {usd(s.costs.other)}
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Income</span>
          <span className="kpi-value">{usd(s.income.total)}</span>
          <span className="kpi-sub">{s.income.ours ? `${usd(s.income.ours)} of it from our own accounts` : "From real buyers"}</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Net</span>
          <span className="kpi-value">{usd(s.net)}</span>
          <span className="kpi-sub">Income less costs, our own purchases left out</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Model use we log</span>
          <span className="kpi-value">{usd(view.usage.eval_usd)}</span>
          <span className="kpi-sub">After Dark eval runs ({view.usage.eval_runs}), paid from OpenRouter&apos;s balance</span>
        </div>
      </div>

      {note && <p className="muted small" role="status">{note}</p>}

      <section className="card">
        <h2>Provider balances</h2>
        <p className="muted small">Read now, kept once a day, so the week&apos;s change shows after a week of readings.</p>
        <div className="table-scroll">
          <table className="board">
            <thead>
              <tr>
                <th>Provider</th>
                <th>State</th>
                <th className="num">Balance</th>
                <th className="num">A week ago</th>
                <th className="num">Used this month</th>
                <th className="num">Used in all</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {view.readings.map((r) => (
                <tr key={r.provider}>
                  <td>
                    <a href={r.dashboard} target="_blank" rel="noreferrer">
                      {r.label}
                    </a>
                    <span className="muted small"> · {CATEGORY_LABEL[r.category]}</span>
                  </td>
                  <td>{STATE_LABEL[r.state]}</td>
                  <td className="num">{usd(r.balance_usd)}</td>
                  <td className="num">{usd(r.balance_week_ago)}</td>
                  <td className="num">{usd(r.used_month_usd)}</td>
                  <td className="num">{usd(r.used_total_usd)}</td>
                  <td className="muted small">
                    {r.note ??
                      (r.state === "no_api"
                        ? "Check the dashboard and enter top-ups below"
                        : r.state === "no_key"
                          ? r.provider === "digitalocean"
                            ? "Set DO_BILLING_TOKEN (read-only)"
                            : r.provider === "bunny"
                              ? "Set BUNNY_ACCOUNT_KEY"
                              : "No house key saved"
                          : "")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>{monthName(month)}: costs</h2>
        {costs.length ? (
          <div className="table-scroll">
            <table className="board">
              <thead>
                <tr>
                  <th>What</th>
                  <th>Provider</th>
                  <th>Kind</th>
                  <th className="num">This month</th>
                </tr>
              </thead>
              <tbody>
                {costs.map((e) => (
                  <tr key={e.id}>
                    <td>
                      {e.label}
                      {e.note && <span className="muted small"> · {e.note}</span>}
                    </td>
                    <td>{e.provider}</td>
                    <td>
                      {CATEGORY_LABEL[e.category]}, {EVERY_LABEL[e.every].toLowerCase()}
                    </td>
                    <td className="num">{usd(e.in_month)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No costs entered for this month.</p>
        )}
        {view.known_missing > 0 && (
          <p>
            <button type="button" className="secondary" disabled={busy} onClick={() => post({ action: "add_known" }, (b) => `Added ${b.added} documented cost${b.added === 1 ? "" : "s"}.`)}>
              Fill in the {view.known_missing} costs docs/costs.md records
            </button>{" "}
            <span className="muted small">Vercel, Neon, DigitalOcean, Bunny, the prepaid top-ups and the MCP listings. Correct any of them after.</span>
          </p>
        )}
      </section>

      <section className="card">
        <h2>{monthName(month)}: income</h2>
        <div className="table-scroll">
          <table className="board">
            <thead>
              <tr>
                <th>Source</th>
                <th className="num">Payments</th>
                <th className="num">Amount</th>
                <th className="num">Ours</th>
              </tr>
            </thead>
            <tbody>
              {view.income.map((l) => (
                <tr key={l.source}>
                  <td>
                    {l.label}
                    {l.note && <span className="muted small"> · {l.note}</span>}
                  </td>
                  <td className="num">{l.count}</td>
                  <td className="num">{usd(l.usd)}</td>
                  <td className="num">{usd(l.ours_usd)}</td>
                </tr>
              ))}
              {entered.map((e) => (
                <tr key={e.id}>
                  <td>
                    {e.label} <span className="muted small">· entered{e.note ? `, ${e.note}` : ""}</span>
                  </td>
                  <td className="num">—</td>
                  <td className="num">{usd(e.in_month)}</td>
                  <td className="num">—</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>The last six months</h2>
        <div className="table-scroll">
          <table className="board">
            <thead>
              <tr>
                <th>Month</th>
                {CATEGORIES.map((c) => (
                  <th key={c} className="num">
                    {CATEGORY_LABEL[c]}
                  </th>
                ))}
                <th className="num">Costs</th>
                <th className="num">Income</th>
                <th className="num">Net</th>
              </tr>
            </thead>
            <tbody>
              {[...view.history].reverse().map((h) => (
                <tr key={h.month}>
                  <td>
                    <button type="button" className="link-button" onClick={() => setMonth(h.month)}>
                      {monthName(h.month)}
                    </button>
                  </td>
                  {CATEGORIES.map((c) => (
                    <td key={c} className="num">
                      {usd(h.costs[c])}
                    </td>
                  ))}
                  <td className="num">{usd(h.costs.total)}</td>
                  <td className="num">{usd(h.income.total)}</td>
                  <td className="num">{usd(h.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Add a cost or income</h2>
        <form onSubmit={add}>
          <div className="traits">
            <label>
              Money
              <select value={draft.kind} onChange={(e) => set("kind", e.target.value as Kind)}>
                <option value="cost">Out (a cost)</option>
                <option value="income">In (income)</option>
              </select>
            </label>
            <label>
              Kind
              <select value={draft.category} onChange={(e) => set("category", e.target.value as Category)}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Provider
              <input type="text" required maxLength={60} value={draft.provider} onChange={(e) => set("provider", e.target.value)} placeholder="Venice" />
            </label>
            <label>
              What
              <input type="text" required maxLength={120} value={draft.label} onChange={(e) => set("label", e.target.value)} placeholder="Auto-pay top-up" />
            </label>
            <label>
              Amount (USD)
              <input type="number" required min={0} step="0.01" inputMode="decimal" value={draft.usd} onChange={(e) => set("usd", e.target.value)} placeholder="10.00" />
            </label>
            <label>
              How often
              <select value={draft.every} onChange={(e) => set("every", e.target.value as Every)}>
                {EVERY.map((x) => (
                  <option key={x} value={x}>
                    {EVERY_LABEL[x]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {draft.every === "once" ? "On" : "From"}
              <input type="date" required value={draft.starts_on} onChange={(e) => set("starts_on", e.target.value)} />
            </label>
            {draft.every !== "once" && (
              <label>
                Until (optional)
                <input type="date" value={draft.ends_on} min={draft.starts_on} onChange={(e) => set("ends_on", e.target.value)} />
              </label>
            )}
          </div>
          <label>
            Note (optional)
            <input type="text" maxLength={300} value={draft.note} onChange={(e) => set("note", e.target.value)} />
          </label>
          <p>
            <button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Add it"}
            </button>
          </p>
        </form>
      </section>

      <section className="card">
        <h2>Every entry</h2>
        {view.entries.length ? (
          <div className="table-scroll">
            <table className="board">
              <thead>
                <tr>
                  <th>What</th>
                  <th>Provider</th>
                  <th>Kind</th>
                  <th>When</th>
                  <th className="num">Amount</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {view.entries.map((e) => (
                  <tr key={e.id}>
                    <td>
                      {e.kind === "income" ? "In: " : ""}
                      {e.label}
                      {e.note && <span className="muted small"> · {e.note}</span>}
                    </td>
                    <td>{e.provider}</td>
                    <td>{CATEGORY_LABEL[e.category]}</td>
                    <td>
                      {EVERY_LABEL[e.every]}, {e.every === "once" ? e.starts_on : `from ${e.starts_on}${e.ends_on ? ` to ${e.ends_on}` : ""}`}
                    </td>
                    <td className="num">{usd(e.usd)}</td>
                    <td>
                      <button
                        type="button"
                        className="secondary small"
                        disabled={busy}
                        onClick={() => {
                          if (confirm(`Delete "${e.label}"?`)) void post({ action: "delete", id: e.id }, () => `Deleted: ${e.label}.`);
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">Nothing entered yet.</p>
        )}
      </section>
    </>
  );
}
