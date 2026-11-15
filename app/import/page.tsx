import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo";
import { CAI_SOURCE, IMPORT_PATH } from "@/lib/import-character";
import { importDoor } from "@/lib/import-events";
import { HISTORY_ITEMS_MAX, importMemoriesOn } from "@/lib/import-history";
import { WRITE_TIME_SPEED } from "@/lib/rules";
import ImportForm from "./ImportForm";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const PLAIN: Metadata = pageMetadata({
  title: "Bring your character from another app · Botchelor",
  description:
    "Paste a character you made in Character.AI, SillyTavern or another chat app (its name, description, greeting and definition, or the card's JSON or PNG) and it opens in Botchelor's builder, filled in.",
  path: IMPORT_PATH,
});

/** The rescue door's own title (2026-11-14); the same address is canonical, so search engines see one page. */
const FROM_CAI: Metadata = pageMetadata({
  title: "Bring your Character.AI character to Botchelor",
  description:
    "Three steps to copy a character you made on Character.AI (Name, Description, Greeting) and paste it here. The builder opens filled in, and they go on a speed date with the cast right away. Free, PG, 18+ fictional characters.",
  path: IMPORT_PATH,
});

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  return importDoor((await searchParams).from) === CAI_SOURCE ? FROM_CAI : PLAIN;
}

/**
 * "Bring your character" (lib/import-character.ts): a paste or a character card in, the /create builder out, filled in.
 * Read in the browser; only unlabelled free text goes to the show's free model (app/api/characters/import).
 *
 * "Bring their history" (lib/import-history.ts, IMPORT_MEMORIES; 2026-11-15): a second, optional box for a chat log, a
 * lorebook, a scenario or example dialogue, read once by the same free model into a short checklist the person edits.
 * With the switch off the box is gone and the page says, as it did, that history stays behind.
 *
 * ?from=cai (the home hero, the Character.AI landing, the rescue posts in docs/launch-kit.md): the same page, with the
 * three steps to copy a Character.AI character above the box and what happens next. The parser is unchanged: it has
 * read Character.AI's labelled fields (Name, Tagline, Description, Greeting, Definition) since the page opened.
 */
export default async function ImportPage({ searchParams }: { searchParams: SearchParams }) {
  const from = importDoor((await searchParams).from);
  const cai = from === CAI_SOURCE;
  const history = importMemoriesOn();
  return (
    <>
      <section className="card import-tool">
        <p className="kicker">{cai ? "Leaving Character.AI?" : "Bring your character"}</p>
        <h1>{cai ? "Bring your Character.AI character to Botchelor" : "Bring a character you made in another app"}</h1>
        {cai ? (
          <>
            <p className="lede">
              Copy what you wrote, paste it below, and they open in the builder with their name, bio, traits, voice and
              hello already in. Then a speed date with the cast, right away.
              {history && " Months of chats behind you? Paste them in the second box and choose what they remember."}
            </p>
            <ol className="import-how-list import-cai-steps" aria-label="Three steps">
              <li>
                <strong>Open your character on Character.AI</strong> and go to its page: tap its name at the top of the
                chat, then <em>Edit character</em> (your own) or <em>View character</em>.
              </li>
              <li>
                <strong>Copy each field with its label in front:</strong> <code>Name:</code>, <code>Description:</code>{" "}
                and <code>Greeting:</code>, plus <code>Tagline:</code> and <code>Definition:</code> if you wrote them. A
                line like <code>Age: 27</code> or <code>Likes: tea, storms</code> inside the definition is read too.
              </li>
              <li>
                <strong>Paste it all below and press Bring them in.</strong> When everything a date needs is there, the
                builder opens on Review: tick the box, press Create, and they&apos;re on a speed date with this
                month&apos;s cast: six lines, {WRITE_TIME_SPEED}. Free, no sign-up.
              </li>
            </ol>
          </>
        ) : (
          <p className="lede">
            Paste what you have from Character.AI, SillyTavern or other apps, and they open in the builder with their
            name, bio, traits, voice and hello already in. Check it over, fill in what&apos;s missing, and they&apos;re
            ready.
            {history && " Their history can come too: paste a chat log or a lorebook in the second box and choose what they keep."}
          </p>
        )}
        <ImportForm from={from} history={history} />
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
            <strong>A character card:</strong> the JSON a card exports from SillyTavern, TavernAI and the apps that share
            their format (V1, V2 or V3: <code>name</code>,{" "}
            <code>description</code>, <code>personality</code>, <code>first_mes</code>, <code>mes_example</code>), or the
            card&apos;s PNG. Only the text inside the PNG is read; the picture isn&apos;t uploaded.
          </li>
          <li>
            <strong>Just a description?</strong> Paste it as it is. Text with no labels is read by the show&apos;s free
            model, once, to find the name, traits and the rest.
          </li>
          {history && (
            <li>
              <strong>Their history, in the second box:</strong> a chat log you copied or exported, a lorebook or
              character book, a scenario, example dialogue. A card&apos;s own <code>scenario</code>,{" "}
              <code>mes_example</code> and <code>character_book</code> are read with it. The show&apos;s free model reads
              it once into at most {HISTORY_ITEMS_MAX} short lines, and you tick and reword what stays: what&apos;s true
              of them goes to their facts, what happened between the two of you goes to what they remember about you as
              a <Link href="/companion">Companion</Link>, and how they talk goes to their voice.
            </li>
          )}
        </ul>
        {history ? (
          <p className="muted small">
            Raw transcripts aren&apos;t kept: what you paste is sent once to the show&apos;s AI model to be read, we never
            store or log it, and only the lines you keep are saved, where you can edit or delete them later. The show is
            PG, so a setup written for adult chat doesn&apos;t come along. Nothing is saved until you press Create in the
            builder.
          </p>
        ) : (
          <p className="muted small">
            The scenario, chat history and long backstory stay behind: here your character goes on dates on a show, and
            talks one to one as a <Link href="/companion">Companion</Link>, so they need who they are, not a roleplay setup.
            Nothing is saved until you press Create in the builder.
          </p>
        )}
      </section>

      {cai && (
        <section className="card">
          <h2>What happens here</h2>
          <ul className="import-how-list">
            <li>
              <strong>A date tonight.</strong> Your character meets one of this month&apos;s cast on a short first date,
              written by AI in their voice. Nobody steers it, not even you: who they are decides how it ends. The show is
              PG. <Link href="/watch">Watch one</Link>.
            </li>
            <li>
              <strong>They text you after.</strong> Once the date ends, hear from your character about how it went, and
              talk with them one to one as a <Link href="/companion">Companion</Link>.
            </li>
            <li>
              <strong>Botchelor isn&apos;t connected to Character.AI.</strong> You copy what you wrote; nothing is fetched
              from your account there, and the characters stay yours.
            </li>
          </ul>
        </section>
      )}

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
