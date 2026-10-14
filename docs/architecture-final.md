# Соңғы system architecture

Бұл monorepo Ethereum chain деректерін оқып сақтайды және user wallet portfolio-ларын бақылайды. Қолданба private key сақтамайды, transaction қол қоймайды және funds қозғамайды. Architecture service ownership, exact quantities және asynchronous recovery қағидаларына сүйенеді.

## Компоненттер

~~~text
Browser -> Next.js -> API Gateway -> identity_db
                         |
                         +-> Indexer -> explorer_db
                         |      +-> Ethereum JSON-RPC / Etherscan
                         |
                         +-> Portfolio -> portfolio_db
                                +-> Ethereum JSON-RPC / CoinGecko

Indexer DB transaction -> outbox -> RabbitMQ
                                      +-> Portfolio consumer -> BullMQ/Redis -> workers
                                      +-> Gateway realtime consumer -> WebSocket -> Browser

Backend OTel -> Collector -> Prometheus / Loki / Tempo -> Grafana
~~~

Next.js route entry және layout сервер компоненттерімен беріледі; session мен interactive resources browser компоненттерінде орындалады. Browser тек Gateway public HTTP және WebSocket boundary-іне кіреді. Private UI gate navigation-ды реттейді; нақты authorization backend-та орындалады.

API Gateway identity_db-ге ғана direct query жасайды. Explorer сұрауы Indexer internal HTTP client-іне, portfolio/watchlist/alert сұрауы Portfolio client-іне беріледі. Clients timeout, redirect rejection, response decoding және trace/request context propagation қолданады. Downstream body public response ретінде тексерусіз берілмейді.

## Data ownership

| Иесі | Database | Негізгі деректер |
| --- | --- | --- |
| API Gateway | identity_db | users, refresh_tokens |
| Indexer | explorer_db | blocks, transactions, receipts, logs, tokens, transfers, addresses, sync state/checkpoints, verification, traces, outbox |
| Portfolio | portfolio_db | portfolios, holdings, prices/history, snapshots, watchlists/items, alerts/events, processed events, outbox intents |

Бір PostgreSQL server үш database-ті орналастыра алады. Production init әр database үшін бөлек role жасайды. Cross-database join жоқ; contract немесе event арқылы ғана байланыс жасалады. Schema/index/migration анықтамасы [database-final.md](database-final.md) ішінде.

## Explorer read flow

GET /blocks немесе /tx/:hash → Gateway validation → optional Redis cache → protected Indexer HTTP → Drizzle/PostgreSQL → Gateway decoder → browser decoder → UI. Request chain provider-ден arbitrary live lookup жасамайды. Indexed resource жоқ болса 404 беріледі.

Cache key Gateway namespace ішінде. Cache outage core read-ті upstream-ға бағыттайды. Realtime invalidation generation-ы кеш аяқталған read-тің ескі result-ты қайта cache-ке жазуын тоқтатады. Redis recovery missed invalidation болған namespace-ті тазалағаннан кейін ғана cache read-ті қайта қосады.

## Canonical indexing flow

Scanner configured chain ID мен confirmed head-ті тексереді. BlockProcessor RPC block/receipts алып, transaction/log/ERC-20 data-ны нормализациялайды. Blocks және dependent rows, sync checkpoint және outbox domain events бір PostgreSQL transaction ішінде commit болады. Provider немесе persistence қатесі successful block metrics/checkpoint ретінде есептелмейді.

Parent hash mismatch reorg recovery-ге әкеледі. Common ancestor bounded depth ішінде анықталып, invalid branch rows cascade/repair арқылы алынады. Reorg event кейін portfolio rebuild пен Explorer cache/UI refresh-ті бастайды. Background verification/trace нәтижесі branch hash guard арқылы жаңа canonical data-ны ауыстыра алмайды.

## Outbox және delivery

DB transaction → persisted outbox row → publisher claim → RabbitMQ publisher confirm → published state. Publisher downtime indexing commit-ін broker availability-ге тәуелді етпейді. Confirm мен DB status update арасында crash болса delivery қайталануы мүмкін: бұл at-least-once behavior.

Portfolio consumer processed_events және deterministic BullMQ job ID арқылы repeat handling-ті шектейді. User portfolio create операциясы initial-sync intent-ті portfolio row-мен бірге жазады; Redis outage кезінде intent DB-де қалады. BullMQ completion бүкіл message жүйесіне exactly-once кепілдігін бермейді; idempotent DB writes correctness-ті қамтамасыз етеді.

