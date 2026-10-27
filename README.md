# Transaction Ledger API

JavaScript, Express, PostgreSQL, Lodash and Swagger. Accounts start at zero. Credits and debits
are immutable, references are unique within each account, and transfers are atomic.

## Run in Docker

```sh
cp .env.example .env # first time only
docker compose up --build -d --remove-orphans
```

- API: `http://localhost:3000`
- Swagger: `http://localhost:3000/docs/`
- OpenAPI: `http://localhost:3000/openapi.json`
- Health: `http://localhost:3000/health`

Two containers: API and PostgreSQL. The API waits for PostgreSQL health, runs migrations and starts.
Database data stays in a named volume. `docker compose down` preserves it; **`down -v` deletes it**.
For multiple API replicas, run migrations once as a deployment job rather than at each startup.

## Run Node locally

Requires Node 24, npm and Docker Desktop (or a locally installed PostgreSQL server).

```sh
cp .env.example .env # first time only
nvm install
nvm use
npm ci
docker compose stop api # if port 3000 is occupied
docker compose up -d db
npm run db:migrate
npm run dev
```

`npm start` runs without file watching. Use `npm run debug` or VS Code **Debug API** for breakpoints.
Your older Node 22.0.0 cannot run the optional env-file loader; use Node 24 or Docker.

## Endpoints

All ledger endpoints start with `/api/v1`. POST requests require `Content-Type: application/json`.

| Method | Path                                | Purpose                                      |
| ------ | ----------------------------------- | -------------------------------------------- |
| POST   | `/accounts`                         | Create account; only `name` accepted         |
| GET    | `/accounts/:accountId/balance`      | Current account balance                      |
| POST   | `/accounts/:accountId/transactions` | Add credit/debit                             |
| GET    | `/accounts/:accountId/transactions` | Filtered, paginated history                  |
| POST   | `/transfers`                        | Atomic debit and credit between two accounts |

`GET /health` checks PostgreSQL with `SELECT 1`; returns 503 if unavailable.
`GET /api/v1/starter` remains available as a simple starter response.

### Create account

```sh
curl -X POST http://localhost:3000/api/v1/accounts \
  -H 'Content-Type: application/json' -d '{"name":"Alice"}'
```

```json
{
  "data": {
    "id": "ecb4dc3b-c6e0-46bd-baa3-b9be5cb68562",
    "name": "Alice",
    "balance": "0.00",
    "created_at": "2026-10-27T12:00:00.000Z"
  }
}
```

IDs are server-generated UUIDs, timestamps come from PostgreSQL, and the database default sets
the balance to zero. Client-supplied balance, ID, timestamps and unknown fields are rejected.

### Add transaction

Use the actual account ID returned above:

```sh
ACCOUNT_ID=ecb4dc3b-c6e0-46bd-baa3-b9be5cb68562
curl -X POST "http://localhost:3000/api/v1/accounts/$ACCOUNT_ID/transactions" \
  -H 'Content-Type: application/json' \
  -d '{"type":"credit","amount":"100.50","description":"Deposit","reference_id":"deposit-001"}'

curl "http://localhost:3000/api/v1/accounts/$ACCOUNT_ID/balance"
curl "http://localhost:3000/api/v1/accounts/$ACCOUNT_ID/transactions?type=credit&page=1&limit=20"
```

Transactions return `{ "data": { "transaction": { ... }, "balance": "100.50" } }`.
Description is optional and defaults to an empty string. Names, descriptions and references are
trimmed. Reference IDs are case-sensitive and unique **per account**. Reuse returns 409 with the
existing transaction ID; it never replays a success or changes money, even if the new payload differs.

History returns:

```json
{
  "data": [],
  "pagination": { "page": 1, "limit": 20, "total_records": 0, "total_pages": 0 }
}
```

Omit `type` for both types. Defaults: page 1, limit 20; maximum limit 100, maximum page 1000000.
Results sort by `created_at DESC, id DESC`. Out-of-range pages return an empty array.
The count and rows share one database snapshot. Separate page requests can shift under concurrent
inserts; use cursor pagination later if the workload needs stable traversal.

### Transfer (bonus)

```sh
curl -X POST http://localhost:3000/api/v1/transfers \
  -H 'Content-Type: application/json' \
  -d '{"source_account_id":"ecb4dc3b-c6e0-46bd-baa3-b9be5cb68562","destination_account_id":"0aafc17b-8507-4681-9e1d-d496864c4ca3","amount":"30.00","reference_id":"transfer-001","description":"Transfer"}'
```

