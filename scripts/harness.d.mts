/** Types for the parts of scripts/harness.mjs the tests read; the harness stays plain JS so the e2e scripts run with no build step. */
type Env = Record<string, string | undefined>;

/** What a local build or app may see of a shell: what a process needs to run, and what HARNESS_PASS_ENV names. */
export function shellEnv(env?: Env): Record<string, string>;
/** The app's environment for a local run: shellEnv plus the local stand-ins (the stub showrunner, the sample payment link…). */
export function appEnv(showrunnerPort: number, dataDir: string): Record<string, string>;
