# Transaction Ledger API

A Node.js, Express and PostgreSQL API for accounts, credits, debits, transaction history
and atomic transfers. JavaScript uses CommonJS (`require` / `module.exports`).

## Submission links

- [Source code](https://github.com/Sanjeev-Karthick/transaction-ledger-api)
- [API documentation — OpenAPI](docs/openapi.json)
- [Postman collection](postman/transaction-ledger.postman_collection.json)
- [Postman environment](postman/transaction-ledger.postman_environment.json)
- [Assumptions](#assumptions)

### Hosted API

| Resource                            | Link                                                                                      |
| ----------------------------------- | ----------------------------------------------------------------------------------------- |
| API base URL (also used in Postman) | https://transaction-ledger-api-qce8.onrender.com                                          |
| Health check                        | [Check API and database health](https://transaction-ledger-api-qce8.onrender.com/health)  |
| Swagger UI                          | [Explore and try the API](https://transaction-ledger-api-qce8.onrender.com/docs/)         |
| OpenAPI specification               | [Hosted API specification](https://transaction-ledger-api-qce8.onrender.com/openapi.json) |

The API base URL is a prefix, not a homepage. Use the health check to check availability
or Swagger UI to explore the endpoints.

## Quick start — Docker

Requires Docker Desktop.

```sh
git clone https://github.com/Sanjeev-Karthick/transaction-ledger-api.git
cd transaction-ledger-api
cp .env.example .env
docker compose up --build -d
```

The API waits for PostgreSQL, runs migrations and starts automatically.

| Resource              | Local URL                          |
| --------------------- | ---------------------------------- |
| Health check          | http://localhost:3000/health       |
| Swagger UI            | http://localhost:3000/docs/        |
| OpenAPI specification | http://localhost:3000/openapi.json |

```sh
docker compose logs -f api # view logs
docker compose down        # stop containers; keep database data
```

**Warning:** `docker compose down -v` deletes the database volume.

## Run Node locally

Requires Node 24, npm and Docker for PostgreSQL. Run from the cloned repository.
Skip copying `.env` if it already exists.

```sh
cp .env.example .env
nvm install
nvm use
npm ci
docker compose stop api # free port 3000 if the Docker API is running
docker compose up -d db
npm run db:migrate
npm run dev
```

`nvm` is optional if Node 24 is already installed. Use `npm start` without file watching,
or `npm run debug` for debugging. If using your own PostgreSQL, update `DATABASE_URL` in `.env`.
Never commit `.env`; the example credentials are for local development only.

## API overview

All paths below start with `/api/v1`. POST requests require `Content-Type: application/json`.
See Swagger for request bodies, filters and response examples.

| Method | Path                                | Purpose                     |
| ------ | ----------------------------------- | --------------------------- |
| POST   | `/accounts`                         | Create an account           |
| GET    | `/accounts/:accountId/balance`      | Get balance                 |
| POST   | `/accounts/:accountId/transactions` | Credit or debit             |
| GET    | `/accounts/:accountId/transactions` | Filtered, paginated history |
| POST   | `/transfers`                        | Transfer between accounts   |

Create your first account:

```sh
curl -X POST http://localhost:3000/api/v1/accounts \
  -H 'Content-Type: application/json' \
  -d '{"name":"Alice"}'
```

**Ledger rules:** accounts start at zero; amounts must be positive with at most two decimal
places. Send money as strings such as `"100.50"`; monetary responses are strings.
Debits cannot overdraw, references are unique per account, and transactions cannot be changed
or deleted. Transfers commit both sides together or roll back entirely.

## Testing

After `npm ci`, run the checks (Mocha, Sinon, Supertest, lint, formatting and OpenAPI validation):

```sh
npm run check
```

Integration tests require a separate, disposable database. With the default local credentials:

```sh
docker compose up -d db
docker compose exec db createdb -U ledger ledger_test # once only
npm run test:integration
```

`TEST_DATABASE_URL` in `.env` must point to a database ending in `_test`.

### Postman

1. Import both JSON files from `postman/`.
2. Select the imported environment and set `base_url` to `http://localhost:3000` or your
   public Render URL, without a trailing slash.
3. Run the complete collection in order, with **one iteration**.

Account IDs populate automatically. Each run creates permanent test records.
See [Postman instructions](postman/README.md) for details and terminal usage.

## Assumptions

- One currency with two decimal places; currency conversion is out of scope. Amounts
  support up to 16 integer digits. Prefer strings to avoid client-side floating-point loss.
- IDs are system-generated UUIDs; timestamps are system-generated and timezone-aware.
  Clients cannot set IDs, timestamps or an initial balance. Unknown request fields are rejected.
- Names and references are trimmed and required. References are case-sensitive and unique
  within each account. A duplicate returns `409`, without changing the balance.
- Description is optional and defaults to an empty string (maximum 500 characters).
- Invalid data or malformed IDs return `400`; valid IDs for missing accounts return `404`.
  Insufficient funds return `409`. Errors use an `error` object with a code, message and request ID.
- History defaults to page 1 and limit 20 (maximum 100). Pages beyond the last return an
  empty list. Results use `created_at DESC`, then ID as a deterministic tie-breaker.
- Transfers require different source/destination accounts and an unused reference in both.
  They create one debit and one credit with the same reference and commit atomically.
- Balance consistency is guaranteed for writes through this API. Direct SQL changes by a
  privileged database user are outside the API contract; restrict database access.

## Requirements verification

Automated tests cover zero-balance account creation, exact credits/debits, rejected overdrafts,
account-scoped duplicates, concurrent writes, missing accounts, validation, filtered/paginated
latest-first history, immutable transactions, transfer rollback and balance reconciliation.
Database constraints enforce valid types, positive amounts, nonnegative balances, account
references and account-scoped uniqueness; a trigger blocks transaction updates/deletes/truncation.

Run `npm run check` and `npm run test:integration` to verify these against your environment.

## Before real-world use

**Authentication and account ownership checks are not implemented. Use test data only.**
Add access control, production secrets, backups and monitoring before handling real accounts.
The API rate limit is 100 requests per minute per client IP; wait before retrying a `429` response.
Keep applied migrations unchanged; add new migration files for schema changes.
