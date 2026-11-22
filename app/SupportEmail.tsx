"use client";

import { useEffect, useState } from "react";

/**
 * The support address in the footer's fine print, on every page. Its markup never holds the address whole: Cloudflare's
 * email obfuscation rewrites any address it finds in a page's markup into a /cdn-cgi link and adds a decode script, and
 * that script threw on every page with links inside an SVG (/house's map: "o.href.indexOf is not a function", 2026-11-22
 * audit). So the address is written in two pieces with a line-break point between them, and links to /contact until
 * the page has loaded, then to the address itself. Addresses inside <script> (the page's data, the JSON-LD) are left
 * alone by Cloudflare. The contact page and the legal pages keep their own mailto links.
 */
export default function SupportEmail({ address }: { address: string }) {
  const [href, setHref] = useState("/contact");
  useEffect(() => setHref(`mailto:${address}`), [address]);
  const at = address.lastIndexOf("@");
  if (at < 1) return null;
  return (
    <a href={href}>
      {address.slice(0, at)}
      <wbr />
      {address.slice(at)}
    </a>
  );
}
