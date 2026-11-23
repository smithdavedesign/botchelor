import Link from "next/link";
import JsonLd from "@/app/JsonLd";
import SetHero from "@/app/SetHero";
import {
  CAI_EXPORT_APP,
  CAI_EXPORT_WEB,
  CAI_GUIDE_CHECKED_DAY,
  CAI_GUIDE_PATH,
  CAI_QUOTES,
  CAI_SOURCES,
  caiGuideFaq,
  caiSaleShown,
} from "@/lib/cai-guide";
import { listedApps } from "@/lib/alternative-apps";
import { CHARACTER_AI_ALTERNATIVE_PATH, IMPORT_CAI_PATH, IMPORT_PATH } from "@/lib/import-paths";
import { breadcrumbJsonLd } from "@/lib/seo";
import { siteUrl } from "@/lib/site";

/** A quote in Character.AI's own words, then a quiet link to the page that says it (never followed). */
function Quote({ words, href, source }: { words: string; href: string; source: string }) {
  return (
    <>
      “{words}” (
      <a href={href} rel="nofollow noopener" target="_blank">
        {source}
      </a>
      )
    </>
  );
}

const Menu = ({ path }: { path: readonly string[] }) => (
  <>
    {path.map((step, i) => (
      <span key={step}>
        {i > 0 && " → "}
        <em>{step}</em>
      </span>
    ))}
  </>
);

/**
 * The guide itself (app/guides/save-character-ai/page.tsx; the words and sources in lib/cai-guide.ts): the hero with
 * the one loud button (bring a character over), four numbered steps, the dated sale box while it's current, the FAQ
 * and its structured data, and the trademark line. `now` and `history` are for tests.
 */
