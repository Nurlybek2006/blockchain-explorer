# Transaction history негізіндегі нақты P&L

Portfolio detail бетінде «Нақты пайда / шығын / True P&L» панелі және жеке мәмілелер журналы қосылды. Есеп валютасы — USD, әдісі — moving weighted average. Жаңа dependency қосылған жоқ; build кезінде анықталған [Next.js security advisory](https://nextjs.org/blog/nextjs-security-update-october-14-2026) үшін Next.js және ESLint config `16.4.1` patch нұсқасына жаңартылды.

## Дерек қайдан алынады

Қазіргі indexed wallet activity аударым санын, бағытын, активін, хэші мен уақытын береді. Онда нақты execution price, off-chain сатып алу сомасы немесе басқа әмияннан келген активтің бастапқы cost basis-і жоқ. Сондықтан received/sent аударымы автоматты buy/sell болып саналмайды, ағымдағы market price тарихи сатып алу бағасының орнына қойылмайды.

Пайдаланушы мәмілені журналға енгізеді немесе Portfolio Activity жолындағы «Өзіндік құнын қосу / Add cost basis» әрекетін таңдайды. Соңғы әрекет hash, activity ID, актив, нақты raw quantity, decimals және уақытты толтырады. Received үшін бастапқы түр — `transfer_in`, sent үшін — `transfer_out`; пайдаланушы buy/sell екенін өзі белгілеп, нақты бағаны енгізеді. Self және zero-amount аударымдары үшін cost-basis әрекеті көрсетілмейді. Decimals белгісіз болса, әрекет бұғатталады.

Бұл автоматты DEX swap decoder немесе historical-price estimator емес. Нәтиже енгізілген журналдың дұрыстығы мен толықтығына тәуелді. Activity coverage бұрынғыдай indexed successful ETH/ERC-20 transfers-пен шектеледі; internal calls пен Gas movement автоматты импортталмайды. Chain reorg пайдаланушы енгізген журналды автоматты жоймайды: reference-ті тексеріп, қажет жазбаны өзгерту/жою керек.

## Журналдағы түрлер

| Түр | Есептеу |
| --- | --- |
| `buy` | Quantity қосылады; `quantity × execution price + feeUsd` cost basis-ке қосылады |
| `sell` | Орташа өзіндік құн пропорционалды алынады; `quantity × sale price − feeUsd − removed basis` realized P&L-ге қосылады |
| `transfer_in` | Алдыңғы әмияннан көшірілген cost per unit және optional fee бойынша quantity/basis қосылады; бұл нөлдік құны бар сатып алу деп болжанбайды |
| `transfer_out` | Quantity мен орташа basis шығарылады; realized gain/loss жасалмайды |
| `fee` | Криптовалютамен төленген комиссия quantity-ді азайтады; consumed basis нөлдік түсіммен шығынға жазылады |

`transfer_out` және `fee` үшін `unitPriceUsd = null`, `feeUsd = 0`. Комиссияны екі рет қоспау керек: USD түрінде buy/sell-ге енгізілген fee-ді екінші рет `fee` жазбасымен есептемеңіз. Криптовалютамен төленген fee бөлек quantity disposal ретінде тіркеледі. Басқа активтер арасындағы swap үшін нақты USD execution мәндерімен екі leg енгізуге болады; әр fee бір рет қана бөлінеді.

Жазбалар `occurredAt ASC, sequence ASC` ретімен replay жасалады. Бірдей timestamp кезінде insertion sequence тұрақты тәртіп береді. Қолдағы журнал санынан артық сатуға/аударуға/fee төлеуге болмайды. Бұрынғы buy бағасын өзгерткенде барлық кейінгі realized/unrealized мәндер қайта есептеледі. Кейінгі disposal-ға негіз болған buy-ды жою не азайту бүкіл replay-ді жарамсыз етсе, операция transaction ішінде қайтарылады.

## Формулалар

```text
Average entry = remaining cost basis / remaining quantity
Current value = observed wallet quantity × current USD price
Unrealized P&L = current value − remaining cost basis
Realized P&L = sum(net sale proceeds − disposed average basis)
               − cost basis consumed by crypto-fee entries
Total P&L = realized + unrealized
Capital basis = remaining basis + basis consumed by sells/crypto fees
ROI = total P&L / capital basis × 100
Unrealized ROI = unrealized P&L / remaining basis × 100
```

«Салынған қаражат / Invested» card-ы remaining/open cost basis-ті көрсетеді. ROI denominator-ы open + disposed cost болғандықтан, оны тек қазіргі ашық позиция құнымен шатастырмау керек. Transfer-out basis есептен шығады; transfer-in бастапқы basis-ті әкеледі. ROI нөлдік denominator кезінде `null`, UI-де «—» болады. Бұл time-weighted return немесе tax report емес.

Орташа cost-ты buy/sell тарихынан replay ету тәсілі [Bitquery wallet P&L құжаттамасымен](https://docs.bitquery.io/docs/trading/crypto-trades-api/wallet-pnl/) салыстырылды. Average cost пен fee байланысы және realized/unrealized ұғымдары [Coinbase performance түсіндірмесінде](https://help.coinbase.com/en-ca/coinbase/trading-and-funding/sending-or-receiving-cryptocurrency/my-investment-performance) де берілген. Осы жобадағы transfers/fees және ROI denominator ережелері жоғарыда нақты анықталған.

## Дәлдік және белгісіз деректер

Raw quantity `numeric(78,0)` ретінде сақталады және uint256 шегімен тексеріледі. Human input BigInt арқылы дәл raw units-ке айналады; exponential notation қабылданбайды. ERC-20 decimals `0..255`, native ETH decimals — 18. Price/fee `numeric(78,18)` және bounded decimal strings ретінде сақталады. Есептер бар `FinanceDecimal` (160-digit precision) арқылы жасалады; intermediate moving-average arithmetic дөңгелектенбейді. API-дағы ақша мәндері existing `toMoney` тәртібімен 18 fractional digit-ке дейін беріледі. UI USD display-ін форматтайды, tooltip-те exact response мәндері сақталады.

P&L asset бойынша белгісіз болады, егер acquisition history жоқ, ledger quantity байқалған wallet balance-пен сәйкес емес немесе balance әлі RPC арқылы байқалмаған болса. Жоқ row нөлдік balance деп саналмайды. Missing/stale quote кезінде known cost basis пен recorded realized result сақталады, current value/unrealized/total/ROI белгісіз болады. Нақты нөлдік баға missing price-пен шатастырылмайды. Толық жабылған, нөлдік balance-і байқалған позиция үшін current quote қажет емес.

Портфель summary partial деректерді толық пайда ретінде қоспайды. Жеке reconciled asset нәтижелері көрсетіле береді, ал толық емес aggregate return «—» болады. Balance сәйкестігі барлық бұрынғы buy/sell жұбы енгізілгенін дәлелдемейді; интерфейс осы шектеуді түсіндіреді.

Market 24h change және snapshot value change бұрынғыдай бөлек қалды. `/analytics` ішіндегі `pnlAvailable` енді нақты журнал/quote/reconciliation жағдайын көрсетеді; `pnlReason` толық болғанда `null`, әйтпесе `cost_basis_unavailable`, `history_incomplete` немесе `price_unavailable`.

## Persistence және қауіпсіздік

Жаңа migration: `apps/portfolio-service/src/database/migrations/0003_portfolio_cost_basis.sql`.

`portfolio_trades` портфельге FK арқылы байланысады; quantity/price/fee/type constraints, `(portfolio_id, client_id)` idempotency unique index, nullable `(portfolio_id, activity_id)` unique index және ordered history index бар. Бір hash ішінде бірнеше token leg болуы мүмкін, сондықтан hash жалғыз өзі unique key емес.

Public identity тек JWT `CurrentUser` арқылы алынады. Gateway body-ден тек белгілі trade өрістерін жобалайды; `userId`/бөгде өрістер validation-нан өтпейді. Internal boundary service token және owner query арқылы қорғалады. Read snapshot repeatable-read transaction ішінде portfolio/holdings/journal-ды бірге алады. Write портфель row-ын lock етіп, idempotency/replay/write операцияларын serializes; concurrent oversells бір уақытта commit бола алмайды. Archived/foreign portfolio үшін барлық операция 404 береді.

Журнал шегі — бір портфельге 10,000 жазба; list API page/limit арқылы беріледі (limit 1..100). `clientId` UUID бір form lifecycle бойы сақталады: network retry бір мәмілені қайталап қоспайды. Өзгертілген payload-пен сол key-ді қайталау — 409. Қате journal/edit immutable price cache немесе holdings balance-ін өзгертпейді; тек журналдан қайта есептеледі.

## API

| Public endpoint | Мағынасы |
| --- | --- |
| `GET /portfolio/:id/pnl` | Portfolio және asset бойынша P&L |
| `GET /portfolio/:id/trades?page=1&limit=20` | Журналдың newest-first беті |
| `POST /portfolio/:id/trades` | `PortfolioTradeInput` жазбасын жасау / idempotent retry |
| `PATCH /portfolio/:id/trades/:tradeId` | Жазбаны толық ауыстыру; бастапқы `clientId` сақталады |
| `DELETE /portfolio/:id/trades/:tradeId` | Қалған history жарамды болса жою (204) |

Internal endpoint prefix — `/internal/portfolios`. Shared `pnl.contracts.ts` browser-safe input/response decoders, reason/side types және exact quantity conversion береді. Gateway malformed upstream response-ты 502-ге айналдырады; UI raw backend detail көрсетпейді.

## Интерфейс

Portfolio detail → Activity → True P&L панелі мен journal. «Мәміле қосу» қолмен history енгізеді; activity жолындағы әрекет дәл transfer metadata-ны толтырады. Журналда edit/delete және pagination бар. Панельде Invested, Current Value, Profit, ROI, Realized/Unrealized және asset бойынша average entry/cost basis/price/result/status көрсетіледі. KK/EN dictionary, currency/quantity/UTC formatting, a11y table labels және toast/error feedback сақталған. Locale ауыстыру form state-ін не WebSocket connection-ды қайта құрмайды.

## Тексеру және іске қосу

Осы workspace-та additive migration локал portfolio DB-ға қолданылды. Басқа ортада алдымен:

```sh
pnpm install
pnpm build:packages
pnpm --dir apps/portfolio-service db:migrate
pnpm --dir apps/portfolio-service build
pnpm --dir apps/api-gateway build
pnpm verify:i18n
```

Іске қосылып тұрған сервистер жаңа module және framework patch-ті жүктеу үшін қайта іске қосылуы керек. Development командалары: `pnpm dev:portfolio`, `pnpm dev:api`, `pnpm dev:web`.

2026-10-23 күнгі тексеру:

| Тексеру | Нәтиже |
| --- | --- |
| `pnpm install --frozen-lockfile`, `pnpm peers check` | Өтті, peer issues жоқ |
| Shared packages және үш backend build | Өтті, TypeScript errors — 0 |
| Portfolio unit + coverage | 146 тест өтті; critical coverage thresholds өтті |
| Gateway unit | 137 тест өтті |
| Web unit | 231 тест өтті |
| Shared contracts unit | 23 тест өтті |
| Public HTTP/event contract tests | 17 тест өтті |
| Real-app e2e | 54 тест өтті: жаңа P&L сценарийлері — 8, бұрынғы регрессия — 46 |
| `tests` strict NodeNext typecheck | Өтті |
| `pnpm verify:i18n` | Strict keys/parity, hardcoded UI audit, frontend lint, production build және 76 SSR response тексерісі өтті |
| Backend type-aware lint | Exit 0; бұрынғы test-file warnings сақталған |
| Additive migration | Disposable Testcontainers DB және локал portfolio DB-да өтті |

`pnl.math.ts`: lines 100%, statements 96.55%, branches 95.71%. `pnl.service.ts`: lines 100%, statements 96%, branches 90.9%. Негізгі мысалдар unit тесттерінде дәл тексерілді: $6250 → $8000, +$1750 (+28%); $4000 → $5300, +$1300 (+32.5%).

E2e нақты PostgreSQL/Redis/RabbitMQ және үш application process қолданады. Owner/archived boundaries, forged identity, concurrent idempotent retry, UUID casing, duplicate activity, bad/future input, partial sale, balance mismatch/reconciliation, historical edit/replay, invalid delete rollback, concurrent oversell және crypto-fee persistence тексеріледі. Fixtures оқшауланған: негізгі базаға demo holdings/trades қосылған жоқ.

Бірінші web build compile/typecheck өткеннен кейін Next.js 16.4.0 security advisory-ге тоқтады. `16.4.1` patch орнатылып, dependency peers және толық web verification қайта өтті. Жаңа lint/build error жоқ; package manager бұрынғы ESLint 9 және кейбір transitive dependency deprecation warnings көрсетеді. Жаңа browser click/visual automation қосылған жоқ; UI SSR tests, production HTTP SSR және real API e2e тексерілді.

## Өзгерген файлдар

Бастапқы user edit болған `indexer-explorer.client.spec.ts` өзгертілген жоқ. Generated build-cache файлдары сақталған snapshot күйінде қалдырылды. Оларды HEAD-пен ауыстыру automatic approval review арқылы қабылданбады, сондықтан ол әрекет орындалмады. Бұл source inventory cache файлдарын қамтымайды.

### Жаңа файлдар — 21

| Файл | Өзгеріс |
| --- | --- |
| [apps/api-gateway/src/modules/portfolio/dto/portfolio-trade.dto.ts](../apps/api-gateway/src/modules/portfolio/dto/portfolio-trade.dto.ts) | Typed trade validation және forged/extra owner field rejection қосылды. |
| [apps/portfolio-service/src/database/migrations/0003_portfolio_cost_basis.sql](../apps/portfolio-service/src/database/migrations/0003_portfolio_cost_basis.sql) | Trade table SQL/snapshot және migration journal metadata қосылды. |
| [apps/portfolio-service/src/database/migrations/meta/0003_snapshot.json](../apps/portfolio-service/src/database/migrations/meta/0003_snapshot.json) | Trade table SQL/snapshot және migration journal metadata қосылды. |
| [apps/portfolio-service/src/database/schema/portfolio-trades.schema.ts](../apps/portfolio-service/src/database/schema/portfolio-trades.schema.ts) | Exact quantity/fees, FK, idempotency/activity indexes және DB constraints анықталды. |
| [apps/portfolio-service/src/modules/analytics/dto/trade.dto.ts](../apps/portfolio-service/src/modules/analytics/dto/trade.dto.ts) | Typed trade validation және forged/extra owner field rejection қосылды. |
| [apps/portfolio-service/src/modules/analytics/pnl.controller.ts](../apps/portfolio-service/src/modules/analytics/pnl.controller.ts) | Owner-scoped internal/public P&L және trade CRUD routes қосылды. |
| [apps/portfolio-service/src/modules/analytics/pnl.math.spec.ts](../apps/portfolio-service/src/modules/analytics/pnl.math.spec.ts) | Cost basis, contracts, localization, ownership не regression тесттері қосылды/бейімделді. |
| [apps/portfolio-service/src/modules/analytics/pnl.math.ts](../apps/portfolio-service/src/modules/analytics/pnl.math.ts) | Moving average, realized/unrealized P&L, transfers/fees және balance reconciliation қосылды. |
| [apps/portfolio-service/src/modules/analytics/pnl.service.spec.ts](../apps/portfolio-service/src/modules/analytics/pnl.service.spec.ts) | Cost basis, contracts, localization, ownership не regression тесттері қосылды/бейімделді. |
| [apps/portfolio-service/src/modules/analytics/pnl.service.ts](../apps/portfolio-service/src/modules/analytics/pnl.service.ts) | Owned snapshot, current quotes, bounded history және validation біріктірілді. |
| [apps/portfolio-service/src/modules/analytics/trades.repository.ts](../apps/portfolio-service/src/modules/analytics/trades.repository.ts) | Private row lock, idempotency және atomic replay/write енгізілді. |
| [apps/web/src/features/portfolio/pnl.module.css](../apps/web/src/features/portfolio/pnl.module.css) | Dark layout үшін sublines/status/activity action стильдері қосылды. |
| [apps/web/src/features/portfolio/portfolio-pnl.spec.ts](../apps/web/src/features/portfolio/portfolio-pnl.spec.ts) | Cost basis, contracts, localization, ownership не regression тесттері қосылды/бейімделді. |
| [apps/web/src/features/portfolio/portfolio-pnl.tsx](../apps/web/src/features/portfolio/portfolio-pnl.tsx) | Localized summary/asset results және editable journal UI қосылды. |
| [apps/web/src/features/portfolio/trade-form.tsx](../apps/web/src/features/portfolio/trade-form.tsx) | Exact quantity/UTC form, stable retry UUID және activity prefill қосылды. |
| [apps/web/src/i18n/locales/pnl.en.ts](../apps/web/src/i18n/locales/pnl.en.ts) | PNL/forms/errors/coverage KK/EN мәтіндері қосылды. |
| [apps/web/src/i18n/locales/pnl.kk.ts](../apps/web/src/i18n/locales/pnl.kk.ts) | PNL/forms/errors/coverage KK/EN мәтіндері қосылды. |
| [docs/true-pnl.md](../docs/true-pnl.md) | Әдіс, API, migration, data coverage және verification құжатталды. |
| [packages/contracts/src/http/pnl.contracts.spec.ts](../packages/contracts/src/http/pnl.contracts.spec.ts) | Cost basis, contracts, localization, ownership не regression тесттері қосылды/бейімделді. |
| [packages/contracts/src/http/pnl.contracts.ts](../packages/contracts/src/http/pnl.contracts.ts) | Shared P&L/trade types, exact quantity conversion және bounded validators/decoders қосылды. |
| [tests/e2e/portfolio-pnl.spec.ts](../tests/e2e/portfolio-pnl.spec.ts) | Cost basis, contracts, localization, ownership не regression тесттері қосылды/бейімделді. |

### Өзгертілген файлдар — 29

| Файл | Өзгеріс |
| --- | --- |
| [README.md](../README.md) | True P&L мүмкіндігі мен documentation сілтемесі жаңартылды. |
| [apps/api-gateway/src/common/http/intelligence-response.decoder.ts](../apps/api-gateway/src/common/http/intelligence-response.decoder.ts) | Analytics P&L availability/reason contract жаңартылды. |
| [apps/api-gateway/src/modules/intelligence/intelligence.client.spec.ts](../apps/api-gateway/src/modules/intelligence/intelligence.client.spec.ts) | Cost basis, contracts, localization, ownership не regression тесттері қосылды/бейімделді. |
| [apps/api-gateway/src/modules/intelligence/intelligence.client.ts](../apps/api-gateway/src/modules/intelligence/intelligence.client.ts) | Owner propagation, field projection және upstream P&L decoding қосылды. |
| [apps/api-gateway/src/modules/portfolio/portfolio.controller.ts](../apps/api-gateway/src/modules/portfolio/portfolio.controller.ts) | Owner-scoped internal/public P&L және trade CRUD routes қосылды. |
| [apps/portfolio-service/src/database/migrations/meta/_journal.json](../apps/portfolio-service/src/database/migrations/meta/_journal.json) | Trade table SQL/snapshot және migration journal metadata қосылды. |
| [apps/portfolio-service/src/database/schema/index.ts](../apps/portfolio-service/src/database/schema/index.ts) | Жаңа schema/shared P&L exports қосылды. |
| [apps/portfolio-service/src/modules/analytics/analytics.fixtures.ts](../apps/portfolio-service/src/modules/analytics/analytics.fixtures.ts) | PnL dependency үшін typed fixture қосылды. |
| [apps/portfolio-service/src/modules/analytics/analytics.module.ts](../apps/portfolio-service/src/modules/analytics/analytics.module.ts) | PnL controller/service/repository DI graph-қа тіркелді. |
| [apps/portfolio-service/src/modules/analytics/analytics.observability.spec.ts](../apps/portfolio-service/src/modules/analytics/analytics.observability.spec.ts) | Cost basis, contracts, localization, ownership не regression тесттері қосылды/бейімделді. |
| [apps/portfolio-service/src/modules/analytics/analytics.service.spec.ts](../apps/portfolio-service/src/modules/analytics/analytics.service.spec.ts) | Cost basis, contracts, localization, ownership не regression тесттері қосылды/бейімделді. |
| [apps/portfolio-service/src/modules/analytics/analytics.service.ts](../apps/portfolio-service/src/modules/analytics/analytics.service.ts) | P&L capability нақты journal reconciliation-ге байланыстырылды. |
| [apps/portfolio-service/vitest.config.ts](../apps/portfolio-service/vitest.config.ts) | PNL core үшін critical coverage thresholds бекітілді. |
| [apps/web/package.json](../apps/web/package.json) | Build-ті бөгеген security advisory үшін Next.js/ESLint config 16.4.1 patch жаңартылды. |
| [apps/web/src/features/analytics/analytics-localization.spec.ts](../apps/web/src/features/analytics/analytics-localization.spec.ts) | Cost basis, contracts, localization, ownership не regression тесттері қосылды/бейімделді. |
| [apps/web/src/features/analytics/portfolio-analytics.tsx](../apps/web/src/features/analytics/portfolio-analytics.tsx) | Unconditional unavailable notice жаңа P&L panel түсіндірмесіне ауыстырылды. |
| [apps/web/src/features/portfolio/activity.module.css](../apps/web/src/features/portfolio/activity.module.css) | Dark layout үшін sublines/status/activity action стильдері қосылды. |
| [apps/web/src/features/portfolio/portfolio-activity.tsx](../apps/web/src/features/portfolio/portfolio-activity.tsx) | Activity-to-journal action және P&L panel интеграциясы қосылды. |
| [apps/web/src/features/portfolio/portfolio-detail.tsx](../apps/web/src/features/portfolio/portfolio-detail.tsx) | Activity-to-journal action және P&L panel интеграциясы қосылды. |
| [apps/web/src/i18n/errors.ts](../apps/web/src/i18n/errors.ts) | Trade validation/duplicate қателері localized context-ке map жасалды. |
| [apps/web/src/i18n/locales/en.ts](../apps/web/src/i18n/locales/en.ts) | PNL namespace aggregate dictionary-ге қосылды. |
| [apps/web/src/i18n/locales/kk.ts](../apps/web/src/i18n/locales/kk.ts) | PNL namespace aggregate dictionary-ге қосылды. |
| [apps/web/src/lib/api/intelligence.decoder.ts](../apps/web/src/lib/api/intelligence.decoder.ts) | Analytics P&L availability/reason contract жаңартылды. |
| [apps/web/src/lib/api/portfolio.api.ts](../apps/web/src/lib/api/portfolio.api.ts) | PnL және trade CRUD frontend API methods қосылды. |
| [docs/localization-kz-en.md](../docs/localization-kz-en.md) | Localization architecture жаңа namespace-пен жаңартылды. |
| [packages/contracts/src/browser.ts](../packages/contracts/src/browser.ts) | Жаңа schema/shared P&L exports қосылды. |
| [packages/contracts/src/http/intelligence.contracts.ts](../packages/contracts/src/http/intelligence.contracts.ts) | Analytics P&L availability/reason contract жаңартылды. |
| [packages/contracts/src/index.ts](../packages/contracts/src/index.ts) | Жаңа schema/shared P&L exports қосылды. |
| [pnpm-lock.yaml](../pnpm-lock.yaml) | Build-ті бөгеген security advisory үшін Next.js/ESLint config 16.4.1 patch жаңартылды. |
