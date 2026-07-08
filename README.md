# Schemap

The embeddable, AI-powered data import layer for SaaS products. Developers install a React
component and an API; their customers upload any messy CSV/Excel file, and Schemap maps,
validates, cleans, and delivers the data to the host app — with progress tracking, error
reports, and rollback.

> Stripe made payments a 10-line integration. Schemap makes data import a 10-line integration.

Design docs: [PRD](docs/01-PRD.md) · [System design](docs/02-system-design.md) · [Database design](docs/03-database-design.md)

## Layout

```
apps/
  api/         Express REST API + SSE progress
  worker/      BullMQ queue consumers (parse → map → validate → deliver → …)
  dashboard/   Next.js developer dashboard
packages/
  core/        Drizzle schema + db client, shared types/constants, queue topology
  ai/          Claude column-mapping client (Haiku 4.5, structured outputs)
  react/       @schemap/react — the embeddable importer widget
```

## Local development

Requirements: Node ≥ 20, Docker Desktop.

```sh
cp .env.example .env         # defaults already match docker-compose
docker compose up -d          # Postgres + Redis + MinIO (+ bucket bootstrap)
npm install
npm run db:migrate            # apply migrations to the local Postgres
npm run dev                   # api :4000, worker, dashboard :3000
```

Useful:

```sh
npm run typecheck             # tsc across every workspace
npm run db:generate           # regenerate migrations after editing packages/core/src/db/schema.ts
```
