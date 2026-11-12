/**
 * The price on a button that spends After Dark's tokens (the design kit's rule, 2026-11-12): "◈ n" for bought tokens,
 * "included" for what the subscription covers, "free" (or `free`'s own word, e.g. "on your key") for nothing. The ◈
 * is the nav's token pill's own mark; a screen reader hears "1 token", never the glyph's name.
 */
export default function TokenPrice({ tokens, included = false, free = "free", per }: { tokens: number; included?: boolean; free?: string; per?: string }) {
  if (included) return <span className="token-price">included</span>;
  if (tokens <= 0) return <span className="token-price">{free}</span>;
  return (
    <span className="token-price">
      <span className="token-price-pip" aria-hidden="true">
        ◈
      </span>{" "}
      {tokens}
      <span className="sr-only"> {tokens === 1 ? "token" : "tokens"}</span>
      {per ? ` ${per}` : ""}
    </span>
  );
}
