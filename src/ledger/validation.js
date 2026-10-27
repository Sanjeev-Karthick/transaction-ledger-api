import _ from 'lodash';
import { z } from 'zod';
import { HttpError } from '../errors.js';

const uuid = z.uuid().transform((value) => value.toLowerCase());

// Convert to text, not a JS floating-point calculation. Reject extra precision instead of rounding.
const amount = z
  .union([z.string(), z.number().finite()])
  .transform(String)
  .pipe(
    z
      .string()
      .regex(
        /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/,
        'Use up to 16 integer digits and 2 decimal places',
      ),
  )
  .refine((value) => /[1-9]/.test(value), 'Amount must be greater than 0');

const text = (max) => z.string().trim().min(1).max(max);
const transactionFields = {
  amount,
  description: z.string().trim().max(500).default(''),
  reference_id: text(100),
};

export const accountSchema = z.object({ name: text(100) }).strict();
export const transactionSchema = z
  .object({
    type: z.enum(['credit', 'debit']),
    ...transactionFields,
  })
  .strict();
export const transferSchema = z
  .object({
    source_account_id: uuid,
    destination_account_id: uuid,
    ...transactionFields,
  })
  .strict()
  .refine((value) => value.source_account_id !== value.destination_account_id, {
    message: 'Source and destination accounts must be different',
    path: ['destination_account_id'],
  });
export const accountIdSchema = z.object({ accountId: uuid }).strict();
const positiveInteger = (max, fallback) =>
  z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(max))
    .default(fallback);
export const historySchema = z
  .object({
    type: z.enum(['credit', 'debit']).optional(),
    page: positiveInteger(1000000, 1),
    limit: positiveInteger(100, 20),
  })
  .strict();

export function validate(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const details = _.map(result.error.issues, (issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
    }));
    throw new HttpError(400, 'VALIDATION_ERROR', 'Request validation failed', details);
  }
  return result.data;
}
