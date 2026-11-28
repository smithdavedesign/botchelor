/**
 * What the catalogs lack (docs/i18n.md "Translating as part of the work"), and the way to fill it.
 *
 *   npx tsx scripts/i18n-missing.ts                 # lists every string a catalog is missing, as a JSON to translate
 *   npx tsx scripts/i18n-missing.ts --apply f.json  # writes translations in: { "es": { "English": "Español" }, … }
 *
 * --apply puts each string in the half it belongs in (`client` when a client component shows it), drops strings the
 * code no longer uses, and keeps the files sorted as they are. The translations themselves are written by the agent
 * doing the page (no translation API, so nothing is paid per string), then `npm test -- tests/i18n` checks them.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CATALOGS } from "@/lib/i18n/catalogs";
import type { Catalog } from "@/lib/i18n/translate";
import { keySets, ROOT } from "./i18n-keys";

type Lang = keyof typeof CATALOGS;
const LANGS = Object.keys(CATALOGS) as Lang[];

function missing(): Record<Lang, Record<string, string>> {
  const { all } = keySets();
  const out = {} as Record<Lang, Record<string, string>>;
  for (const lang of LANGS) {
    const c = CATALOGS[lang];
    out[lang] = Object.fromEntries([...all].filter((k) => !(k in c.client) && !(k in c.server)).map((k) => [k, ""]));
  }
  return out;
}

function write(lang: Lang, catalog: Catalog) {
  const file = join(ROOT, "lib/i18n/messages", `${lang}.ts`);
  const src = readFileSync(file, "utf8");
  const head = src.slice(0, src.indexOf("const catalog: Catalog = "));
  writeFileSync(file, `${head}const catalog: Catalog = ${JSON.stringify(catalog, null, 2)};\n\nexport default catalog;\n`);
}

function apply(path: string) {
  const given = JSON.parse(readFileSync(path, "utf8")) as Partial<Record<Lang, Record<string, string>>>;
  const { all, client } = keySets();
  for (const lang of LANGS) {
    const c = CATALOGS[lang];
    const every: Record<string, string> = { ...c.server, ...c.client, ...Object.fromEntries(Object.entries(given[lang] ?? {}).filter(([, v]) => v.trim())) };
    const next: Catalog = { client: {}, server: {} };
    // Old entries keep their order; new ones follow.
    for (const [k, v] of Object.entries(every)) {
      if (!all.has(k)) continue;
      (client.has(k) ? (next.client as Record<string, string>) : (next.server as Record<string, string>))[k] = v;
    }
    write(lang, next);
  }
}

const i = process.argv.indexOf("--apply");
if (i > 0) apply(process.argv[i + 1]);
else {
  const m = missing();
  const n = Object.values(m).reduce((s, x) => s + Object.keys(x).length, 0);
  console.log(JSON.stringify(m, null, 2));
  console.error(`${n} missing across ${LANGS.length} languages`);
}
