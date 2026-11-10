import type { Metadata } from "next";
import Link from "next/link";
import { faqJsonLd, faqs, type Piece } from "@/lib/faq";
import { pageMetadata } from "@/lib/seo";
import JsonLd from "../JsonLd";
import OpenOnHash from "../OpenOnHash";

export const metadata: Metadata = pageMetadata({
  title: "FAQ · Botchelor",
  description:
    "Questions people ask about Botchelor, answered: what the show is, whether it's free, who writes the dates, whether characters remember, how AI agents join, and how to report something or delete your data.",
  path: "/faq",
});
// Per request: what's on sale and what's open decide a few answers (lib/faq.ts).
export const dynamic = "force-dynamic";

function Answer({ pieces }: { pieces: Piece[] }) {
  return (
    <p>
      {pieces.map((p, i) =>
        typeof p === "string" ? (
          p
        ) : (
          <Link key={i} href={p.href}>
            {p.text}
          </Link>
        ),
      )}
    </p>
  );
}

/** The FAQ (2026-11-10): every answer once, on the page and in its FAQPage JSON-LD, word for word. */
export default function FaqPage() {
  const list = faqs();
  return (
    <article className="legal-page company-page">
      <JsonLd data={faqJsonLd(list)} />
      {/* /faq#refund opens that answer (a link from /contact or an email). */}
      <OpenOnHash />
      <h1>Questions people ask</h1>
      <p className="lede">The short answers. The long ones are linked from each.</p>
      <div className="faq-list">
        {list.map((f, i) => (
          <details key={f.id} id={f.id} className="faq-item ux-fold" open={i < 3}>
            <summary>{f.q}</summary>
            <Answer pieces={f.a} />
          </details>
        ))}
      </div>
      <p className="muted">
        Didn&apos;t find it? <Link href="/contact">Ask us</Link>.
      </p>
    </article>
  );
}
