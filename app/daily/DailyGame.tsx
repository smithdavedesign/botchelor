"use client";

import { useEffect, useState, type FormEvent } from "react";
import { trackConversion } from "@/app/conversion";
import {
  DAILY_PATH,
  DAILY_STORAGE_KEY,
  dailyNumberAt,
  dailyShareText,
  dailyStreak,
  formatCountdown,
  msUntilNextDaily,
  readDailyHistory,
  recordDailyPlay,
  type DailyHistory,
  type DailyReveal,
} from "@/lib/daily-shared";
import { ENDING_LABELS, ENDINGS, type Ending } from "@/lib/rules";
import DailyStoryView from "./Story";

function loadHistory(): DailyHistory {
  try {
    return readDailyHistory(localStorage.getItem(DAILY_STORAGE_KEY));
  } catch {
    return {}; // storage blocked: the game still plays, it just can't remember
  }
}

function saveHistory(history: DailyHistory): void {
  try {
    localStorage.setItem(DAILY_STORAGE_KEY, JSON.stringify(history));
  } catch {
    /* storage blocked */
  }
}

type State = { phase: "pick" | "busy" } | { phase: "result"; reveal: DailyReveal; streak: number };

/**
 * Today's Daily Date game (lib/daily-shared.ts): three endings to pick from, then the date itself. The page hands it
 * only the day's number, never the ending; a pick goes to POST /api/daily, which answers with the date. The picks and
 * the streak stay in this browser (localStorage), so there's no account; a reload on a day already played shows the
 * result again.
 */
export default function DailyGame({ n, shareUrl }: { n: number; shareUrl: string }) {
  const [state, setState] = useState<State>({ phase: "pick" });
  const [error, setError] = useState<string | null>(null);
  // The streak through yesterday, shown before today's pick so there's something to keep going.
  const [carried, setCarried] = useState(0);

  async function reveal(pick: Ending, fresh: boolean): Promise<void> {
    setError(null);
    setState({ phase: "busy" });
    try {
      const res = await fetch("/api/daily", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ n, pick }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.message === "string" ? body.message : "That didn't go through. Try again.");
      const result = body as DailyReveal;
      const history = recordDailyPlay(loadHistory(), n, { pick, correct: result.correct });
      saveHistory(history);
      if (fresh) trackConversion("prediction_made", { surface: "daily", with_drama: false });
      setState({ phase: "result", reveal: result, streak: dailyStreak(history, n) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't go through. Try again.");
      setState({ phase: "pick" });
    }
  }

  useEffect(() => {
    const history = loadHistory();
    const mine = history[n];
    if (mine) void reveal(mine.pick, false);
    else setCarried(dailyStreak(history, n - 1));
    // Once per day's number: reveal reads nothing else.
  }, [n]);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const pick = new FormData(e.currentTarget).get("pick");
    if (!ENDINGS.includes(pick as Ending)) return setError("Pick one of the three endings first.");
    void reveal(pick as Ending, true);
  }

  if (state.phase === "result") return <DailyResult reveal={state.reveal} streak={state.streak} shareUrl={shareUrl} />;

  return (
    <section className="card daily-game">
      <h2>How does it end?</h2>
      <form className="choices daily-choices" onSubmit={submit}>
        {ENDINGS.map((ending) => (
          <label key={ending}>
            <input type="radio" name="pick" value={ending} required /> {ENDING_LABELS[ending]}
          </label>
        ))}
        <button type="submit" disabled={state.phase === "busy"}>
          Lock it in
        </button>
      </form>
      {carried > 0 && (
        <p className="muted daily-carried">
          You&apos;ve called {carried} {carried === 1 ? "day" : "days"} in a row. Call today&apos;s to keep it going.
        </p>
      )}
      <p className="muted small">No account needed: your picks and your streak stay in this browser.</p>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

/** After the pick: right or wrong, the streak, the line to copy, and the date itself. */
export function DailyResult({ reveal, streak, shareUrl }: { reveal: DailyReveal; streak: number; shareUrl: string }) {
  const share = dailyShareText({ n: reveal.n, correct: reveal.correct, streak, url: shareUrl });
  const [copied, setCopied] = useState<string | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(share);
      setCopied("Copied. Paste it anywhere: it gives nothing away.");
    } catch {
      setCopied("Couldn't reach the clipboard: select the lines above and copy them.");
    }
  }

  return (
    <section className={`card daily-result ${reveal.correct ? "daily-right" : "daily-wrong"}`} data-ending={reveal.ending}>
      <h2>{reveal.correct ? "✅ You called it" : "❌ Not this time"}</h2>
      <p className="daily-verdict">
        It ended: <strong>{reveal.ending_label}</strong>.{" "}
        {reveal.correct ? "That was your pick." : `You picked ${ENDING_LABELS[reveal.pick].toLowerCase()}.`}
      </p>
      <p className="daily-streak">
        <strong>Streak: {streak}</strong>
      </p>
      <div className="daily-share">
        <pre data-share="">{share}</pre>
        <button type="button" onClick={copy}>
          Copy result
        </button>
        {copied && (
          <p className="muted small" role="status">
            {copied}
          </p>
        )}
      </div>
      <NextDaily n={reveal.n} />
      <DailyStoryView story={reveal} />
    </section>
  );
}

/**
 * When the next Daily Date is, by this browser's clock: a countdown to the next UTC midnight, and once it's passed (a tab
 * left open overnight), a link to the new one. Nothing until mounted, so the server's render never disagrees with it.
 */
function NextDaily({ n }: { n: number }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  if (now === null) return null;
  if (dailyNumberAt(now) > n) {
    return (
      <p className="daily-next">
        {/* A full load, so the server deals the new day. */}
        <a className="button" href={DAILY_PATH}>
          Daily Date #{dailyNumberAt(now)} is up: play it
        </a>
      </p>
    );
  }
  return <p className="muted daily-next">The next Daily Date is in {formatCountdown(msUntilNextDaily(now))}, at midnight UTC.</p>;
}
