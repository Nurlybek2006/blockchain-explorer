# PHASE 12 — Production hardening

Бұл фазада бұрынғы Explorer, portfolio intelligence, authentication, messaging және observability архитектурасы сақталып, нақты шекаралық тексерулер, production контейнерлері және operation құралдары қосылды. Development PostgreSQL database-тері мен Docker volume-дері жойылған жоқ.

## Testcontainers және integration testing

`tests/` — жеке ESM workspace. `tests/helpers/test-environment.ts` нақты PostgreSQL 17.11, Redis 7.4.11 және RabbitMQ 4.3.6 контейнерлерін көтереді. Әр іске қосылуда кездейсоқ run ID, credentials және үш бөлек database жасалады. Drizzle migration-дары әр owner service папкасынан орындалады; бұрынғы migration prefix-інен жаңа күйге upgrade те тексеріледі. Teardown контейнерлерді ғана тоқтатады; development stack қолданылмайды.

Integration tests PostgreSQL constraints/rollback/ownership, Redis TTL мен atomic fixed-window limiter, BullMQ retry/deduplication және RabbitMQ routing/ACK/NACK/DLQ semantics-ін тексереді. Backup/restore тесті үш database-ті нақты `pg_dump` custom format арқылы архивтеп, жаңа бос target-терге қайтарады; checksum, owner guard, exact confirmation және populated target-ті қабылдамау тексеріледі.

## Contracts, e2e және failure testing

`tests/contracts/` нақты Gateway және browser runtime decoder-лерін бірдей typed contract-термен тексереді. Decimal quantities string күйінде қалады; unknown/private fields allowlist-тен шықпайды; trace/verification availability states сақталады. Бұл suite желіге шықпайды; HTTP арқылы нақты producer response-тері бөлек e2e suite-те тексеріледі.

`tests/e2e/` үш compiled NestJS application-ды random порттарда нақты dependencies-пен іске қосады. Local deterministic JSON-RPC, CoinGecko және Etherscan fixture-лері external key/rate limit-ке тәуелділікті жояды. Auth expiry/signature/refresh rotation/reuse/revocation/logout, user A/B ownership, HTTP validation/body/CORS, internal token, Explorer/portfolio endpoints, source/ABI, trace, outbox delivery/recovery және native WebSocket broadcast/deduplication қамтылған. Redis unavailable fixture auth-тың fail-closed 503, public reads-тің fail-open behavior-ін тексереді. PostgreSQL unavailable, provider 429/timeout/error және RabbitMQ recovery де нақты шекараларда сыналады. OTel exporter down кезінде telemetry business path-ты тоқтатпауы бұрынғы observability tests пен Phase 11 verification арқылы тексеріледі.

## Security hardening

Gateway body parser explicit: JSON maximum 65,536 bytes, strict mode және compressed body inflate өшірулі. Malformed JSON — 400, oversized body — 413, unsupported compressed encoding — 415. Safe exception filter client response-қа stack trace, SQL немесе upstream detail жібермейді; request correlation сақталады.

CORS тек exact `WEB_ORIGIN` қабылдайды, wildcard және cookie credentials қосылмаған. Preflight 204. Security headers: nosniff, frame DENY, referrer және permissions policy. HSTS тек production-та explicit enabled кезде беріледі. Next standalone CSP static hydration-мен compatible; production `unsafe-eval` жоқ, бірақ inline script/style рұқсаты және localStorage refresh token residual XSS risk ретінде [security-final.md](security-final.md)-те жазылған.

Redis limiter existing messaging abstraction-ды reuse етеді: Lua `INCR` + `PEXPIRE` + `PTTL` atomic operation. Auth, search және expensive reads үшін бөлек configurable buckets; IP hash key-де ғана қолданылады, metric labels-ке кірмейді. Default proxy trust false; client-controlled XFF identity ретінде алынбайды. Redis operation deadline 250 ms, reconnect cooldown және forced disconnect request latency-ді шектейді. Auth Redis unavailable кезде 503, public reads work availability үшін fail-open.

## Database және EXPLAIN ANALYZE

Actual query/index review [database-final.md](database-final.md)-те: барлық owner tables, PK/FK/indexes, search/list/detail patterns және N+1 review. `scripts/performance/database-audit.mjs` 200 blocks, 10,000 transactions/transfers, 10,100 outbox rows, 2,000 snapshots және 200 alerts бойынша `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` орындайды. Seed және candidate index-тер disposable transaction ішінде rollback болады.

Token history `(token_address, block_number DESC)` және outbox `(status, available_at)` candidates салыстырылды. Осы dataset-те token planner бұрынғы block index арқылы оқуды таңдады; outbox query бұрыннан sub-millisecond. Candidate improvement тұрақты әрі маңызды болған жоқ. Сондықтан duplicate/new indexes пен жаңа migration қосылмады; write-heavy ingestion артық write overhead алмайды. Бұл large production dataset үшін indexes мәңгі қажет емес деген тұжырым емес: нақты cardinality/retention өзгерсе қайта EXPLAIN жүргізу керек.

