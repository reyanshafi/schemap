# Schemap — Product Requirements Document (PRD)

**Version:** 1.0 · **Date:** 2026-07-08 · **Status:** Draft for approval
**Phase 0, Document 1 of 3** (next: `02-system-design.md`, `03-database-design.md`)

---

## 1. One-liner

**Schemap is the embeddable, AI-powered data import layer for SaaS products.** Developers install a React component and an API; their customers upload any messy CSV/Excel file, and Schemap maps, validates, cleans, and delivers the data to the host app — with progress tracking, error reports, and rollback.

> Stripe made payments a 10-line integration. Schemap makes data import a 10-line integration.

---

## 2. Problem

Every B2B SaaS (CRM, HRMS, ERP, accounting, education, healthcare…) is eventually asked: *"Can I import my existing data?"* Each customer's file is different — `Name / Email / Phone` vs `Customer Name / Mobile Number / Email Address` vs a Salesforce export. Teams burn ~2 months building an in-house importer of hardcoded column-name conditions that still breaks, then maintain it forever.

The AI column-mapping is only ~20% of the pain. The other 80% is the pipeline nobody wants to build: streaming large files, validation, duplicate detection, background jobs with progress, human-readable error reports, and rollback when row 48,000 of 50,000 fails.

## 3. Positioning

Competitors exist (Flatfile, OneSchema, Nuvo, Dromo, CSVBox) — the market is validated. Schemap wins on three deliberate wedges:

1. **AI-native** — mapping, transform suggestions, and fix suggestions are LLM-powered from day one, not retrofitted fuzzy matching.
2. **Priced for indie/SMB SaaS** — a generous free tier and plans a bootstrapped founder can afford; incumbents price for enterprise.
3. **Self-hostable (post-MVP)** — a `docker compose up` deployment for hospitals, fintech, HR platforms that legally cannot send customer data to a third-party cloud.

## 4. Users & personas

