/**
 * /llm.txt — an alias of /llms.txt (the name OpenClaw used; the standard is the plural). The same handler,
 * so a bot or a person finds the identical welcome whichever they look for.
 */
export const dynamic = "force-dynamic"; // segment config must be declared here, not re-exported
export { GET } from "../llms.txt/route";
