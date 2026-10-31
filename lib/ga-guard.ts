/**
 * Google Analytics never sees After Dark (the adult tier, lib/adult): no hit, page_view or event, from /after-dark/* or
 * /admin/after-dark/*, and no After Dark address or title in any later hit (terms review, 2026-10-22; docs/after-dark.md
 * "Terms fixes").
 *
 * The switch is gtag.js's own opt-out, window["ga-disable-<measurement id>"] = true, which it checks on every event it
 * sends. A script in <head> (app/layout.tsx) sets it before gtag.js loads:
 *  - on a page load of an After Dark page, or of a page reached from one (document.referrer would be its address);
 *  - in a client-side navigation, before the address changes to an After Dark page: it wraps history.pushState and
 *    replaceState first, so it sits beneath Next's router and gtag's history listener, which wrap them later;
 *  - and once up, it stays up until the next full page load: gtag's next page_view in the app would carry the After
 *    Dark address as its page_referrer, so a tab that has shown After Dark sends GA nothing more.
 * The site's own events (app/conversion.ts) check the same switch, and nothing here sends a page title or address
 * explicitly. Our own engagement log (app/engagement.ts) still counts these pages, by path only, without button labels.
 */

/** After Dark's pages: /after-dark and /admin/after-dark, and everything under them. */
export const GA_OFF_PATH = /^\/(?:admin\/)?after-dark(?:\/|$)/i;

/** Set on window with the measurement id's flag, so code that doesn't know the id can check the switch. */
export const GA_OFF_FLAG = "__bzGaOff";

/** Whether a page's path is After Dark's (the head script tests the same pattern). */
export function gaOffPath(pathname: string): boolean {
  return GA_OFF_PATH.test(pathname);
}

/** Whether this tab has turned GA off (the head script's flag). */
export function gaOff(w: object = globalThis): boolean {
  return (w as Record<string, unknown>)[GA_OFF_FLAG] === true;
}

/**
 * The <head> script: the rules above, in plain ES5 (plus URL), run before gtag.js. `gaId` is the GA4 measurement id
 * (lib/tracking.ts only passes a well-formed one); without one it still sets GA_OFF_FLAG. Navigation never depends on
 * it: the history wrappers always call through, whatever the check does.
 */
export function gaGuardScript(gaId: string | null): string {
  const keys = JSON.stringify([GA_OFF_FLAG, ...(gaId ? [`ga-disable-${gaId}`] : [])]);
  const re = `new RegExp(${JSON.stringify(GA_OFF_PATH.source)},"i")`;
  return (
    `(function(w){try{var re=${re},k=${keys},h=w.history;` +
    `function off(){for(var i=0;i<k.length;i++)w[k[i]]=true}` +
    `function hit(u){try{return re.test(new URL(String(u),w.location.href).pathname)}catch(e){return false}}` +
    `if(re.test(w.location.pathname)||(w.document.referrer&&hit(w.document.referrer)))off();` +
    `["pushState","replaceState"].forEach(function(m){var o=h[m];if(typeof o!=="function")return;` +
    `h[m]=function(s,t,u){try{if(u!=null&&hit(u))off()}catch(e){}return o.apply(h,arguments)}});` +
    `w.addEventListener("popstate",function(){if(re.test(w.location.pathname))off()})}catch(e){}})(window);`
  );
}
