/**
 * Where this server runs. Vercel sets VERCEL and VERCEL_ENV itself. Anywhere else (DigitalOcean App Platform, since
 * 2026-10-30: docs/hosting.md) the deployment says so with DEPLOY_ENV=production (or preview). A local run sets neither.
 */
type Env = Record<string, string | undefined>;

/** "production", "preview", or null on a developer's machine. */
export const deployEnv = (env: Env = process.env): string | null => env.VERCEL_ENV?.trim() || env.DEPLOY_ENV?.trim() || null;

/** The live site: real payments, real analytics, search-engine pings. */
export const isProductionDeploy = (env: Env = process.env): boolean => deployEnv(env) === "production";

/** Any deployment (production or preview, on any host), never a developer's machine. */
export const isDeployed = (env: Env = process.env): boolean => Boolean(env.VERCEL || env.VERCEL_ENV || env.DEPLOY_ENV);