| Persona | Who | What they need |
|---|---|---|
| **Integrating developer** ("Deepak", full-stack dev at a 5-person CRM startup) | Our *user & buyer*. Installs Schemap. | Working import flow in <30 min; clear docs; predictable webhook payloads; never think about importers again. |
| **End user** ("Priya", ops manager at the CRM's customer) | Uses the import wizard inside the host app. | Upload file → see it understood correctly → fix a few errors → done. No CSV knowledge required. |
| **Buyer/decider** (founder/CTO of the host SaaS) | Approves the vendor. | Price, data-privacy answers, reliability, easy migration off in-house code. |

## 5. Product scope — the import pipeline

Every import runs this pipeline. Each stage is a feature area:

```
Upload → Parse/Preview → AI Mapping → Human Review → Validation →
Duplicate Detection → Transform → Import (background) → Progress →
Result + Error Report → (Rollback on failure)
```

## 6. Features & priorities

**P0 = MVP (phases 1–7) · P1 = fast-follow at launch (phase 8) · P2 = post-launch**

### 6.1 File intake
- **P0** CSV upload (drag-drop + file picker), UTF-8/BOM handling, delimiter auto-detect (`,` `;` `\t` `|`), streaming parse (constant memory regardless of file size), preview of headers + first 100 rows. Limits: 100 MB / 250k rows per import.
- **P1** XLSX (first sheet + sheet picker), gzip'd CSV.
- **P2** Google Sheets URL, JSON/NDJSON, header-less files, multi-file imports.

### 6.2 Target schema (defined by the integrating developer)
- **P0** Schema = named fields with: key, label, type (`string, number, boolean, date, email, phone, enum, custom-regex`), required flag, unique flag, enum values, examples/description (fed to the AI). Defined via dashboard UI **and** JSON in SDK config; dashboard is source of truth, SDK can override per-embed.
- **P1** Multiple schemas per workspace, schema versioning.
- **P2** Conditional/dependent fields, nested objects.

### 6.3 AI mapping (Claude)
- **P0** Send headers + up to 5 sample rows per column (configurable, can be disabled for privacy) → Claude returns per-field mapping with confidence score (0–1) and reasoning. Confidence ≥0.9 auto-selected, 0.6–0.9 flagged "please confirm", <0.6 left unmapped. Unmapped source columns can be ignored or routed to a catch-all field. Mapping decisions cached per (workspace, header-signature) so repeat files skip the AI call.
- **P1** AI-suggested transforms ("these dates are DD/MM/YYYY", "phone numbers missing +91 country code — add?").
- **P2** AI fix suggestions for failed rows; learn from the workspace's past manual corrections.

### 6.4 Human review (end-user step)
- **P0** Mapping review table: source column → detected field, confidence badge, dropdown to remap, sample values shown. User must confirm before proceeding.
- **P1** "Remember my mapping" per end-user organization.

### 6.5 Validation
- **P0** Per-field validation from schema (type, format, required, enum, regex); per-row results; error table grouped by error type ("214 rows: invalid email"); user options: fix inline (edit cell), exclude bad rows, or abort. Configurable policy: `reject-file | import-valid-only | require-all-valid`.
- **P1** Cross-field rules (e.g. `end_date > start_date`); custom validation via developer webhook (Schemap calls host app to validate a batch).
- **P2** AI bulk-fix ("normalize all 3,000 dates").

### 6.6 Duplicate detection
- **P0** In-file duplicates on schema fields marked `unique` — exact match after normalization (trim/case/phone normalization). Options: keep-first, keep-last, exclude-all, abort.
- **P1** Duplicates vs. host app's existing data via developer-provided lookup endpoint or pre-uploaded key list.
- **P2** Fuzzy dedup ("Jon Smith" ≈ "John Smith").

### 6.7 Transform
- **P0** Built-in transforms applied at import: trim, case normalization, date parsing → ISO 8601, phone → E.164 (default region configurable), number parsing (locale separators), enum value coercion via AI mapping of values (e.g. "Y/Yes/TRUE" → `true`).
- **P1** Developer-defined transform functions (JS snippet, sandboxed) and value-mapping tables.

### 6.8 Import execution & delivery
- **P0** Background jobs (queue + workers), batched delivery to host app via **webhook** (signed HMAC, batches of ~500 rows, ordered, retried with exponential backoff, idempotency keys). Host app responds per-row accept/reject; rejects join the error report. Alternative **pull API** (host fetches clean rows). Live progress (SSE/polling): % complete, rows ok/failed. Import statuses: `pending → parsing → mapping → review → validating → importing → completed | failed | rolled_back | cancelled`.
- **P0 Rollback:** if the import fails mid-way (or dev/end-user aborts), Schemap sends a rollback webhook with the idempotency keys of delivered batches so the host can undo; imports are all-or-nothing from the end-user's perspective when policy is `require-all-valid`.
- **P1** Concurrency controls per workspace; scheduled/recurring imports.

### 6.9 Results & error report
- **P0** Summary screen (imported / skipped / failed counts), downloadable error CSV = original rows + `error_reason` column so the end user can fix and re-upload just the failures.

### 6.10 Embeddable React component (`@schemap/react`)
- **P0** `<SchemapImporter token={...} schema="contacts" onComplete={...} />` — full wizard (upload → mapping → errors → progress → done), themable (colors, radius, logo, light/dark), all states handled. Auth via short-lived embed token minted by host backend.
- **P1** Headless hooks API for fully custom UI; vanilla JS embed.
- **P2** Vue/Svelte wrappers.

### 6.11 Developer dashboard
- **P0** Email+password auth, workspace, API keys (test/live), schema builder, import history with drill-down (per-import log, error report), webhook config + delivery log with redrive.
- **P1** Team members/roles, usage & billing page.

### 6.12 Platform
- **P0** REST API (everything the component does is public API), API key auth, rate limits, multi-tenant isolation, uploaded files encrypted at rest and auto-deleted after 7 days (configurable), full import audit log.
- **P1** Stripe billing + metering (rows imported/month), status page.
- **P2** Self-hosted Docker distribution (license key), SOC2 groundwork, EU data residency.

## 7. Primary user flows

**Developer integration (target: <30 minutes):** sign up → create schema in dashboard (or paste JSON) → get API keys → `npm install @schemap/react` → backend mints embed token → drop `<SchemapImporter/>` in their app → receive webhook batches → done.

**End-user import:** click "Import" in host app → wizard opens → upload CSV → see preview → confirm/adjust AI mapping → review validation errors (fix/exclude) → confirm → watch progress → summary + error CSV download.

## 8. Non-functional requirements

- **Scale (MVP):** 100 MB / 250k rows per file; 10 concurrent imports per workspace; parsing at streaming constant memory; 100k rows imported ≤ 10 min end-to-end.
- **Reliability:** no data loss once upload succeeds; webhook delivery at-least-once with idempotency keys; workers resume after crash/restart.
- **Security/privacy:** TLS everywhere; files encrypted at rest; auto-delete after retention window; AI calls send only headers + small samples (opt-out available → header-only mapping); no training on customer data; per-workspace data isolation.
- **AI cost ceiling:** mapping cost per import ≤ $0.01 (Claude Haiku 4.5 tier, header+sample prompt, cached by header signature).

## 9. Out of scope (MVP)

XLSX (P1), dedup vs. existing data (P1), fuzzy dedup, self-hosting (P2), non-React SDKs, Google Sheets, SSO/SAML, on-prem compliance certs, migrating *between* SaaS products (future premium: "import from Salesforce/HubSpot" switch-kits).

## 10. Pricing sketch (validated later, not a Phase 0 blocker)

| Plan | Price | Included |
|---|---|---|
| Free | $0 | 2,000 rows/mo, 1 schema, Schemap badge on widget |
| Starter | $29/mo | 50k rows/mo, 5 schemas, no badge |
| Growth | $99/mo | 500k rows/mo, unlimited schemas, priority webhooks |
| Self-hosted | $ TBD /yr | Post-launch |

## 11. Success metrics

- Developer time-to-first-successful-import < 30 min (measured from signup).
- ≥ 90% of AI-suggested mappings accepted without change on real-world files.
- Import success rate ≥ 99% (excluding user-aborted).
- 10 external integrating developers within 60 days of launch.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Incumbents add identical AI features | Compete on price tier + self-host wedge, not AI alone |
| LLM mis-maps silently → corrupt customer data | Confidence thresholds + mandatory human review step + rollback |
| Large-file memory blowups | Streaming-only parsing is a P0 architectural rule (no full-file loads, ever) |
| Webhook integration friction | Pull API alternative + excellent webhook debugger in dashboard |
| PII sent to LLM concerns | Sample-free header-only mode; document data flow clearly |
