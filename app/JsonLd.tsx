/**
 * Structured data (schema.org JSON-LD) for search engines and AI crawlers. Serialized with "<" escaped, so
 * text that came from a character sheet or a generated episode can never close the script tag.
 */
export default function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
