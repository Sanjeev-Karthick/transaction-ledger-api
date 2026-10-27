import { z } from 'zod';
import { HttpError } from '../errors.js';

// Minor units avoid floating point rounding. PostgreSQL bigint is returned as a string.
export const createTransactionSchema = z
  .object({
    reference: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[a-zA-Z0-9._:-]+$/),
    amountMinor: z
      .string()
      .regex(/^[1-9][0-9]{0,17}$/, 'Use a positive integer string, up to 18 digits'),
    currency: z.string().regex(/^[A-Z]{3}$/, 'Use a three-letter uppercase currency code'),
    direction: z.enum(['credit', 'debit']),
    description: z.string().trim().max(500).default(''),
  })
  .strict();

export const idSchema = z.object({ id: z.uuid() }).strict();
export const listSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
  })
  .strict();

export function parse(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'Request validation failed',
      result.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })),
    );
  }
  return result.data;
}
