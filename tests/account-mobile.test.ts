// The 2026-11-20 mobile audit, fix #15 (C15, C16, C17): jump links on /account, the Connections intro folded and the
// opened form brought into view, and the casting invite's buttons above its terms.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { accountJumps } from "@/app/account/AccountPanel";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("/account's jump links", () => {
  it("go only to cards that are always there for that account, in the page's order", () => {
    expect(accountJumps({ characters: 0, password: false, persona: false }).map((j) => j.id)).toEqual(["signed-in", "your-characters", "model-key", "appearance"]);
    expect(accountJumps({ characters: 2, password: true, persona: true }).map((j) => j.label)).toEqual([
      "Account",
      "Characters",
      "Dates",
      "Password",
      "Connections",
      "Appearance",
      "You in scenes",
    ]);
  });

  it("every target has its id", () => {
    const panel = read("app/account/AccountPanel.tsx");
    for (const id of ["signed-in", "your-characters", "model-key"]) expect(panel).toContain(`id="${id}"`);
    expect(read("app/account/YourDates.tsx")).toContain('id="your-dates"');
    expect(read("app/account/PasswordSettings.tsx")).toContain('id="password"');
    expect(read("app/ThemeSetting.tsx")).toContain('id="appearance"');
    expect(read("app/account/PersonaCard.tsx")).toContain('id="persona"');
    expect(panel).toContain('<nav className="account-jumps scroll-row" aria-label="On this page">');
  });
});

describe("Connections (/account/keys)", () => {
  it("opens on one line, the rest in How it works", () => {
    const page = read("app/account/keys/page.tsx");
    expect(page).toContain('<a href="#how-it-works">How it works</a>');
    expect(page).toContain('<details className="card connection-how" id="how-it-works">');
    expect(page).toContain("<strong>One key, several jobs.</strong>");
  });

  it("brings an opened form into view, and its card's Cancel is quiet", () => {
    expect(read("app/account/keys/KeyForm.tsx")).toMatch(/formRef\.current\?\.scrollIntoView\?\.\(\{ block: "start"/);
    const card = read("app/account/keys/JobCard.tsx");
    expect(card.match(/className=\{open \? "link-button" : "secondary"\}/g)?.length).toBe(2);
  });
});

describe("the casting invite", () => {
  it("puts Make (primary) and Bring (quiet) above the terms", () => {
    const page = read("app/casting/invite/[code]/page.tsx");
    const open = page.slice(page.indexOf("export default async function CastingInvitePage"));
    expect(open.indexOf('<section className="casting-invite-action"')).toBeLessThan(open.indexOf("<Terms />"));
    expect(page).toContain('<Link className="button-ghost" href="/import" data-track="casting-invite-import">');
    expect(read("app/casting/invite/[code]/InviteApply.tsx")).toContain("Applying means you agree to the terms below.");
  });
});
