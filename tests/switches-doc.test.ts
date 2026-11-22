// What's live is never a guess (docs/switches.md): every environment name the app reads is explained somewhere, and the
// inventory script that writes the page's tables still reads the code the way the page says.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BEGIN, DOC, END, renderSwitches, scanSwitches } from "../scripts/switches.mjs";

describe("docs/switches.md", () => {
  const rows = scanSwitches();
  const page = readFileSync(DOC, "utf8");

  it("finds the names the code reads, and tells a switch's default from a value", () => {
    expect(rows.length).toBeGreaterThan(200);
    const kind = (name: string) => rows.find((r) => r.name === name)?.kind;
    expect(kind("STEP_IN_OPEN")).toBe("on"); // lib/step-in-switch.ts: on unless "0"
    expect(kind("COMPANION_DEBUG")).toBe("off"); // lib/companion.ts: "1" turns it on
    expect(kind("DATABASE_URL")).toBe("value");
    expect(rows.find((r) => r.name === "DATABASE_URL")?.spec).toEqual(["show.yaml", "app.yaml"]);
  });

  it("explains every name somewhere: in its feature's doc, or here", () => {
    // A new switch or key: explain it where its feature is documented, or in the table on docs/switches.md
    // ("Names the other docs don't explain"). `node scripts/switches.mjs` refreshes the page's generated tables.
    const ours = page.slice(0, page.indexOf(BEGIN));
    const unexplained = rows.filter((r) => !r.docs.length && !ours.includes(`\`${r.name}\``));
    expect(unexplained.map((r) => r.name)).toEqual([]);
  });

  it("keeps its generated tables between the markers", () => {
    expect(page.indexOf(BEGIN)).toBeGreaterThan(0);
    expect(page.indexOf(END)).toBeGreaterThan(page.indexOf(BEGIN));
    const table = renderSwitches(rows.slice(0, 3));
    expect(table.startsWith(BEGIN) && table.endsWith(END)).toBe(true);
  });
});
