# Postman tests

Import both JSON files in this folder into Postman:

- `transaction-ledger.postman_collection.json`
- `transaction-ledger.postman_environment.json`

Select **Transaction Ledger - Local or Render** as the active environment.
Set its `base_url` to `http://localhost:3000` or your Render service URL, without a trailing slash.
No credentials or database URLs belong in this environment.

Run the **whole collection**, in its numbered order, with **one iteration**. The first request
generates a unique run ID, and the account creation requests save account IDs automatically.
Later requests use those saved values. No manual account/reference editing is needed.

The collection has 43 requests with assertions for:

- Health and starter responses
- Zero initial balance and generated account fields
- Credits, debits and account-scoped duplicate protection
- Overdraft rejection without balance changes
- Filtered history, pagination and latest-first ordering
- Transfers, duplicate transfers, missing accounts and insufficient funds
- Invalid bodies, amounts, UUIDs, filters and pagination
- Rejection of transaction edits/deletions
- Final balances and valid transaction counts

Expected final balances: **A = 50.00**, **B = 70.00**.
Expected final transaction counts: **A = 3**, **B = 2** (A's count is asserted).

**Use a test environment.** Every run creates two accounts and permanent ledger records.
There is intentionally no cleanup endpoint. Running individual write requests again can fail
because references are unique; rerun the full collection to create fresh accounts.

The API rate limit is 100 requests/minute/client IP. Run once at a time and wait a minute if you
receive 429 responses. For concurrent-write and injected rollback checks, use the Mocha integration
suite instead: the Postman requests are sequential and do not replace those tests.

## Optional terminal runner

With the local API running:

```sh
npx --yes newman@6.2.3 run postman/transaction-ledger.postman_collection.json \
  -e postman/transaction-ledger.postman_environment.json \
  --delay-request 100 --timeout-request 15000
```

For Render, override the environment URL (replace the example hostname):

```sh
npx --yes newman@6.2.3 run postman/transaction-ledger.postman_collection.json \
  --env-var base_url=https://your-service-name.onrender.com \
  --delay-request 100 --timeout-request 60000
```

Newman is an optional one-off runner, not an application dependency.
