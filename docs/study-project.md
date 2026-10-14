# Жобаны код арқылы үйрену: PHASE 1–12

Бұл guide дайын project-ті қайта оқуға арналған. Әр phase feature-ді қандай мәселе үшін енгізгенін, нақты код қайда жатқанын және оның data flow-ын байланыстырады. PHASE 7–11 толық phase documents қосымша behavior/evidence береді; PHASE 12 final report нақты соңғы verification нәтижелерін ұстайды.

Алдымен component атауларын жаттаудан гөрі бір request немесе event-тің жүйеден қалай өтетінін бақылаңыз. Негізгі сұрақтар: бұл деректі кім иеленеді, қандай input trusted, transaction қайда commit болады, жұмыс қайталанса не болады және unavailable dependency қандай state береді?

## PHASE 1 — Monorepo, NestJS және Next.js

**Не жасалды:** applications пен reusable packages бір pnpm workspace ішінде ұйымдастырылды. API Gateway, Indexer және Portfolio жеке Nest application, Web жеке Next.js App Router application болып қалды.

**Неге:** independent service responsibilities-ті сақтау және shared types/client abstractions-ті copy-paste жасамай қолдану қажет. Workspace dependency runtime network call емес; package source/build graph-тың байланысы.

**Технология және файлдар:** pnpm-workspace.yaml, root package.json, apps/*/package.json, backend tsconfig.json/tsconfig.build.json және apps/web/tsconfig.json. Nest app.module.ts module composition береді; Web src/app/layout.tsx routing/provider roots-ты қосады.

**Data flow:** root dev command алдымен shared packages-ті build етеді → app өз dependencies exports-ін жүктейді → Nest bootstrap HTTP application-ды іске қосады немесе Next route tree-ді render етеді.

**Маңызды concept:** TypeScript source import пен emitted JavaScript runtime import бірдей емес. Backend NodeNext/ESM relative .js extension қолданады; type-only import runtime symbol шығармайды. Strict compile external JSON дұрыс дегенді автоматты дәлелдемейді.

Код оқу: бір backend AppModule import tree-ін сызыңыз, содан кейін packages/contracts browser және root exports айырмасын салыстырыңыз. Browser export node:crypto сияқты server-only dependency-ді UI bundle-ге әкелмеуі керек.

## PHASE 2 — Docker және persistent infrastructure

**Не жасалды:** PostgreSQL, Redis және RabbitMQ development Compose арқылы іске қосылады. Named volumes process/container restart-тен кейін state сақтайды; healthchecks readiness-ті байқайды.

**Неге:** application code database/broker/cache binaries installation-ына тәуелді болмай, қайталанатын ортада жұмыс істеуі керек. Container process жаңаруы volume lifecycle-ымен бір нәрсе емес.

**Технология және файлдар:** infrastructure/compose.yml, infrastructure/postgres/init/01-create-databases.sql, infrastructure/rabbitmq/enabled_plugins және .env.example.

**Data flow:** Compose environment → container startup → init script fresh PostgreSQL data directory-де databases жасайды → application connection URL арқылы кіреді. Existing initialized volume-де init scripts қайта орындалмайды.

**Маңызды concept:** infrastructure up болғаны application schema latest дегенді білдірмейді; migrations жеке орындалады. Stop command деректерді жоймайды. Docker network hostname контейнер ішінде қолданылады, localhost әр process/container-дің өзін білдіреді.

Код оқу: Compose port mappings пен internal port-ты ажыратыңыз. Production template-та dependency ports published емес екенін development-пен салыстырыңыз.

## PHASE 3 — Drizzle және database ownership

**Не жасалды:** identity_db, explorer_db және portfolio_db үшін service-local schemas/migrations/database modules енгізілді. Drizzle query builders нақты PostgreSQL pool-мен жұмыс істейді.

**Неге:** database ownership service boundary-ді сақтайды. Gateway explorer table-ді тікелей оқыса, indexer schema change public BFF implementation-ін tightly couple етеді және authorization/data ownership жайын шатастырады.

**Технология және файлдар:** әр backend src/database/database.service.ts, src/database/schema/, src/database/migrations/, drizzle.config.ts. Толық table/key/index map database-final.md ішінде.

**Data flow:** service repository → Drizzle SQL → pg.Pool → тек owner database. Schema TypeScript өзгерісі SQL migration generate/inspect/apply арқылы нақты database-ке жеткізіледі.

**Маңызды concept:** transaction atomicity тек бір database transaction scope-та кепілденеді. Foreign service HTTP/Rabbit operation PostgreSQL commit-тің бөлігі бола алмайды; кейін outbox осы мәселені шешеді.

Код оқу: user record schema мен portfolio userId field-ін салыстырыңыз. Portfolio userId identity database-ке cross-database FK емес; service contract арқылы алынған identity.

## PHASE 4 — Ethereum JSON-RPC indexing

**Не жасалды:** custom EthereumRpcClient, confirmed block scanner, checkpoints және canonical parent-hash/reorg processing. ethers/viem орнына explicit JSON-RPC request/response validation бар.

**Неге:** latest block mutable болуы мүмкін; confirmations және chain identity дұрыс деректерді таңдауға көмектеседі. Provider timeout/429 indexing progress-ті false success ретінде сақтамауы керек.

**Технология және файлдар:** packages/blockchain-client/src/ethereum-rpc.client.ts, errors.ts, rpc-rate-limiter.ts; Indexer src/config/indexer-config.service.ts, workers/block-scanner.worker.ts, modules/chain-sync/chain-sync.service.ts, block-processor.service.ts, sync-state.repository.ts және reorg.service.ts.

**Data flow:** configured RPC chain → head/confirmed head → scanner batch → block/receipts fetch → normalized block entities → DB transaction → checkpoint update. Restart persisted state-тен жалғасады.

**Маңызды concept:** block number мен quantities hex JSON-RPC input-тан bigint/string representation-ға өтеді. Chain reorg жай жаңа block емес: бұрынғы canonical branch effects-і repair/rollback қажет.

Код оқу: block commit сәтін табыңыз. Fetch аяқталды, parse аяқталды және DB commit аяқталды деген үш кезеңнің айырмасын metrics spans арқылы тексеріңіз.

## PHASE 5 — ERC-20 және Explorer read model

**Не жасалды:** receipt logs-тан ERC-20 Transfer extraction, token/address indexing және protected Explorer queries. Gateway public REST Explorer boundary береді.

**Неге:** browser әр table немесе provider-ге тікелей сұрау жасамай, pagination/validation бар application read model алуы керек. Indexed address белгісіз arbitrary wallet үшін live balance discovery дегенді білдірмейді.

**Технология және файлдар:** packages/blockchain-client/src/erc20.client.ts; Indexer modules/tokens/token-indexing.service.ts, modules/addresses/address-indexing.service.ts, modules/explorer/explorer-query.service.ts және explorer.controller.ts; Gateway modules/explorer/explorer.controller.ts, explorer.service.ts, indexer-explorer.client.ts.

**Data flow:** block receipt logs → validated token transfer → tokens/addresses/transfers persistence. Read flow browser → Gateway → internal token HTTP → Indexer query → response decoder → UI.

**Маңызды concept:** read response monetary quantities-ді string түрінде ұстайды. Raw balance 1500000000000000000, decimals 18 болса formatted 1.5; floating-point Number қолдану үлкен uint256 мәндерін дәл сақтамайды.

Код оқу: token decimals unavailable болғандағы API/UI state-ін қараңыз. UNKNOWN label немесе fake zero displayed value ретінде жасалмағанын салыстырыңыз.

## PHASE 6 — Redis, BullMQ, RabbitMQ және outbox

**Не жасалды:** shared messaging package, Explorer cache, durable domain events, portfolio event consumer және retryable jobs. Бір BullMQ version/type system queue/worker/job generics-ін біріктіреді.

**Неге:** DB commit пен broker publish-ті бір atomic distributed transaction ретінде жасай алмаймыз. Қарапайым save-then-publish broker outage кезінде event loss әкелуі мүмкін.

**Технология және файлдар:** packages/messaging/src/redis/redis-cache.client.ts, rabbitmq/rabbitmq.client.ts, bullmq/bullmq.factory.ts; Indexer workers/outbox-publisher.worker.ts, modules/messaging/indexer-event.factory.ts; Portfolio modules/messaging/portfolio-events.consumer.ts, modules/jobs/portfolio-jobs.service.ts және workers/portfolio-jobs.worker.ts.

**Data flow:** entity+outbox бірге commit → publisher claim → Rabbit confirm → published state → consumer idempotency → BullMQ enqueue → worker effect. Cache read Redis unavailable болса upstream-ға өтеді.

**Маңызды concept:** at-least-once delivery repeat possibility-ді мойындайды. processed_events, deterministic job IDs және idempotent writes exactly-once marketing claim-інен маңыздырақ. Retry invocation әлі commit болған effect-ті қайта бүлдірмеуі керек.

Код оқу: publisher confirm кейін, published status update алдында crash болса не болатынын түсіндіріңіз. Worker generic types messaging export-тарынан келетінін тексеріңіз: әртүрлі physical BullMQ .d.ts version-дары class compatibility қателерін тудыруы мүмкін.

## PHASE 7 — Authentication және Portfolio Management

**Не жасалды:** register/login/profile, access JWT, refresh rotation/logout, owner-scoped portfolio CRUD және initial native balance sync. Auth identity_db-ге, portfolio data portfolio_db-ге тиесілі.

**Неге:** client userId жіберуі ownership дәлелі емес. JWT current identity, active user check және downstream owner predicates жеке қабаттар болып бірге жұмыс істейді.

**Технология және файлдар:** Gateway modules/auth/auth.service.ts, token.service.ts, password.service.ts, guards/jwt-auth.guard.ts; modules/portfolio/portfolio.client.ts; Portfolio modules/portfolios/portfolios.repository.ts, portfolio-ownership.ts және portfolio-initial-sync.dispatcher.ts.

**Data flow:** register input → bcrypt → user+hashed refresh session transaction → typed response. Portfolio create JWT owner → internal HTTP → portfolio+initial sync intent commit → BullMQ → actual balance.

**Маңызды concept:** refresh reuse family revocation exception rollback-ына түсіп жоғалмауы керек. Service transaction invalid outcome-ды commit етеді, одан кейін 401 береді. Concurrent refresh/logout user/session lock ordering арқылы реттеледі.

Код оқу: AuthService.refresh-ті жолмен оқып, throw қай жерде екенін табыңыз. Logout-all access JWT-ді автоматты revoke етпейтін semantics-ті TokenService TTL-мен байланыстырыңыз. Phase 7 document пен auth.session security tests қосымша сценарийлер береді.

## PHASE 8 — Portfolio Intelligence

**Не жасалды:** CoinGecko prices, exact valuation, snapshots/history/analytics, watchlists және төрт in-app alert rule. Missing price мен unsynced balance honest incomplete state береді.

**Неге:** wallet quantity мен market value бөлек деректер. Белгісіз бағаны zero деп көрсету false total мен fake chart тудырады. Price crossing alert бір condition true күйінде repeated notifications жасамауы керек.

**Технология және файлдар:** Portfolio modules/prices/coingecko.client.ts, prices.service.ts, prices.cache.ts; modules/analytics/valuation.math.ts, analytics.service.ts, analytics.repository.ts; modules/watchlists/ және modules/alerts/. decimal.js және lossless-json precision boundary-ді қорғайды.

**Data flow:** price worker → provider parse → DB/cache → holding×price valuation → complete/fresh snapshot → history sampling. Transfer event → alert evaluation job → rule/event-key DB dedup → in-app event.

**Маңызды concept:** market change current holdings-ке қатысты price effect; snapshot delta balances/deposits әсерін де қамтиды; cost-basis P&L басқа есеп. Allocation priced subtotal-ға қатысты. First fresh price observation baseline, кейін false→true transition alert береді.

Код оқу: valuation.math.ts және valuation.math.spec.ts бірге оқыңыз. Unpriced asset, zero balance, -100% price change және stale prices scenarios-ында null/zero semantics-ін түсіндіріңіз. Whale price transfer-time тарихи баға емес, current reference екенін payload metadata-дан байқаңыз.

## PHASE 9 — Next.js frontend

**Не жасалды:** public Explorer routes, auth forms және portfolio/watchlist/alert workspace, dark responsive components және SVG charts. UI typed API transport/runtime decoders мен lifecycle-aware useResource қолданады.

**Неге:** frontend backend semantics-ін бұрмаламауы керек. Private session/data account switch немесе late request completion-нан кейін басқа user-ге көрінбеуі тиіс.

**Технология және файлдар:** Web src/app/, features/, components/ui*.tsx, hooks/use-resource.ts, lib/api/client.ts, providers/auth-provider.tsx, lib/auth/session.ts және browser-session.ts; lib/format/ және features/analytics/history-geometry.ts.

**Data flow:** route wrapper → client feature → API transport → session/access JWT → decoder → resource state → exact formatted UI. Reload stored refresh арқылы session restore жасайды; supported Web Locks rotation-ды tab арасында реттейді.

**Маңызды concept:** client route protection authorization емес. Access token memory-де, refresh token localStorage-де сақталады; same-origin XSS residual risk. Hydration initial snapshot consistent loading state қолданады.

Код оқу: SessionController.generation-ды account switch/logout scenarios-ымен бақылаңыз. API retry бұрынғы mutation-ды басқа account атынан қайта жібермейтінін tests-та қараңыз. Chart geometry bounded ratio ғана Number-ге өтеді, source money strings unchanged.

## PHASE 10 — Advanced Explorer және realtime

**Не жасалды:** contract detection/verification/source ABI, background callTracer traces, Internal Calls, backend-aware search, network status және shared native WebSocket connection.

**Неге:** heavy external provider work ingestion loop-ты тоқтатпауы керек. Unknown provider capability controlled unavailable state беруі тиіс. Browser public stream private user messages-ті таратпауы керек.

**Технология және файлдар:** Indexer modules/advanced/advanced-jobs.service.ts, contract-detection.service.ts, etherscan.client.ts, trace-normalizer.ts; modules/explorer/search-resolution.ts және network-status.service.ts. Gateway modules/realtime/. Web providers/realtime-provider.tsx, lib/realtime/realtime-client.ts, features/explorer/trace-view.tsx және contract-page.tsx.

**Data flow:** canonical intent → BullMQ → separate provider lookup → block-hash guarded persistence → API/UI. Outbox Rabbit event → Gateway allowlist → cache invalidate → public socket → targeted REST refresh.

**Маңызды concept:** trace tree-нің apparent positive child value-і reverted ancestor ішінде actual transfer емес. Delegate/static call value new ETH transfer ретінде саналмайды. External Etherscan verified lookup local Solidity compile-verification дегенді білдірмейді.

Код оқу: trace-normalizer.spec.ts reverted-ancestor test-ін, advanced jobs canonical guard-ін және realtime mapper allowlist-ін салыстырыңыз. Missed socket events durable REST data-дан қалпына келетінін reconnect behavior-мен байланыстырыңыз.

## PHASE 11 — Observability

**Не жасалды:** reusable OTel SDK, structured sanitized logs, bounded metrics, async trace propagation және Collector/Prometheus/Loki/Tempo/Grafana stack. Төрт dashboards пен 11 rules actual application instruments-ке сүйенеді.

**Неге:** HTTP slow/error ғана емес, RPC wait, DB persistence, broker backlog, worker retry және stale valuation себептерін service boundary бойынша байқау қажет. Observability өзі business availability/correctness-ті бұзбауы тиіс.

**Технология және файлдар:** backend main.ts/instrumentation.ts/bootstrap.ts; packages/observability/src/sdk.ts, instrumentation.ts, context.ts, logger.ts, metrics.ts, privacy-processor.ts және sanitize.ts; infrastructure/monitoring/ configs, dashboards/provisioning.

**Data flow:** SDK imports алдында init → request ID/server span → internal HTTP/outbox/broker/job context → logs/metrics/traces → Collector → signal backends → Grafana log-trace/exemplar links.

**Маңызды concept:** metric cardinality bounded болуы керек. Wallet address, tx hash, email/IP және request ID metric label болмайды. Trace/log correlation identifiers-і басқа storage/model. High sampling storage cost-пен байланысты; Collector outage telemetry degradation ғана береді.

Код оқу: logger sanitizer мен span export privacy boundary айырмасын қараңыз. Metric collection business DB/RPC scrape-time query жасамайтынын registration/periodic observation code-тан тексеріңіз.

## PHASE 12 — Production hardening және дәлел

**Не жасалды:** real PostgreSQL/Redis/Rabbit Testcontainers helpers, cross-service contracts, public security/e2e checks, API abuse bounds, production images/Compose, safe archive/restore scripts, CI және measured performance/query audit.

**Неге:** mock дұрыс return берсе де actual migration, broker ACK/DLQ, Redis TTL/retry немесе service HTTP contract қате болуы мүмкін. Production-style build/runtime packaging бөлек тексеріледі; code unit success Docker runtime success-ті автоматты білдірмейді.

**Технология және файлдар:** tests/helpers/test-environment.ts, application-stack.ts, provider-fixtures.ts; tests/integration/, tests/e2e/, tests/contracts/; Gateway common/security/; infrastructure/docker/Dockerfile.*, compose.production*.yml; infrastructure/scripts/postgres-archive.mjs, backup.mjs, restore.mjs; .github/workflows/ci.yml және scripts/verify-phase-12.mjs.

**Data flow:** disposable containers → migrations → deterministic provider fixture → built backend processes → public/internal/messaging assertions → graceful cleanup. Archive drill seeded temporary DB → pg_dump+manifest → empty temporary target → single-transaction pg_restore → row verification.

**Маңызды concept:** security fail-open/fail-closed әр dependency үшін explicit policy. Public cache/read Redis outage-та upstream-ға өтеді, auth limiter outage-та 503 береді. Restore exact target confirmation мен empty-database proof қолданады; application's live DB overwrite автоматизацияланбайды.

Код оқу: rate limit atomic Lua Redis helper-ін және forced deadline disconnect-ін бірге оқыңыз. Performance percentile actual dataset/run context-імен ғана meaningful; local dev numbers universal SLA емес. Query/index evidence, coverage және verification counts Phase 12 report-та жаңарады.

## Бір complete request-ті оқу: portfolio create

1. Web feature create form address/name тексереді; API transport current session token-ді қосады.
2. Gateway JWT guard signature/claims және active identity-ді тексереді; public DTO forged userId-ті reject етеді.
3. Gateway internal client trusted userId пен service token-ді Portfolio-ға жібереді.
4. Portfolio internal guard және DTO validation өтеді; repository owner/chain/wallet uniqueness policy қолданады.
5. Portfolio row және initial-sync outbox intent бір transaction ішінде commit болады; response create result береді.
6. Dispatcher persisted intent-ті stable job ID-мен BullMQ-ға enqueue етеді; Redis outage intent-ті жоғалтпайды.
7. Worker real block context бойынша native/known-token balances оқып, guarded/idempotent holding update жасайды.
8. Valuation кейін prices/freshness-ке сүйенеді; async sync аяқталмайынша complete total fabricated болмайды.

Осы flow-да public response success пен background work completion екі бөлек уақыт. Trace context persisted intent арқылы worker-ге дейін жетуі мүмкін; request ID password немесе owner identity-дің орнына жүрмейді.

## Failure арқылы түсіну

Broker-ді өшіру indexing DB commit-ін rollback жасамауы керек: outbox қалады. Redis cache-ті өшіру Explorer read fallback береді; Redis job queue outage durable pending work semantics-ін талап етеді. PostgreSQL unavailable болса successful write/checkpoint жоқ. Provider capability жоқ болса trace unsupported, ал баға жоқ болса null/stale state көрсетіледі.

Бұл scenarios tests-та disposable scopes-пен орындалады; development volumes reset жасалмайды. Testcontainers Docker availability талап етеді; provider fixtures сыртқы RPC/CoinGecko/Etherscan secrets талап етпейді. HTTP frontend smoke valid HTML/assets көрсетеді, full browser interaction/hydration QA емес.

## Технология study map

| Технология | Нақты қолданылатын бөлік | Оқу concept |
| --- | --- | --- |
| TypeScript | Backend tsconfig, shared contracts, frontend decoders/types | Strict types және runtime validation айырмасы |
| Node.js | Bootstrap, native fetch/RPC, verifier/performance/archive scripts | Async lifecycle, abort/deadline, process shutdown |
| NestJS | Modules/controllers/guards/providers/workers | DI, HTTP validation, lifecycle hooks |
| React | Web features/providers/hooks/components | State, effects cleanup, account boundaries |
| Next.js | src/app App Router, layout/metadata, next.config.ts | Server/client boundary, static hydration, standalone build |
| PostgreSQL | Үш owner DB, transactions/indexes/advisory locks | Atomicity, isolation, query plan және persistence |
| Drizzle ORM | database/schema, repositories, migrations | Typed SQL және ordered schema evolution |
| JWT | Gateway TokenService/JwtAuthGuard | Signed claims, issuer/audience/type/expiry |
| bcrypt | PasswordService | Slow password hashing және 72-byte bound |
| Redis | Cache, atomic API quotas, BullMQ backing store | TTL, shared state, outage policy |
| BullMQ | Messaging factory, Portfolio/advanced queues/workers | Retry/backoff, deterministic IDs, durable intents |
| RabbitMQ | Outbox publisher, Portfolio/realtime consumers | Topic routing, confirms, ACK/NACK/DLQ, redelivery |
| Vitest | Backend/Web/shared unit, contracts, integration/e2e suites | Assertions, meaningful doubles, real boundaries |
| Testcontainers | tests/helpers/test-environment.ts | Disposable real dependencies, random ports, cleanup |
| Docker | infrastructure/docker images, archive docker exec | Build/runtime isolation, non-root process |
| Docker Compose | core/observability/production YAML | Dependency health, networks, named volume scopes |
| OpenTelemetry | packages/observability, application instrumentation | Context propagation, spans/metrics/logs, privacy |
| Prometheus | monitoring scrape config/rules | Counters, histograms, gauges, PromQL/alerts |
| Grafana | Provisioning/dashboards, Explore | Signal correlation және operational diagnosis |
| Loki | Structured log OTLP storage/query | Bounded indexed labels, LogQL |
| Tempo | Distributed trace storage/span metrics/service graph | TraceQL, parent/child links, exemplars |
| Blockchain | Canonical blocks, receipts, ERC-20 events/reorgs | Consensus-visible history және mutable head |
| JSON-RPC | Custom EthereumRpcClient/ERC20 client | Method IDs/errors, quantity encoding, provider capability |

## Қайта оқу тәртібі және practice

Алдымен architecture-final.md, содан кейін бір phase-тың data flow мен listed files-ін оқыңыз. Жұмыс үшін user-visible behavior-ды анықтап, input boundary, transaction commit және failure path-ты белгілеңіз. Test файлды source implementation-мен қатар қараңыз; test assertion request result-ты ғана емес, forbidden side effect болмағанын қалай дәлелдейтінін байқаңыз.

Практика ретінде small change алдында matching test-ті таңдаңыз: malformed input, duplicate delivery, revoked session reuse, reverted child call немесе unpriced valuation. Expected behavior-ды өз сөзіңізбен түсіндіріп, code path пен evidence-ті атаңыз. UI presentational detail-дің 100% coverage-ін қуу орнына auth/outbox/canonical block/financial arithmetic correctness-ке назар аударыңыз.

Соңғы жоба single-host production-style deployment береді. TLS/HA/off-host encrypted archive/notification receiver және full browser visual QA operator-дың келесі жұмыстары болып қалады. Нақты test totals, measured bottlenecks, migrations және remaining limitations үшін phase-12-production-hardening.md мен production-checklist.md қараңыз.

