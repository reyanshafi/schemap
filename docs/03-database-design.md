# Schemap — Database Design

**Version:** 1.0 · **Date:** 2026-07-08 · **Status:** Draft for approval
**Phase 0, Document 3 of 3** (prev: `01-PRD.md`, `02-system-design.md`)

---

## 1. Conventions (apply to every table)

| Convention | Decision | Why |
|---|---|---|
| Primary keys | `text`, app-generated: `{prefix}_{22-char base62 of UUIDv7}` (e.g. `imp_6x9K…`, `ws_…`, `sch_…`, `key_…`) | One ID for DB, API, and logs (Stripe-style); UUIDv7 is time-ordered so B-tree inserts stay local |
| Tenancy | Every table carries `workspace_id` (even when derivable via FK) | The repository layer requires it in every query signature — isolation by construction, and a future partitioning key |
| Timestamps | `timestamptz` only, UTC; `created_at` default `now()`; `updated_at` set by the app layer | No naive timestamps, no trigger magic to debug |
| Status columns | `text` + `CHECK` constraint, not native enums | Adding/removing states is a constraint swap, not a type migration |
| Flexible shapes | `jsonb` validated by shared Zod schemas in `packages/core` (same schemas the API uses) | One source of truth; Postgres never guesses shape, the app guarantees it |
| Deletes | Control plane: soft (`archived_at` / `revoked_at`). Data plane (`import_rows`, files): hard, by the cleanup job per retention policy | Auditability where it matters, bounded growth where it hurts |
| FKs | `ON DELETE RESTRICT` everywhere; workspace deletion is an explicit offboarding job, never a cascade | A cascade from `workspaces` deleting live import history is not a failure mode we want to be possible |
| Migrations | Drizzle Kit — SQL migration files committed to the repo, applied on deploy before app start | Type-safe client shared via `packages/core`; `drizzle-zod` derives insert/select types from the same definitions |

**Not in Postgres (by design):** embed JWTs (stateless, 15-min expiry), rate-limit token buckets, live progress counters, and pub/sub — all Redis, all reconstructible. Postgres holds nothing that Redis is the master of, and vice versa.

## 2. Entity overview

```
users ──< workspace_members >── workspaces
                                   │ 1:N
        ┌──────────────┬───────────┼────────────┬──────────────────┐
        ▼              ▼           ▼            ▼                  ▼
    api_keys       schemas     uploads   webhook_endpoints     ai_calls
                      │ 1:N       │ 1:1       │ 1:N
                      ▼           ▼           ▼
                   imports ◄──────┘    webhook_deliveries ──< webhook_delivery_attempts
                      │ 1:N                   ▲
        ┌─────────────┼──────────────┐        │ (deliveries also FK → imports)
        ▼             ▼              ▼        │
  import_rows   import_events   ──────────────┘
   (staging)      (audit)

                   schemas ──< mapping_cache        workspaces ──< usage_counters
                   users ──< sessions
```

## 3. Control plane

### 3.1 `workspaces`

```sql
id                       text PK                    -- ws_…
name                     text NOT NULL
plan                     text NOT NULL DEFAULT 'free'   CHECK (plan IN ('free','starter','growth'))
embed_secret_ciphertext  bytea NOT NULL             -- signs embed JWTs; AES-256-GCM under MASTER_KEY env (KMS later)
retention_days           integer NOT NULL DEFAULT 7 -- raw-file + staging retention
ai_daily_call_limit      integer NOT NULL DEFAULT 500
created_at / updated_at  timestamptz
archived_at              timestamptz NULL
```

Rotating `embed_secret_ciphertext` invalidates all outstanding embed tokens — that is the revocation mechanism promised in the system design (§10).

### 3.2 `users`, `workspace_members`, `sessions`

```sql
users:              id text PK (usr_…) · email citext UNIQUE · password_hash text (argon2id)
                    · email_verified_at timestamptz NULL · created_at/updated_at
workspace_members:  PK (workspace_id, user_id) · role text CHECK (role IN ('owner','admin','member'))
                    · created_at            -- MVP creates only 'owner'; the table exists so P1 teams is additive
sessions:           id text PK (random 256-bit) · user_id FK · expires_at · created_at
                    -- server-side sessions: logout/compromise = DELETE row; cookie holds only the id
```

### 3.3 `api_keys`