Both accounts must exist and differ. The reference must be unused on **both** accounts, including
references from ordinary transactions. Success returns debit/credit records and both new balances.
Both entries share the provided reference; neither is persisted if anything fails.

## Money and consistency

- This version assumes one shared currency with **two decimal places**. No currency conversion.
- Amounts accept strings or JSON numbers, positive and up to `9999999999999999.99`.
  Strings are recommended: numbers may lose precision before the server receives them.
- More than two decimal places is rejected, not silently rounded. Money responses are strings.
- PostgreSQL `numeric` handles all arithmetic; no JS floating-point balance calculations.
- Account balances use `numeric(24,2)`; exceeding its range returns 422 and rolls back the write.
- Each write uses BEGIN/COMMIT/ROLLBACK on one database connection. Account row locks serialize
  writes before checking duplicates and funds. Transfers lock both accounts in UUID order to avoid
  opposite-direction deadlocks. No partial balance/record changes are visible.
- Database constraints enforce IDs, account references, positive amounts, nonnegative balances,
  valid types, and account-scoped reference uniqueness. Triggers block transaction changes/deletion.
- No API can edit balances or edit/delete transactions. All application writes go through the
  transaction functions. A privileged database administrator can bypass controls or change balances;
  do not grant clients direct SQL access. This is not cryptographic tamper-proofing.

## Errors

```json
{
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "Account has insufficient balance",
    "requestId": "b415e1dc-e247-447f-bce9-f0a9ce8d181f"
  }
}
```

| Status    | Cases                                                          |
| --------- | -------------------------------------------------------------- |
| 400       | Invalid body, UUID, type, amount, pagination or missing fields |
| 404       | Account/route not found                                        |
| 409       | Duplicate reference or insufficient balance                    |
| 413 / 415 | Body too large / unsupported media type                        |
| 422       | Money exceeds database range                                   |
| 429       | API rate limit exceeded                                        |
| 500       | Unexpected error; database write rolled back                   |

Validation errors include a `details` array of field errors. Duplicate errors can include an
object with `account_id` and `transaction_id`. Internal errors are logged, not exposed to clients.

## Simple structure

```text
src/server.js             start/stop server
src/app.js                middleware, health, Swagger, routes
src/ledger/routes.js      HTTP handlers
src/ledger/validation.js  Zod validation; Lodash maps field errors
src/ledger/repository.js  SQL and atomic operations; Lodash orders account locks
src/db/pool.js            database connections
src/db/migrate.js         transactional SQL migration runner
migrations/              versioned SQL files
```

Read flow: **route → validate → repository → response**. No generic controller/service layers.
Migration 002 uses new account tables and leaves any earlier experimental `transactions` table
and migration history alone. No existing data is dropped or converted into the new ledger.
Add new migrations rather than modifying applied ones. Checksums detect modified applied files.

## Tests

```sh
npm run check
docker compose up -d db
docker compose exec db createdb -U ledger ledger_test # once, default local credentials
npm run test:integration
```

Integration tests require `TEST_DATABASE_URL` with a database name ending in `_test`. They run
migrations and leave append-only test records in that disposable database. Tests cover precision,
duplicate races, concurrent debits, history, validation, immutability, transfers, injected failures
and a query verifying that every account balance equals its ledger sum. CI runs the same checks.

## Settings and deployment

See `.env.example`. `DATABASE_URL` is required. Compose uses hostname `db`; local Node uses localhost.
Changing database credentials in `.env` does not update an already initialized PostgreSQL volume.
If you change Compose ports or credentials, update local connection URLs too.

Before public deployment add authentication and account ownership/authorization, HTTPS, production
secrets, backup/restore procedures and monitoring. CORS is not access control. Disable docs with
`DOCS_ENABLED=false` where appropriate. Use verified database TLS (`DB_SSL=true`, optional
`DB_SSL_CA_FILE`) for hosted PostgreSQL; do not override it with SSL URL parameters.
The built-in rate limit is per-process, 100 API requests/minute/client IP; use a gateway/shared limit
and configure trusted proxies when scaling. Use least-privilege DB credentials; the local Compose
user is not an appropriate production runtime role.
