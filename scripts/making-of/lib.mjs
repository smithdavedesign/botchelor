/**
 * The making-of page's facts, read from git (app/making-of, lib/making-of.ts). Pure helpers, so tests can pin them
 * (tests/making-of.test.ts); scripts/making-of/collect.mjs runs git and writes the files.
 */

/** The show is made in California, so a day is a Pacific day: the first commit is 2026-10-13 07:44 PDT. */
export const TIME_ZONE = "America/Los_Angeles";

/** A commit's ISO time as its Pacific calendar day, "YYYY-MM-DD". */
export function pacificDay(iso) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** A commit's ISO time as Pacific clock time, "7:44 am". */
export function pacificTime(iso) {
  return new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit" }).format(new Date(iso)).replace(/\s?([AP])M$/, (_, x) => ` ${x.toLowerCase()}m`);
}

/**
 * The pull request a first-parent commit on main brought in: a merge commit ("Merge pull request #12 from …", the PR's
 * title on the body's first line) or a squash ("Title (#12)"). Anything else (the first commit, a direct push) is null.
 */
export function prOf(subject, body = "") {
  const merge = /^Merge pull request #(\d+) from /.exec(subject);
  if (merge) {
    const title = body.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
    return { pr: Number(merge[1]), title };
  }
  // A merge made by hand and pushed (Oct 21–22) names the PR with a colon: "Merge pull request #606: tsc-fix verified".
  const byHand = /^Merge pull request #(\d+): (.+)$/.exec(subject);
  if (byHand) return { pr: Number(byHand[1]), title: byHand[2].trim() };
  const squash = /^(.*\S)\s+\(#(\d+)\)$/.exec(subject);
  if (squash) return { pr: Number(squash[2]), title: squash[1] };
  return null;
}

/** `git log --first-parent --format='%H%x1f%cI%x1f%s%x1f%b%x1e'` → one entry per commit, PR or not, newest first. */
export function parseFirstParent(text) {
  return text
    .split("\x1e")
    .map((r) => r.replace(/^\n+/, ""))
    .filter(Boolean)
    .map((r) => {
      const [sha, iso, subject, body = ""] = r.split("\x1f");
      return { sha, iso, day: pacificDay(iso), subject, ...(prOf(subject, body) ?? { pr: null, title: subject }) };
    });
}

/**
 * `git log --first-parent --diff-merges=first-parent --name-status --format='@@%H' -- docs/screenshots` → for each
 * commit, the screenshots it added (A) or changed (M), so each version can be read back at that commit.
 */
export function parseShotLog(text) {
  const out = new Map();
  let sha = null;
  for (const line of text.split("\n")) {
    if (line.startsWith("@@")) {
      sha = line.slice(2).trim();
      out.set(sha, []);
      continue;
    }
    const m = /^([AM])\t(.+)$/.exec(line);
    if (m && sha && /\.(png|jpe?g|webp)$/i.test(m[2])) out.get(sha).push({ status: m[1], path: m[2] });
  }
  return out;
}

/**
 * A screenshot's name says what it shows. These never go on the open page: After Dark and its Studio, the back office,
 * money and accounts, companions and calls, and anything a test made. Bare words match a whole word of the file name
 * (so "ad" catches "ad-hub" but not "add" or "read"); the rest match anywhere.
 */
const NEVER_WORDS = ["ad", "nsfw", "admin", "spend", "costs", "billing", "checkout", "stripe", "token", "tokens", "wallet", "account", "login", "signin", "password", "recovery", "email", "settings", "companion", "companions", "call", "calls", "ditto", "lipsync", "e2e", "debug", "nude", "explicit", "spicy", "heat", "night", "nights", "shorts", "shoot", "roleplay", "roleplays", "director", "studio", "showcase", "reel", "reels", "gallery", "archive", "limits", "processor", "ccbill", "segpay", "verotel", "didit", "age", "verify"];
const NEVER_PARTS = ["after-dark", "afterdark", "step-in", "stepin", "analytics", "sign-in", "private", "discreet"];

export function openPageSafe(path) {
  const name = path.split("/").pop().toLowerCase().replace(/\.[a-z]+$/, "");
  if (NEVER_PARTS.some((p) => name.includes(p))) return false;
  const words = name.split(/[^a-z0-9]+/);
  return !words.some((w) => NEVER_WORDS.includes(w));
}

/** "watch-theater-desktop.png" → { base: "watch-theater", kind: "desktop" }; phone/mobile → "phone". */
export function shotKind(path) {
  const name = path.split("/").pop().replace(/\.[a-z]+$/i, "");
  const m = /^(.*?)[-_](desktop|phone|mobile)(?:[-_](.*))?$/.exec(name);
  if (!m) return { base: name, kind: "other" };
  const base = m[3] ? `${m[1]}-${m[3]}` : m[1];
  return { base, kind: m[2] === "desktop" ? "desktop" : "phone" };
}

/** Merged PRs per Pacific day from the first day to the last, zero days included, oldest first. */
export function prsPerDay(commits, first, last) {
  const counts = new Map();
  for (const c of commits) if (c.pr) counts.set(c.day, (counts.get(c.day) ?? 0) + 1);
  const days = [];
  for (let d = new Date(`${first}T12:00:00Z`); ; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.toISOString().slice(0, 10);
    days.push({ day, prs: counts.get(day) ?? 0 });
    if (day >= last) break;
  }
  return days;
}
