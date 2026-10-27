# REST API Starter

Simple JavaScript REST API using Express and PostgreSQL. There are no transaction models,
business rules, database tables, or migrations yet. Those will be added with your requirements.

## Endpoints

| Method | Path              | Response                                      |
| ------ | ----------------- | --------------------------------------------- |
| GET    | `/health`         | `{ "status": "ok", "database": "connected" }` |
| GET    | `/api/v1/starter` | `{ "message": "API is ready" }`               |

The health check runs `SELECT 1` against PostgreSQL. It returns HTTP 503 if the database is
unavailable. The starter endpoint does not depend on the database. The server can start while
PostgreSQL is unavailable, so the health endpoint can report the problem.

Swagger UI: `http://localhost:3000/docs/`.
OpenAPI JSON: `http://localhost:3000/openapi.json`.

## Run everything in Docker

```sh
cp .env.example .env # first time only; keep existing settings
docker compose up --build -d --remove-orphans
curl http://localhost:3000/health
curl http://localhost:3000/api/v1/starter
```

API and PostgreSQL use separate containers. The database uses a persistent named volume.

```sh
docker compose logs -f api
docker compose down # preserves database data
```

**`docker compose down -v` deletes database data.** Removing the old transaction code does not
delete tables or records from an existing database. A fresh database starts without business tables.

## Run Node locally

Use Node 24 and Docker Desktop. Node 22.0.0 is too old for the env-file loader used here.

```sh
cp .env.example .env # first time only
nvm install
nvm use
npm ci
docker compose stop api # free port 3000 if necessary
docker compose up -d db
npm run dev
```

No migration step is needed. You can also install PostgreSQL locally and update `DATABASE_URL`.
`npm run dev` watches files; `npm start` runs normally.

## Debug

In VS Code, set a breakpoint and select **Run and Debug → Debug API**.
Alternatively use `npm run debug` and attach to port 9229. Keep the debugger local only.

```text
src/server.js       starts and stops the server
src/app.js          health and starter handlers, middleware and docs
src/config.js       environment validation
src/db/pool.js      PostgreSQL connection pool
src/errors.js       shared error handling
src/logger.js       structured logs
docs/openapi.json   API documentation
```

## Configuration

`.env.example` contains local defaults. `DATABASE_URL` is required. Optional settings:

- `PORT`: 3000 by default.
- `LOG_LEVEL`: info by default.
- `DOCS_ENABLED`: defaults off in production; enabled in the local example.
- `CORS_ORIGINS`: optional comma-separated browser origins.
- `DB_SSL`: true for verified database TLS; false locally.
- `DB_SSL_CA_FILE`: optional trusted CA certificate file.
- `TEST_DATABASE_URL`: connection string used by integration tests.

Compose uses `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` and `POSTGRES_PORT`.
If you change them, update local connection URLs too. Existing database volumes keep their
original credentials. Use URL-safe development credentials. Do not commit `.env`.

## Tests

```sh
npm run check # lint, formatting, API tests and OpenAPI validation
npm run format

docker compose up -d db
docker compose exec db createdb -U ledger ledger_test # once, using default local credentials
npm run test:integration
```

Integration tests only check connectivity and responses; they create no tables or records.

Before public deployment, add authentication/authorization, HTTPS, production secrets, backups,
and monitoring. CORS is not access control. The basic API limiter is per-process (100 requests
per minute per client IP); configure trusted proxies and gateway limits for your deployment.
