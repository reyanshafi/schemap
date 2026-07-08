# Schemap — System Design

**Version:** 1.0 · **Date:** 2026-07-08 · **Status:** Draft for approval
**Phase 0, Document 2 of 3** (prev: `01-PRD.md`, next: `03-database-design.md`)

---

## 1. Design principles

1. **Streaming-only.** No component ever loads a whole file into memory. Files flow as streams: upload → object storage → parser → batched DB writes.
2. **Queue-first.** Anything that can take more than ~1 second (parsing, AI calls, validation, delivery) runs as a background job. HTTP requests only enqueue and query.
3. **Idempotent everywhere.** Every job and every webhook can be retried safely; duplicates are detected by keys, not by hope.
4. **The database is the source of truth.** Import state lives in Postgres, not in worker memory — a worker crash loses nothing.
5. **Multi-tenant from day one.** Every row carries `workspace_id`; API keys are scoped; no cross-tenant reads are possible by construction.

## 2. High-level architecture

```
                       ┌────────────────────────────────────────────────┐
                       │                 HOST SAAS APP                  │
                       │  ┌──────────────────────┐   ┌───────────────┐  │
                       │  │ <SchemapImporter/>   │   │ Host backend  │  │
                       │  │  (React SDK)         │   │               │  │
                       │  └─────────┬────────────┘   └───┬───────▲───┘  │
                       └────────────┼────────────────────┼───────┼──────┘
                              (2) uploads,          (1) mint     │ (7) webhooks:
                              mapping, progress     embed token  │ rows / rollback
                                    │                    │       │
┌───────────────────────────────────▼────────────────────▼───────┼─────────────┐
│ SCHEMAP CLOUD                     API SERVICE (Express)        │             │
│                    auth · embed tokens · REST · SSE progress   │             │
│                                        │ enqueue jobs          │             │
│        ┌───────────────┬───────────────┼──────────────┬────────┴──┐          │
│        ▼               ▼               ▼              ▼           │          │
│   ┌─────────┐    ┌──────────┐    ┌───────────────────────────────────────┐   │
│   │ Postgres│    │  Redis   │    │            WORKER SERVICE             │   │
│   │ control │    │ BullMQ   │◄──►│  parse → map → validate → import →    │   │
│   │ plane + │    │ queues + │    │  webhook-delivery → cleanup           │   │
│   │ staging │    │ progress │    │  (one process, many queue consumers)  │   │
│   │  rows   │    │ + cache  │    └───────┬──────────────────┬────────────┘   │
│   └─────────┘    └──────────┘            │                  │                │
│        ▲                                 ▼                  ▼                │
│        │                        ┌───────────────┐   ┌──────────────┐         │
│        └────────────────────────│ Object storage│   │  Claude API  │         │
│                                 │ (R2/S3; MinIO │   │ (AI mapping) │         │
│   ┌──────────────────────┐      │  in dev)      │   └──────────────┘         │
│   │ DASHBOARD (Next.js)  │      └───────────────┘                            │
│   │ schemas · keys ·     │                                                   │
│   │ history · webhooks   │                                                   │
│   └──────────────────────┘                                                   │
└───────────────────────────────────────────────────────────────────────────────┘
```

**Two deployable backend units** (same TypeScript monorepo, two entrypoints):
- **API service** — stateless HTTP. Scales horizontally.
- **Worker service** — BullMQ consumers. Scales horizontally; concurrency configured per queue.

## 3. Monorepo layout

```
schemap/
├── apps/
│   ├── api/          # Express REST API + SSE
│   ├── worker/       # BullMQ queue consumers
│   └── dashboard/    # Next.js developer dashboard
├── packages/
│   ├── core/         # shared: db client, schema types, validation engine, transforms
│   ├── ai/           # Claude client, mapping prompts, response parsing, cache
│   └── react/        # @schemap/react — the embeddable importer (published to npm)
├── docs/
└── docker-compose.yml  # postgres + redis + minio for local dev
```

## 4. Lifecycle of an import (the heart of the system)

Import state machine (persisted on the `imports` row; every transition is audit-logged):

```
created ──► parsing ──► mapping ──► awaiting_review ──► validating ──► awaiting_confirm
                                                                            │
              ┌─────────────────────────────────────────────────────────────┘
              ▼
         importing ──► completed
              │
              ├──► failed ──► rolling_back ──► rolled_back
              └──► cancelled (user abort; triggers rollback if rows were delivered)
```

Step by step:

