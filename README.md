# Transaction Ledger API

A Node.js, Express and PostgreSQL API for accounts, credits, debits, transaction history
and atomic transfers. JavaScript uses CommonJS (`require` / `module.exports`).

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

## Deploy on Render

- [Render dashboard](https://dashboard.render.com/)
- [Docker deployment guide](https://render.com/docs/docker)
- [PostgreSQL setup guide](https://render.com/docs/postgresql-creating-connecting)

1. Push the repository to GitHub and create a **Render PostgreSQL** database.
2. Create a **Web Service** from this repository using the **Docker** runtime.
3. Keep the service and database in the same region. Use the root `Dockerfile`.
4. Set the environment variables below and the health check path to `/health`.
5. **Leave Docker Command empty** — the Dockerfile runs migrations before starting the API.
6. Deploy and check the service logs if startup fails.

| Variable       | Value                                       |
| -------------- | ------------------------------------------- |
| `DATABASE_URL` | Render PostgreSQL **Internal Database URL** |
| `NODE_ENV`     | `production`                                |
| `DOCS_ENABLED` | `true` to enable Swagger and OpenAPI        |
| `LOG_LEVEL`    | `info`                                      |

Render supplies `PORT`. Local `POSTGRES_*` variables and `TEST_DATABASE_URL` are not needed.
For external database connections, enable verified TLS with `DB_SSL=true`; see `.env.example`.
Never publish database URLs or credentials.

### Live service links

Your public service URL is shown in the Render dashboard. **The URL below is an example;
replace it with your deployed service URL.**

| Resource                            | Example URL                                           |
| ----------------------------------- | ----------------------------------------------------- |
| API base URL (also used in Postman) | `https://your-service-name.onrender.com`              |
| Health check                        | `https://your-service-name.onrender.com/health`       |
| Swagger UI                          | `https://your-service-name.onrender.com/docs/`        |
| OpenAPI specification               | `https://your-service-name.onrender.com/openapi.json` |

The health check should return `{"status":"ok","database":"connected"}`.

## Before real-world use

**Authentication and account ownership checks are not implemented. Use test data only.**
Add access control, production secrets, backups and monitoring before handling real accounts.
The API rate limit is 100 requests per minute per client IP; wait before retrying a `429` response.
Keep applied migrations unchanged; add new migration files for schema changes.
