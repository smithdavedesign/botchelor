import { HOUSE_PROVIDER_INFO, isUserProvider, PROVIDER_INFO, type HouseProvider } from "@/lib/connections-shared";

/** The letters on a provider's tile: its text mark (lib/connections-shared.ts), "+" for a job with no key yet. */
function markOf(provider: string | null): string {
  if (!provider) return "+";
  if (provider === "after-dark") return "AD";
  if (isUserProvider(provider)) return PROVIDER_INFO[provider].mark;
  return HOUSE_PROVIDER_INFO[provider as HouseProvider]?.mark ?? provider.slice(0, 2).toUpperCase();
}

/**
 * A provider's tile: its letters on its colour (app/ux/agents-footer.css sets each provider's --mark), drawn inline, so
 * there's no logo file to host or license. Decorative: the provider's name is always written beside it.
 */
export default function ProviderMark({ provider, size = 36 }: { provider: string | null; size?: number }) {
  const mark = markOf(provider);
  return (
    <svg className="provider-mark" data-provider={provider ?? "none"} width={size} height={size} viewBox="0 0 36 36" aria-hidden="true" focusable="false">
      <rect className="provider-mark-tile" x="0.75" y="0.75" width="34.5" height="34.5" rx="9" />
      <text className="provider-mark-text" x="18" y="18" dy="0.36em" textAnchor="middle" fontSize={mark.length > 2 ? 11 : mark.length === 2 ? 13 : 17}>
        {mark}
      </text>
    </svg>
  );
}
