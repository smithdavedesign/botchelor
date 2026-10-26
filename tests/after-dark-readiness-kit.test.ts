import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SEGPAY_SECRET_MIN } from "@/lib/adult/billing-segpay";
import { startTestDb } from "./helpers";

// The processor readiness kit (docs/after-dark-processor-application.md): the monthly moderation report runs on today's
// schema and counts what it says; the setup script asks for exactly the settings the billing code reads, and every
// parameter in the Segpay postback URL it hands out is one the postback handler reads.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const REPORT = readFileSync("scripts/after-dark/moderation-report.sql", "utf8");
const SETUP = readFileSync("scripts/after-dark/provision-billing.py", "utf8");
const SEGPAY = readFileSync("lib/adult/billing-segpay.ts", "utf8");
const VEROTEL = readFileSync("lib/adult/billing-verotel.ts", "utf8");

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  for (const table of ["adult_images", "adult_rejections", "content_reports", "adult_billing_events", "adult_billing_flags"]) await t.db.query(`delete from ${table}`);
});

/** The report's statements in order, for this month (the file's `report_month` line set to its first day). */
function reportStatements(monthStart: string): string[] {
  const sql = REPORT.replace(/set local after_dark\.report_month = '';/, `set local after_dark.report_month = '${monthStart}';`);
  expect(sql).toContain(`report_month = '${monthStart}'`);
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(/;\s*\n/)
    .map((s) => s.trim().replace(/;$/, ""))
    .filter(Boolean);
}

describe("the monthly moderation report (scripts/after-dark/moderation-report.sql)", () => {
  it("runs read-only on today's schema and counts kept, refused, reports against their deadlines, and billing", async () => {
    // A fixed past month, so the test reads the same on any day it runs.
    const monthStart = "2026-09-01";
    const at = (iso: string) => `2026-09-${iso}`;
    for (const [i, kind] of ["scene", "scene", "video", "audio"].entries()) {
      await t.db.query(`insert into adult_images (id, owner_id, kind, prompt, mime, status, created_at) values ($1, 'u1', $2, 'p', 'image/png', 'ready', $3)`, [
        `img${i}`,
        kind,
        at("10T12:00:00Z"),
      ]);
    }
    await t.db.query(`insert into adult_images (id, owner_id, kind, prompt, mime, status, created_at) values ('pend', 'u1', 'scene', 'p', 'image/png', 'pending', $1)`, [at("10T12:00:00Z")]);
    // Outside the month: never counted.
    await t.db.query(`insert into adult_images (id, owner_id, kind, prompt, mime, status, created_at) values ('aug', 'u1', 'scene', 'p', 'image/png', 'ready', '2026-08-31T23:00:00Z')`);
    await t.db.query(
      `insert into adult_rejections (id, owner_id, kind, reason, created_at) values
         ('r1', 'u1', 'scene', 'age check (Venice): MINOR', $1), ('r2', 'u1', 'scene', 'age check (Venice): MINOR', $1),
         ('r3', 'u1', 'video', 'the check couldn''t run (Hive answered 429)', $1)`,
      [at("11T09:00:00Z")],
    );
    // Reports: an intimate image decided in 30 hours (in time), another kind decided after 10 days (late), one still open.
    await t.db.query(
      `insert into content_reports (id, created_at, category, status, decided_at) values
         ('c1', $1, 'intimate_image', 'hidden', $2), ('c2', $3, 'other', 'dismissed', $4), ('c3', $5, 'minor', 'open', null)`,
      [at("05T00:00:00Z"), at("06T06:00:00Z"), at("02T00:00:00Z"), at("12T00:00:00Z"), at("20T00:00:00Z")],
    );

    const statements = reportStatements(monthStart);
    expect(statements[0]).toBe("begin read only");
    expect(statements.at(-1)).toBe("rollback");
    const results: Any[][] = [];
    try {
      for (const s of statements) results.push((await t.db.query<Any>(s)).rows);
    } finally {
      // A failed statement leaves the transaction open and aborted: close it, so one failure stays one red test.
      await t.db.query("rollback").catch(() => {});
    }

    // Statement order: begin, set, month, kept/refused, reasons, reports, deadlines, billing, flags, rollback.
    const [, , month, outcomes, reasons, reports, deadlines, billing, flags] = results;
    expect(month[0].month_start).toBeTruthy();
    const count = (outcome: string, kind: string) => outcomes.find((r: Any) => r.outcome === outcome && r.kind === kind)?.n ?? 0;
    expect(count("kept: passed the output check", "scene")).toBe(2); // the pending one isn't kept
    expect(count("kept: passed the output check", "video")).toBe(1);
    expect(count("kept: voiced line (no picture to check)", "audio")).toBe(1); // never counted as "passed the check"
    expect(count("refused and discarded", "scene")).toBe(2);
    expect(count("refused and discarded", "video")).toBe(1);
    expect(reasons[0]).toEqual({ reason: "age check (Venice): MINOR", n: 2 });
    expect(reports.map((r: Any) => `${r.category}/${r.status}`).sort()).toEqual(["intimate_image/hidden", "minor/open", "other/dismissed"]);
    const by = (c: string) => deadlines.find((r: Any) => r.category === c);
    expect(by("intimate_image")).toMatchObject({ decided: 1, still_open: 0, within_deadline: 1 });
    expect(by("other")).toMatchObject({ decided: 1, within_deadline: 0 }); // 10 days > 7 business days
    expect(by("minor")).toMatchObject({ decided: 0, still_open: 1 });
    expect(billing).toEqual([]);
    expect(flags).toEqual([{ accounts_flagged: 0 }]);
  });

  it("only reads: every statement is a select inside a read-only transaction it rolls back", () => {
    const statements = reportStatements("2026-10-01");
    const body = statements.slice(2, -1);
    for (const s of body) expect(s).toMatch(/^(with|select)\b/i);
    expect(REPORT).not.toMatch(/\b(insert|update|delete|drop|alter|truncate)\b/i);
    // Counts only: no user ids, names, prompts or pictures leave the database.
    expect(REPORT).not.toMatch(/select[^;]*\b(owner_id|user_id|prompt|data|contact_email|details)\b/i);
  });
});