## Portfolio request және worker flow

JWT guard user identity-ді тексереді → Gateway trusted userId орнатады → Portfolio internal token guard → owner-scoped repository query. Foreign/missing/archived resources бірдей 404 semantics қолданады.

Portfolio create commit-тен кейін BullMQ initial sync native ETH және белгілі ERC-20 balance-терін нақты block context-інде оқиды. Transfer events tracked portfolios үшін token sync береді; reorg explicit rebuild жасайды. Price worker CoinGecko response-ін lossless parse жасап, PostgreSQL және Redis-ке сақтайды. Valuation decimal arithmetic қолданады; nonzero unpriced asset толық total-ды null етеді.

Periodic snapshots fresh, complete observations-тан ғана жазылады. Market-price change current balance-ке қатысты; snapshot delta deposits/withdrawals әсерін қамтуы мүмкін. Cost basis жоқ, сондықтан true investment P&L шығарылмайды. Alerts fresh price crossing немесе indexed ERC-20 transfer арқылы durable in-app event жазады.

## Contract және trace enrichment

Contract creation receipt пен background eth_getCode code presence-ті анықтайды. Canonical commit durable verification intent жасайды; separate BullMQ worker Etherscan V2 source/ABI lookup орындайды. Source мәтіні executable HTML ретінде қолданылмайды. Verification деген осы external result; local Solidity compile/submission жоқ.

Trace intent transaction және canonical block hash-қа байланған. Separate RPC worker callTracer capability-ін байқайды, bounded tree-ді flattened rows-қа нормализациялайды және guarded commit жасайды. Unsupported provider controlled status береді. Internal Calls root емес successful positive-value call/create/selfdestruct subset-інен құралады; reverted ancestors және delegate/static execution transfer ретінде саналмайды.

## Realtime flow

RabbitMQ topic exchange → әр Gateway instance-тің ephemeral queue-і → public allowlist mapper → cache invalidation → native /realtime socket → shared RealtimeProvider → targeted REST reread. Бұл live notification stream; durable user notification ledger емес. Socket reconnect кезінде missed updates REST арқылы қалпына келеді. User alerts public channel-ға жіберілмейді.

## Shared packages және type boundaries

Contracts HTTP/event shapes, payload guards және browser-safe exports береді. Blockchain client custom Ethereum JSON-RPC/ ERC-20 implementation-ін ұстайды; ethers/viem жоқ. Messaging Redis, RabbitMQ және бір BullMQ 5.81.5 implementation/type system-ін біріктіреді. Observability metrics, context, logger, SDK және privacy boundary береді.

Backend strict TypeScript NodeNext/ESM қолданады; relative imports .js extension-мен жазылады. Frontend Next bundler resolution қолданады. TypeScript compile-time contracts сыртқы JSON validation-ды алмастырмайды: Gateway және browser response decoder-лері жеке boundaries болып қалады.

## Observability және failure isolation

SDK main application imports алдында қосылады. Context internal HTTP headers, durable outbox metadata, Rabbit headers және BullMQ telemetry metadata арқылы өтеді. Collector metrics-ті Prometheus-ке, logs-ты Loki-ге, traces-ті Tempo-ға жеткізеді; Grafana correlation және dashboards береді.

Telemetry fail open: Collector unavailable HTTP/indexing/transactions-ті тоқтатпайды. Redis cache unavailable read fallback береді; Redis auth limiter unavailable authentication 503 береді. Rabbit unavailable кезінде DB outbox retry қалады. PostgreSQL unavailable кезде write success жарияланбайды. Detailed failure evidence [Phase 12](phase-12-production-hardening.md) ішінде.

## Deployment және шекаралар

Development core, development monitoring және production Compose әртүрлі project/volume scopes қолданады. Production applications non-root, read-only, init-enabled және bounded shutdown/log resources-пен іске қосылады; migrations one-shot service арқылы application алдында орындалады. Internal dependency ports host-та жарияланбайды.

Бұл single-host production-style setup. TLS termination, multi-host HA, database replication, distributed secret manager, remote/encrypted backup storage және alert notification delivery енгізілмеген. Browser HTTP smoke full interactive browser QA-ны алмастырмайды. Security мен operations decisions тиісті final documents-та берілген.