export default function CaiGuide({ now = new Date(), history }: { now?: Date; history: boolean }) {
  const base = siteUrl();
  const faq = caiGuideFaq(history);
  const sale = caiSaleShown(now);
  // The Character.AI page's list, counted as it is (ALTERNATIVES_LIST=0 takes it off: the link then says less).
  const apps = listedApps("character-ai");
  return (
    <>
      <JsonLd
        data={[
          breadcrumbJsonLd([
            { name: "Botchelor", path: "/" },
            { name: "Bring your character", path: IMPORT_PATH },
            { name: "Save your Character.AI characters and chats", path: CAI_GUIDE_PATH },
          ], base),
          {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            url: `${base}${CAI_GUIDE_PATH}`,
            mainEntity: faq.map(({ q, a }) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
          },
        ]}
      />
      {/* A short lede and no media, so on a phone the first step starts on the first screen or just under it. */}
      <SetHero
        set="booth"
        kicker="Character.AI"
        title="Save your Character.AI characters and chats"
        lede="Request your data, copy what you wrote, keep the chats you care about, then take your characters anywhere."
      >
        <p>
          <Link className="button" href={IMPORT_CAI_PATH} data-track="alternative-import" data-track-src="guide">
            Bring a character over
          </Link>
        </p>
        <p className="muted small">Checked against Character.AI&apos;s own pages on {CAI_GUIDE_CHECKED_DAY}.</p>
      </SetHero>

      <section className="card" aria-labelledby="cai-steps-title">
        <h2 id="cai-steps-title">Four steps</h2>
        <ol className="import-how-list cai-guide-steps">
          <li>
            <strong>Request your data export today.</strong> On the website: <Menu path={CAI_EXPORT_WEB} />. In the app:{" "}
            <Menu path={CAI_EXPORT_APP} />. Its help page says{" "}
            <Quote words={CAI_QUOTES.exportTime} href={CAI_SOURCES.export} source="How do I download my data" />. The
            download link goes to your account&apos;s email, and{" "}
            <Quote words={CAI_QUOTES.exportLink} href={CAI_SOURCES.export} source="the same page" />. Character.AI
            doesn&apos;t say what the export holds, so do step 2 too.
            <p className="muted small">
              Its privacy policy also covers a request{" "}
              <Quote words={CAI_QUOTES.privacyRequest} href={CAI_SOURCES.privacy} source="Privacy Policy" />: send it
              through its{" "}
              <a href={CAI_SOURCES.privacyRequest} rel="nofollow noopener" target="_blank">
                request form
              </a>{" "}
              or by email to the privacy address its policy gives.
              {/* Never an email address in a sentence: Cloudflare's email obfuscation rewrites it and hydration fails (#418, docs/company.md). */}
            </p>
          </li>
          <li>
            <strong>Copy each character you made.</strong> Open its edit page and copy each field with its label in front:{" "}
            <code>Name:</code>, <code>Tagline:</code>, <code>Description:</code>, <code>Greeting:</code> and{" "}
            <code>Definition:</code>. For the Definition its help center gives{" "}
            <Quote words={CAI_QUOTES.definitionSpecs} href={CAI_SOURCES.definition} source="Character Definition" />.
            Paste them into a document you keep. Characters other people made may not show a Definition:{" "}
            <Quote words={CAI_QUOTES.fieldsVisible} href={CAI_SOURCES.fields} source="Character fields" />
          </li>
          <li>
            <strong>Save the chats you care about.</strong> Only you have them:{" "}
            <Quote words={CAI_QUOTES.chatsPrivate} href={CAI_SOURCES.chats} source="Character.AI help center" /> Select
            the text and copy it into a document.
            <p className="muted small">
              Some people use browser extensions to save chats. They aren&apos;t made by Character.AI or by us, and they
              ask for access to your account, so read what they ask for before installing one.
            </p>
          </li>
          <li>
            <strong>Bring them somewhere.</strong> What you copied is plain text: you can paste it into any app that
            imports characters. Here, paste it at <Link href={IMPORT_CAI_PATH}>Bring your character</Link> and the builder
            opens with them filled in
            {history ? <>; paste a chat in the second box so they remember it.</> : "."}
            <p className="muted small">
              Looking around first?{" "}
              <Link href={CHARACTER_AI_ALTERNATIVE_PATH}>{apps ? `${apps.length} apps, with what each costs` : "Moving your characters from Character.AI"}</Link>.
            </p>
          </li>
        </ol>
      </section>

      {sale && (
        <section className="card alt-note" aria-labelledby="cai-sale-title">
          <h2 id="cai-sale-title">What Character.AI has said</h2>
          <p className="muted small">Checked on {CAI_GUIDE_CHECKED_DAY}, in its own words.</p>
          <ul className="import-how-list">
            <li>
              On October 12, 2026: <Quote words={CAI_QUOTES.upAndRunning} href={CAI_SOURCES.update} source="An update on Character.ai" />
            </li>
            <li>
              On a sale of the company, the same post: <Quote words={CAI_QUOTES.woundDown} href={CAI_SOURCES.update} source="the same post" />
            </li>
            <li>
              On your information: <Quote words={CAI_QUOTES.privacyUnchanged} href={CAI_SOURCES.update} source="the same post" />
            </li>
            <li>
              On paid plans: <Quote words={CAI_QUOTES.subscriptions} href={CAI_SOURCES.update} source="the same post" />
            </li>
            <li>
              Its sale notice of November 5, 2026 sets bids due November 24 at 12:00 ET, an auction on December 1 at 10:00
              ET, and a sale hearing on December 3–4 at 9:30 ET (
              <a href={CAI_SOURCES.saleNotice} rel="nofollow noopener" target="_blank">
                Chapter 11 update and transaction notice
              </a>
              ).
            </li>
          </ul>
          <p className="muted small">
            It gives no date by which you need to act. An export takes 3–4 weeks by its own page, and the auction is
            December 1, so request yours now.
          </p>
        </section>
      )}

      <section className="card">
        <h2>Questions</h2>
        <dl className="import-faq">
          {faq.map(({ q, a }) => (
            <div key={q}>
              <dt>{q}</dt>
              <dd>{a}</dd>
            </div>
          ))}
        </dl>
        <p className="meta">
          Character.AI is a trademark of its owner. Botchelor isn&apos;t affiliated with or endorsed by Character.AI.
        </p>
      </section>
    </>
  );
}
