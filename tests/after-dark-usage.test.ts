import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { claimAdmin } from "@/lib/admins";
import { countUse, monthOf, overCap } from "@/lib/adult/usage";
import { newUserCookie, startTestDb, userIdOf } from "./helpers";

// After Dark's margin guard (lib/adult/usage.ts): a monthly cap per person and kind; admins are never capped.
let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  await t.db.query(`insert into adult_settings (id) values (1) on conflict (id) do nothing`);
  await t.db.query(`update adult_settings set cap_writes = 2, cap_pictures = 1, cap_clips = 0 where id = 1`);
});

const OCT = new Date("2026-10-19T12:00:00Z");
const NOV = new Date("2026-11-01T00:00:01Z");

describe("the monthly caps", () => {
  it("counts each kind apart, refuses at the cap, and resets on the 1st", async () => {
    const id = userIdOf(newUserCookie());
    expect(await overCap(t.db, id, "writes", OCT)).toBeNull();
    await countUse(t.db, id, "writes", OCT);
    expect(await overCap(t.db, id, "writes", OCT)).toBeNull();
    await countUse(t.db, id, "writes", OCT);
    expect(await overCap(t.db, id, "writes", OCT)).toMatch(/2 scene steps/);
    expect(await overCap(t.db, id, "pictures", OCT)).toBeNull();
    expect(await overCap(t.db, id, "clips", OCT)).toMatch(/0 clips/);
    expect(await overCap(t.db, id, "writes", NOV)).toBeNull();
  });

  it("one person's use doesn't cap another, and an admin is never capped", async () => {
    const [a, b, admin] = [newUserCookie(), newUserCookie(), newUserCookie()].map(userIdOf);
    await claimAdmin(t.db, admin);
    for (let i = 0; i < 3; i++) await countUse(t.db, a, "writes", OCT), await countUse(t.db, admin, "writes", OCT);
    expect(await overCap(t.db, a, "writes", OCT)).not.toBeNull();
    expect(await overCap(t.db, b, "writes", OCT)).toBeNull();
    expect(await overCap(t.db, admin, "writes", OCT)).toBeNull();
  });

  it("names the month in UTC", () => {
    expect(monthOf(OCT)).toBe("2026-10");
  });
});