1. **Token** — Host backend calls `POST /v1/embed-tokens` with its secret API key → gets a 15-min JWT scoped to `{workspace, schema, end_user_org}`. The browser never sees the API key.
2. **Upload** — SDK requests a presigned upload URL; the browser streams the file **directly to object storage** (never through our API — keeps API stateless and cheap). SDK then calls `POST /v1/imports` → import row created (`created`), `parse` job enqueued.
3. **Parse (worker)** — streams the file from storage through a CSV parser: detects delimiter/encoding, extracts headers + per-column sample values, writes rows into the `import_rows` staging table in batches of 1,000. Updates progress counters in Redis as it goes. → `mapping`.
4. **Map (worker)** — computes header-signature hash; on cache hit reuses stored mapping (no AI call). Otherwise sends schema definition + headers + samples to Claude, gets `{field, confidence, reason}` per column, validates the JSON strictly. If the AI is unreachable, falls back to string-similarity matching with low confidence. → `awaiting_review`.
5. **Review (human)** — end user confirms/overrides mapping in the widget. `POST /v1/imports/:id/mapping` → `validating`.
6. **Validate (worker)** — streams staging rows in batches; applies transforms (trim, date→ISO, phone→E.164…), then field validations and in-file dedup (normalized hash on unique fields). Writes per-row status + error reasons back to staging. → `awaiting_confirm` with an error summary.
7. **Confirm (human)** — user fixes/excludes rows per policy, confirms. → `importing`.
8. **Import (worker)** — reads *valid* staging rows in order, packs batches of 500, delivers each as a signed webhook (below). Host responds per-row accept/reject. Progress streams to the widget via SSE. All batches done → `completed`; error CSV generated into storage.
9. **Rollback** — on mid-import failure or user cancel: state → `rolling_back`; Schemap sends a `rollback` webhook listing every delivered batch's idempotency key; host undoes them; → `rolled_back`.
10. **Cleanup (scheduled job)** — deletes raw files after retention (7 days) and purges staging rows of finished imports.

## 5. Queue topology (BullMQ on Redis)

| Queue | Job | Concurrency/worker | Retries (backoff) | Notes |
|---|---|---|---|---|
| `parse` | parse one file | 2 | 3 (exp, 10s base) | CPU/IO heavy — low concurrency |
| `map` | AI mapping call | 5 | 3 (exp, 5s) | rate-limit aware; cache-first |
| `validate` | validate one import | 2 | 3 (exp, 10s) | resumable via last-processed row cursor |
| `deliver` | deliver ONE batch | 10 | 5 (exp, 30s, max 1h) | idempotency key = `importId:batchNo` |
| `rollback` | send rollback webhook | 5 | 5 (exp, 30s) | must eventually succeed; alerts on exhaustion |
| `cleanup` | purge files/rows | 1 | 2 | cron-scheduled |

Job IDs are deterministic (e.g. `parse:{importId}`) so accidental double-enqueues collapse into one job. Every job re-reads import state from Postgres on start and no-ops if the state already moved on (crash-safe resume).

## 6. Webhook delivery contract

```
POST {host_webhook_url}
X-Schemap-Signature: t=1720444800,v1=hex(hmac_sha256(secret, t + "." + body))
{
  "type": "rows.batch",            // or "import.completed", "import.rollback"
  "import_id": "imp_9f3k...",
  "batch_no": 12,
  "idempotency_key": "imp_9f3k:12",
  "rows": [ { "_row": 5501, "name": "...", "mobile": "+91..." }, ... ]
}
→ host responds 200 with per-row results: { "results": [ {"_row":5501,"status":"ok"}, ... ] }
```

- **At-least-once** delivery; hosts must dedupe on `idempotency_key` (we provide copy-paste middleware for Express/Fastify/Next in the docs).
- Signature scheme is Stripe-style (timestamp + HMAC-SHA256, 5-min tolerance) — familiar to every developer.
- Non-2xx or timeout (30s) → retry with backoff; after 5 failures the import is marked `failed` → rollback flow starts.
- Every attempt is stored in a `webhook_deliveries` log, viewable + redrivable from the dashboard (this is the "webhook debugger" — a real adoption feature).
- **Pull mode alternative:** hosts that can't receive webhooks poll `GET /v1/imports/:id/rows?cursor=...` for validated rows and ack them.

## 7. AI mapping design (packages/ai)

- **Model:** Claude Haiku 4.5 (cheap, fast, structured-output capable). One call per *new* header signature.
- **Prompt inputs:** target schema (keys, types, labels, descriptions, examples) + source headers + up to 5 sample values per column (samples excluded in header-only privacy mode).
- **Output (strict JSON, zod-validated):** `[{source: "Reach Number", field: "mobile", confidence: 0.93, reason: "phone-like values with +91 prefix"}]`. Invalid JSON → one retry with error feedback → fallback to string-similarity.
- **Cache:** key = `sha256(schemaId + schemaVersion + normalizedHeaders)`, stored in Postgres (`mapping_cache`), TTL none (schema version invalidates). Confirmed human overrides update the cache so the system "learns" per workspace.
- **Cost guard:** samples truncated to 80 chars; per-workspace daily AI-call budget; token usage recorded per import for margin tracking.

