# Phase 7: Authentication және Portfolio Management

Phase 7 API Gateway ішіне register/login, access JWT, refresh token rotation, logout және profile қосты. Portfolio Service wallet portfolio жасау, тізімдеу, қарау, атын өзгерту, архивтеу және holdings беруді орындайды. Indexer, Explorer API, RabbitMQ оқиғалары, Redis және BullMQ интеграциясы сақталған.

## Auth flow

`POST /auth/register` email-ді trim/lowercase жасайды, password-ты bcrypt арқылы hash етеді және user мен refresh session-ды бір transaction ішінде сақтайды. Password кемінде 8 таңба және ең көбі 72 UTF-8 byte болуы керек; [bcrypt-тің 72 byte шектеуі](https://github.com/kelektiv/node.bcrypt.js/) тексеріледі. `displayName` optional, duplicate email — `409`.

`POST /auth/login` белсенді user мен bcrypt hash-ты тексереді, `lastLoginAt` жаңартады және token жұбын береді. Қате email/password және inactive user бірдей `401 Invalid credentials` жауабын алады. Жауаптағы `user` тек public profile өрістерінен құралады; `passwordHash` қайтарылмайды.

Access JWT әдепкіде **15 минут**, refresh JWT **30 күн** өмір сүреді. Access payload: `sub`, `email`, `role`, `type: "access"`; refresh payload: `sub`, `jti`, `familyId`, `type: "refresh"`. Екеуі де signature, HS256 algorithm, issuer, audience, expiry және payload түрі бойынша тексеріледі. `JwtAuthGuard` user-дің әлі белсенді екенін identity DB арқылы тексеріп, `@CurrentUser()` үшін trusted user орнатады.

Config:

```dotenv
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=30d
BCRYPT_ROUNDS=12
PORTFOLIO_INTERNAL_URL=http://localhost:3002
PORTFOLIO_HTTP_TIMEOUT_MS=10000
```

JWT secrets екі түрлі кездейсоқ мән болуы және әрқайсысы кемінде 32 byte болуы керек. Мәндерді `.env` ішінде орнатыңыз; `.env.example` ішінде secrets бос қалдырылған. Код secret мәндерін hardcode жасамайды. Duration бүтін seconds немесе `15m`, `30d` түрінде беріледі; access ең көбі 1 сағат, refresh ең көбі 90 күн. `BCRYPT_ROUNDS` — 10–14.

## Refresh rotation және logout

`identity_db.refresh_tokens` ішінде raw token орнына SHA-256 hash, expiry, family ID және revocation уақыты сақталады. `POST /auth/refresh` JWT мен stored hash-ты тексеріп, ескі token-ді revoke етеді және сол family ішінде жаңа token жұбын transaction арқылы сақтайды.

Session операциялары алдымен user row-ды lock етеді, одан кейін refresh row-ды lock етеді. Бұл concurrent refresh пен logout-all операцияларын реттейді. Revoked refresh қайта қолданылса, бүкіл family revoke етіледі; бұл өзгеріс transaction commit арқылы сақталып, содан кейін `401` беріледі.

`POST /auth/logout` body-дегі refresh token family-ін revoke етеді. `POST /auth/logout-all` JWT арқылы анықталған user-дің барлық refresh session-ын revoke етеді. Бұрын берілген access token expiry-ге дейін жарамды болуы мүмкін; inactive user access guard арқылы бірден қабылданбайды.

## Service boundary және ownership

| Service | Өз database-і | Phase 7 міндеті |
| --- | --- | --- |
| API Gateway | `identity_db` | Auth, profile, JWT және public portfolio BFF |
| Indexer | `explorer_db` | Blockchain indexing және Explorer internal API |
| Portfolio Service | `portfolio_db` | Portfolio ownership, CRUD, holdings және sync |

Public portfolio controller userId-ді тек `@CurrentUser()` арқылы алады. Public body/query ішіндегі бөгде `userId` global `ValidationPipe` арқылы `400` болады. UUID параметрлері, name, wallet және pagination тексеріледі; `.js` relative imports және strict TypeScript сақталған.

Gateway Portfolio Service-ке internal HTTP request жібереді. `x-internal-service-token` header existing `INTERNAL_SERVICE_TOKEN` мәнімен толтырылады; redirects қабылданбайды. Create body: `{ userId, name, walletAddress, chainId? }`; list/detail/holdings/rename/archive request-терінің query-сінде `userId` бар, list-те қосымша `page`/`limit`, rename body-де тек `name` бар.

Portfolio Service internal guard service token-ді тексереді. Барлық read/update/archive SQL сұраулары userId пен `archivedAt IS NULL` бойынша шектеледі. Өзге user-дің немесе архивтелген portfolio-сы `404`; holdings сұрауы да ownership арқылы шектелген. Gateway upstream contract-ты runtime-та тексеріп, public өрістерді ғана қайтарады. Upstream network/timeout — `503`, күтпеген status немесе жарамсыз response — `502`; raw SQL, connection error немесе upstream body public жауапқа шықпайды.

## Portfolio және initial sync

Wallet Ethereum `0x` + 40 hex форматына тексеріліп, lowercase түрінде сақталады. Default chain — `ETHEREUM_CHAIN_ID`, әдеттегі config-та Sepolia `11155111`. Қазіргі RPC endpoint бір chain-ге қызмет ететіндіктен, басқа chainId қабылданбайды.

Бір user-дің бір wallet + chain комбинациясы duplicate болса `409` беріледі. Бірінші active portfolio primary болады; user бойынша transaction advisory lock concurrent create/archive кезінде primary күйін реттейді. `DELETE` физикалық жоюдың орнына `archivedAt` орнатады және primary архивтелсе, келесі active portfolio-ны primary етеді. Existing unique index архивтелген wallet комбинациясын да сақтайды: сол wallet + chain қайта жасау `409` береді.

Create transaction portfolio row және initial-sync intent-ті existing `outbox_events` кестесіне бірге жазады. Commit-тен кейін dispatcher intent-ті BullMQ-ға береді; Redis unavailable болса create жоғалмайды, intent retry жасалады. Outbox row lock бірнеше dispatcher instance-ін реттейді; deterministic `initial-{portfolioId}` job ID enqueue/commit арасында процесс тоқтағандағы duplicate job-ты шектейді.

`portfolio-jobs` queue ішінде:

- `sync-portfolio` — initial native ETH және белгілі ERC-20 holdings sync.
- `sync-token-holding` — tracked wallet қатысқан `token.transfer.indexed.v1` оқиғасынан token balance sync.
- `rebuild-portfolio` — reorg оқиғасынан holdings қайта оқу.

Worker configured chain мен RPC chain-ді тексеріп, нақты block number бойынша `EthereumRpcClient.getBalance()` шақырады. Native holding: `assetKey: "native:eth"`, `assetType: "native"`, `symbol: "ETH"`, `decimals: 18`. Қазіргі ERC-20 sync бұрын белгілі token holdings пен indexed transfer оқиғалары арқылы толықтырылады; барлық wallet token-дерін автоматты discovery жасау Phase 7-ге кірмейді.

Normal initial/token sync ескі block snapshot-ымен жаңарақ holding-ті алмастырмайды; explicit reorg rebuild canonical rollback-ты қолдайды. Initial-sync enqueue 5 секундпен шектеледі; timeout кезінде outbox retry жалғасады. Token/reorg enqueue бұрынғы Redis retry тәртібін сақтайды.

RabbitMQ consumer `processed_events` idempotency мен deterministic job IDs қолданады; архивтелген немесе басқа chain portfolio-ларды sync етпейді. Queue/worker error handlers, retry/backoff және graceful close сақталған. BullMQ workspace-та **5.81.5** нұсқасын қолданады; оның типтері messaging package арқылы беріледі.

Holdings `balanceRaw`, `balanceFormatted`, `lastUpdatedBlock` мәндерін string ретінде қайтарады. Formatting bigint/string арифметикасымен орындалады; blockchain balances floating point `Number` арқылы бөлінбейді.

## Endpoint-тер

| Method | Public endpoint | Auth / нәтиже |
| --- | --- | --- |
| POST | `/auth/register` | Email/password/displayName; user + token жұбы, `201` |
| POST | `/auth/login` | Email/password; user + token жұбы, `200` |
| POST | `/auth/refresh` | Body `{ refreshToken }`; жаңа token жұбы, `200` |
| POST | `/auth/logout` | Body `{ refreshToken }`; family revoke, `204` |
| POST | `/auth/logout-all` | Access JWT; барлық refresh session revoke, `204` |
| GET | `/users/me` | Access JWT; public profile |
| POST | `/portfolio` | Access JWT; `{ name, walletAddress, chainId? }`, `201` |
| GET | `/portfolio?page=1&limit=20` | Access JWT; `{ items, page, limit, total, totalPages }` |
| GET | `/portfolio/:id` | Access JWT; portfolio + `holdings` |
| PATCH | `/portfolio/:id` | Access JWT; `{ name }` |
| DELETE | `/portfolio/:id` | Access JWT; archive, `204` |
| GET | `/portfolio/:id/holdings` | Access JWT; holdings array |
| GET | `/health` | Service dependency status; healthy `200`, unavailable `503` |

Portfolio Service internal endpoint-тері `/internal/portfolios`, `/internal/portfolios/:id`, `/internal/portfolios/:id/holdings` prefix-ін қолданады. Олар service token талап етеді және public JWT endpoint-тері ретінде қолданылмайды. API Gateway health DB/Redis-ті, Portfolio health DB/BullMQ/RabbitMQ-ды көрсетеді; dependency checks уақытпен шектеледі.

## Dependencies және migrations

API Gateway-ге `bcrypt` **6.0.0**, `jsonwebtoken` **9.0.3**, `@types/bcrypt` **6.0.0**, `@types/jsonwebtoken` **9.0.10** және direct `@blockchain-explorer/contracts` workspace dependency қосылды. Portfolio Service-ке direct `class-transformer` **0.5.1**, `class-validator` **0.15.1** қосылды. pnpm `allowBuilds` ішінде bcrypt native build рұқсат етілген; lockfile жаңартылды.

**Жаңа schema migration жасалған жоқ.** Existing users, refresh_tokens, portfolios, holdings және outbox_events схемалары жеткілікті. Fresh infrastructure үшін бұрынғы migrations-ты `pnpm db:migrate` арқылы қолданыңыз.

## Жасалған негізгі файлдар

Төмендегі әр топта көрсетілген prefix барлық filename-ге қатысты.

| Prefix | Жасалған файлдар | Міндеті |
| --- | --- | --- |
| `apps/api-gateway/src/modules/auth/` | `auth.controller.ts`, `auth.module.ts`, `auth.repository.ts`, `auth.service.ts`, `password.service.ts`, `token.service.ts` | Auth API, Drizzle transaction/session storage, bcrypt және JWT |
| `apps/api-gateway/src/modules/auth/` | `decorators/current-user.decorator.ts`, `guards/jwt-auth.guard.ts`, `types/auth.types.ts`, `types/authenticated-request.ts`, `types/authenticated-user.ts` | Trusted current user, reusable guard және public/internal types |
| `apps/api-gateway/src/modules/auth/` | `dto/auth-validation.ts`, `dto/register.dto.ts`, `dto/login.dto.ts`, `dto/refresh-token.dto.ts`, `auth.service.spec.ts`, `token.service.spec.ts` | Request validation және auth security тесттері |
| `apps/api-gateway/src/modules/users/` | `users.controller.ts` | `/users/me` |
| `apps/api-gateway/src/modules/portfolio/` | `portfolio.controller.ts`, `portfolio.module.ts`, `portfolio.service.ts`, `portfolio.client.ts`, `portfolio-response.decoder.ts` | Public BFF, internal HTTP және response validation |
| `apps/api-gateway/src/modules/portfolio/` | `dto/create-portfolio.dto.ts`, `dto/update-portfolio.dto.ts`, `portfolio.client.spec.ts`, `portfolio-validation.spec.ts` | Public validation, spoofing/error/timeout contract тесттері |
| `apps/portfolio-service/src/common/` | `guards/internal-service.guard.ts`, `validators/is-ethereum-address.ts`, `utils/format-token-balance.ts`, `utils/format-token-balance.spec.ts`, `utils/postgres-error.ts` | Service authorization, reusable address/precision/error utilities |
| `apps/portfolio-service/src/modules/portfolios/` | `portfolios.controller.ts`, `portfolios.module.ts`, `portfolios.repository.ts`, `portfolios.service.ts`, `portfolio-ownership.ts`, `portfolio-initial-sync.ts`, `portfolio-initial-sync.dispatcher.ts` | Internal API, ownership, CRUD және durable initial sync |
| `apps/portfolio-service/src/modules/portfolios/` | `dto/portfolio.dto.ts`, `dto/portfolio.dto.spec.ts`, `portfolio-ownership.spec.ts`, `portfolio-initial-sync.dispatcher.spec.ts`, `portfolios.service.spec.ts` | Internal validation және ownership/outbox behavior тесттері |
| `packages/contracts/src/` | `http/portfolio.contracts.ts`, `utils/ethereum-address.ts`, `events/blockchain-event.guards.ts` | Shared HTTP contracts, wallet helper және event payload validation |
| `packages/messaging/src/` | `health/check-dependency.ts` | Bounded dependency checks |
| `scripts/` | `verify-phase-7.mjs` | Нақты services/DB/Redis/RabbitMQ/RPC арқылы API flow тексеруі |
| `docs/` | `phase-7-auth-portfolio.md` | Осы phase-тың жұмыс тәртібі |

## Өзгертілген негізгі файлдар

| Файлдар | Өзгеріс |
| --- | --- |
| `.env.example`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` | JWT/BFF config, bcrypt build permission және dependency resolution |
| `package.json` | `verify:phase7` integration verification командасы |
| `apps/api-gateway/package.json`, `apps/portfolio-service/package.json` | Әр service тікелей қолданатын dependency-лер |
| `apps/api-gateway/src/app.module.ts`, `apps/portfolio-service/src/app.module.ts` | Auth және portfolio module wiring |
| `apps/api-gateway/src/modules/cache/cache.service.ts`, `apps/api-gateway/src/modules/health/health.controller.ts` | Redis ping және DB/Redis health |
| `apps/portfolio-service/src/database/database.service.ts`, `apps/portfolio-service/src/main.ts` | Worker/outbox аяқталғаннан кейін DB pool жабу, signal shutdown hooks және global DTO validation |
| `apps/portfolio-service/src/modules/health/health.controller.ts`, `apps/portfolio-service/src/modules/health/health.module.ts` | DB/BullMQ/RabbitMQ health |
| `apps/portfolio-service/src/modules/jobs/portfolio-job.types.ts`, `apps/portfolio-service/src/modules/jobs/portfolio-jobs.service.ts` | Typed initial-sync job, deterministic ID, enqueue deadline және queue health |
| `apps/portfolio-service/src/modules/messaging/messaging.module.ts`, `apps/portfolio-service/src/modules/messaging/portfolio-events.consumer.ts` | Health integration, event type guards және active/configured-chain filtering |
| `apps/portfolio-service/src/workers/portfolio-jobs.worker.ts` | Native ETH sync, configured chain guard және worker error handling |
| `packages/contracts/src/index.ts`, `packages/messaging/src/index.ts` | Жаңа shared contract/helper exports |
| `packages/messaging/src/rabbitmq/rabbitmq.client.ts`, `packages/messaging/src/redis/redis-cache.client.ts` | Channel connection status, Redis error handling және cache shutdown |
| `apps/api-gateway/test/app.e2e-spec.ts`, `apps/indexer-service/test/app.e2e-spec.ts`, `apps/portfolio-service/test/app.e2e-spec.ts` | Ескі Hello World assertion орнына compiled service-тердің нақты health readiness тексерісі |

Local ignored `.env` файлына жетіспеген JWT secrets үшін екі түрлі secure random мән және жаңа auth/BFF config қосылды; existing connection settings сақталды. Secret мәндері құжатта немесе Git diff ішінде жарияланбайды. Build-generated `tsconfig.build.tsbuildinfo` файлдары business өзгерістер тізіміне кірмейді.

## Іске қосу және тексеру

Root `.env` ішінде DB/Redis/RabbitMQ connection settings, нақты Sepolia RPC URL, `ETHEREUM_CHAIN_ID`, internal token және екі JWT secret орнатыңыз. Fresh clone үшін `.env.example` файлын `.env` ретінде көшіріп, мәндерін толтырыңыз.

```powershell
pnpm install
pnpm build:packages
pnpm --dir apps/api-gateway build
pnpm --dir apps/indexer-service build
pnpm --dir apps/portfolio-service build
pnpm infra:up
pnpm db:migrate
```

Үш бөлек terminal-да:

```powershell
pnpm dev:api
pnpm dev:indexer
pnpm dev:portfolio
```

Unit және e2e health тексерістері:

```powershell
pnpm --dir apps/api-gateway test
pnpm --dir apps/portfolio-service test
pnpm --dir apps/api-gateway test:e2e
pnpm --dir apps/indexer-service test:e2e
pnpm --dir apps/portfolio-service test:e2e
```

Толық API flow үшін infrastructure және existing migrations дайын болғанда:

```powershell
pnpm verify:phase7
```

Script compiled services-ті бөлек **3300/3301/3302** порттарында, `INDEXER_ENABLED=false` арқылы іске қосады. Ол register/login/profile/refresh, portfolio create/list/detail/holdings/rename, ownership rejection, logout/revoked refresh, archive және native ETH sync-ті тексереді. Native balance өзгертілмеген нақты configured RPC-ден алынады. Әр invocation үш temporary PostgreSQL database жасап, existing migrations-ты қолданады және жеке Redis cache/BullMQ queue/RabbitMQ exchange/consumer queue namespace-терін пайдаланады; shared database/outbox/schedulers өзгермейді. Cleanup тек successful CREATE registry және `shobj_description` ownership marker расталған өз databases-ін, дәл осы invocation namespace keys/topology-ін тазалап, өзі іске қосқан service process-терін жабады. PostgreSQL role-ға осы temporary databases үшін CREATE/DROP құқығы қажет. Phase 8 regression run-да осы толық isolated script-тің **11 checks passed**, барлық own resources тазаланды және нақты RPC balance салыстыруы өтті.

Қолмен тексергенде JWT-ді `Authorization: Bearer <accessToken>` header-іне беріңіз. Refresh/logout body: `{ "refreshToken": "..." }`. Create body: `{ "name": "Main Portfolio", "walletAddress": "0x..." }`. Initial sync async болғандықтан, holdings-ті бірнеше секундтан кейін қайта тексеріңіз. Басқа user арқылы detail/rename/archive/holdings `404`, duplicate wallet `409`, forged body/query owner `400` болуы керек.

Тесттер refresh hash/rotation/reuse/concurrency, inactive users, cross-owner filtering, exact balances, outbox retry және BFF response/error/security contracts-ты қамтиды.

## Орындалған тексеру нәтижелері

- `pnpm install`, `pnpm build:packages` және үш NestJS service build — сәтті, **0 TypeScript error**.
- Үш service-тің толық `tsconfig.json` бойынша `tsc --noEmit --incremental false` тексерісі де өтті, test TypeScript файлдарын қоса.
- API Gateway — **40 unit/security тест**, Portfolio Service — **19 тест** өтті. Indexer unit suite ішінде test файлдары жоқ; `--passWithNoTests` арқылы тексерілді.
- Үш service-тің нақты dependency health e2e тесті — **3/3 өтті**.
- `pnpm infra:up` — PostgreSQL, Redis және RabbitMQ healthy.
- `pnpm verify:phase7` — **11 нақты integration тексеруі өтті**: startup, register/login/profile, refresh rotation/replay family commit, JWT/validation, concurrent primary, ownership, rename/archive, logout-all және initial native ETH.
- Native ETH holding нақты RPC-дің сол block-тағы balance-імен және дәл decimal formatting-пен салыстырылды. Test services graceful shutdown жасап, тек generated test user/portfolio/session/outbox/job деректері тазаланды.
- `pnpm -r why bullmq` workspace-та бір нұсқаны — **5.81.5** — растады.

Verification кезінде жаңа chain scanning өшірілді (`INDEXER_ENABLED=false`); нақты indexing progress бұл phase-тың тексеруіне кірмейді. Existing outbox dispatch пен portfolio consumer қалыпты service startup режимінде іске қосылды. Жаңа migration жасалмады және migration командасы орындалмады: қолданылып тұрған databases existing schemas-қа сай болды.

Қазіргі tooling warnings: nested web workspace туралы pnpm ескертуі, deprecated transitive dependencies, TypeScript 6 пен `tsconfck` TypeScript `^5` peer range айырмашылығы және Vite-тің `vite-tsconfig-paths` plugin-і енді native path resolution-мен алмастырылуы мүмкін деген ескертуі. Бұл ескертулерді dependency tooling жаңарту жұмысында қарастыруға болады.

## Phase 8 үшін негіз

Reusable JWT guard/current user, typed public/internal contracts, нақты service database ownership, durable sync outbox және дәл balance formatting дайын. Келесі phase token discovery, prices/valuation, watchlists/alerts, rate limiting және observability-ді осы modules арқылы дамыта алады. Phase 7 толық token discovery немесе portfolio USD valuation есептемейді.
