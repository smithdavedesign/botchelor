// The admin pages after the 2026-10-31 UX audit (E2, E3, E11–E14): After Dark's settings in tabs with one save model,
// the KPI cards' caveats behind an ⓘ, and the People feedback's triage order.
import { createElement as h, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KpiGrid } from "@/app/admin/analytics/Kpis";
import { sortNotes } from "@/app/admin/feedback/PeopleFeedback";
import ModerationSettings from "@/app/admin/after-dark/settings/ModerationSettings";
import PricesCaps from "@/app/admin/after-dark/settings/PricesCaps";
import SettingsForm from "@/app/admin/after-dark/settings/SettingsForm";
import SettingsTabs from "@/app/admin/after-dark/settings/SettingsTabs";
import StatusStrip from "@/app/admin/after-dark/settings/StatusStrip";
import StudioSettings from "@/app/admin/after-dark/settings/StudioSettings";
import { SettingsProvider } from "@/app/admin/after-dark/settings/autosave";
import { getAdultSettings } from "@/lib/adult/settings";
import type { Db } from "@/lib/db";
import { countVerdict, type Kpi } from "@/lib/insights";

/** Every setting at its default: no row saved yet. */
const defaults = () => getAdultSettings({ query: async () => ({ rows: [] }) } as unknown as Db, {});

async function settingsPage(tab: string) {
  const settings = await defaults();
  const tabs = [
    { key: "models", label: "Models & keys", panel: h(SettingsForm, { hive: null }) },
    { key: "checks", label: "Safety checks", panel: h(ModerationSettings) },
    { key: "prices", label: "Prices & caps", panel: h(PricesCaps) },
    { key: "studio", label: "Studio", panel: h(StudioSettings) },
    { key: "requests", label: "Agent requests (0)", panel: h("p", null, "None yet.") },
  ];
  const pauses = [{ what: "Hive", text: "paused until 14:20 UTC", active: true, reason: "429", hive: true }];
  return renderToStaticMarkup(
    h(SettingsProvider, { initial: settings, children: h(Fragment, null, h(StatusStrip, { pauses }), h(SettingsTabs, { initial: tab, tabs })) }),
  );
}

describe("After Dark settings: a status strip, then tabs, with one save model", () => {
  it("opens on the tab in the address, every panel mounted and the others hidden", async () => {
    const html = await settingsPage("prices");
    expect(html).toContain('role="tablist"');
    for (const label of ["Models &amp; keys", "Safety checks", "Prices &amp; caps", "Studio", "Agent requests (0)"]) expect(html).toContain(`>${label}</button>`);
    expect(html).toMatch(/id="ad-tab-prices"[^>]*aria-selected="true"/);
    expect(html).toMatch(/id="ad-panel-models"[^>]*hidden=""/);
    expect(html).not.toMatch(/id="ad-panel-prices"[^>]*hidden/);
    // Hidden, not unmounted: a field typed in another tab is still there on the way back.
    expect(html).toContain('id="ad-text-model"');
    // An unknown tab falls back to the first.
    expect(await settingsPage("nope")).toMatch(/id="ad-tab-models"[^>]*aria-selected="true"/);
  });

  it("puts the On/Off switch and what's paused at the top, with the way to Providers", async () => {
    const html = await settingsPage("models");
    expect(html).toMatch(/role="switch"[^>]*aria-checked="false"/);
    expect(html).toContain("After Dark off");
    expect(html).toContain("Paused: Hive paused until 14:20 UTC");
    expect(html).toContain('href="/admin/after-dark/providers"');
  });

  it("saves field by field: no Save button, a note beside each field, and the Unsaved bar only once a JSON box is edited", async () => {
    const html = await settingsPage("models");
    expect(html).not.toContain('type="submit"');
    expect(html).not.toContain(">Save<");
    expect(html).not.toContain("ad-unsaved-bar");
    // A note for every field: the providers' keys and models, the writer, the checks, every price and cap, the Studio.
    expect((html.match(/class="ad-field-note"/g) ?? []).length).toBeGreaterThan(60);
    for (const field of ["ad-or-key", "ad-chapter-tokens", "ad-clip-tokens", "ad-mod-mode", "ad-studio-open", "ad-writer-default"]) expect(html).toContain(`id="${field}"`);
  });

  it("folds each provider closed, its summary saying where it stands", async () => {
    const html = await settingsPage("models");
    expect(html).not.toMatch(/<details[^>]* open/);
    expect(html).toMatch(/<details class="ad-settings-section ux-fold"><summary><h3>Text: OpenRouter<\/h3><span class="fold-status muted small">no key · deepseek-chat-v3\.1<\/span>/);
    expect(html).toContain("no key: pictures off");
    // A long parenthesis is a hint line under its field now.
    expect(html).toContain('<small class="muted ad-hint">0 to 2; 0.8 by default.</small>');
  });

  it("has every token price and the monthly caps in Prices & caps, not in the providers' folds or the Studio", async () => {
    const html = await settingsPage("prices");
    const panel = (key: string) => html.slice(html.indexOf(`id="ad-panel-${key}"`), html.indexOf("</section>", html.indexOf(`id="ad-panel-${key}"`)));
    for (const marker of ["ad-chapter-tokens", "ad-reel-tokens", "ad-clip-tokens", "ad-menu-picture-tokens", "ad-draw-ahead-tokens", "Restyle", "Animate 10 s", "Monthly caps, per person", "Scene steps"]) {
      expect(panel("prices")).toContain(marker);
      expect(panel("models")).not.toContain(marker);
      expect(panel("studio")).not.toContain(marker);
    }
  });
});

describe("the KPI cards: label, value, change, previous; caveats behind an ⓘ", () => {
  const card = (over: Partial<Kpi>): Kpi => ({ key: "k", label: "Watch-room viewers", definition: "People in a room.", scope: "segment", format: "count", current: 30, previous: 10, comparable: true, verdict: countVerdict(30, 10), ...over });

  it("keeps a card's caveat off the card and in the ⓘ and the fold; a shared one is said once, in the fold", () => {
    const html = renderToStaticMarkup(
      h(KpiGrid, {
        kpis: [card({ note: "Only each viewer's latest visit is stored." }), card({ key: "a", label: "A", note: "Since launch." }), card({ key: "b", label: "B", note: "Since launch." })],
        segment: "all",
        explain: "Colour only when it's real.",
      }),
    );
    expect(html).not.toContain("kpi-note");
    expect(html).toContain('<details class="info-tip"><summary aria-label="About Watch-room viewers">ⓘ</summary>');
    expect(html).toContain('<details class="kpi-definitions ux-fold">');
    expect(html.match(/Since launch\./g)).toHaveLength(1);
    expect(html.indexOf("Since launch.")).toBeGreaterThan(html.indexOf("What each number means"));
    expect(html).toContain("Colour only when it&#x27;s real.");
  });
});

describe("People feedback: what's still to triage first", () => {
  it("puts New, then Seen, then Done, each newest first as sent; Newest first keeps the order", () => {
    const items = [
      { id: "1", status: "done" as const },
      { id: "2", status: "new" as const },
      { id: "3", status: "seen" as const },
      { id: "4", status: "new" as const },
    ];
    expect(sortNotes(items, "triage").map((r) => r.id)).toEqual(["2", "4", "3", "1"]);
    expect(sortNotes(items, "newest").map((r) => r.id)).toEqual(["1", "2", "3", "4"]);
  });
});
