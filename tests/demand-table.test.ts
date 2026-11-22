/**
 * Admin → Tags' demand tables (app/admin/tags/DemandTable.tsx): each facet's table names itself once, and its caption
 * sits where the cells' words do, clear of the scroller's rounded corner (app/globals.css `.table-scroll`).
 */
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DemandTable from "@/app/admin/tags/DemandTable";
import type { Demand, DemandRow } from "@/lib/tag-demand";

const row = (facet: string, tag: string, blended: number): DemandRow => ({
  tag,
  label: tag,
  icon: "·",
  facet,
  picks: 1,
  supply: 1,
  raw: 1,
  census: 1,
  blended,
});
const demand = (rows: DemandRow[]): Demand => ({ side: "sfw", total: rows.length, rows });
const captions = (html: string): string[] => [...html.matchAll(/<caption>([^<]*)<\/caption>/g)].map((m) => m[1]);

describe("the demand table", () => {
  it("names a lone facet's table by its caption alone, and each of several by caption and facet", () => {
    const one = renderToStaticMarkup(
      DemandTable({ demand: demand([row("art_style", "anime", 1.06), row("art_style", "photo", 0.97)]), caption: "Art style", item: "Style" }),
    );
    expect(captions(one)).toEqual(["Art style"]);
    expect(one).toContain('aria-label="Art style"');
    const two = renderToStaticMarkup(
      DemandTable({ demand: demand([row("setup", "rivals", 1.2), row("genre", "drama", 1.1)]), caption: "Roleplays" }),
    );
    expect(captions(two)).toEqual(["Roleplays · setup", "Roleplays · genre"]);
  });

  // UX audit 2026-11-22: the intro said "capped at 3×" beside Grump at 12.44× from 2 picks.
  it("says when the raw number is over the blend's cap, and greys a row with too few picks to mean much", () => {
    const html = renderToStaticMarkup(
      DemandTable({ demand: demand([{ ...row("type", "grump", 1.1), picks: 2, raw: 12.44 }, { ...row("type", "warm", 1.0), picks: 40, raw: 1.2 }]), caption: "Types" }),
    );
    expect(html).toContain("Ours (raw)");
    expect(html).toContain("12.44×<span class=\"muted small\"> (3× in the blend)</span>");
    expect(html).not.toContain("1.20×<span");
    expect(html.match(/<tr class="demand-few">/g)).toHaveLength(1);
  });

  // The 2026-11-22 audit: After Dark's table, before any member had picked, was a column of 0s, a column of dashes and
  // the census twice over.
  it("drops the picks, ours and the blend when nobody has picked yet, and says the order is the census's", () => {
    const none = (r: DemandRow): DemandRow => ({ ...r, picks: 0, raw: null });
    const html = renderToStaticMarkup(DemandTable({ demand: { ...demand([none(row("setup", "rivals", 1.15)), none(row("setup", "work", 1.17))]), total: 0 }, caption: "After Dark roleplays" }));
    expect(html).toContain("data-no-picks");
    expect(html).toContain("the order is the census&#x27;s alone");
    for (const gone of ["Picks", "Ours (raw)", "Blended"]) expect(html).not.toContain(`<th scope="col">${gone}</th>`);
    for (const kept of ["On offer", "Census"]) expect(html).toContain(`<th scope="col">${kept}</th>`);
    expect(html).not.toContain("demand-few");
    // One pick anywhere and the full table is back.
    const one = renderToStaticMarkup(DemandTable({ demand: demand([row("setup", "rivals", 1.15), none(row("setup", "work", 1.17))]), caption: "After Dark roleplays" }));
    expect(one).not.toContain("data-no-picks");
    expect(one).toContain('<th scope="col">Blended</th>');
  });

  it("starts a shown caption where the cells' words start, and leaves the hidden ones alone", () => {
    const css = readFileSync("app/globals.css", "utf8");
    const cell = css.match(/\.board th,\s*\.board td \{[^}]*padding: [^ ;]+ ([^;]+);/)?.[1];
    const shown = css.match(/\.table-scroll \.board caption:not\(\.sr-only\) \{([^}]*)\}/)?.[1] ?? "";
    expect(cell).toBe("0.8rem");
    // At the box's edge the scroller's 16px rounded corner (overflow-x: auto) cut the top off "Lineup"'s L.
    expect(shown).toMatch(/padding: 0 0\.8rem 0\.35rem;/);
    expect(css).toMatch(/\.table-scroll \{[^}]*overflow-x: auto;[^}]*border-radius: var\(--radius\);/);
  });
});
