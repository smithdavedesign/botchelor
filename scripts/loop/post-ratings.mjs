// Posts one loop run's simulated-visitor ratings to botchelor.com, so /admin/analytics can show them next to the real
// numbers (lib/real-metrics.ts). The app runs on Vercel and can't read ~/.botchelor-loop, so the loop sends them.
//
//   node scripts/loop/post-ratings.mjs <runDir> [--dry-run]
//
// Reads <runDir>/summary.json (sha, started_at, finished_at) and <runDir>/visitor-N.md (each visitor's report: section 7
// "Rating: X/10" and section 8 "MCP experience: X/10"), averages them and POSTs them to /api/admin/sim-ratings with the
// admin password (FRONTIER_PASSWORD from the environment, else the keychain's vault/botchelor/FRONTIER_PASSWORD; never
// printed). Posting the same run again replaces it. SITE overrides the target (default https://botchelor.com).
// --dry-run prints what it would post and sends nothing.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SCORE = /(\d+(?:\.\d+)?)\s*\/\s*10\b/;
/** A report's section heading: "## 8. …", "**8. …", "### MCP …". */
const HEADING = /^\s*(?:#{1,6}\s|\*\*\s*\d+\.)/;

/** The first "N/10" on the heading line that matches `heading`, or on one of the few lines after it (a bold "**8/10.**"). */
function scoreAfter(lines, heading) {
  const at = lines.findIndex((l) => heading.test(l));
  if (at < 0) return null;
  for (const [i, line] of lines.slice(at, at + 4).entries()) {
    if (i > 0 && HEADING.test(line)) break; // the next section: its score isn't this one's
    const m = SCORE.exec(line);
    if (m) {
      const n = Number(m[1]);
      return n >= 0 && n <= 10 ? n : null;
    }
  }
  return null;
}

/** A visitor report's two ratings: overall (section 7, "Rating") and MCP (section 8, "MCP experience"). Null when absent. */
export function parseReport(text) {
  const lines = String(text).split("\n");
  // A heading, in whatever form the visitor wrote it: "## 7. Rating: 8/10", "**7. Rating: 8/10**", "### 7. Rating".
  const head = (body) => new RegExp(`^\\s*(?:#{1,6}\\s*|\\*\\*\\s*)?${body}`, "i");
  const overall = scoreAfter(lines, head("(?:7\\.\\s*)?(?:overall\\s+)?rating\\b(?!.*mcp)"));
  const mcp = scoreAfter(lines, head("(?:8\\.\\s*)?mcp\\b"));
  return { overall, mcp };
}

const avg = (xs) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 100) / 100 : null);

/** One run folder's averages, as the endpoint takes them. */
export function runRatings(runDir) {
  const dir = resolve(runDir);
  let summary = {};
  try {
    summary = JSON.parse(readFileSync(join(dir, "summary.json"), "utf8"));
  } catch {
    /* a run without a summary still has its reports */
  }
  const reports = readdirSync(dir)
    .filter((f) => /^visitor-\d+\.md$/.test(f))
    .map((f) => parseReport(readFileSync(join(dir, f), "utf8")));
  const overall = reports.map((r) => r.overall).filter((n) => n !== null);
  const mcp = reports.map((r) => r.mcp).filter((n) => n !== null);
  const at = summary.finished_at ?? summary.started_at ?? new Date().toISOString();
  return {
    run: basename(dir),
    sha: typeof summary.sha === "string" ? summary.sha : null,
    at,
    overall_avg: avg(overall),
    mcp_avg: avg(mcp),
    visitors: reports.filter((r) => r.overall !== null || r.mcp !== null).length,
  };
}

function adminPassword() {
  if (process.env.FRONTIER_PASSWORD) return process.env.FRONTIER_PASSWORD;
  return execFileSync("security", ["find-generic-password", "-s", "vault/botchelor/FRONTIER_PASSWORD", "-w"], { encoding: "utf8" }).trim();
}

async function main() {
  const args = process.argv.slice(2);
  const runDir = args.find((a) => !a.startsWith("--"));
  if (!runDir || !existsSync(runDir)) {
    console.error("usage: node scripts/loop/post-ratings.mjs <runDir> [--dry-run]");
    process.exit(2);
  }
  const body = runRatings(runDir);
  if (args.includes("--dry-run")) {
    console.log(JSON.stringify(body, null, 2));
    return;
  }
  if (!body.visitors) {
    console.log(`post-ratings: no ratings in ${runDir}, nothing posted`);
    return;
  }
  const site = (process.env.SITE || "https://botchelor.com").replace(/\/$/, "");
  const res = await fetch(`${site}/api/admin/sim-ratings`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-frontier-key": adminPassword() },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`post-ratings: ${res.status} from ${site}`);
    process.exit(1);
  }
  console.log(`post-ratings: ${body.run} posted (overall ${body.overall_avg ?? "-"}, mcp ${body.mcp_avg ?? "-"}, ${body.visitors} visitors)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(`post-ratings: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