```sql
id           text PK          -- key_…
workspace_id text FK
name         text NOT NULL    -- "Production", "CI"
mode         text NOT NULL CHECK (mode IN ('test','live'))
key_hash     bytea NOT NULL UNIQUE   -- sha256 of the raw key; raw shown exactly once at creation
last4        text NOT NULL           -- display hint in the dashboard
last_used_at timestamptz NULL        -- updated at most once/minute (write-throttled)
created_at   timestamptz · revoked_at timestamptz NULL
```

Auth path: hash the presented key → point lookup on `key_hash` → check `revoked_at IS NULL`. One indexed read per request; rate limiting stays in Redis.

### 3.4 `schemas` (target schemas)

```sql
id                 text PK        -- sch_…
workspace_id       text FK
key                text NOT NULL  -- "contacts"; UNIQUE (workspace_id, key)
name               text NOT NULL
version            integer NOT NULL DEFAULT 1   -- bumped on ANY change to fields/policies
fields             jsonb NOT NULL  -- ordered array: {key,label,type,required,unique,enum_values,examples,description}
validation_policy  text NOT NULL DEFAULT 'import_valid_only'
                   CHECK (validation_policy IN ('reject_file','import_valid_only','require_all_valid'))
duplicate_policy   text NOT NULL DEFAULT 'keep_first'
                   CHECK (duplicate_policy IN ('keep_first','keep_last','exclude_all','abort'))
default_phone_region text NULL    -- e.g. 'IN'; used by the E.164 transform
ai_samples_enabled boolean NOT NULL DEFAULT true  -- false = header-only privacy mode
created_at / updated_at · archived_at timestamptz NULL
```

**Why `fields` is jsonb, not a child table:** fields are always read and written as one ordered unit, never queried relationally; Zod (`packages/core`) validates the shape on write; and the `version` bump is the cache-invalidation signal for `mapping_cache`. A child table would buy joins we never make. Imports pin `schema_version` at creation, so editing a schema mid-import changes nothing retroactively. (P1 schema versioning = an immutable `schema_versions` snapshot table; additive.)

### 3.5 `webhook_endpoints`

```sql
id                 text PK      -- whe_…
workspace_id       text FK
mode               text NOT NULL CHECK (mode IN ('test','live'))
url                text NOT NULL          -- HTTPS enforced in live mode at the app layer
secret_ciphertext  bytea NOT NULL         -- HMAC signing secret; encrypted (must be recoverable, so not hashed)
active             boolean NOT NULL DEFAULT true
created_at / updated_at
```

## 4. Import pipeline (data plane)

### 4.1 `uploads`

```sql
id            text PK           -- upl_…
workspace_id  text FK
storage_key   text NOT NULL     -- object path in R2/MinIO
filename      text · byte_size bigint · declared_mime text
consumed_by_import_id text NULL -- set when POST /v1/imports claims it
delete_after  timestamptz NOT NULL   -- created + retention; orphans (never consumed) deleted after 24h
created_at    timestamptz
```

Exists separately from `imports` because presigned upload happens *before* import creation (system design §4 step 2) — this table is how the cleanup job finds abandoned files.

### 4.2 `imports` — the state machine row

```sql
id              text PK          -- imp_…
workspace_id    text FK · schema_id text FK · upload_id text FK UNIQUE
schema_version  integer NOT NULL          -- pinned at creation
end_user_org    text NULL                 -- from embed-token claim; powers per-org features later
status          text NOT NULL DEFAULT 'created' CHECK (status IN
                ('created','parsing','mapping','awaiting_review','validating',
                 'awaiting_confirm','importing','completed','failed',
                 'rolling_back','rolled_back','cancelled'))
failure_reason  jsonb NULL                -- {code, message, detail}

-- policies snapshotted from schema (SDK may override per-embed)
validation_policy text NOT NULL · duplicate_policy text NOT NULL

-- parse metadata
delimiter text NULL · encoding text NULL · headers jsonb NULL        -- array of source headers
column_samples jsonb NULL                 -- ≤5 values/column, 80-char truncated (preview + AI prompt)

-- mapping
proposed_mapping  jsonb NULL   -- AI/cache/fallback output incl. confidence + reason per column
confirmed_mapping jsonb NULL   -- what the human approved (may differ)
mapping_source    text NULL CHECK (mapping_source IN ('cache','ai','fallback'))

-- counters (Redis is live; flushed here on every state transition)
row_count integer · valid_count integer · invalid_count integer · excluded_count integer
delivered_count integer · accepted_count integer · rejected_count integer   -- all DEFAULT 0

-- crash-safe resume cursors (system design §5: jobs re-read state and continue)
last_parsed_row integer NOT NULL DEFAULT 0
last_validated_row integer NOT NULL DEFAULT 0
last_delivered_batch integer NOT NULL DEFAULT 0

error_summary    jsonb NULL    -- [{code, field, count}] for the summary screen
error_report_key text NULL     -- storage key of generated error CSV
created_at / updated_at · completed_at timestamptz NULL
```

