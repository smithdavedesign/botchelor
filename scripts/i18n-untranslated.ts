/**
 * Finds words shown to a visitor that aren't translated (docs/i18n.md): text between JSX tags, a string shown as it is
 * (`{"…"}`, `{x ? "…" : "…"}`), and the text props a person reads or hears (aria-label, title, placeholder, alt,
 * label), when they hold letters and aren't inside t(). Text a library function builds isn't seen: pass it `t`.
 *
 *   npx tsx scripts/i18n-untranslated.ts app/page.tsx …   # prints each one, with its line
 *   npx tsx scripts/i18n-untranslated.ts --baseline        # rewrites tests/i18n-baseline.json from the code as it is
 *
 * tests/i18n-coverage.test.ts holds every page to its baseline: a new file has none, and a file's count only goes down.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const TEXT_PROPS = new Set(["aria-label", "title", "placeholder", "alt", "label", "aria-description"]);

export type Untranslated = { file: string; line: number; text: string };

/** A string a person reads: some letters, not a lone symbol, number, class name or code. */
const readable = (s: string) => /[A-Za-z]{2,}/.test(s.replace(/&[a-z]+;/g, ""));

export function untranslated(file: string, src = readFileSync(file, "utf8")): Untranslated[] {
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: Untranslated[] = [];
  const add = (node: ts.Node, text: string) => {
    const t = text.replace(/\s+/g, " ").trim();
    if (!readable(t)) return;
    // `i18n-ok` on the line (or the line above) marks a name, a brand or code that stays as it is.
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
    const lines = src.split("\n");
    if (/i18n-ok/.test(lines[line] ?? "") || /i18n-ok/.test(lines[line - 1] ?? "")) return;
    out.push({ file, line: line + 1, text: t });
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) add(node, node.getText(sf));
    else if (ts.isJsxAttribute(node) && TEXT_PROPS.has(node.name.getText(sf)) && node.initializer) {
      const init = node.initializer;
      if (ts.isStringLiteral(init)) add(init, init.text);
      else if (ts.isJsxExpression(init) && init.expression && ts.isTemplateExpression(init.expression)) add(init, [init.expression.head.text, ...init.expression.templateSpans.map((s) => s.literal.text)].join(" … "));
      else if (ts.isJsxExpression(init) && init.expression && (ts.isStringLiteral(init.expression) || ts.isNoSubstitutionTemplateLiteral(init.expression))) add(init, init.expression.text);
    } else if (ts.isJsxExpression(node) && node.expression && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      // A string shown as it is: `{"…"}`, `{x ? "…" : "…"}`, `{x && "…"}`.
      const shown = (e: ts.Expression): void => {
        if (ts.isParenthesizedExpression(e)) shown(e.expression);
        else if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) add(e, e.text);
        else if (ts.isTemplateExpression(e)) add(e, [e.head.text, ...e.templateSpans.map((sp) => sp.literal.text)].join(" … "));
        else if (ts.isConditionalExpression(e)) {
          shown(e.whenTrue);
          shown(e.whenFalse);
        } else if (ts.isBinaryExpression(e) && (e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken || e.operatorToken.kind === ts.SyntaxKind.BarBarToken || e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) shown(e.right);
      };
      shown(node.expression);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const ROOT = join(__dirname, "..");

/**
 * What stays in English by design (docs/i18n.md): After Dark (its checks read English), the admin pages (the owner's
 * own), the legal and policy pages (the English is the binding text), the API and the emails' landing pages, and the
 * share pictures.
 */
export const ENGLISH_ONLY = [
  /^app\/after-dark\//,
  /^app\/admin\//,
  /^app\/api\//,
  /^app\/(legal|terms|privacy|2257|content-policy|security|accessibility|cancel)\//,
  /^app\/email\//,
  /opengraph-image\.tsx$/,
  /twitter-image\.tsx$/,
];

/** Every page and component a visitor can see, as paths from the repo root. */
export function shownFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".tsx")) out.push(relative(ROOT, p));
    }
  };
  walk(join(ROOT, "app"));
  return out.filter((f) => !ENGLISH_ONLY.some((re) => re.test(f))).sort();
}

/** Each file's count of untranslated strings, the files with none left out. */
export function counts(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of shownFiles()) {
    const n = untranslated(join(ROOT, f)).length;
    if (n) out[f] = n;
  }
  return out;
}

export const BASELINE = join(ROOT, "tests/i18n-baseline.json");

if (process.argv[1]?.endsWith("i18n-untranslated.ts")) {
  if (process.argv[2] === "--baseline") {
    const c = counts();
    writeFileSync(BASELINE, `${JSON.stringify(c, null, 2)}\n`);
    console.log(`${Object.values(c).reduce((a, b) => a + b, 0)} untranslated strings in ${Object.keys(c).length} files`);
  } else {
    const found = process.argv.slice(2).flatMap((f) => untranslated(f));
    for (const u of found) console.log(`${u.file}:${u.line}  ${u.text}`);
    console.log(`${found.length} untranslated`);
  }
}