Үш PostgreSQL pool default-ы 10 connections, 30 seconds idle және 5 seconds connection wait. Shared pure validator (`packages/contracts/src/config/database-pool.config.ts`) startup-та invalid/infinite values қабылдамайды: max 1–100, idle 0–300,000 ms, connection 100–60,000 ms. Existing pool saturation metrics сақталған.

Нақты N+1 improvement: portfolio bulk price read бұрын әр unique cold asset үшін жеке PK SELECT орындайтын. Енді `PricesRepository.findMany` барлық cache miss-ті бір SQL `IN` query-мен оқиды. Redis reads parallel және deduplicated; result order/duplicates, decimal precision, stale/missing values пен asynchronous BullMQ refresh behavior сақталған. Үш focused regression test осы invariants-ті тексереді. Background per-portfolio snapshots және per-alert conditional updates correctness/locking үшін сақталған.

## Performance benchmark

`pnpm perf:http` қолданыстағы `PERF_BASE_URL` үшін concurrent Node fetch workers іске қосады. `PERF_DURATION_SECONDS` және `PERF_CONCURRENCY` bounded; optional `PERF_ACCESS_TOKEN` /portfolio өлшемін қосады. Warmup excluded; requests/success/errors/throughput/p50/p95/p99/min/max/statuses JSON және human readable түрде жазылады. Token report-қа жазылмайды.

Live HTTP benchmark existing rate-limit policy-ге бағынады: default quota асып кетсе 429 error count-қа кіріп, script nonzero exit береді. Deterministic zero-error smoke үшін `pnpm perf:indexer` disposable quota-configured stack-ты қолданады. Live production limiter-ді benchmark үшін өшіру қажет емес; нақты configured limit пен statuses-ті бірге бағалау керек.

`pnpm perf:indexer` толық disposable environment жасайды: actual BlockProcessor, Drizzle transaction, local RPC және real RabbitMQ/BullMQ. Test-only AsyncLocalStorage instrumentation production code-ты өзгертпей RPC wait және persistence time-ды өлшейді. 20 blocks fixture-інде әр block бір transaction, log және ERC-20 transfer сақтайды. Бұл maximum throughput load емес, deterministic correctness/performance smoke. HTTP бес endpoints және бес concurrent WebSocket clients қосымша тексеріледі. Reports `artifacts/performance/` ішінде gitignored; benchmark барлық application/container ресурстарын finally арқылы жабады.

## Production Docker және Compose

Төрт multi-stage image Node 24.21.0 bookworm slim және pnpm 12.10.1 қолданады. Frozen lock install, offline production deploy, runtime dist және migration files ғана қалады. Non-root user, read-only filesystem, bounded SIGTERM және health checks бар. Next standalone output барлық қажет workspace tracing files-імен көшіріледі. `.dockerignore` secret/env/archive/source-build artifacts-ті context-тен шығарады.

`infrastructure/compose.production.yml` бөлек project/volumes және private service DNS қолданады. Gateway/Web ғана configurable localhost host port жариялайды; PostgreSQL/Redis/RabbitMQ мен internal services жарияланбайды. Үш database owner role cross-database CONNECT privilege алмайды. Үш one-off migration service сәтті аяқталғаннан кейін application startup өтеді. Optional monitoring overlay Collector/Prometheus/Loki/Tempo/Grafana service names-ін production DNS-ке сәйкестендіреді.

`verify-production.mjs --observability` төрт image-ті нақты build етеді; fresh migrations, non-root/private runtime/no compiler/no baked secrets, Gateway downstream requests, төрт frontend HTML route, database ownership, 6/6 Prometheus targets, үш service metric, үш datasource, төрт dashboard және төрт app SIGTERM тексереді. Cleanup тек random project label-мен дәлелденген өз volumes-ін жояды; `down -v` қолданылмайды.

## Backup және restore

`pnpm db:backup --container <production-postgres-container>` үш database архивін және SHA-256 manifest жасайды. `pnpm db:restore --container <container> --directory <archive-directory> --database <source> --target <empty-target> --confirm <container>/<empty-target>` exact explicit confirmation талап етеді. Target алдын ала бар әрі бос болуы керек; script DROP немесе --clean жасамайды. PGPASSWORD child environment арқылы беріледі, shell argument/log емес. Archive local disk-те sensitive data болуы мүмкін; off-host encrypted copies және retention policy operator-дың міндеті. Толық procedure [operations-final.md](operations-final.md)-те.

## CI және dependency audit

`.github/workflows/ci.yml` pinned official action commits, Node/pnpm versions, lock-based pnpm cache, frozen install, packages/backend/web builds, lint, unit/contracts/integration/e2e және actual production image/runtime smoke қамтиды. Tests production credentials немесе external provider keys талап етпейді. Hosted GitHub workflow осы workspace-та push жасалмайды; pipeline қадамдары local actual commands арқылы тексеріледі.

Testcontainers 11.14.0 host Node 22.16 compatibility үшін pinned; newer version-ның minimum Node талабын бұзатын upgrade жасалмады. BullMQ workspace-та бір 5.81.5 version. Existing OpenTelemetry compatible package family сақталған. Vite native `resolve.tsconfigPaths` ескі plugin-ді ауыстырды; `vite-tsconfig-paths` және tsconfck peer warning жойылды. Testcontainers optional SSH native addons local Docker socket үшін қажет емес және explicit disabled. Бір unreferenced duplicate Explorer query service жойылды; public API starter routes breaking change болмас үшін сақталды.