Indexes:

```sql
(workspace_id, created_at DESC)                    -- dashboard import history
(status) WHERE status IN ('parsing','mapping','validating','importing','rolling_back')
                                                   -- partial: the reconciler cron scans only stuck/transient imports
```

### 4.3 `import_rows` — staging (the big table)

```sql
import_id     text NOT NULL           -- FK imports
row_no        integer NOT NULL        -- 1-based file order
workspace_id  text NOT NULL           -- tenancy rule, and future partition key
raw           jsonb NOT NULL          -- ARRAY of strings aligned to imports.headers by index
data          jsonb NULL              -- mapped+transformed object keyed by schema field key (set by validate)
status        text NOT NULL DEFAULT 'staged' CHECK (status IN
              ('staged','valid','invalid','excluded','delivered','accepted','rejected'))
errors        jsonb NULL              -- [{field, code, message}]
dedup_hash    bytea NULL              -- sha256 over normalized unique-field values
batch_no      integer NULL            -- assigned when packed for delivery (500 valid rows/batch)
edited        boolean NOT NULL DEFAULT false   -- true after an inline PATCH fix

PRIMARY KEY (import_id, row_no)
```

Design notes:

- **`raw` is a jsonb array, not an object** — aligned to `imports.headers` by position. Objects would corrupt files with duplicate or blank header names and store every header string 250k times.
- **Idempotent parse resume:** the parser upserts batches of 1,000 on the `(import_id, row_no)` PK — a retried parse job after a crash overwrites identical rows harmlessly.
- **No timestamps.** At 250k rows × 2 columns × 8 bytes that's pure waste; the import row and audit log carry all timing anyone needs.
- **Deliberately minimal indexes** (every index is a write amplification on the hottest table):

```sql
(import_id, status, row_no)                        -- error-table pagination, valid-row streaming,
                                                   -- pull-API keyset cursor
(import_id, dedup_hash) WHERE dedup_hash IS NOT NULL   -- in-file dup detection (window fn pass)
(import_id, batch_no)   WHERE batch_no IS NOT NULL     -- delivery + rollback batch reconstruction
```

- **Purge:** cleanup job hard-deletes in 10k-row batches by `import_id` once an import is terminal + retention elapsed. Autovacuum settings for this table get lowered `autovacuum_vacuum_scale_factor` (0.01) from day one. If churn outgrows this, the escape hatch is hash partitioning by `import_id` — the PK and every index above already lead with it, so partitioning is a mechanical migration, not a redesign.

Sizing sanity check: worst case 250k rows × ~1 KB raw+data ≈ 250–500 MB per max-size import, TOAST-compressed; 10 concurrent per workspace is comfortably within a small managed Postgres.

### 4.4 `import_events` — audit log

```sql
id          bigint GENERATED ALWAYS AS IDENTITY PK
import_id   text FK · workspace_id text
from_status text NULL · to_status text NOT NULL
actor       text NOT NULL CHECK (actor IN ('system','end_user','developer_api','dashboard'))
detail      jsonb NULL          -- e.g. {job:'parse', attempt:2} or {overridden_columns:[…]}
created_at  timestamptz

INDEX (import_id, id)
```

Every state transition writes here in the *same transaction* that updates `imports.status` — the audit trail cannot drift from reality.

### 4.5 `mapping_cache`

```sql
id               text PK        -- mc_…
workspace_id     text FK · schema_id text FK
schema_version   integer NOT NULL
header_signature text NOT NULL  -- sha256 hex of normalized (trim/lower/collapse-ws) headers, order-preserved
mapping          jsonb NOT NULL -- same shape as imports.confirmed_mapping
source           text NOT NULL CHECK (source IN ('ai','human'))   -- human overrides upgrade the entry
hit_count        integer NOT NULL DEFAULT 0
last_used_at     timestamptz · created_at / updated_at

UNIQUE (schema_id, schema_version, header_signature)
```

Lookup is one point read on the unique index. No TTL — a `schema_version` bump orphans old entries naturally (cleanup sweeps entries whose version no longer matches). When a human confirms a mapping that differs from the AI's, the worker upserts it here with `source='human'` — this is the "learns per workspace" behavior from the PRD (§6.3). P1's per-org "remember my mapping" adds `end_user_org` to the unique key; additive.

## 5. Delivery & observability

