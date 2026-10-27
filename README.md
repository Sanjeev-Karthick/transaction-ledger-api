# Transaction Ledger API

Production-oriented **JavaScript (ES modules, not TypeScript)** REST API starter using Express 5,
PostgreSQL, node-postgres, Zod, Pino, OpenAPI 3 and Swagger UI.

## Prerequisites

- Node **24** recommended (`nvm install && nvm use`); minimum supported version is 22.21.
- npm and Docker Desktop with Compose v2.
- Your installed Node 22.0.0 is too old for the npm scripts' optional env-file loader. Upgrade
  with nvm, or use the fully containerized workflow without installing Node locally.

## Quick start: everything in Docker

From the project folder:

```sh
cp .env.example .env
docker compose up --build -d
docker compose ps -a
curl --fail http://localhost:3000/health/ready
```

API: `http://localhost:3000`. Swagger UI: `http://localhost:3000/docs/`.
OpenAPI JSON: `http://localhost:3000/openapi.json`.
The example `.env` explicitly enables docs for local exploration. Without that override,
docs default to disabled in production.

```sh
docker compose logs -f api
docker compose down
```

`down` preserves database data. **`docker compose down -v` permanently deletes this project's
database volume.** Do not use it for data you need.

### Why separate containers?

The long-running API and PostgreSQL run separately so their upgrades, restarts, resource limits,
and scaling are independent. The database has its own named persistent volume. A third,
short-lived `migrate` service uses the same API image, waits for PostgreSQL health, applies
migrations, and exits successfully before the API starts. An exited migration container with
code 0 is expected, not an error. Neither the image build nor API replicas run migrations.

Compose is a **local/single-host baseline**, not a complete production deployment. Both published
ports bind to loopback only. A real deployment should normally use a managed PostgreSQL service
or a separately operated database, and private networking. Do not combine the database and API
in the same container.

## Local Node development, PostgreSQL in Docker

```sh
cp .env.example .env  # first time only; do not overwrite your existing settings
nvm install
nvm use
npm ci
docker compose up -d db
npm run db:migrate
npm run dev
```

Stop the Compose API (`docker compose stop api`) before running the local API on the same port.
The Node process uses `DATABASE_URL` from `.env`, pointing at localhost. Compose builds its own
database URL pointing at hostname `db`. `npm start` runs without watch mode.

Alternatively install PostgreSQL locally, create a database/user, set `DATABASE_URL`, then run
the same migration and development commands; Docker is not required by the application itself.

If you change `POSTGRES_PORT`, also update the port in `DATABASE_URL` and `TEST_DATABASE_URL`.
If you change credentials, update the URLs too. Compose interpolates credentials into a URL;
use URL-safe development credentials. For hosted environments supply a properly encoded
`DATABASE_URL` via your secret manager instead. Changing PostgreSQL initialization variables
does not change users/passwords in an already initialized volume.

## Example requests

```sh
curl -i http://localhost:3000/api/v1/transactions \
  -H 'Content-Type: application/json' \
  -d '{"reference":"order-1001","amountMinor":"1099","currency":"USD","direction":"credit","description":"Example payment"}'

curl 'http://localhost:3000/api/v1/transactions?limit=20&offset=0'
# Use the id returned by POST in GET /api/v1/transactions/{id}.
```

| Method | Route                       | Purpose                                                   |
| ------ | --------------------------- | --------------------------------------------------------- |
| GET    | `/health/live`              | Process liveness                                          |
| GET    | `/health/ready`             | Database connectivity and transactions table availability |
| POST   | `/api/v1/transactions`      | Append a transaction                                      |
| GET    | `/api/v1/transactions`      | Bounded offset pagination, newest first                   |
| GET    | `/api/v1/transactions/{id}` | Read a transaction                                        |
| GET    | `/docs/`                    | Interactive Swagger UI when enabled                       |
| GET    | `/openapi.json`             | OpenAPI contract when enabled                             |

Amounts are **positive integer strings in minor units**, not floating point numbers. `"1099"`
represents USD 10.99; supported range is 1 through 999999999999999999. Credits/debits are explicit.
Currency validation enforces three uppercase letters only, not ISO membership or exponent rules.
References are unique and case-sensitive; duplicate submission returns 409, not a replayed success.
Append-only database triggers block UPDATE, DELETE and TRUNCATE. Database owners can disable
triggers: this is not cryptographic tamper-proofing. The example is **not** a double-entry ledger,
balance engine, settlement system, or complete financial product.

