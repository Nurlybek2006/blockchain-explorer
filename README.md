# Blockchain Explorer + Portfolio Tracker

## Overview

A TypeScript monorepo with an Ethereum explorer, authenticated wallet portfolios, asynchronous enrichment and operational telemetry. Three NestJS services own separate PostgreSQL databases; the Next.js frontend uses the API Gateway public boundary.

The production Compose configuration provides a local, production-style deployment. Public Internet deployment still requires an operator-managed TLS endpoint, network policy, secret distribution and backup destination.

## Features

- Canonical block, transaction, receipt, log and ERC-20 indexing with checkpoints and reorg recovery.
- Indexed address/token search, contract source/ABI lookup and background transaction call traces.
- Native WebSocket updates with reconnect, deduplication and REST recovery.
- Registration, access JWT, rotating refresh sessions and owner-scoped portfolio/watchlist/alert management.
- Exact decimal valuation, incomplete/stale price states, sampled snapshot history and price/transfer alerts.
- Transactional outbox, RabbitMQ delivery, Redis cache and BullMQ workers.
- Distributed traces, structured logs, metrics, provisioned Grafana dashboards and Prometheus alert rules.

## Architecture

~~~text
Browser -> Next.js :3003 -> API Gateway :3000 -> identity_db
                                |
                                +-- internal HTTP -> Indexer :3001 -> explorer_db
                                |                       |
                                |                       +-- Ethereum JSON-RPC / Etherscan
                                |
                                +-- internal HTTP -> Portfolio :3002 -> portfolio_db
                                                        |
                                                        +-- Ethereum JSON-RPC / CoinGecko

Indexer transaction -> outbox -> RabbitMQ -> Portfolio consumers -> BullMQ/Redis
                                      |
                                      +-> Gateway -> public WebSocket -> Browser

Backends -> OpenTelemetry Collector -> Prometheus / Loki / Tempo -> Grafana
~~~

Gateway never reads another service's database. Shared packages provide contracts, a custom JSON-RPC client, messaging and observability.

## Tech Stack

TypeScript, Node.js, NestJS, React, Next.js App Router, PostgreSQL, Drizzle ORM, JWT, bcrypt, Redis, BullMQ, RabbitMQ, Vitest, Testcontainers, Docker/Compose, OpenTelemetry, Prometheus, Grafana, Loki and Tempo. Monetary arithmetic uses decimal.js and lossless-json; charts use SVG and realtime uses the native WebSocket protocol.

## Microservices

| Application | Default development port | Data owner |
| --- | --- | --- |
| API Gateway | 3000 | identity_db: accounts and refresh sessions |
| Indexer Service | 3001 | explorer_db: canonical chain, enrichment and outbox |
| Portfolio Service | 3002 | portfolio_db: wallets, balances, prices, snapshots and alerts |
| Web | 3003 | Browser UI; no direct database access |

## Blockchain Indexer

The scanner processes a configured chain and confirmed head. Blocks and dependent rows commit with outbox events; persisted checkpoints support restart. Parent-hash checks and bounded reorg recovery remove invalid canonical data and trigger portfolio rebuilds. INDEXER_START_BLOCK=latest starts near the current confirmed head; choose an explicit block for historical ingestion.

## Portfolio Intelligence

Native ETH and known ERC-20 holdings sync asynchronously. CoinGecko prices produce exact string valuations, freshness metadata and an honest unknown total when nonzero assets cannot be priced. Allocation uses priced assets. Market price change and snapshot value change are separate; investment P&L is unavailable without cost basis. Snapshots require complete, fresh observations. Whale alerts currently cover indexed ERC-20 transfers using current reference prices.

## Messaging Architecture

Canonical writes and outbox events share a database transaction. The publisher marks delivery after RabbitMQ confirms; recovery may redeliver, so consumers use database idempotency and deterministic job IDs. BullMQ handles retries/backoff and durable PostgreSQL intents recover enqueue failures. Live Gateway queues are ephemeral per instance; REST refresh recovers missed browser updates.

## Authentication

Access and refresh JWT use distinct secrets, HS256, issuer/audience/type checks and bounded expiry. Refresh token hashes are stored in identity_db. Rotation and replay-triggered family revocation are serialized in transactions. Private APIs derive ownership from authenticated identity. Logout-all revokes refresh sessions; issued access tokens can remain valid until expiry.

