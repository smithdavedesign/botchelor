// #1005 (2026-10-30 prod loop, the After Dark visitor: "couldn't tell what the money buys"): After Dark's host counts the
// bought tokens After Dark actually spends, as "tokens"; /api/me carries both numbers so the meter refreshes after a spend.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as meGet } from "@/app/api/me/route";
import { BASE_URL, newUserCookie, startTestDb, userIdOf } from "./helpers";

vi.mock("next/navigation", () => ({ usePathname: () => "/after-dark" }));
const { default: Nav } = await import("@/app/Nav");

let t: Awaited<ReturnType<typeof startTestDb>>;
beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});

describe("what After Dark costs (#1005)", () => {
  it("the meter says tokens on After Dark's host, and dates on the show", () => {
    expect(renderToStaticMarkup(createElement(Nav, { tokens: 40, meter: "tokens" }))).toMatch(/40<\/span><span class="token-word">tokens</);
    expect(renderToStaticMarkup(createElement(Nav, { tokens: 43 }))).toMatch(/43<\/span><span class="token-word">dates left</);
  });

  it("/api/me carries the dates left and the bought tokens left", async () => {
    const cookie = newUserCookie();
    await t.db.query(`insert into token_grants (id, user_id, episodes, granted_by) values ($1, $2, 5, 'test')`, [crypto.randomUUID(), userIdOf(cookie)]);
    const me = await (await meGet(new Request(`${BASE_URL}/api/me`, { headers: { cookie } }) as never)).json();
    expect(me.tokens_left).toBe(5);
    expect(me.dates_left).toBeGreaterThanOrEqual(5);
  });
});
