import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import CallsPage, { generateMetadata } from "@/app/calls/page";
import { shareOf } from "@/app/YourCalls";
import { parseRecordShare, recordSharePath, recordShareText, sharedByOf, type RecordShare } from "@/lib/share-record";
import { sharerOf, signShare, verifiedSharerName } from "@/lib/share-record-name";
import { recordOf } from "@/lib/streaks";
import { startTestDb, TEST_SESSION_SECRET } from "./helpers";

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  await t.db.query("delete from profiles");
  vi.stubEnv("SESSION_SECRET", TEST_SESSION_SECRET);
});
afterEach(() => vi.unstubAllEnvs());

const SHARE: RecordShare = { recent: [true, true, false, true, true, true], right: 5, called: 6, streak: 3, best: 3, season: 1, night: 2 };
const named = (userId: string, name: string) => t.db.query(`insert into profiles (user_id, name) values ($1, $2)`, [userId, name]);
/** The query a shared link's page gets. */
const queryOf = (s: RecordShare) => Object.fromEntries(new URLSearchParams(recordSharePath(s).split("?")[1]).entries());
const page = async (q: Record<string, string>) => renderToStaticMarkup(await CallsPage({ searchParams: Promise.resolve(q) }));

describe("a shared record carries the sharer's display name, checked (lib/share-record-name.ts)", () => {
  it("signs a sharer with a name of their own, and the link carries the name and an opaque check, never an id", async () => {
    await named("user-sam-0001", "Sam");
    const sharer = await sharerOf(t.db, "user-sam-0001");
    expect(sharer).toEqual({ user_id: "user-sam-0001", name: "Sam" });
    const signed = signShare(SHARE, sharer);
    const path = recordSharePath(signed);
    expect(path).toMatch(/[?&]by=Sam&k=[A-Za-z0-9_-]{22}&ref=share-record$/);
    expect(path).not.toContain("user-sam");
    // The share text stays the sharer's own words: no name added there.
    expect(recordShareText(signed, `https://botchelor.com${path}`).split("\n")[0]).toBe("My Botchelor calls · S1 · Night 2");
    expect(await verifiedSharerName(t.db, parseRecordShare(queryOf(signed))!, sharedByOf(queryOf(signed)))).toBe("Sam");
  });

  it("/calls says whose calls they are, and anything it can't vouch for reads Someone's calls", async () => {
    await named("user-sam-0001", "Sam");
    const q = queryOf(signShare(SHARE, await sharerOf(t.db, "user-sam-0001")));
    expect(await page(q)).toContain("<h1>Sam&#x27;s calls</h1>");
    expect((await generateMetadata({ searchParams: Promise.resolve(q) })).title).toBe("Sam called 5 of 6 on Botchelor");

    // A claimed name with no signature, someone else's name, or an edited number: no name.
    expect(await page({ ...q, k: "A".repeat(22) })).toContain("Someone&#x27;s calls");
    expect(await page({ ...q, by: "Alex" })).toContain("Someone&#x27;s calls");
    expect(await page({ ...q, w: "6", c: "6", g: "111111" })).toContain("Someone&#x27;s calls");
    // A link with no name at all is the plain one.
    const { by: _by, k: _k, ...plain } = q;
    expect(await page(plain)).toContain("Someone&#x27;s calls");
    expect((await generateMetadata({ searchParams: Promise.resolve(plain) })).title).toBe("Called 5 of 6 on Botchelor");
  });

  it("follows one person per display name: a rename, a shared name or another person taking it all drop the name", async () => {
    await named("user-sam-0001", "Sam");
    const q = queryOf(signShare(SHARE, await sharerOf(t.db, "user-sam-0001")));
    // Sam renames: the old link no longer vouches for anyone.
    await t.db.query(`update profiles set name = 'Samwise' where user_id = 'user-sam-0001'`);
    expect(await page(q)).toContain("Someone&#x27;s calls");
    // Someone else takes "Sam" later: Sam's old signature isn't theirs.
    await named("user-other-02", "sam");
    expect(await page(q)).toContain("Someone&#x27;s calls");
    // Two people on one name (from before #1238): neither can sign with it.
    await named("user-dupe-0003", " SAM ");
    expect(await sharerOf(t.db, "user-other-02")).toBeNull();
    expect(await sharerOf(t.db, "user-nobody")).toBeNull();
    expect(await sharerOf(t.db, null)).toBeNull();
  });

  it("without the secret, nothing is signed and nothing is shown", async () => {
    await named("user-sam-0001", "Sam");
    const sharer = await sharerOf(t.db, "user-sam-0001");
    const q = queryOf(signShare(SHARE, sharer));
    vi.stubEnv("SESSION_SECRET", "");
    expect(signShare(SHARE, sharer)).toEqual(SHARE);
    expect(await page(q)).toContain("Someone&#x27;s calls");
  });

  it("the calls line signs the viewer's record when they have a name, and shareOf alone stays nameless", async () => {
    await named("user-sam-0001", "Sam");
    const record = { ...recordOf([true, false, true]), recent: [true, false, true] };
    expect(shareOf(record)?.by).toBeUndefined();
    const signed = shareOf(record, new Date("2026-11-02T12:00:00Z"), await sharerOf(t.db, "user-sam-0001"))!;
    expect(signed.by).toBe("Sam");
    expect(await verifiedSharerName(t.db, parseRecordShare(queryOf(signed))!, sharedByOf(queryOf(signed)))).toBe("Sam");
  });
});