All errors use `{ "error": { "code", "message", "requestId", "details"? } }` except readiness,
which returns `{ "status": "unavailable" }`. Request IDs are generated server-side and exposed
in `X-Request-Id`. Unknown fields are rejected; JSON bodies are limited to 32 KB. SQL is parameterized.
No request bodies, arbitrary headers, or query strings are included in HTTP access logs.

## Tests and quality checks

```sh
npm run check  # ESLint, formatting, unit/API tests, OpenAPI validation
npm run format
```

Integration tests use real PostgreSQL, a separate database, and real migrations:

```sh
docker compose up -d db
docker compose exec db createdb -U ledger ledger_test  # once, defaults from .env.example
npm run test:integration
```

`TEST_DATABASE_URL` is required, its database name must end in `_test`, and it must differ from
the application database. Tests leave append-only records in this disposable database rather
than attempting destructive cleanup. To reset it, drop/recreate **only the test database**.
Integration tests cover migration repeatability, exact bigint serialization, persistence,
duplicate references, pagination, readiness, and database append-only/check constraints.
CI also builds the runtime image and audits production dependencies.

## Project layout

```text
src/
  app.js                 # app factory; no listening or connections at import time
  server.js              # startup, HTTP timeouts, graceful signal shutdown
  config.js              # validated environment configuration
  logger.js              # structured JSON logging
  errors.js              # consistent, non-leaking API errors
  db/pool.js             # connection pool and verified TLS options
  db/migrate.js          # transactional migrations + advisory lock + checksums
  transactions/          # request schemas, routes and SQL repository
migrations/              # ordered, immutable SQL migrations
docs/openapi.json        # API contract, also served to Swagger UI
test/unit/               # isolated API/configuration tests
test/integration/        # real PostgreSQL tests
```

Add new numbered SQL files to `migrations/`; never modify an already applied migration.
Each file and its checksum are recorded transactionally, and concurrent runners serialize
through a PostgreSQL advisory lock. Use forward corrective migrations, not automatic rollback.
Only transactional SQL is supported (e.g. do not use `CREATE INDEX CONCURRENTLY` in these files).

## Production checklist and deliberate boundaries

- **Add authentication and resource/tenant authorization before public exposure.** No fake JWT
  secret or permissive placeholder auth is included. CORS is a browser policy, not access control.
- Deploy behind HTTPS and a trusted gateway/load balancer. Set `TRUST_PROXY` to actual trusted
  proxy IPs/CIDRs only; the default trusts none. Restrict origins with `CORS_ORIGINS`.
- Set `DOCS_ENABLED=false`, rotate example passwords, use secret injection, and never commit `.env`.
- Use separate least-privilege runtime and migration DB roles in production. The Compose user
  is an initialization superuser for **local convenience only**. Runtime needs SELECT/INSERT on
  transactions; migration credentials need DDL privileges and should only exist in deployment jobs.
- Set `DB_SSL=true` for hosted PostgreSQL; optionally supply `DB_SSL_CA_FILE` with a trusted CA.
  Verification is never disabled. Do not place sslmode/sslcert/sslkey/sslrootcert in DATABASE_URL:
  node-postgres can replace explicit TLS configuration when those parameters are present.
- The rate limiter uses per-process memory, suitable for this single-process starter. For multiple
  replicas, enforce a shared limit at your gateway or implement a shared store. Health endpoints
  bypass the limiter; don't expose internal health endpoints unnecessarily.
- Offset pagination is intentionally simple and can shift under concurrent inserts. Move to
  keyset/cursor pagination for high-volume workloads. Design real idempotency and reconciliation
  semantics before processing financial operations.
- Configure backups, restore drills, monitoring/alerts, log retention/redaction, resource limits,
  dependency updates, vulnerability scans and incident procedures. Readiness checks schema
  availability, not migration version equality or write privileges.
- Runtime Docker image uses a non-root user, production dependencies, read-only filesystem,
  dropped capabilities, init process and health check. Pin tested image digests and CI action
  commit SHAs in your release process; major image tags here intentionally receive security updates.
- Graceful shutdown stops accepting requests, drains connections and closes the pool, with a
  15-second hard deadline. Compose allows 20 seconds before killing the process.

This starter provides production-oriented foundations, not a claim that an unauthenticated
example API is ready for public financial traffic.
