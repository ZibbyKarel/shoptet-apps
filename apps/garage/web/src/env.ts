/**
 * Fail-fast environment schema for apps/garage/web.
 *
 * This is the single source of truth for which environment variables the
 * Next.js app needs and what shape they must have. It is invoked from
 * `src/instrumentation-node.ts`, which Next.js loads once when an actual
 * server instance boots (`next dev` / `next start`) — so a missing or
 * malformed variable crashes the process immediately with a readable error
 * instead of failing later inside a React component or a route handler. See
 * `doc/decision/0008-web-env-validation-instrumentation-hook.md` for why
 * this is not done from `next.config.ts` instead.
 *
 * Dev, e2e and production all run this exact same validation; only the
 * values differ (see `.env.example` and `doc/environment.md`).
 *
 * The schema is deliberately minimal for this phase (Fáze 0) and is designed
 * to grow additively: later phases add variables as new keys on this object,
 * never by relaxing existing ones.
 */
import * as z from 'zod';

const nodeEnvSchema = z.enum(['development', 'test', 'production']);

export const webEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  NEXT_PUBLIC_API_URL: z.url(),
  // Auth.js signs/encrypts session cookies with this; 32 chars is the
  // minimum length recommended for a `openssl rand -hex 32`-style secret.
  AUTH_SECRET: z.string().min(32, 'must be at least 32 characters long'),
  AUTH_OKTA_ISSUER: z.url(),
  AUTH_OKTA_CLIENT_ID: z.string().min(1),
  AUTH_OKTA_CLIENT_SECRET: z.string().min(1),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

/**
 * Formats a `ZodError` into a multi-line, human-readable message that names
 * every offending variable and states what is wrong with it. It never
 * includes the invalid value itself: Zod's own issue messages for the checks
 * used in this schema (missing/empty, wrong type, bad URL, too short)
 * describe the *expectation*, not the input — so this formatter is safe to
 * print to logs or a terminal that other people can see.
 */
function formatEnvValidationError(appName: string, error: z.ZodError): string {
  const lines = error.issues.map((issue) => {
    const variable = issue.path.join('.') || '(root)';
    return `  - ${variable}: ${issue.message}`;
  });
  return [
    `Invalid or missing environment variables for ${appName}. Fix these and restart:`,
    ...lines,
  ].join('\n');
}

/**
 * Validates `process.env` (or a stand-in, e.g. in tests) against
 * {@link webEnvSchema}. Throws on failure — the caller
 * (`src/instrumentation-node.ts`) is expected to turn that into a real
 * process exit; see its own docstring for why.
 */
export function validateWebEnv(config: Record<string, unknown> = process.env): WebEnv {
  const result = webEnvSchema.safeParse(config);
  if (!result.success) {
    throw new Error(formatEnvValidationError('web', result.error));
  }
  return result.data;
}