## 8. API surface (v1, REST)

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /v1/embed-tokens` | API key | Mint short-lived widget JWT |
| `POST /v1/uploads` | Embed JWT | Get presigned upload URL |
| `POST /v1/imports` | Embed JWT | Create import from uploaded file |
| `GET /v1/imports/:id` | JWT or key | State, counts, error summary |
| `GET /v1/imports/:id/preview` | Embed JWT | Headers + first 100 rows + suggested mapping |
| `POST /v1/imports/:id/mapping` | Embed JWT | Confirm/override mapping |
| `PATCH /v1/imports/:id/rows/:rowNo` | Embed JWT | Inline-fix a row |
| `POST /v1/imports/:id/confirm` | Embed JWT | Start import after validation |
| `POST /v1/imports/:id/cancel` | JWT or key | Cancel (+ rollback if needed) |
| `GET /v1/imports/:id/events` | Embed JWT | **SSE** progress stream |
| `GET /v1/imports/:id/error-report` | JWT or key | Presigned URL of error CSV |
| `GET /v1/imports/:id/rows` | API key | Pull-mode row fetch (cursor) |
| `GET/POST/PATCH /v1/schemas...` | API key | Schema CRUD (dashboard uses this too) |
| `GET /v1/webhook-deliveries...` | API key | Delivery log + redrive |

Errors follow one envelope: `{ "error": { "code": "invalid_mapping", "message": "...", "details": [...] } }`.

## 9. Progress tracking

Workers `INCR` Redis counters (`import:{id}:processed`, `:failed`, `:delivered`) and publish state changes on a Redis pub/sub channel. The API's SSE endpoint subscribes and forwards to the widget; a 2s polling fallback covers proxies that break SSE. Counters flush to Postgres on each state transition (Redis is a cache here, never the source of truth).

## 10. Security

- API keys: `sk_live_…`/`sk_test_…`, stored **hashed** (SHA-256), shown once at creation; per-key rate limits (token bucket in Redis).
- Embed JWTs: 15-min expiry, scoped claims `{ws, schema, org}`, signed with workspace-specific secret; revocable by key rotation.
- Files: private buckets, presigned URLs (10-min), server-side encryption, auto-delete after retention; MIME/extension and size checks before parse; CSV-injection sanitization (`=`, `+`, `-`, `@` prefixes) on error-report generation.
- Webhooks: HMAC signatures (above); host webhook URLs must be HTTPS in live mode; SSRF guard — resolved IPs must be public (no RFC-1918/loopback/metadata targets).
- Tenant isolation: every query filtered by `workspace_id` via a repository layer that requires it in its function signatures (compile-time enforcement, not discipline).
- Dashboard auth: email+password (argon2) + session cookies (MVP); OAuth/SSO later.

## 11. Environments & deployment

| | Local dev | Production (MVP) |
|---|---|---|
| API + Worker | `npm run dev` (two processes) | Railway/Render: 1 API instance + 1 worker instance (scale count later) |
| Postgres | docker-compose | Managed Postgres (Railway/Neon) |
| Redis | docker-compose | Managed Redis (Railway/Upstash) |
| Object storage | MinIO in docker-compose | Cloudflare R2 (S3 API, free egress) |
| Dashboard | `npm run dev` | Vercel |
| CI/CD | — | GitHub Actions: lint, typecheck, tests, docker build, deploy on main |

The self-hosted edition (P2) is the same `docker-compose.yml` shape with all services pinned — designing dev like prod-in-miniature from day one is what makes self-hosting cheap to offer later.

## 12. Failure modes & answers

| Failure | Behavior |
|---|---|
| Worker crashes mid-parse | Job retries; parser resumes from batch cursor stored in Postgres (row batches are idempotent upserts keyed by row number) |
| Claude API down | Retry ×3 → string-similarity fallback mapping flagged low-confidence → human review catches it |
| Host webhook down mid-import | 5 retries/batch over ~1h → import `failed` → rollback webhooks (retried until delivered; alert + manual redrive if exhausted) |
| Redis lost | Queues rebuild from Postgres state (jobs re-enqueued by a reconciler cron that finds imports stuck in transient states) |
| Duplicate webhook delivery | Host dedupes on idempotency key (documented contract + provided middleware) |
| Malicious file (zip bomb / 10GB CSV / binary) | Size caps at presign time, content sniffing at parse start, row cap aborts with clear error |
| End user closes browser mid-import | Import continues server-side; host app can query state; widget resumes on reopen (import id in host session) |

## 13. Technology choices — rationale

| Choice | Why |
|---|---|
| Express 5 (not Fastify) | Team familiarity, largest middleware ecosystem, every integrating developer knows it; perf difference is irrelevant at our request rates (heavy work is in workers). Zod middleware supplies the validation Fastify would have given us |
| BullMQ (not Kafka/RabbitMQ) | Right-sized: Redis already present, delayed jobs + retries + rate limiting built in; Kafka is overkill at this scale |
| Postgres staging rows (not re-reading the file) | Enables the review/fix UI, resumable validation, per-row status — the file becomes read-once |
| SSE (not WebSockets) | One-directional progress needs no bidirectional channel; SSE survives proxies better and is trivial to serve |
| Presigned direct-to-storage uploads | API stays stateless; no 100MB bodies through Node; free bandwidth on R2 |
| npm workspaces monorepo | SDK, API, worker share `packages/core` types — one source of truth for schema/validation logic; npm is zero extra tooling |
| Zod everywhere | Same validation definitions serve API input checking and import field validation |
