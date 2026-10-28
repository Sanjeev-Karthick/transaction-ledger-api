# Transaction Ledger API

A small ledger API built with Node.js, Express and PostgreSQL. You can create an account,
credit or debit it, check its balance and browse its transaction history. Transfers between
accounts are supported too: either both sides succeed, or neither does.

The code uses CommonJS (`require` / `module.exports`).

## Project links

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

Start with Swagger if you want to try it out in your browser. The base URL doesn't have a
homepage; the health endpoint checks that both the API and database are available.

## Run with Docker

Docker Desktop is all you need for this option.

```sh
git clone https://github.com/Sanjeev-Karthick/transaction-ledger-api.git
cd transaction-ledger-api
cp .env.example .env
docker compose up --build -d
```

This starts PostgreSQL and the API. Migrations run automatically once the database is ready.

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

For development, you can run Node directly and keep PostgreSQL in Docker. You'll need
Node 24 and npm. From the cloned repository, run the following (skip the first command
if you already have a `.env` file):

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

If Node 24 is already installed, skip the `nvm` commands. `npm run dev` restarts the server
when files change; use `npm start` to run without watching, or `npm run debug` for debugging.
To use an existing PostgreSQL instance instead, change `DATABASE_URL` in `.env`.

The example credentials are only for local development. Keep `.env` out of Git.

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

Every account starts at zero. Amounts must be positive and have no more than two decimal
places. Send money as strings, for example `"100.50"`; balances and amounts also come back
as strings to preserve decimal precision.

A debit is rejected if there isn't enough money. Each transaction needs a reference that's
unique within its account, so retrying the same reference won't apply it twice. Once saved,
a transaction can't be edited or deleted.

## Testing

After `npm ci`, this runs the unit/API tests, lint, formatting and OpenAPI validation:

```sh
npm run check
```

The tests use Mocha, Sinon and Supertest. To also run them against PostgreSQL, create a
separate test database. With the default local credentials:

```sh
docker compose up -d db
docker compose exec db createdb -U ledger ledger_test # once only
npm run test:integration
```

Create `ledger_test` only once. `TEST_DATABASE_URL` in `.env` must point to a separate
database whose name ends in `_test`. Test runs leave records there, so don't use a database
you need to keep clean.

### Postman

1. Import both JSON files from `postman/`.
2. Select the imported environment and set `base_url` to `http://localhost:3000` or your
   public Render URL, without a trailing slash.
3. Run the complete collection in order, with **one iteration**.

The collection saves account IDs for you as it runs. Each run creates permanent test records.
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

## What the tests cover

The tests check account creation, decimal arithmetic, overdrafts, duplicate references and
concurrent writes. They also cover history filtering and pagination, validation errors,
transaction immutability and transfers. Failure-injection tests check that a failed write
rolls back the balance and both transfer records. A reconciliation check compares account
balances with the sum of their transactions.

PostgreSQL constraints provide another layer of protection for amounts, balances, account
references and duplicate references. A database trigger rejects updates, deletes and
truncation of transaction records.

Run `npm run check` and `npm run test:integration` to verify these against your environment.

## Known limitations

**There is no authentication or account ownership checking yet. Use test data only on the
hosted service.** Access control, production secrets, backups and monitoring are needed before
using this with real accounts.

The API allows 100 requests per minute per client IP. If you get a `429`, wait before trying
again. For schema changes, add a new migration rather than changing one that's already run.
