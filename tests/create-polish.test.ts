import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { suggestLabel } from "@/app/create/DetailsStep";
import { PROVIDER_INFO } from "@/lib/connections-shared";
import { tidyNameCase } from "@/lib/express-create";

// The editor is a client component that routes after saving; a static render only needs a stub router.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }) }));
const { default: CreateWizard } = await import("@/app/create/CreateWizard");

// 2026-11-22 audit, the create flow's small things: the edit rail ticked empty steps, the dice said "a occupation", a
// draft's name came out "vandenBosch", the review graded a fresh draft's length, and the key pages said portraits need
// your own key.
const initial = {
  name: "Ira Fenn",
  age: 26,
  bio: "Runs a 24-hour library for insomniac poets.",
  traits: ["bookish", "warm", "stubborn"],
  want: "Someone who reads the last page first",
  dealbreaker: "Dog-earing a page",
  pronouns: "she/her",
  voice: null as string | null,
  appearance: null,
  hue: 230,
  soul: null,
  openToDates: false,
  extras: {} as Record<string, unknown>,
  imageTrained: false,
  portrait: null,
};
const rail = (over: Partial<typeof initial>) => {
  const html = renderToStaticMarkup(createElement(CreateWizard, { edit: { id: "char-ira-1", initial: { ...initial, ...over } } } as never));
  return html.slice(html.indexOf('class="wizard-rail"'), html.indexOf("wizard-rail-caption"));
};
const dot = (html: string, label: string) => html.match(new RegExp(`aria-label="Step \\d+: ${label} \\((done|empty|this step)\\)"[^>]*><span class="wizard-rail-num">([^<]*)<`))?.slice(1);

describe("the edit rail ticks what's filled in, not every step", () => {
  it("leaves an empty step its number, and ticks one that holds something", () => {
    const bare = rail({});
    for (const step of ["Voice", "Look", "Dating profile", "More about them", "Go deeper", "Inner life"]) expect([step, dot(bare, step)?.[0]]).toEqual([step, "empty"]);
    expect(dot(bare, "Voice")?.[1]).toBe("2");

    const filled = rail({ voice: "Dry, short sentences.", extras: { looks: { gender: "woman" }, hobbies: ["Reading"], hot_takes: ["Endings first."] } });
    for (const step of ["Voice", "Look", "Dating profile", "Go deeper"]) expect([step, dot(filled, step)]).toEqual([step, ["done", "✓"]]);
    expect(dot(filled, "More about them")).toEqual(["empty", "5"]);
    expect(dot(filled, "Inner life")).toEqual(["empty", "7"]);
  });
});

describe("words on the create flow", () => {
  it("the dice say a or an, as the field's name needs", () => {
    expect(suggestLabel("Occupation")).toBe("Suggest an occupation");
    expect(suggestLabel("Ideal first date")).toBe("Suggest an ideal first date");
    expect(suggestLabel("Quirk")).toBe("Suggest a quirk");
    expect(suggestLabel("Walk-on music")).toBe("Suggest walk-on music");
    expect(readFileSync("app/create/DetailsStep.tsx", "utf8")).not.toContain("Suggest a ${");
  });

  it("a model's name gets a name's own casing", () => {
    expect(tidyNameCase("Storm vandenBosch")).toBe("Storm van den Bosch");
    expect(tidyNameCase("Anouk vanderBerg")).toBe("Anouk van der Berg");
    expect(tidyNameCase("Anouk van der Berg")).toBe("Anouk van der Berg");
    expect(tidyNameCase("storm chaser")).toBe("Storm Chaser");
    expect(tidyNameCase("Lucia dellaRosa")).toBe("Lucia della Rosa");
    // Left alone: a first name that starts like a particle, and names already in their own casing.
    expect(tidyNameCase("DeShawn McAllister")).toBe("DeShawn McAllister");
    expect(tidyNameCase("Dana Delgado")).toBe("Dana Delgado");
  });

  it("the review shows the length meter only on the depth track, not under a fresh one-sentence draft", () => {
    const wizard = readFileSync("app/create/CreateWizard.tsx", "utf8");
    expect(wizard).toContain("{depth && <DepthMeter words={sheetLength} />}");
  });

  it("the key pages say every character gets a free portrait", () => {
    expect(PROVIDER_INFO.openai.blurb).not.toContain("only key");
    expect(PROVIDER_INFO.openai.blurb).toContain("every character already gets a free one");
  });

  it("the anonymous account page doesn't sell private dates, which anyone can already have", () => {
    const panel = readFileSync("app/account/AccountPanel.tsx", "utf8");
    expect(panel).not.toMatch(/lets you keep dates\s+private/);
    expect(panel).toContain("An account keeps your characters across devices and lets you bring your");
  });
});