## Coverage және final verification

Coverage барлық backend `src/**/*.ts` source-ты қамтиды, test files excluded; HTML және JSON summary жазылады. Auth/security, block processing, source/trace normalization, portfolio valuation/ownership/alerts үшін actual baseline-нан төмен reasonable critical thresholds белгіленді. Unit coverage subprocess e2e execution-ды біріктірмейді; repository/outbox/worker integration behavior нақты tests-пен тексерілсе де coverage пайызына қосылмайды. Whole-project 100% claim жоқ.

`pnpm verify:phase12` install/peers/build/lint/unit/contracts/Testcontainers/e2e/coverage/performance/production Docker+observability/documentation тексерулерін қайта орындайды. Әр group exit code және duration `artifacts/phase-12-verification.json` ішінде сақталады. Regression Phase 7–11 осы final command алдында орындалады. Соңғы нақты counts, measurements және file inventory төмендегі evidence section-ға енгізіледі; [production-checklist.md](production-checklist.md) operation readiness және external prerequisites-ті ажыратады.

## Remaining limitations

Production-style single-host architecture: managed TLS termination, HA/failover, autoscaling, off-host encrypted archives және Alertmanager notification delivery қосылмаған. Blockchain canonical accuracy provider/chain behavior-іне, verification source availability Etherscan-ге және prices CoinGecko-ға тәуелді. Static CSP inline permission мен browser token storage қауіптері сақталады. Benchmarks local fixture smoke, capacity planning немесе public-mainnet SLA емес. CI configuration дайын, remote execution push жасалмағандықтан local result-пен ғана дәлелденген.

## Соңғы файлдар тізімі

Git source inventory төменде көрсетілген; generated dist/cache/coverage/artifacts саналмайды. Existing ignored .env файлына жетіспеген security defaults қосылды, secrets сақталды.

### Жасалған — 62 файл

