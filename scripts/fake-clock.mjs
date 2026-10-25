/**
 * A clock for a test run's server, preloaded with NODE_OPTIONS=--import by scripts/e2e-daily.mjs: with FAKE_CLOCK_AT
 * set (an ISO time), the process's Date starts there and runs on from it, so a run can play one UTC day and then the
 * next. The app has no test hook for time; this file is never loaded outside such a run. Unset, it changes nothing.
 */
const at = Date.parse(process.env.FAKE_CLOCK_AT ?? "");

if (Number.isFinite(at)) {
  const RealDate = Date;
  const offset = at - RealDate.now();
  const now = () => RealDate.now() + offset;
  globalThis.Date = new Proxy(RealDate, {
    // new Date() is now on the fake clock; new Date(anything) is that moment, as ever.
    construct: (target, args, newTarget) => Reflect.construct(target, args.length ? args : [now()], newTarget),
    // Date() called as a function returns the time as a string.
    apply: () => new RealDate(now()).toString(),
    get: (target, prop, receiver) => (prop === "now" ? now : Reflect.get(target, prop, receiver)),
  });
}