### 5.1 `webhook_deliveries` + `webhook_delivery_attempts`

Two tables because they answer different questions: *what should have arrived* vs *what happened each time we tried* — together they are the webhook debugger (system design §6).

```sql
webhook_deliveries:
id               text PK        -- whd_…
workspace_id     text · import_id text FK · endpoint_id text FK
type             text NOT NULL CHECK (type IN ('rows.batch','import.completed','import.rollback'))
batch_no         integer NULL   -- for rows.batch
idempotency_key  text NOT NULL  -- 'imp_x:12'; UNIQUE (endpoint_id, idempotency_key)
payload          jsonb NULL     -- inline ONLY for small events (completed/rollback);
                                -- rows.batch payloads are reconstructed from import_rows by (import_id, batch_no)
status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','failed','exhausted'))
attempt_count    integer NOT NULL DEFAULT 0 · next_retry_at timestamptz NULL
created_at / updated_at

INDEX (workspace_id, created_at DESC) · INDEX (import_id)

webhook_delivery_attempts:
id bigint IDENTITY PK · delivery_id text FK · attempt_no integer
response_status integer NULL · response_body text NULL   -- truncated to 4 KB
error text NULL · duration_ms integer · created_at

INDEX (delivery_id, attempt_no)
```

Consequence to document publicly: **redrive of `rows.batch` deliveries is possible only within the staging-retention window** (default 7 days), because batch payloads are rebuilt from `import_rows`, not stored twice. Rollback webhooks need only idempotency keys, which live here forever.

### 5.2 `ai_calls` — cost & margin tracking

```sql
id bigint IDENTITY PK · workspace_id text · import_id text FK
model text · input_tokens integer · output_tokens integer · latency_ms integer
outcome text CHECK (outcome IN ('ok','invalid_json_retried','fallback_used'))
created_at timestamptz

INDEX (workspace_id, created_at)   -- daily budget check = indexed count since midnight
```

### 5.3 `usage_counters` — billing metering (P1, table ships in MVP)

```sql
workspace_id text · period date   -- first of month; PK (workspace_id, period)
rows_imported bigint DEFAULT 0 · imports_completed integer DEFAULT 0
```

Incremented in the same transaction that marks an import `completed` — metering can never disagree with the audit log. Stripe reporting (P1) reads from here.

## 6. Queries the design must serve (index justification)

| Hot query | Served by |
|---|---|
| Auth an API request | `api_keys.key_hash` unique index — 1 point read |
| Mapping cache hit | `mapping_cache (schema_id, version, signature)` unique — 1 point read |
| Reconciler: find stuck imports | partial index on `imports.status` (transient states only — index stays tiny) |
| Error table, grouped + paginated | `import_rows (import_id, status, row_no)` + `imports.error_summary` for the group counts |
| Stream valid rows into batches | same `(import_id, status, row_no)` index, keyset pagination — no OFFSET |
| Pull-API cursor fetch | same index (`status='valid' AND row_no > $cursor ORDER BY row_no LIMIT n`) |
| Rollback: list delivered batches | `webhook_deliveries (import_id)` where `type='rows.batch' AND status='succeeded'` |
| Dashboard import history | `imports (workspace_id, created_at DESC)` |
| Redrive a delivery | rebuild payload via `import_rows (import_id, batch_no)` partial index |

## 7. Retention & cleanup matrix

| Data | Kept | Deleted by |
|---|---|---|
| Raw files (object storage) | `retention_days` (default 7) | cleanup job via `uploads.delete_after` |
| Orphan uploads (never became imports) | 24 h | cleanup job |
| `import_rows` staging | terminal status + `retention_days` | cleanup job, batched deletes |
| `imports`, `import_events`, `webhook_deliveries(+attempts)`, `ai_calls` | indefinitely (audit trail; rows are small) | workspace offboarding job only |
| `mapping_cache` | until `schema_version` orphaned | cleanup sweep |
| `sessions` | until `expires_at` | cleanup job |

## 8. Explicitly deferred (with the seam already cut)

| Deferred | Seam that makes it additive |
|---|---|
| Hash-partition `import_rows` | every index already leads with `import_id` |
| `schema_versions` immutable snapshots (P1) | imports already pin `schema_version` |
| Per-org mapping memory (P1) | add `end_user_org` to `mapping_cache` unique key |
| Team roles beyond owner (P1) | `workspace_members.role` already exists |
| Read replicas for dashboard queries | all dashboard reads are already index-only patterns, no session state in Postgres |
| Postgres RLS as a second isolation layer | `workspace_id` is already on every table |
