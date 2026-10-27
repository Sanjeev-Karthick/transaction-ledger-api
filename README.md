# Transaction Ledger API

A small REST API using **JavaScript**, Express, PostgreSQL and Swagger UI.
Use Node 24 (`nvm install && nvm use`) and Docker Desktop.

## Run with Docker

```sh
cp .env.example .env # first time only
docker compose up --build -d --remove-orphans
```

- API: `http://localhost:3000`
- Swagger UI: `http://localhost:3000/docs/`
- OpenAPI: `http://localhost:3000/openapi.json`
- Database readiness: `http://localhost:3000/health/ready`

There are just **two containers**: API and PostgreSQL. PostgreSQL stores data in a named volume.
The API waits for a healthy database, runs migrations, then starts the server. This startup
sequence is intended for a single-instance deployment; use a separate migration job when scaling.

```sh
docker compose logs -f api
docker compose down # stops containers, preserves data
```

**Do not use `docker compose down -v` unless you want to delete all database data.**

## Run Node locally

```sh
cp .env.example .env # first time only
nvm install
nvm use
npm ci
docker compose stop api # if it is running on port 3000
docker compose up -d db
npm run db:migrate
npm run dev
```

`npm run dev` restarts the server on file changes. `npm start` runs without watching.
You can also use a locally installed PostgreSQL server: update `DATABASE_URL` in `.env`.
The existing Node 22.0.0 installation is too old; use Node 24 or the Docker workflow.

## Debug

Open this project in VS Code, set a breakpoint, and select **Run and Debug → Debug API**.
Make sure PostgreSQL is running, migrations have run, and port 3000 is free.

Alternatively run `npm run debug` and attach a Node debugger to port 9229.
The inspector is for local use only; do not expose it publicly.

Start reading the code here:

```text
src/server.js                  starts and stops the server
src/app.js                     middleware, health checks, docs and routing
src/transactions/routes.js     named request handlers
src/transactions/schema.js     request validation
src/transactions/repository.js SQL queries
src/errors.js                  shared error responses
src/config.js                  environment validation
src/db/pool.js                 PostgreSQL connection pool
src/db/migrate.js              migration runner
scripts/migrate.js             migration command
docs/openapi.json              API documentation
```

Request flow: **route handler → validate input → repository query → JSON response**.
There are no controller/service/base-class layers. SQL stays in the repository so it is easy
to inspect without mixing database details into HTTP handling. Named handlers appear in stack
traces. Errors are logged with stack traces; request IDs connect responses to access logs.

## Try the API

```sh
curl -i http://localhost:3000/api/v1/transactions \
  -H 'Content-Type: application/json' \
  -d '{"reference":"order-1001","amountMinor":"1099","currency":"USD","direction":"credit"}'

curl 'http://localhost:3000/api/v1/transactions?limit=20&offset=0'
```

| Method | Route                       | Purpose                         |
| ------ | --------------------------- | ------------------------------- |
| GET    | `/health/live`              | Process health                  |
| GET    | `/health/ready`             | Database and table availability |
| POST   | `/api/v1/transactions`      | Create a transaction            |
| GET    | `/api/v1/transactions`      | List transactions               |
| GET    | `/api/v1/transactions/{id}` | Get one transaction             |

Amounts are positive integer **strings** in currency minor units: `"1099"` means USD 10.99.
Strings preserve exact values without floating-point rounding. Maximum: 18 digits.
Currency validation checks three uppercase letters, not currency membership or decimal rules.
Duplicate references return 409. Transactions are append-only; database triggers reject updates,
deletes and truncation. This example is not a complete double-entry accounting ledger.

## Settings

Only `DATABASE_URL` is required by the application. Defaults live in the code.

| Setting             | Default / purpose                                             |
| ------------------- | ------------------------------------------------------------- |
| `PORT`              | `3000`                                                        |
| `NODE_ENV`          | `development`                                                 |
| `LOG_LEVEL`         | `info`; use `debug` for additional application logs           |
| `DOCS_ENABLED`      | Enabled outside production; `.env.example` enables it locally |
| `CORS_ORIGINS`      | Empty; optional comma-separated browser origins               |
| `DB_SSL`            | `false`; set `true` for hosted PostgreSQL                     |
| `DB_SSL_CA_FILE`    | Optional trusted CA file for database TLS                     |
| `TEST_DATABASE_URL` | Separate disposable database, used only by integration tests  |

`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` and `POSTGRES_PORT` configure local Compose.
If you change them, update the local database URLs too. Compose uses hostname `db`; local Node
uses `localhost`. Use URL-safe local credentials. Existing volumes retain their original database
credentials even after you change `.env`.

The pool uses 10 connections. API requests are limited to 100 per minute per client IP, per process.
These are straightforward constants in the code, not extra environment switches.
The application does not trust forwarded proxy headers by default.

## Tests

```sh
npm run check # lint, format, unit/API tests and OpenAPI validation
npm run format
```

For real PostgreSQL integration tests:

```sh
docker compose up -d db
docker compose exec db createdb -U ledger ledger_test # once, using default local credentials
npm run test:integration
```

The test database name must end in `_test` and differ from the application database.
Tests leave records in this disposable database. CI runs checks, integration tests, a dependency
audit and the Docker build.

## Migrations and deployment

Add numbered SQL files to `migrations/`, then run `npm run db:migrate`. Do not edit applied files.
The runner keeps checksums, serializes concurrent runs, and wraps each migration in a transaction.
Existing migration history and data remain compatible. Only transactional SQL is supported.

Before exposing this API publicly:

- Add authentication and authorization. CORS is not access control.
- Use HTTPS, strong secrets, backups and monitoring; never commit `.env`.
- Disable public docs with `DOCS_ENABLED=false` where appropriate.
- Use separate least-privilege runtime and migration database roles. Compose credentials are for
  local development, not production. Run migrations once in your deployment pipeline when scaling.
- Enable verified database TLS. Do not add sslmode/sslcert/sslkey/sslrootcert URL options; use
  `DB_SSL` and `DB_SSL_CA_FILE` so they do not override explicit verification settings.
- Configure trusted proxy IPs in Express only if you deploy behind a known proxy, and use gateway
  rate limiting for multiple instances. The built-in limiter uses per-process memory.
- Offset pagination can shift during concurrent inserts. Add cursor pagination and proper
  idempotency/reconciliation when the business requirements call for them.

The runtime image uses a non-root user and production dependencies. Compose binds published
ports to localhost. This is a simple starter, not a complete public financial service.