| Файл | Өзгеріс |
| --- | --- |
| [.dockerignore](../.dockerignore) | Secrets, ENV файлдары, dependencies, build outputs, архивтер мен reports Docker build context-іне кірмеуін қамтамасыз етеді. |
| [.env.production.example](../.env.production.example) | Production порттары, бос secret өрістері, private service settings және security/telemetry defaults үшін бөлек template береді. |
| [.github/workflows/ci.yml](../.github/workflows/ci.yml) | Pinned CI actions арқылы install, build, lint, unit, coverage, contracts, integration, e2e, performance және Docker smoke қадамдарын орындайды. |
| [README.md](../README.md) | System overview, ASCII architecture, нақты startup/API/testing/operations командалары және documentation links береді. |
| [apps/api-gateway/src/common/security/api-exception.filter.ts](../apps/api-gateway/src/common/security/api-exception.filter.ts) | HTTP errors-ті bounded public response-қа айналдырып, private diagnostics-ті sanitized internal logging ішінде қалдырады. |
| [apps/api-gateway/src/common/security/http-security.config.ts](../apps/api-gateway/src/common/security/http-security.config.ts) | Body, CORS, proxy trust, rate limits және HSTS configuration мәндерін fail-fast тексереді. |
| [apps/api-gateway/src/common/security/http-security.spec.ts](../apps/api-gateway/src/common/security/http-security.spec.ts) | Нақты loopback HTTP арқылы CORS, headers, JSON bounds, safe errors, JWT және Redis limiter failure policy-ін тексереді. |
| [apps/api-gateway/src/common/security/http-security.ts](../apps/api-gateway/src/common/security/http-security.ts) | Security headers, exact-origin CORS, strict JSON size limit және sanitized parser errors middleware-ін қосады. |
| [apps/api-gateway/src/common/security/security-rate-limit.service.ts](../apps/api-gateway/src/common/security/security-rate-limit.service.ts) | Auth/search/expensive-read Redis quotas, bounded timeout/reconnect және explicit fail-closed/fail-open policy-ін басқарады. |
| [apps/api-gateway/src/common/security/security.module.ts](../apps/api-gateway/src/common/security/security.module.ts) | Gateway rate-limit service-ін Nest provider ретінде тіркеп, bootstrap үшін export етеді. |
| [apps/indexer-service/src/common/guards/internal-service.guard.spec.ts](../apps/indexer-service/src/common/guards/internal-service.guard.spec.ts) | Indexer internal boundary-де missing, wrong, duplicated және ambiguous service token header-лерін reject етуді тексереді. |
| [apps/indexer-service/src/workers/outbox-publisher.worker.spec.ts](../apps/indexer-service/src/workers/outbox-publisher.worker.spec.ts) | Publisher confirm, retry/recovery, invalid envelope, competing claim/lease және metrics failure кезіндегі outbox invariants-ті тексереді. |
| [apps/portfolio-service/src/common/guards/internal-service.guard.spec.ts](../apps/portfolio-service/src/common/guards/internal-service.guard.spec.ts) | Portfolio internal boundary-де missing, wrong, duplicated және ambiguous service token header-лерін reject етуді тексереді. |
| [apps/web/src/lib/security/frontend-security.spec.ts](../apps/web/src/lib/security/frontend-security.spec.ts) | Next CSP, allowed connection origins, HSTS және production/development compatibility behavior-ын тексереді. |
| [docs/architecture-final.md](../docs/architecture-final.md) | Қазақ тілінде system ownership, canonical indexing және request/event/job data flows-ты түсіндіреді. |
| [docs/database-final.md](../docs/database-final.md) | 26 owner table үшін PK/FK/index map, actual query/EXPLAIN audit, N+1 өзгерісі және pool budget-ті сипаттайды. |
| [docs/operations-final.md](../docs/operations-final.md) | Startup/shutdown, migrations, monitoring, secrets, backup, empty-target restore және troubleshooting тәртібін береді. |
| [docs/phase-12-production-hardening.md](../docs/phase-12-production-hardening.md) | Phase 12 implementation, нақты verification evidence, limitations және барлық өзгерген файлдардың тізімін береді. |
| [docs/production-checklist.md](../docs/production-checklist.md) | Орындалған implementation acceptance пен Internet deployment алдындағы external operator prerequisites-ті ажыратады. |
| [docs/security-final.md](../docs/security-final.md) | Threat model, auth/ownership/internal token, HTTP hardening, secret/privacy policy және қалған қауіптерді түсіндіреді. |
| [docs/study-project.md](../docs/study-project.md) | 12 phase бойынша guided code reading, нақты files/data flows/concepts және 23 технологияның study map-ын береді. |
| [infrastructure/compose.production.observability.yml](../infrastructure/compose.production.observability.yml) | Production DNS ішінде optional monitoring stack пен authenticated Grafana-ны бөлек persistent volumes-пен қосады. |
| [infrastructure/compose.production.yml](../infrastructure/compose.production.yml) | Төрт application, private dependencies, үш DB role/migrator және health/startup/shutdown policies бар production-style stack береді. |
| [infrastructure/docker/Dockerfile.api](../infrastructure/docker/Dockerfile.api) | Gateway үшін pinned workspace build, production dependencies, migration files және non-root runtime image жасайды. |
| [infrastructure/docker/Dockerfile.indexer](../infrastructure/docker/Dockerfile.indexer) | Indexer үшін pinned workspace build, production dependencies, owner migrations және non-root runtime image жасайды. |
| [infrastructure/docker/Dockerfile.portfolio](../infrastructure/docker/Dockerfile.portfolio) | Portfolio үшін pinned workspace build, production dependencies, owner migrations және non-root runtime image жасайды. |
| [infrastructure/docker/Dockerfile.web](../infrastructure/docker/Dockerfile.web) | Next standalone output, public/static assets және build-time browser settings бар non-root runtime image жасайды. |
| [infrastructure/docker/migrate.mjs](../infrastructure/docker/migrate.mjs) | Owner-specific Drizzle migrations-ті runtime advisory lock және bounded pool cleanup арқылы орындайды. |
| [infrastructure/postgres/production-init/01-owned-databases.sh](../infrastructure/postgres/production-init/01-owned-databases.sh) | Fresh PostgreSQL volume ішінде үш owner database/role жасап, cross-database CONNECT қолжетімділігін шектейді. |
| [infrastructure/scripts/backup.mjs](../infrastructure/scripts/backup.mjs) | Үш database үшін timestamped архив directory жасайтын cross-platform backup CLI береді. |
| [infrastructure/scripts/postgres-archive.d.mts](../infrastructure/scripts/postgres-archive.d.mts) | Archive helper API-ына strict integration-test type contract береді. |
| [infrastructure/scripts/postgres-archive.mjs](../infrastructure/scripts/postgres-archive.mjs) | Docker pg_dump/pg_restore streams, manifest checksum және secret-safe archive/target validation орындайды. |
| [infrastructure/scripts/restore.mjs](../infrastructure/scripts/restore.mjs) | Checksum, exact confirmation және empty-target proof талап ететін guarded restore CLI береді. |
| [infrastructure/scripts/verify-production.mjs](../infrastructure/scripts/verify-production.mjs) | Төрт image, health/private/ownership/OTel boundaries, SIGTERM/SIGINT және owned-project cleanup-ты нақты тексереді. |
| [packages/contracts/src/config/database-pool.config.spec.ts](../packages/contracts/src/config/database-pool.config.spec.ts) | Pool defaults, integer/range bounds және invalid/infinite configuration rejection behavior-ын тексереді. |
| [packages/contracts/src/config/database-pool.config.ts](../packages/contracts/src/config/database-pool.config.ts) | Үш owner pool үшін shared defaults және fail-fast integer/range validation береді. |
| [packages/contracts/src/contracts.spec.ts](../packages/contracts/src/contracts.spec.ts) | Event envelope, asset/address normalization және precision сақтайтын public contracts behavior-ын тексереді. |
| [packages/contracts/vitest.config.ts](../packages/contracts/vitest.config.ts) | Shared contracts package unit tests үшін Vitest configuration береді. |
| [scripts/performance/database-audit.mjs](../scripts/performance/database-audit.mjs) | Disposable synthetic PostgreSQL dataset-те actual EXPLAIN/BUFFERS, candidate index comparison және rollback орындайды. |
| [scripts/performance/http-benchmark.mjs](../scripts/performance/http-benchmark.mjs) | Concurrent HTTP requests, latency percentiles, status/error counts және optional authenticated endpoint өлшемдерін жинайды. |
| [scripts/performance/indexer-benchmark.mjs](../scripts/performance/indexer-benchmark.mjs) | Actual block/RPC/DB processing, бес HTTP endpoint және бірнеше WebSocket client үшін disposable benchmark орындайды. |
| [scripts/performance/report.mjs](../scripts/performance/report.mjs) | Benchmark configuration bounds, percentile calculation және JSON report export helpers береді. |
| [scripts/verify-phase-12.mjs](../scripts/verify-phase-12.mjs) | Барлық final acceptance командаларын ретімен орындап, exit code/duration evidence-ін JSON artifact-ке жазады. |
| [tests/README.md](../tests/README.md) | Disposable integration/e2e helpers, resource ownership және cleanup тәртібін түсіндіреді. |
| [tests/contracts/cross-service.spec.ts](../tests/contracts/cross-service.spec.ts) | Gateway/browser decoder drift, precision, availability states және public-field allowlist contracts-ті тексереді. |
| [tests/e2e/public-boundaries.spec.ts](../tests/e2e/public-boundaries.spec.ts) | Үш actual application арқылы auth, ownership, API, security, outbox, trace, WebSocket және resilience бойынша 46 scenario тексереді. |
| [tests/helpers/application-process.mjs](../tests/helpers/application-process.mjs) | Test-only child process bootstrap және app.close арқылы explicit shutdown control береді. |
| [tests/helpers/application-stack.ts](../tests/helpers/application-stack.ts) | Random-port applications startup/readiness, redacted captured logs және bounded graceful teardown басқарады. |
| [tests/helpers/assertions.ts](../tests/helpers/assertions.ts) | Unknown runtime values-ті narrow ету және bounded eventual assertions үшін reusable helpers береді. |
| [tests/helpers/global-setup.ts](../tests/helpers/global-setup.ts) | Vitest lifecycle ішінде migrated disposable container environment setup/teardown басқарады. |
| [tests/helpers/indexer-process.mjs](../tests/helpers/indexer-process.mjs) | Actual BlockProcessor-ді IPC арқылы шақырып, test-only RPC/persistence timing boundaries-ін өлшейді. |
| [tests/helpers/provider-fixtures.ts](../tests/helpers/provider-fixtures.ts) | Structurally correlated Ethereum, CoinGecko және Etherscan responses үшін deterministic local fixtures береді. |
| [tests/helpers/test-environment.ts](../tests/helpers/test-environment.ts) | Random credentials/database names бар үш actual Testcontainer, owner migrations және cleanup API береді. |
| [tests/integration/backup-restore.spec.ts](../tests/integration/backup-restore.spec.ts) | Үш owner database үшін actual pg_dump/restore, checksum және restore safety guards-ті тексереді. |
| [tests/integration/messaging.spec.ts](../tests/integration/messaging.spec.ts) | Нақты Redis/BullMQ/RabbitMQ арқылы TTL, retries, dedup, routing, ACK/NACK/DLQ және atomic quotas тексереді. |
| [tests/integration/migrations.spec.ts](../tests/integration/migrations.spec.ts) | Fresh/upgrade migrations, legacy row preservation, ownership, constraints және unavailable database behavior-ын тексереді. |
| [tests/integration/provider-resilience.spec.ts](../tests/integration/provider-resilience.spec.ts) | Local RPC/CoinGecko/Etherscan 429/timeout/error және unavailable OTel кезінде controlled behavior-ды тексереді. |
| [tests/package.json](../tests/package.json) | Reusable test workspace, explicit transport/test dependencies және compatible Testcontainers 11.14.0 нұсқасын жариялайды. |
| [tests/tsconfig.helpers.json](../tests/tsconfig.helpers.json) | Reusable test helpers-ті strict NodeNext/ESM JavaScript output-қа build етеді. |
| [tests/tsconfig.json](../tests/tsconfig.json) | Test suites пен helpers үшін strict NodeNext type-check configuration береді. |
| [tests/vitest.config.ts](../tests/vitest.config.ts) | Actual-container integration/e2e suites үшін sequential execution және bounded deadlines орнатады. |
| [tests/vitest.contracts.config.ts](../tests/vitest.contracts.config.ts) | Network-free cross-service response contract suite үшін бөлек Vitest configuration береді. |

