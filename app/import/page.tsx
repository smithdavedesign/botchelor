import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo";
import { IMPORT_PATH } from "@/lib/import-character";
import ImportForm from "./ImportForm";

export const metadata: Metadata = pageMetadata({
  title: "Bring your character from another app · Botchelor",
  description:
    "Paste a character you made in Character.AI, SillyTavern or another chat app (its name, description, greeting and definition, or the card's JSON or PNG) and it opens in Botchelor's builder, filled in.",
  path: IMPORT_PATH,
});

/**
 * "Bring your character" (lib/import-character.ts): a paste or a character card in, the /create builder out, filled in.
 * Read in the browser; only unlabelled free text goes to the show's free model (app/api/characters/import).
 */
export default function ImportPage() {
  return (
    <>
      <section className="card import-tool">
        <p className="kicker">Bring your character</p>
        <h1>Bring a character you made in another app</h1>
        <p className="lede">
          Paste what you have from Character.AI, SillyTavern or other apps, and they open in the builder with their name,
          bio, traits, voice and hello already in. Check it over, fill in what&apos;s missing, and they&apos;re ready.
        </p>
        <ImportForm />
      </section>

      <section className="card">
        <h2>What to paste</h2>
        <ul className="import-how-list">
          <li>
            <strong>From a creator page:</strong> copy the fields with their labels: <code>Name:</code>,{" "}
            <code>Tagline:</code>, <code>Description:</code>, <code>Greeting:</code> and <code>Definition:</code>. Lines
            inside the definition like <code>Age: 27</code>, <code>Likes: tea, storms</code> or W++ are read too.
          </li>
          <li>
            <strong>A character card:</strong> the JSON a card exports (V1, V2 or V3: <code>name</code>,{" "}
            <code>description</code>, <code>personality</code>, <code>first_mes</code>, <code>mes_example</code>), or the
            card&apos;s PNG. Only the text inside the PNG is read; the picture isn&apos;t uploaded.
          </li>
          <li>
            <strong>Just a description?</strong> Paste it as it is. Text with no labels is read by the show&apos;s free
            model, once, to find the name, traits and the rest.
          </li>
        </ul>
        <p className="muted small">
          The scenario, chat history and long backstory stay behind: here your character goes on dates on a show, and
          talks one to one as a <Link href="/companion">Companion</Link>, so they need who they are, not a roleplay setup.
          Nothing is saved until you press Create in the builder.
        </p>
      </section>

      <section className="card">
        <h2>Original characters, fictional adults</h2>
        <p>
          Bring characters you made yourself. Every character on Botchelor is a fictional adult: anything that suggests
          someone is under 18 stops the import, as does a real person&apos;s name. The show is PG, so a line that
          isn&apos;t is left out, and the builder says which.
        </p>
        <p className="muted small">
          Moving from a chat app? <Link href="/alternatives/character-ai">What Botchelor is, for someone moving their characters</Link>.
        </p>
      </section>
    </>
  );
}
