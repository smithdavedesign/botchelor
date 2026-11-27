/**
 * next/font/google under vitest (app/fonts.ts): the real loaders are replaced by Next's compiler at build time, so
 * outside it they aren't functions. Each stub returns what a loader returns: a class name, a style and the variable's
 * class.
 */
type FontOptions = { variable?: string };
const loader = (family: string) => (opts: FontOptions = {}) => ({
  className: `font-${family.toLowerCase()}`,
  variable: opts.variable ? `font-var-${opts.variable.replace(/^--/, "")}` : "",
  style: { fontFamily: family },
});
export const Fraunces = loader("Fraunces");
export const Inter = loader("Inter");
