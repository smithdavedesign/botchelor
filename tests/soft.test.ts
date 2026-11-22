import { afterEach, describe, expect, it, vi } from "vitest";
import { logSoft, soft } from "@/lib/soft";

// A failure that's handled by carrying on still reaches the run log, labelled (lib/soft.ts).
describe("soft failures", () => {
  afterEach(() => vi.restoreAllMocks());

  it("carry on with the fallback, and say where and why in the log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await Promise.reject(new Error("pool exhausted")).catch(soft("date job: renew lease"))).toBeUndefined();
    expect(await Promise.reject(new Error("smtp down")).catch(soft("plans: renewal reminder email", false))).toBe(false);
    expect(log.mock.calls.map((c) => c[0])).toEqual(["[soft] date job: renew lease: Error: pool exhausted", "[soft] plans: renewal reminder email: Error: smtp down"]);
  });

  it("leave a success alone and log nothing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await Promise.resolve(7).catch(soft("anything", 0))).toBe(7);
    expect(log).not.toHaveBeenCalled();
  });

  it("log what isn't an Error too, cut to a line's length", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    logSoft("auth: Google token reply", "x".repeat(2000));
    logSoft("scheduled dates: the booking reply", { status: 502 });
    expect(log.mock.calls[0][0]).toBe(`[soft] auth: Google token reply: ${"x".repeat(500)}`);
    expect(log.mock.calls[1][0]).toBe("[soft] scheduled dates: the booking reply: [object Object]");
  });
});