### Өзгертілген — 43 файл

| Файл | Өзгеріс |
| --- | --- |
| [.env.example](../.env.example) | Security және benchmark defaults қосылып, duplicate RPC settings алынды. |
| [.gitignore](../.gitignore) | Production secret file, backup archives және generated reports/artifacts Git inventory-ден шығарылды. |
| [apps/api-gateway/package.json](../apps/api-gateway/package.json) | Қолданылмайтын vite-tsconfig-paths dev dependency алынды. |
| [apps/api-gateway/src/app.module.ts](../apps/api-gateway/src/app.module.ts) | SecurityModule Gateway application dependency graph-ына қосылды. |
| [apps/api-gateway/src/bootstrap.ts](../apps/api-gateway/src/bootstrap.ts) | Telemetry middleware-нен кейін explicit secure body/CORS/headers және safe exception filter initialization қосылды. |
| [apps/api-gateway/src/database/database.service.ts](../apps/api-gateway/src/database/database.service.ts) | Shared pool validator қосылып, identity ownership, Drizzle және observability lifecycle сақталды. |
| [apps/api-gateway/src/modules/auth/token.service.spec.ts](../apps/api-gateway/src/modules/auth/token.service.spec.ts) | Malformed/expired JWT, wrong signatures және extreme identity input үшін regression cases қосылды. |
| [apps/api-gateway/src/modules/explorer/dto/pagination-query.dto.ts](../apps/api-gateway/src/modules/explorer/dto/pagination-query.dto.ts) | Public pagination page upper bound 1,000,000 болып шектелді. |
| [apps/api-gateway/src/modules/explorer/explorer.controller.ts](../apps/api-gateway/src/modules/explorer/explorer.controller.ts) | Block number HTTP input PostgreSQL signed-bigint storage bound бойынша тексерілді. |
| [apps/api-gateway/src/modules/portfolio/portfolio-validation.spec.ts](../apps/api-gateway/src/modules/portfolio/portfolio-validation.spec.ts) | Extreme pagination, unsafe large numbers және malformed query shapes үшін rejection cases қосылды. |
| [apps/api-gateway/vitest.config.e2e.ts](../apps/api-gateway/vitest.config.e2e.ts) | Obsolete path plugin орнына Vite native tsconfig path resolution қосылды. |
| [apps/api-gateway/vitest.config.ts](../apps/api-gateway/vitest.config.ts) | Native path resolution, all-source coverage reports және measured critical thresholds қосылды. |
| [apps/indexer-service/package.json](../apps/indexer-service/package.json) | Қолданылмайтын vite-tsconfig-paths dev dependency алынды. |
| [apps/indexer-service/src/common/guards/internal-service.guard.ts](../apps/indexer-service/src/common/guards/internal-service.guard.ts) | Duplicate/ambiguous internal token header-ін first-element coercion арқылы қабылдау тоқтатылды. |
| [apps/indexer-service/src/database/database.service.ts](../apps/indexer-service/src/database/database.service.ts) | Shared pool validator қосылып, explorer ownership, Drizzle және observability lifecycle сақталды. |
| [apps/indexer-service/src/modules/explorer/explorer.controller.ts](../apps/indexer-service/src/modules/explorer/explorer.controller.ts) | Internal pagination string shape, page/limit bounds және extreme input rejection күшейтілді. |
| [apps/indexer-service/src/workers/outbox-publisher.worker.ts](../apps/indexer-service/src/workers/outbox-publisher.worker.ts) | Қолданылмайтын catch binding алынып, outbox publish/retry behavior сақталды. |
| [apps/indexer-service/vitest.config.e2e.ts](../apps/indexer-service/vitest.config.e2e.ts) | Obsolete path plugin орнына Vite native tsconfig path resolution қосылды. |
| [apps/indexer-service/vitest.config.ts](../apps/indexer-service/vitest.config.ts) | Native path resolution, all-source coverage reports және measured critical thresholds қосылды. |
| [apps/portfolio-service/package.json](../apps/portfolio-service/package.json) | Қолданылмайтын vite-tsconfig-paths dev dependency алынды. |
| [apps/portfolio-service/src/database/database.service.ts](../apps/portfolio-service/src/database/database.service.ts) | Shared pool validator қосылып, portfolio ownership, Drizzle және observability lifecycle сақталды. |
| [apps/portfolio-service/src/modules/alerts/alerts.service.spec.ts](../apps/portfolio-service/src/modules/alerts/alerts.service.spec.ts) | Object/array/boolean whale config rejection және numeric config acceptance үшін meaningful test қосылды. |
| [apps/portfolio-service/src/modules/alerts/alerts.service.ts](../apps/portfolio-service/src/modules/alerts/alerts.service.ts) | Whale threshold config String conversion алдында string/number түріне narrow етіліп, unsafe object coercion қабылданбайтын болды. |
| [apps/portfolio-service/src/modules/prices/price-decimal.ts](../apps/portfolio-service/src/modules/prices/price-decimal.ts) | Destructured integer value undefined болғанда explicit rejection қосылып, strict typing сақталды. |
| [apps/portfolio-service/src/modules/prices/prices.repository.ts](../apps/portfolio-service/src/modules/prices/prices.repository.ts) | Unique cold asset keys үшін indexed SQL IN query орындайтын findMany helper қосылды. |
| [apps/portfolio-service/src/modules/prices/prices.service.spec.ts](../apps/portfolio-service/src/modules/prices/prices.service.spec.ts) | Batch lookup, mixed cache/missing/stale behavior және I/O алдындағы validation үшін үш test қосылды. |
| [apps/portfolio-service/src/modules/prices/prices.service.ts](../apps/portfolio-service/src/modules/prices/prices.service.ts) | Bulk price cache misses бір DB query-ге біріктіріліп, order/duplicates/precision және async refresh semantics сақталды. |
| [apps/portfolio-service/src/workers/portfolio-jobs.worker.ts](../apps/portfolio-service/src/workers/portfolio-jobs.worker.ts) | Exhaustive unknown-job fallback message unreachable name interpolation орнына fixed safe мәтін қолданды. |
| [apps/portfolio-service/vitest.config.e2e.ts](../apps/portfolio-service/vitest.config.e2e.ts) | Obsolete path plugin орнына Vite native tsconfig path resolution қосылды. |
| [apps/portfolio-service/vitest.config.ts](../apps/portfolio-service/vitest.config.ts) | Native path resolution, all-source coverage reports және measured critical thresholds қосылды. |
| [apps/web/next.config.ts](../apps/web/next.config.ts) | Standalone output/tracing root, static-compatible CSP/security headers және explicit production HSTS қосылды. |
| [package.json](../package.json) | Root tests, performance, production, backup/restore және final verification командалары стандартталды. |
| [packages/contracts/package.json](../packages/contracts/package.json) | Explicit Vitest dev dependency және shared contracts unit-test command қосылды. |
| [packages/contracts/src/index.ts](../packages/contracts/src/index.ts) | Bounded shared PostgreSQL pool configuration export қосылды. |
| [packages/contracts/tsconfig.json](../packages/contracts/tsconfig.json) | Unit spec files production dist build-тан шығарылды. |
| [packages/messaging/src/redis/redis-cache.client.ts](../packages/messaging/src/redis/redis-cache.client.ts) | Bounded connection options, force disconnect және atomic TTL-backed fixed-window quota helper қосылды. |
| [pnpm-lock.yaml](../pnpm-lock.yaml) | Testcontainers workspace graph қосылып, obsolete path plugin/peer graph алынды және compatible runtime versions сақталды. |
| [pnpm-workspace.yaml](../pnpm-workspace.yaml) | Tests workspace тіркеліп, local Docker socket үшін қажет емес optional SSH native builds өшірілді. |
| [scripts/verify-phase-10.mjs](../scripts/verify-phase-10.mjs) | Functional regression fixtures API limiter-ден оқшауланып, бастапқы feature assertions сақталды. |
| [scripts/verify-phase-11.mjs](../scripts/verify-phase-11.mjs) | Functional observability fixtures API limiter-ден оқшауланып, бастапқы telemetry assertions сақталды. |
| [scripts/verify-phase-7.mjs](../scripts/verify-phase-7.mjs) | Functional auth/portfolio fixtures API limiter-ден оқшауланып, бастапқы regression assertions сақталды. |
| [scripts/verify-phase-8.mjs](../scripts/verify-phase-8.mjs) | Fixture limiter isolation және recovered fresh provider state-ті bounded күту қосылып, retry/idempotency assertions сақталды. |
| [scripts/verify-phase-9.mjs](../scripts/verify-phase-9.mjs) | Functional frontend fixtures API limiter-ден оқшауланып, бастапқы API/HTML assertions сақталды. |

