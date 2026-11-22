"use client";

import { useState } from "react";
import { ENDING_LABELS, ENDINGS, type Ending } from "@/lib/rules";

/**
 * A run spends on the paid frontier model, so it takes the admin password every time, even from an admin account
 * (app/api/admin/frontier): typed here, sent with the run, and kept only while this page is open, never saved.
 */
export default function FrontierCompare({ configured }: { configured: boolean }) {
  const [key, setKey] = useState("");
  const [a, setA] = useState("Mira Quell");
  const [b, setB] = useState("Rafe Calloway");
  const [scenario, setScenario] = useState("");
  const [ending, setEnding] = useState<Ending>("second_date");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ free: string; frontier: string } | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/frontier", {
        method: "POST",
        headers: { "content-type": "application/json", "x-frontier-key": key },
        body: JSON.stringify({ a, b, scenario: scenario || undefined, ending }),
      });
      const data = await res.json();
      if (res.ok) setResult(data);
      else setError(data.message ?? data.error ?? "Failed.");
    } catch {
      setError("Network error. Try again.");
    }
    setBusy(false);
  }

  return (
    <>
      <section className="card">
        <label>
          Frontier password
          <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="only you have this" autoComplete="off" />
        </label>
        <div className="traits">
          <label>
            Character A
            <input type="text" maxLength={60} value={a} onChange={(e) => setA(e.target.value)} />
          </label>
          <label>
            Character B
            <input type="text" maxLength={60} value={b} onChange={(e) => setB(e.target.value)} />
          </label>
          <label>
            Ending
            <select value={ending} onChange={(e) => setEnding(e.target.value as Ending)}>
              {ENDINGS.map((x) => (
                <option key={x} value={x}>
                  {ENDING_LABELS[x]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Scenario <span className="muted">(optional)</span>
          <input type="text" maxLength={200} value={scenario} onChange={(e) => setScenario(e.target.value)} placeholder="a rooftop in the rain" />
        </label>
        <button type="button" disabled={busy || !configured} onClick={run}>
          {busy ? "Running both models…" : "Run free vs frontier"}
        </button>
        {!configured && <p className="error">No frontier model is configured yet (set FRONTIER_LLM_* in the environment).</p>}
        {error && <p className="error">{error}</p>}
      </section>

      {result && (
        <div className="features">
          <section className="card">
            <h3>Free model</h3>
            <p>{result.free}</p>
          </section>
          <section className="card">
            <h3>Frontier model</h3>
            <p>{result.frontier}</p>
          </section>
        </div>
      )}

      <p className="muted">
        The password is checked on the server and isn't saved anywhere: close the page and it's gone. Each run makes
        one free and one frontier call.
      </p>
    </>
  );
}
