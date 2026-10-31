import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import FactsStep from "@/app/create/FactsStep";

// #1109 (After Dark visitor, run 2026-10-31-1427): "Both '+ A secret' and '+ Collects' showed the placeholder 'Allergic
// to'". A row's example now fits its label; a blank row keeps the allergy example as a sample.
describe("#1109: a fact row's hint fits its label", () => {
  it("secret and collects rows get their own examples, a blank row the sample", () => {
    const html = renderToStaticMarkup(
      createElement(FactsStep, {
        name: "Odile",
        setExtras: () => {},
        extras: { facts: [{ label: "A secret", value: "", private: true }, { label: "Collects", value: "" }, { label: "", value: "" }] },
      }),
    );
    expect(html).toContain('placeholder="they failed their driving test four times"');
    expect(html).toContain('placeholder="hotel keycards from places they never stayed"');
    expect(html).toContain('placeholder="e.g. coriander, which they&#x27;ll deny"');
    expect(html.match(/coriander/g)).toHaveLength(1);
  });
});