### Жойылған — 1 файл

| Файл | Өзгеріс |
| --- | --- |
| apps/indexer-service/src/common/explorer/explorer-query.service.ts | Ешбір active import қолданбаған duplicate Explorer query service алынды; modules/explorer ішіндегі actual service сақталды. |

## Соңғы орындау дәлелдері

Тексерілген уақыт: **2026-10-14T17:26:07.636Z**. Final pipeline **exit 0**, **19/19 verification group өтті**, **өткізіп жіберілген қадам жоқ**. Нақты record: [phase-12-verification.json](../artifacts/phase-12-verification.json).

### Тест нәтижелері

| Unit suite | Тест | Файл |
| --- | ---: | ---: |
| API Gateway | 135 | 14 |
| Indexer | 107 | 11 |
| Portfolio | 125 | 19 |
| Web | 155 | 16 |
| Observability | 29 | 3 |
| Contracts және pool validation | 20 | 2 |
| **Барлығы** | **571** | **65** |

- Cross-service decoder contracts: **17/17**.
- Actual Testcontainers integration: **26/26**, төрт файл.
- Үш actual service HTTP/messaging/WebSocket e2e: **46/46**, бір файл.
- Бұрынғы local health e2e: **3/3**.
- Бөлек Vitest cases жалпы саны: **663** (571 + 17 + 26 + 46 + 3); verification groups бұл санға қайта қосылмайды.
- Жаңа hardening security additions: **50 unit case** (49 HTTP/JWT/internal/Next validation және бір unsafe config case); бұл 571 unit test ішіндегі subset. Auth/ownership/failure behavior нақты e2e suite ішінде де тексерілді.

