"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

/**
 * The showcase's dropdown filters (ShowcaseBrowser.tsx): a plain GET form, so it works without scripts (its Apply
 * button), and with them a pick applies at once, leaving the empty ones out of the address. `keep`: the filters set
 * elsewhere on the page (the side, the sort, the type), carried along.
 */
export default function FilterForm({ action, keep, children }: { action: string; keep: [string, string][]; children: ReactNode }) {
  const router = useRouter();
  const go = (form: HTMLFormElement) => {
    const q = new URLSearchParams();
    for (const [k, v] of new FormData(form)) if (typeof v === "string" && v) q.set(k, v);
    const s = q.toString();
    router.push(s ? `${action}?${s}` : action, { scroll: false });
  };
  return (
    <form
      method="get"
      action={action}
      className="showcase-selects"
      onChange={(e) => go(e.currentTarget)}
      onSubmit={(e) => {
        e.preventDefault();
        go(e.currentTarget);
      }}
    >
      {keep.map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {children}
      <noscript>
        <button type="submit" className="button-ghost small">Apply</button>
      </noscript>
    </form>
  );
}
