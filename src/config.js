import { z } from 'zod';

const boolean = z.enum(['true', 'false']).transform((value) => value === 'true');
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z
    .string()
    .url()
    .refine((value) => {
      try {
        const url = new URL(value);
        return (
          ['postgres:', 'postgresql:'].includes(url.protocol) &&
          !['sslmode', 'sslcert', 'sslkey', 'sslrootcert'].some((key) => url.searchParams.has(key))
        );
      } catch {
        return false;
      }
    }, 'Use a PostgreSQL URL without ssl parameters; configure TLS through DB_SSL instead'),
  DB_SSL: boolean.default('false'),
  DB_SSL_CA_FILE: z.string().default(''),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DOCS_ENABLED: boolean.optional(),
  CORS_ORIGINS: z.string().default(''),
});

export function loadConfig(env = process.env) {
  const result = schema.safeParse(env);
  if (!result.success) {
    // Never print values: DATABASE_URL can contain credentials.
    throw new Error(
      `Invalid configuration: ${result.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    );
  }
  const value = result.data;
  const corsOrigins = value.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (
    corsOrigins.some((origin) => {
      try {
        const url = new URL(origin);
        return !['http:', 'https:'].includes(url.protocol) || url.origin !== origin;
      } catch {
        return true;
      }
    })
  )
    throw new Error('Invalid configuration: CORS_ORIGINS must contain HTTP(S) origins');
  return {
    ...value,
    DOCS_ENABLED: value.DOCS_ENABLED ?? value.NODE_ENV !== 'production',
    corsOrigins,
  };
}