The browser keeps access tokens in memory and refresh tokens in localStorage. This persistence is an explicit XSS tradeoff; this project does not claim HttpOnly-cookie sessions.

## Smart Contract Verification

Contract creation receipts and background code checks discover contracts. BullMQ performs bounded Etherscan V2 source/ABI lookup. Stored states distinguish pending, verified, unverified, unsupported and failed. No local Solidity compiler or source-submission verification is implemented.

## Transaction Tracing

Background workers use debug_traceTransaction with callTracer when the provider supports it. Canonical block identity is checked before/after RPC and before persistence. Flattened traces retain exact quantities; Internal Calls exclude reverted execution and delegate/static apparent values. Unsupported debug APIs return a controlled status.

## Realtime

Gateway maps only allowlisted public block/transfer/reorg events to /realtime. Native sockets enforce Origin, client/frame/buffer bounds and heartbeat. One frontend connection invalidates relevant REST resources; reconnect triggers recovery reads. Private alerts are not part of this public stream.

## Observability

The SDK initializes before application imports. W3C trace context crosses internal HTTP, outbox, RabbitMQ and BullMQ. Sanitized logs include request/trace IDs; metric dimensions are bounded. Grafana provisions System Overview, Blockchain Indexer, Portfolio and Logs/Traces dashboards. Prometheus evaluates 11 rules; an external notification receiver is not included.

Development monitoring:

~~~sh
pnpm observability:up
pnpm observability:ps
pnpm observability:logs
~~~

Grafana is available at http://localhost:3004 with development Viewer access. Prometheus: http://localhost:9090; Loki: http://localhost:3100; Tempo: http://localhost:3200. The production overlay disables anonymous Grafana access and exposes only its UI on localhost.

## Database Architecture

Each service has its own Drizzle schema and ordered SQL migrations. Production initialization creates separate owner roles; migrations run as one-shot services before application startup. PostgreSQL is shared infrastructure, while database ownership and queries remain service-local.

See [database reference](docs/database-final.md) for tables, keys, indexes and query review.

## Project Structure

~~~text
apps/
  api-gateway/       Public HTTP, authentication, BFF and WebSocket
  indexer-service/   Blockchain ingestion, Explorer and enrichment
  portfolio-service/ Holdings, prices, analytics and alerts
  web/              Next.js application
packages/
  blockchain-client/ Custom Ethereum JSON-RPC and ERC-20 client
  contracts/         Shared HTTP/event/browser contracts
  messaging/         Redis, RabbitMQ and BullMQ abstractions
  observability/     Telemetry, propagation and privacy
tests/               Disposable integration/e2e and contract tests
scripts/             Phase verification and performance benchmarks
infrastructure/      Compose, images, monitoring and archive scripts
docs/                Phase, architecture, security, operations and study guides
~~~

## Getting Started

Requirements: Node.js 24, pnpm 12.10.1 and Docker with Compose and a running Docker daemon. Docker Desktop with Linux containers supports the Windows workspace.

For a fresh checkout, copy .env.example to an ignored .env and fill the database/broker credentials, a real Ethereum RPC URL, internal token and two distinct JWT secrets. Preserve existing local .env values.

~~~sh
pnpm install
pnpm build:packages
pnpm infra:up
pnpm db:migrate
~~~

Use [operations instructions](docs/operations-final.md) for secret generation and dependency diagnostics.

## Environment

.env.example documents development defaults. .env.production.example is a separate template for the isolated production Compose project. Do not commit populated ENV files.

NEXT_PUBLIC_API_URL and NEXT_PUBLIC_WS_URL are public browser settings embedded at web image build time; changing them requires rebuilding. Backend provider keys and service tokens must never be NEXT_PUBLIC variables. WEB_ORIGIN must be one exact origin.

## Development

Run each application in a separate terminal:

~~~sh
pnpm dev:api
pnpm dev:indexer
pnpm dev:portfolio
pnpm dev:web
~~~

Build explicitly with:

~~~sh
pnpm build:packages
pnpm --dir apps/api-gateway build
pnpm --dir apps/indexer-service build
pnpm --dir apps/portfolio-service build
pnpm --dir apps/web build
pnpm lint
~~~

