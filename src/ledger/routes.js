const { Router } = require('express');
const { HttpError } = require('../errors.js');
const {
  accountSchema,
  transactionSchema,
  transferSchema,
  accountIdSchema,
  historySchema,
  validate,
} = require('./validation.js');

function ledgerRoutes(repository) {
  const router = Router();

  router.use((req, _res, next) => {
    if (req.method === 'POST' && !req.is('application/json')) {
      throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
    }
    next();
  });

  router.post('/accounts', async function createAccount(req, res) {
    const input = validate(accountSchema, req.body);
    const account = await repository.createAccount(input);
    res.status(201).json({ data: account });
  });

  router.get('/accounts/:accountId/balance', async function getBalance(req, res) {
    const { accountId } = validate(accountIdSchema, req.params);
    const balance = await repository.getBalance(accountId);
    res.json({ data: balance });
  });

  router.post('/accounts/:accountId/transactions', async function addTransaction(req, res) {
    const { accountId } = validate(accountIdSchema, req.params);
    const input = validate(transactionSchema, req.body);
    const result = await repository.addTransaction(accountId, input);
    res.status(201).json({ data: result });
  });

  router.get('/accounts/:accountId/transactions', async function getHistory(req, res) {
    const { accountId } = validate(accountIdSchema, req.params);
    const query = validate(historySchema, req.query);
    res.json(await repository.getHistory(accountId, query));
  });

  router.post('/transfers', async function transfer(req, res) {
    const input = validate(transferSchema, req.body);
    const result = await repository.transfer(input);
    res.status(201).json({ data: result });
  });

  return router;
}

module.exports = { ledgerRoutes };