### Coverage

| Backend толық source | Statements | Branches | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
| API Gateway | 66.74% | 71.82% | 57.28% | 70.99% |
| Indexer | 45.79% | 44.63% | 42.16% | 46.73% |
| Portfolio | 55.2% | 59.96% | 54% | 56.01% |

Critical мысалдар: auth service lines **96.82%**, token service **95.91%**, outbox worker **96.29%**, valuation math **100%**. Outbox branches **66.66%**; threshold branches **60%**, lines/statements **90%**, functions **95%**. Барлық configured critical thresholds final pipeline ішінде өтті. Whole-source coverage DTO/module/controller/repository және worker files-ті де қамтиды; compiled subprocess e2e execution осы coverage report-қа біріктірілген жоқ.

### Өлшенген performance

Fixture run: **2026-10-14T17:23:32.892Z**, concurrency **2**, әр endpoint үшін **2 seconds**; warmup өлшемге кірмейді.

| Endpoint | Requests | Errors | Req/s | p50 ms | p95 ms | p99 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| /health | 493 | 0 | 245.67 | 6.953 | 14.553 | 20.56 |
| /stats | 290 | 0 | 144.06 | 12.77 | 21.394 | 25.209 |
| /blocks?page=1&limit=20 | 284 | 0 | 141.23 | 13.086 | 20.627 | 26.132 |
| /search?q=101 | 320 | 0 | 159.12 | 12.193 | 16.223 | 21.743 |
| /portfolio | 244 | 0 | 121.38 | 16.033 | 21.179 | 23.364 |