## Docker

Fill an ignored .env.production from its template, then:

~~~sh
pnpm prod:config
pnpm prod:build
pnpm prod:up
pnpm prod:ps
pnpm prod:logs
pnpm prod:down
~~~

Production images use build/runtime stages, a non-root Node user, exec-form startup and native HTTP healthchecks. Application containers run read-only with bounded tmpfs/logs and no source mounts. Dependency/internal ports are not published. Production data uses a separate Compose project and volumes; stop commands retain volumes.

Optional production monitoring requires OTEL_ENABLED=true and the overlay:

~~~sh
docker compose --env-file .env.production -f infrastructure/compose.production.yml -f infrastructure/compose.production.observability.yml up -d
~~~

## API

| Area | Public routes |
| --- | --- |
| Authentication | POST /auth/register, /auth/login, /auth/refresh, /auth/logout, /auth/logout-all; GET /users/me |
| Explorer | GET /stats, /blocks, /blocks/:number, /blocks/hash/:hash, /tx/:hash, /address/:address, /tokens, /token/:address |
| Advanced Explorer | GET /contract/:address, /tx/:hash/traces, /search?q=, /network/status |
| Prices | GET /prices/eth, /prices/token/:address |
| Portfolio | /portfolio CRUD; GET /portfolio/:id/holdings, /valuation, /history, /analytics |
| Watchlists | /watchlists CRUD; POST /watchlists/:id/items; DELETE /watchlists/:id/items/:itemId |
| Alerts | /alerts CRUD; GET /alerts/events; PATCH /alerts/events/:id/read |
| Realtime / health | WS /realtime; GET /health |

Private routes require Authorization: Bearer access JWT. Internal service APIs require the shared service token and remain unexposed by production Compose. Invalid input, foreign resources and conflicts use bounded HTTP error responses.

## Testing

~~~sh
pnpm test:unit
pnpm test:contracts
pnpm test:integration
pnpm test:e2e
pnpm test:coverage
pnpm verify:phase12
~~~

Testcontainers starts disposable PostgreSQL, Redis and RabbitMQ with generated secrets and mapped ports. Tests apply real migrations and use deterministic Ethereum/CoinGecko/Etherscan fixtures. Existing development databases are not used by this suite. The local legacy health checks remain under test:e2e:local.

Regression commands: verify:phase7 through verify:phase11. Verification scripts isolate their database/topology/cache/job namespaces and clean only owned resources. Performance scripts measure HTTP and deterministic block processing without an external load framework; see the Phase 12 report for results and command options.

HTTP frontend smoke verifies production HTML and assets. Browser clicks, visual layout and hydration are not fully verified by HTTP smoke. Final counts, coverage and benchmark evidence are maintained in [Phase 12](docs/phase-12-production-hardening.md) and the [checklist](docs/production-checklist.md).

## Security

Gateway provides exact-origin CORS, body bounds, Redis-backed rate limits, safe errors and security headers. Authentication limits fail closed during Redis outage; public Explorer reads fail open. Proxy trust defaults to false. HSTS is explicitly enabled only for a production TLS deployment.

Static Next.js CSP allows inline scripts/styles for hydration, and refresh persistence uses localStorage; these are documented residual XSS risks. Secrets are redacted from telemetry, and no wallet private keys or transaction signing are involved. Read the [security model](docs/security-final.md) before deployment.

## Documentation

- [Final architecture](docs/architecture-final.md)
- [Database reference](docs/database-final.md)
- [Security](docs/security-final.md)
- [Operations and backup/restore](docs/operations-final.md)
- [Study guide: phases 1–12 and technology map](docs/study-project.md)
- [Production checklist](docs/production-checklist.md)
- [Phase 7](docs/phase-7-auth-portfolio.md), [Phase 8](docs/phase-8-portfolio-intelligence.md), [Phase 9](docs/phase-9-frontend.md)
- [Phase 10](docs/phase-10-advanced-explorer.md), [Phase 11](docs/phase-11-observability.md), [Phase 12](docs/phase-12-production-hardening.md)

## License

Private project. No root open-source license has been supplied; package manifests marked UNLICENSED do not grant redistribution rights.

