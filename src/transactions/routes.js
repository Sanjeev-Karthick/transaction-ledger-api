import { Router } from 'express';
import { HttpError } from '../errors.js';
import { createTransactionSchema, idSchema, listSchema, parse } from './schema.js';

export function transactionRoutes(repository) {
  const router = Router();
  router.post('/', async (req, res) => {
    if (!req.is('application/json')) {
      throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
    }
    const input = parse(createTransactionSchema, req.body);
    let transaction;
    try {
      transaction = await repository.create(input);
    } catch (err) {
      if (err.code === '23505' && err.constraint === 'transactions_reference_key') {
        throw new HttpError(
          409,
          'REFERENCE_EXISTS',
          'A transaction with this reference already exists',
        );
      }
      throw err;
    }
    res.location(`/api/v1/transactions/${transaction.id}`).status(201).json({ data: transaction });
  });
  router.get('/', async (req, res) =>
    res.json(await repository.list(parse(listSchema, req.query))),
  );
  router.get('/:id', async (req, res) => {
    const { id } = parse(idSchema, req.params);
    const transaction = await repository.findById(id);
    if (!transaction) throw new HttpError(404, 'NOT_FOUND', 'Transaction not found');
    res.json({ data: transaction });
  });
  return router;
}