HTTP жалпы нәтиже — **1631 successful request / 0 errors**. Indexer **20 block** үшін **17.09 tx/log/transfer per second** өлшеді; block p50/p95/p99 — **53.973/116.692/122.59 ms**, RPC — **4.035/7.678/14.048 ms**, DB persistence — **39.418/85.916/107.219 ms**. Бес WebSocket client әрқайсысы екі broadcast алып, жабылды. Бұл local fixture smoke нәтижесі; maximum capacity немесе universal SLA кепілдігі берілмейді.

Осы sample-де persistence RPC wait-тен ұзағырақ болды; келесі tuning бағыты SQL transaction/persistence workload болуы мүмкін. Deep OFFSET және exact counts үлкен cardinality жағдайында қайта өлшенуі керек. Әр block-та бір transaction/log/transfer бар fixture жалпы mainnet throughput-ты сипаттамайды. Толық JSON: [system.json](../artifacts/performance/system.json).

### Infrastructure және regression

- Соңғы **төрт Docker image build** өтті; frozen/offline runtime dependencies, non-root, source/secret exclusion, health және private-boundary checks сәтті.
- Production Compose және monitoring: **cleanup-пен бірге 12 check өтті**; үш fresh migration job exit 0 және cross-owner DB denial тексерілді.
- SIGTERM төрт application үшін, SIGINT үш NestJS backend үшін bounded shutdown арқылы өтті.
- Monitoring: **6/6 targets UP**, **3 application service**, **3/3 datasource**, **4/4 dashboard**.
- Pinned Prometheus container promtool арқылы **11 alert rule** және config valid екені расталды.
- Үш database archive/restore, populated-target rejection, wrong confirmation және checksum guards нақты тексерілді.
- Phase 7 — **11**, Phase 8 — **24**, Phase 9 — **17**, Phase 10 — **17**, Phase 11 — **37**, Phase 12 — **19 group**; барлығы exit 0.
- Install, packages/backend/web builds, type-aware/frontend lint, tests және coverage final pipeline ішінде exit 0 берді.

### Dependencies, migrations және warnings

Test workspace-ке Testcontainers **11.14.0**, Vitest және бұрыннан қолданылатын pg, Drizzle, Redis, amqplib, ws, jsonwebtoken, Nest config/type dependencies explicit қосылды. Үлкен жаңа application framework енгізілген жоқ. Үш backend dev dependencies ішінен **vite-tsconfig-paths** алынып, оның transitive tsconfck graph-ы жойылды. **BullMQ 5.81.5 — workspace-та бір нұсқа**, compatible OpenTelemetry family сақталды; **pnpm peers check: no issues**.

Жаңа migration немесе index өзгерісі жоқ: actual candidate measurements тұрақты meaningful improvement дәлелдемеді. Existing data/schema сақталды; cold price N+1 batching өзгерісі жаңа index талап етпейді.

Қалған warnings: direct ESLint **9.39.5** deprecation және transitive **@esbuild-kit/core-utils 3.3.2**, **@esbuild-kit/esm-loader 2.6.5**, **cron-parser 4.9.0**, **glob 10.5.0**, **uuid 10.0.0** deprecations. Тек warnings үшін risky major upgrade жасалмады. pnpm deploy legacy-mode workspace lock notice intentional; нақты frozen/offline deployment өтті. Бұрынғы mock-only unbound-method/object-stringification lint warnings сақталды; meaningful production source warnings түзетілді, lint exit 0.

Tempo 3.1.0 idle NotFound: no jobs found log behavior Phase 11 upstream limitation ретінде құжатталған; readiness/provisioning/trace ingestion checks өтті. Next verifier tsconfig notices оқшауланған generated files-ке қатысты; cleanup олардың алдыңғы күйін қалпына келтіреді.

### Аяқталу шекарасы

**Production-style implementation COMPLETE**: service ownership, canonical indexing, messaging durability/idempotency, auth/security, observability, tests, container lifecycle және safe operations нақты орындалған evidence арқылы тексерілді. Checklist implementation acceptance аяқталды.

Internet-facing deployment алдында operator checklist-тегі actual secrets, TLS/WSS endpoint, provider quotas, off-host encrypted archives, availability және notification delivery prerequisites аяқталуы керек. CI workflow-дың local-equivalent stages өтті; remote GitHub run немесе push осы task scope-ында орындалған жоқ.
