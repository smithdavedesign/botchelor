/**
 * A Replicate model as a setting or a person's connection names it: `owner/name`, optionally with `:` and a version id,
 * or a bare version id. The owner and name go in the request's path, so neither starts with a dot ("." and ".." aren't
 * names). Its own module so the show's connection settings (app/api/me/connections) check a pasted model without
 * importing After Dark's code; lib/adult/replicate.ts, which runs the predictions, reads it from here.
 */
export const REPLICATE_MODEL_ID = /^(?:[\w-][\w.-]*\/[\w-][\w.-]*(?::[0-9a-f]{64})?|[0-9a-f]{64})$/;