describe("the setup script asks for exactly what the billing code reads (scripts/after-dark/provision-billing.py)", () => {
  /** (name, required) from the script's SETTINGS for one processor. */
  const settings = (processor: string): { name: string; required: boolean }[] => {
    const block = SETUP.slice(SETUP.indexOf(`"${processor}": [`), SETUP.indexOf("],", SETUP.indexOf(`"${processor}": [`)));
    return [...block.matchAll(/\("([A-Z_]+)",\s*(?:None|"[^"]*"),\s*(True|False)/g)].map((m) => ({ name: m[1], required: m[2] === "True" }));
  };
  const envNames = (src: string, prefix: string) => [...new Set([...src.matchAll(new RegExp(`env\\.(${prefix}_[A-Z_]+)`, "g"))].map((m) => m[1]))].sort();

  it("Segpay: the same settings, the same required ones, and a secret at least as long as the handler demands", () => {
    const s = settings("segpay");
    expect(s.map((x) => x.name).sort()).toEqual(envNames(SEGPAY, "SEGPAY"));
    // segpayConfig is off without the package, the price point and the postback secret; the IP list is optional.
    expect(s.filter((x) => x.required).map((x) => x.name).sort()).toEqual(["SEGPAY_PACKAGE_ID", "SEGPAY_POSTBACK_SECRET", "SEGPAY_PRICE_POINT_ID"]);
    // The script makes the secret with secrets.token_hex(32): 64 characters, and checks a stored one is 32+.
    expect(SETUP).toMatch(/secrets\.token_hex\(32\)/);
    expect(64).toBeGreaterThanOrEqual(SEGPAY_SECRET_MIN);
    expect(SETUP).toMatch(new RegExp(`len\\(v\\) >= ${SEGPAY_SECRET_MIN}\\b`));
  });

  it("Verotel: the same settings and the same required ones", () => {
    const s = settings("verotel");
    expect(s.map((x) => x.name).sort()).toEqual(envNames(VEROTEL, "VEROTEL"));
    expect(s.filter((x) => x.required).map((x) => x.name).sort()).toEqual(["VEROTEL_SHOP_ID", "VEROTEL_SIGNATURE_KEY"]);
  });

  it("every parameter in the Segpay postback URLs it hands out is one the handler reads, and the routes it names exist", () => {
    const params = [...SETUP.matchAll(/&(\w+)=<[^>]+>/g)].map((m) => m[1].toLowerCase());
    expect(params.length).toBeGreaterThan(10);
    const kept = SEGPAY.slice(SEGPAY.indexOf("const SEGPAY_KEPT"), SEGPAY.indexOf("] as const", SEGPAY.indexOf("const SEGPAY_KEPT")));
    for (const p of new Set(params)) expect(kept, `the handler doesn't keep "${p}"`).toContain(`"${p}"`);
    // The secret travels as ?secret=, which the route checks.
    expect(readFileSync("app/api/after-dark/billing/segpay/route.ts", "utf8")).toMatch(/secret/);
    for (const path of ["/api/after-dark/billing/segpay", "/api/after-dark/billing/verotel", "/after-dark/subscribe?done=1", "/after-dark/subscribe?declined=1"]) {
      expect(SETUP).toContain(path);
    }
  });

  it("never prints a secret: the postback URLs go to the clipboard, and live settings only ever reach production", () => {
    expect(SETUP).toMatch(/to_clipboard\(postback_urls\(/);
    expect(SETUP).not.toMatch(/print\([^)]*postback_urls\(/);
    expect(SETUP).not.toMatch(/print\([^)]*keychain_get\(/);
    expect(SETUP).toMatch(/"target": \["production"\]/);
    expect(SETUP).not.toMatch(/"preview"/);
  });
});
