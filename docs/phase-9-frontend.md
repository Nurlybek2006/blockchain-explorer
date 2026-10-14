# Phase 9: Blockchain Explorer frontend

Phase 9 `apps/web` ішінде Ethereum Explorer және жеке portfolio workspace интерфейсін жасайды. UI ағылшын тілінде, түсіндірме құжат қазақ тілінде. Browser тек API Gateway public endpoint-теріне сұрау жібереді; Indexer немесе Portfolio Service internal endpoint-тері frontend-ке ашылмайды.

## 1. Frontend architecture

Stack — Next.js **16.4.0**, React **19.3.0**, TypeScript strict mode, App Router, CSS variables және CSS Modules. Үлкен UI framework, Tailwind, chart library немесе browser automation framework қосылмайды.

`src/app` routing пен metadata-ға жауап береді. `src/features` нақты page functionality-ді топтайды: auth, explorer, portfolio, analytics, watchlists және alerts. `src/lib/api` typed HTTP клиент пен runtime response decoding береді. `src/lib/auth`, `src/lib/format`, `src/lib/utils` shared session, precision-safe formatting және search/pagination logic сақтайды. Providers auth пен toast notification күйін басқарады; `useResource` fetch lifecycle мен polling-ті біріктіреді.

Production UI ішінде seeded verification data, synthetic balance немесе price жоқ. Verification fixtures тек `scripts/verify-phase-9.mjs` бөлек local server-інде және осы script жасаған temporary databases ішінде өмір сүреді.

## 2. App Router

Route groups URL-ге кірмейді: `(auth)` login/register layout үшін, `(dashboard)` authenticated workspace үшін қолданылады. Route entry файлдары feature component-терді қосады, search params/route params мәндерін қабылдап, metadata береді.

| Route | Мақсаты | Access |
| --- | --- | --- |
| `/` | Explorer overview, stats, latest blocks, search | Public |
| `/blocks` | Backend pagination арқылы blocks тізімі | Public |
| `/blocks/[number]` | Block details және transactions | Public |
| `/tx/[hash]` | Transaction, receipt, gas, logs, ERC-20 transfers | Public |
| `/address/[address]` | Indexed address, transactions, transfers | Public |
| `/tokens` | Indexed token metadata тізімі | Public |
| `/token/[address]` | Token metadata және transfers | Public |
| `/search` | Input түрін анықтау және қажетті detail route-қа бағыттау | Public |
| `/login`, `/register` | Auth forms | Anonymous |
| `/dashboard` | Portfolio workspace entry | JWT |
| `/portfolio` | Wallet portfolio тізімі/create | JWT |
| `/portfolio/[id]` | Holdings, valuation, history, analytics, rename/archive | JWT |
| `/watchlists`, `/watchlists/[id]` | Watchlist және items басқару | JWT |
| `/alerts` | Alert rules және events | JWT |
| `/settings` | Current account, logout/logout-all | JWT |

Global `loading.tsx`, `error.tsx`, `not-found.tsx` loading/error/missing-route күйін береді. `error.tsx` — Client Component; installed Next.js 16.4.0 API-ындағы `retry()` prop арқылы route rendering-ті қайта бастайды. API resource `404` болса feature ішіндегі context-specific missing state көрсетіледі; route жоқ болғандағы Next `404` бөлек өңделеді.

## 3. Server және Client Components

Root layout, route wrappers және metadata Server Components болып қалады. `ui-base.tsx` static primitives Server және Client Components ішінде қолдануға жарамды; `ui-controls.tsx` modal/tabs/pagination/copy interaction үшін Client Component boundary береді. Form, search, session-dependent UI, toast, polling және interactive SVG — Client Components. `ui.tsx` — public re-export entry.

Private resource data сервер HTML-інде token арқылы алдын ала жүктелмейді. Initial session snapshot тұрақты `loading` күйінде болады; browser mount кезінде session қалпына келеді. Бұл access JWT-ті server-side shared module күйіне немесе rendered HTML-ге орналастырудан сақтайды.

Client route protection UI navigation-ды реттейді. Нақты authentication/authorization әр private HTTP request үшін Gateway JWT guard және downstream ownership арқылы тексеріледі.

## 4. API layer және contract validation

`apiRequest` API base URL, URL query encoding, `Authorization: Bearer`, JSON body, AbortController, timeout, safe HTTP error mapping, authenticated retry және runtime decoder-ді біріктіреді. Redirect қабылданбайды, cache `no-store`; raw backend error body/stack user-ге көрсетілмейді.

API layer `@blockchain-explorer/contracts/browser` арқылы browser-safe shared types-ті қайта қолданады; feature view-лердегі type-only root imports runtime bundle-ге кірмейді. Explorer және auth contracts нақты backend responses негізінде shared package-ке additive түрде шығарылған; қолданыстағы portfolio/intelligence contracts сақталған. Browser entry Node-only runtime import-қа тәуелді емес.

Әр decoder HTTP JSON-ды `unknown` ретінде қабылдайды. Required strings, nullable values, timestamps, enums, pagination және decimal/integer strings тексеріліп, public өрістер ғана құралады. Жарамсыз contract user-ге қауіпсіз unexpected-response error береді; unsafe cast арқылы дұрыс shape болып көрсетілмейді.

| Gateway endpoint | Frontend client |
| --- | --- |
| `/stats`, `/blocks`, `/blocks/:number`, `/tx/:hash`, `/address/:address`, `/tokens`, `/token/:address` | `explorer.api.ts` |
| `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/logout-all`, `/users/me` | `auth.api.ts` |
| `/portfolio` және detail/holdings/valuation/history/analytics | `portfolio.api.ts` |
| `/prices`, `/watchlists`, `/alerts` және items/events/read | `intelligence.api.ts` |

Gateway ішкі service token-ді өзі қосады. Frontend-де `INTERNAL_SERVICE_TOKEN`, database, Redis/Rabbit credentials немесе provider API key қолданылмайды.

## 5. Auth/session flow

Register form email, password, confirm password және optional display name қабылдайды. Password кемінде сегіз таңба, ең көбі 72 UTF-8 byte болуы керек; браузер validation-ы backend bcrypt шектеуіне сәйкес келеді. Login incorrect credentials үшін түсінікті message береді; fields жоғалмайды және submit қайта басылуы disabled күйімен шектеледі.

`SessionController` current user, status және access token-ді memory-де ұстайды. Refresh token `blockchain-explorer.refresh-token`, current user identity `blockchain-explorer.session-user` localStorage key ішінде сақталады. Refresh арқылы page reload кезінде session қалпына келеді. Storage unavailable болса memory session жұмысын жалғастырады, бірақ reload persistence болмайды.

`AuthProvider` session subscribe lifecycle-ін басқарады. `AuthGate` anonymous user-ді `/login?next=...` адресіне жібереді. `safeReturnPath` external/protocol-relative/backslash/control-character destination-дерді және login/register redirect cycle-дерін қабылдамайды. Login/register сәтті аяқталса бастапқы protected route немесе `/portfolio` ашылады.

Logout local user/token state-ті бірден clear етеді, кейін backend refresh family revoke сұрауын жібереді. Logout-all барлық backend refresh sessions-ті revoke етеді; existing access JWT expiry-ге дейін жарамды болуы мүмкін — бұл Phase 7 semantics-і сақталған. Profile update endpoint болмағандықтан settings ішінде fake edit action жоқ.

**Storage tradeoff:** refresh token localStorage ішінде болғандықтан same-origin XSS оны оқи алады. Access token localStorage-ге жазылмайды, React plain text escaping сақталған, `dangerouslySetInnerHTML` қолданылмайды. HttpOnly-cookie session transport future hardening ретінде бөлек Gateway/BFF өзгерісін қажет етеді; осы phase мұндай cookie архитектурасы бар деп көрсетпейді.

## 6. Refresh token coordination

Бір tab ішінде қатар келген refresh әрекеттері shared `refreshPromise`-ті күтіп, бір rotation орындайды. Protected request `401` алса current token басқа request арқылы жаңарып кеткенін тексереді; қажет болса refresh жасап, request-ті бір рет қайталайды. Қайта `401` болса session clear болады.

Қолдау бар browser-де Web Locks `blockchain-explorer.session` lock-ы refresh/login/register/logout операцияларын tab-тар арасында реттейді. Lock ішінде refresh token localStorage-ден қайта оқылады: күтіп тұрған tab ескі token-ді blind reuse жасамайды. Web Locks unavailable болса coordination бір tab шегінде ғана кепілденеді; бұл fallback-та әр tab үшін shared browser lock бар деп есептеуге болмайды.

Logout немесе жаңа login кезінде session generation өзгереді. Бұрын басталған refresh completion жаңа session-ды алмастыра немесе signed-out user-ді қайта тірілте алмайды. Storage remove/clear event басқа tab-тағы UI session-ды clear етеді. Басқа tab жаңа account-қа кірсе identity key change ескі access token мен private UI data-ны алдымен clear етіп, жаңа stored session-ды қалпына келтіреді. `AuthGate` private subtree-ді user identity бойынша remount жасайды.

Request басталған user identity refresh/retry кезінде өзгерсе, API client бұрынғы mutation-ды жаңа account атынан қайта жібермейді; user action-ды жаңа session ішінде explicit қайталауы керек. Бұл protection backend ownership checks-ті алмастырмайды, қосымша frontend account-boundary guard ретінде жұмыс істейді.

## 7. Explorer pages және search

Overview `/stats` және latest `/blocks` сұрауын қатар орындайды; periodic refresh жаңа indexer data-ны көрсетеді. Blocks/tokens/address/transfer views backend pagination қолданады, өте үлкен table-ді түгел browser-ге жүктемейді.

Block details number/hash/parent hash, timestamp, miner, gas және transactions көрсетеді. Transaction view receipt мәртебесін success/failed/pending деп береді; fee raw gas × effective price арқылы bigint-пен есептеледі. Contract creation, nullable receipt және empty logs бөлек түсіндірілген. Token transfer decimals белгісіз болса amount raw units ретінде анық белгіленеді.

Address view indexer байқап сақтаған мәліметке сүйенеді: бұл arbitrary address үшін автоматты live blockchain lookup емес. Token name/symbol/decimals/supply `null` болса unavailable күйі көрсетіледі; token metadata ойдан жасалмайды.

Search parser numeric string → block number, `0x` + 64 hex → transaction, `0x` + 40 hex → address деп анықтайды. Addresses/hashes lowercase нормализацияланады; block number bigint арқылы сақталады. Input қате болса navigation жасалмай, нақты формат нұсқаулығы беріледі.

`CopyButton` address/hash көшіріп, екі секунд copied feedback береді. Clipboard error fallback selection/copy message-імен өңделеді.

## 8. Portfolio pages және valuation semantics

Portfolio list create modal, primary badge, wallet address, asset count, total value және 24h market change көрсетеді. Total API-дан `null` келсе unknown күйі сақталады; priced subtotal толық total болып көрсетілмейді. Stale prices және incomplete coverage визуалды белгіленеді.

Detail holdings raw/formatted balances, unit price, value, 24h change және freshness metadata береді. Rename және archive API арқылы орындалады; destructive action explicit UI confirmation талап етеді. Бұл backend archive semantics-ін physical wallet deletion деп өзгертпейді.

Market change — current holdings-тің price change әсері. Snapshot value change balance өзгерістерін де қамтиды. Cost basis жоқ болғандықтан true investment P&L қолжетімсіз; UI market/snapshot figures-ді investment returns деп атамайды.

Жаңа portfolio worker native ETH initial sync аяқталғанша incomplete болуы мүмкін. History тек толық, fresh valuations snapshot-тары жиналғанда пайда болады; frontend missing points орнына synthetic chart жасамайды.

## 9. SVG charts және precision

Portfolio history диапазоны `24h`, `7d`, `30d`, `90d`; backend history sampling пен timestamp order сақталады. Line chart SVG арқылы салынады, third-party chart package қажет емес. Empty history, single point және equal values бөлек өңделеді.

History USD strings bigint fixed-point шкаласына ауыстырылады. SVG coordinates үшін ғана bounded ratio `Number`-ге айналады; бастапқы money values tooltip/table ішінде exact strings болып қалады. Point pointer/touch арқылы немесе ArrowLeft/ArrowRight/Home/End пернелерімен таңдалады. Accessible title және snapshot table alternative беріледі.

Allocation bars backend `allocationBasis: priced_assets` semantics-іне сүйенеді. Percentages priced subtotal ішіндегі үлесті көрсетеді; unpriced holdings алынып тасталғаны ашық жазылады. CSS width үшін percentage ғана `0..100` шегінде controlled conversion арқылы беріледі.

Formatting raw bigint/decimal strings-ті floating-point balances-ке айналдырмайды. USD rounding bigint-пен жасалады; өте кішкентай nonzero value `<$0.01` түрінде көрсетіледі. Address/hash қысқартылады, толық value title/copy арқылы қолжетімді. Timestamps UTC түрінде көрсетіледі.

## 10. Watchlists

Watchlist create/rename/delete және detail items add/remove public Gateway API-ға байланған. Item type `address` немесе `token`; item address validation және label қолданылады. Address item explorer address page-ке, token item token detail-ға апарады.

Duplicate item `409`, missing/other-owner list `404`, invalid input `400` user-ге safe feedback береді. Delete/remove explicit confirmation арқылы орындалады. Response ownership userId-ті browser body-ден қабылдау арқылы айналып өтпейді; Gateway authenticated user-ден trusted owner алады.

## 11. Alerts және events

Alert form backend қолдайтын төрт rule type-қа бейімделеді:

| Type | UI config |
| --- | --- |
| `price_above`, `price_below` | Positive decimal USD threshold; token address optional, native ETH default; wallet filter жоқ |
| `wallet_activity` | Required wallet, optional token filter; threshold жоқ |
| `whale` | Optional positive USD threshold және wallet/token filters; omitted threshold backend default-қа сүйенеді |

Threshold input string күйінде жіберіледі; exponential/negative/zero және invalid address frontend validation-нан өтпейді. Enabled toggle, edit/delete және rule history API арқылы орындалады.

Events title, message, time, read/unread және пайдалы structured payload fields көрсетеді. Mark-read endpoint idempotent; unread visual state successful response кейін жаңарады. Events periodic polling cleanup арқылы басқарылады, private data logout-тан кейін көрсетілмейді.

Price alerts алғашқы fresh observation-да baseline орнатады, келесі false → true crossing-те event жасайды. Wallet/whale alerts қазіргі backend indexed ERC-20 Transfer оқиғаларына сүйенеді. Whale USD valuation — fresh current reference price, transfer кезіндегі тарихи price емес. UI бұл detection scope-ты барлық native ETH transaction-дарына кеңейтіп көрсетпейді.

## 12. Responsive design және accessibility

Global CSS dark workspace theme, semantic color tokens, focus states, spacing және breakpoint жүйесін береді. Desktop full sidebar және table layout қолданады; tablet sidebar ықшамдалады; mobile header drawer, stacked cards және horizontally scrollable tables пайдаланады. SVG chart viewBox viewport-қа бейімделеді.

Main content skip link, semantic headings/tables, field labels, ARIA loading/error status, keyboard tabs, native dialog focus management, copied feedback және reduced-motion CSS бар. Long addresses/hashes content width-ті бұзбай wrap/scroll арқылы көрсетіледі. Loading, API error/retry, empty және ownership/missing states нақты page контекстіне бейімделген.

## 13. Environment

`apps/web/.env.local` ішінде тек public Gateway URL керек:

```dotenv
NEXT_PUBLIC_API_URL=http://localhost:3000
```

Root `.env` backend service конфигурациясына арналған; Next `apps/web` ішінде жұмыс істегенде root `.env` автоматты түрде жүктелмейді. Web үшін example env файлға қарап `apps/web/.env.local` жасаңыз. Secrets `NEXT_PUBLIC_*` арқылы шығарылмайды.

`NEXT_PUBLIC_API_URL` browser bundle-ге **build кезінде** бекітіледі. Production deployment API origin өзгерсе rebuild қажет. Browser мен Gateway origin-дері айырмашылығы бар болғандықтан Gateway `WEB_ORIGIN` нақты web origin-ге сәйкес болуы керек; development default — `http://localhost:3003`.

`WEB_BUILD_DIR` және `WEB_TSCONFIG_PATH` — verification үшін server-side build configuration ғана. Normal build `.next` және `tsconfig.json` қолданады. Verify Phase 9 `.next-phase9` және exclusive temporary `.next-phase9-tsconfig.json` қолданады, standard production build-ті алмастырмайды.

## 14. Негізгі файлдар

| Файл/директория | Міндеті |
| --- | --- |
| `apps/web/src/app/layout.tsx` | Metadata, providers, navigation, main content |
| `apps/web/src/app/globals.css` | Theme, layout, controls, responsive styles |
| `apps/web/src/components/ui.tsx`, `ui-base.tsx`, `ui-controls.tsx` | Public re-export, static primitives және interactive controls |
| `apps/web/src/components/layout/navigation.tsx` | Header/sidebar/mobile drawer және account actions |
| `apps/web/src/providers/` | Auth/session subscriptions және toast |
| `apps/web/src/hooks/use-resource.ts` | Abortable fetch lifecycle, retry, polling cleanup |
| `apps/web/src/lib/api/` | Gateway client, contracts decoding, resource APIs |
| `apps/web/src/lib/auth/` | Session controller, browser storage/locks, form/return-path validation |
| `apps/web/src/lib/format/` | Precision-safe formatting |
| `apps/web/src/lib/utils/search.ts` | Search classification және pagination parsing |
| `apps/web/src/features/` | Explorer/private workspace feature views |
| `packages/contracts/src/http/` және browser entry | Shared browser-safe HTTP types |
| `apps/web/vitest.config.mts` | Minimal frontend node test configuration |
| `scripts/verify-phase-9.mjs` | Isolated production build + real HTTP/API smoke |

### Created files: 90

Төмендегі prefix әр қатардағы барлық filename-ге қатысты. Бұл тізім `git ls-files --others --exclude-standard` inventory-імен тексеріледі; ignored build output және local env оған кірмейді.

| Prefix | Жаңа файлдар |
| --- | --- |
| `apps/web/` | `.env.example`, `vitest.config.mts` |
| `apps/web/src/app/(auth)/` | `login/page.tsx`, `register/page.tsx` |
| `apps/web/src/app/(dashboard)/` | `layout.tsx`, `dashboard/page.tsx`, `portfolio/page.tsx`, `portfolio/[id]/page.tsx`, `watchlists/page.tsx`, `watchlists/[id]/page.tsx`, `alerts/page.tsx`, `settings/page.tsx` |
| `apps/web/src/app/(explorer)/` | `blocks/page.tsx`, `blocks/[number]/page.tsx`, `tx/[hash]/page.tsx`, `address/[address]/page.tsx`, `tokens/page.tsx`, `token/[address]/page.tsx`, `search/page.tsx` |
| `apps/web/src/app/` | `error.tsx`, `loading.tsx`, `not-found.tsx`, `icon.svg` |
| `apps/web/src/components/` | `ui.tsx`, `ui-base.tsx`, `ui-controls.tsx`, `layout/navigation.tsx` |
| `apps/web/src/features/auth/` | `auth-form.tsx`, `auth-gate.tsx`, `profile.tsx` |
| `apps/web/src/features/explorer/` | `overview.tsx`, `blocks-page.tsx`, `block-page.tsx`, `transaction-page.tsx`, `address-page.tsx`, `tokens-page.tsx`, `token-page.tsx`, `data-tables.tsx`, `detail-fields.tsx`, `resource-view.tsx`, `search-form.tsx`, `explorer.module.css` |
| `apps/web/src/features/portfolio/` | `portfolio-list.tsx`, `portfolio-detail.tsx`, `portfolio-display.ts`, `portfolio-display.spec.ts`, `forms.tsx`, `portfolio.module.css` |
| `apps/web/src/features/analytics/` | `portfolio-analytics.tsx`, `history-chart.tsx`, `history-geometry.ts`, `history-geometry.spec.ts`, `analytics.module.css` |
| `apps/web/src/features/watchlists/` | `watchlists.tsx`, `watchlist-detail.tsx` |
| `apps/web/src/features/alerts/` | `alerts.tsx`, `alert-form.tsx`, `alert-form-validation.ts`, `alert-form-validation.spec.ts`, `alert-event-details.tsx`, `alerts.module.css` |
| `apps/web/src/hooks/` | `use-resource.ts` |
| `apps/web/src/lib/api/` | `client.ts`, `client.spec.ts`, `fields.ts`, `auth.api.ts`, `auth.api.spec.ts`, `explorer.api.ts`, `explorer.decoder.ts`, `explorer.decoder.test.ts`, `portfolio.api.ts`, `intelligence.api.ts`, `intelligence.decoder.ts`, `intelligence.decoder.spec.ts` |
| `apps/web/src/lib/auth/` | `session.ts`, `session.spec.ts`, `browser-session.ts`, `validation.ts`, `validation.spec.ts` |
| `apps/web/src/lib/format/` | `index.ts`, `format.spec.ts` |
| `apps/web/src/lib/utils/` | `search.ts`, `search.test.ts` |
| `apps/web/src/providers/` | `auth-provider.tsx`, `toast-provider.tsx` |
| `packages/contracts/src/` | `browser.ts`, `http/auth.contracts.ts`, `http/explorer.contracts.ts` |
| `scripts/` | `verify-phase-9.mjs` |
| `docs/` | `phase-9-frontend.md` |

### Modified files: 15

| Файл | Өзгерісі |
| --- | --- |
| `.env.example` | Public API URL example қосылды; frontend credentials жоқ. |
| `.gitignore` | Isolated verification build/config output Git inventory-ден шығарылды. |
| `apps/web/.gitignore` | `.env.example` version control-ға рұқсат етілді; local secret/config env files ignored болып қалады. |
| `apps/web/README.md` | Monorepo development, build, tests және Phase 9 құжат сілтемесі starter мәтінінің орнына жазылды. |
| `apps/web/eslint.config.mjs` | Isolated verification output ESLint source scan-нан шығарылды. |
| `apps/web/next.config.ts` | Verification үшін configurable output/TS config paths және disabled powered-by header қосылды. |
| `apps/web/package.json` | Workspace contracts dependency, frontend Vitest scripts/dependency және production port 3003 қосылды. |
| `apps/web/src/app/globals.css` | Theme, layout, responsive navigation, shared controls, states және accessibility styles жасалды. |
| `apps/web/src/app/layout.tsx` | Metadata, English language, providers, navigation, skip link және footer енгізілді; starter layout ауыстырылды. |
| `apps/web/src/app/page.tsx` | Starter page орнына нақты API-ға байланған Explorer overview қосылды. |
| `apps/web/tsconfig.json` | ES2022 bigint-compatible target және isolated verification output exclusion қосылды; strict mode сақталды. |
| `package.json` | Root `verify:phase9` командасы қосылды. |
| `packages/contracts/package.json` | Browser-safe `./browser` export entry қосылды. |
| `packages/contracts/src/index.ts` | Auth және Explorer HTTP contracts public exports қосылды. |
| `pnpm-lock.yaml` | Root workspace-тағы web/contracts/Vitest resolution жаңартылды; sole workspace lock сақталды. |

### Removed files: 9

| Файлдар | Себебі |
| --- | --- |
| `apps/web/pnpm-lock.yaml`, `apps/web/pnpm-workspace.yaml` | Web root monorepo workspace-тың мүшесі; nested lock/workspace орнына project root sole lock/config қолданылады. |
| `apps/web/public/file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg` | Next starter assets production UI-дан алынған соң unused assets жойылды. Prefix — `apps/web/public/`. |
| `apps/web/src/app/favicon.ico` | Starter favicon орнына project identity `icon.svg` берілді. |
| `apps/web/src/app/page.module.css` | Starter page styles орнына global design tokens және feature CSS Modules қолданылады. |

Local ignored root `.env` және `apps/web/.env.local` тек public API URL config-пен толықтырылды; existing backend credentials сақталды. Олар Git counts-қа кірмейді. Generated backend `tsconfig.build.tsbuildinfo` business change емес және бастапқы HEAD bytes-ке қалпына келтірілді.

Dependencies: web direct `@blockchain-explorer/contracts: workspace:*` және dev `vitest` resolved **4.1.11** қосылды. Next **16.4.0**, React/React DOM **19.3.0**, existing CSS stack сақталды; UI/chart/browser framework, DOM testing stack немесе blockchain SDK қосылмады.

Backend controllers, services, database schemas және public HTTP behavior өзгермеді. Shared Auth/Explorer types пен browser export additive түрде қосылды. **Жаңа database migration жоқ**; verification тек бұрынғы migrations-ты өзі жасаған temporary databases-ке қолданады.

## 15. Development іске қосу

Root backend `.env` толтырылғанда:

```powershell
pnpm install
pnpm build:packages
pnpm infra:up
pnpm db:migrate
```

Төрт terminal-да:

```powershell
pnpm dev:api
pnpm dev:indexer
pnpm dev:portfolio
pnpm dev:web
```

Browser: `http://localhost:3003`. Нақты indexer data жоқ fresh database-де Explorer empty state береді. Register/login → public wallet create → worker sync күту → holdings/valuation/history → watchlist → alert flow арқылы private workspace тексеріледі.

## 16. Production build

Project root-та міндетті pipeline:

```powershell
pnpm install
pnpm build:packages
pnpm --dir apps/api-gateway build
pnpm --dir apps/indexer-service build
pnpm --dir apps/portfolio-service build
pnpm --dir apps/web build
```

Web build алдында `NEXT_PUBLIC_API_URL` destination API origin-ге сәйкес болсын. Build аяқталған соң `pnpm --dir apps/web start` production server-ді 3003 портында іске қосады. TLS/reverse proxy немесе container deployment бөлек infrastructure жұмысы; API URL production browser-ден қолжетімді болуы тиіс.

## 17. Tests және verification

Frontend minimal Vitest setup existing workspace Vitest-ті қайта қолданады; жаңа DOM testing/browser stack енгізілмейді. Pure logic tests formatting/search parsing, response decoders, safe error mapping, auth refresh coordination/races, portfolio display mapping және alert form validation semantics-ін тексереді.

```powershell
pnpm --dir apps/web test
pnpm --dir apps/web lint
pnpm verify:phase7
pnpm verify:phase8
pnpm verify:phase9
```

Optional manual browser review кезінде `pnpm verify:phase9 -- --browser-review` қолданылады. HTTP smoke checks аяқталған соң isolated production web `http://127.0.0.1:3503` адресінде және services ең көбі он минут ашық тұрады. Terminal-ға Enter жіберілгенде немесе уақыт біткенде бұрынғы own-resource cleanup орындалады. Script test credentials шығармайды; browser review үшін UI арқылы жаңа verification account жасауға болады. Бұл flag browser framework орнатпайды және automated HTTP checks-ті manual UI evidence-пен араластырмайды.

Phase 7 — isolated real backend storage/broker және configured real Ethereum RPC regression. Phase 8 — isolated real storage/broker/services және deterministic provider/RPC fixtures. Phase 9 — production web build, route HTML және real API flow; browser clicks/hydration/visual layout автоматты тексерілді дегенді білдірмейді.

Phase 9 script үш temporary PostgreSQL database-ке existing migrations қолданады; жаңа migration жасамайды. Әр invocation жеке Redis cache/BullMQ queue/RabbitMQ exchange/consumer queue namespace қолданады. Services 3500/3501/3502, production Next 3503 порттарында жүреді. Бар port occupied болса existing process тоқтатылмайды, verification fail болады. Local CoinGecko және Ethereum RPC fixtures сыртқы provider key-ді қолданбайды.

Script Next-ті isolated API URL-мен бөлек output directory-ге build етеді. Browser JS chunks ішінде нақты build API URL барын және backend secrets жоқтығын тексереді. Public/protected route shells, missing route 404, CORS, explorer exact strings, register/login/me/refresh, portfolio worker sync/valuation/history/analytics, watchlist CRUD, persisted crossing alert/read/update және ownership checks орындалады.

Cleanup тек өзі spawn еткен processes, exact namespace Redis keys/broker topology және successful CREATE registry + `shobj_description` ownership marker расталған temporary databases үшін орындалады. Shared databases, normal schedulers немесе user processes өзгермейді. PostgreSQL role temporary databases үшін CREATE/DROP құқығына ие болуы керек. Exclusive temporary TS config және generated next-env declarations өз captured content-і өзгермесе ғана тазаланып/қалпына келеді.

Расталған verification нәтижелері:

| Command | Нәтиже |
| --- | --- |
| `pnpm install` | Exit 0 |
| `pnpm build:packages` | Contracts, blockchain-client, messaging — exit 0 |
| `pnpm --dir apps/api-gateway build` | Exit 0, TypeScript build қатесі жоқ |
| `pnpm --dir apps/indexer-service build` | Exit 0, TypeScript build қатесі жоқ |
| `pnpm --dir apps/portfolio-service build` | Exit 0, TypeScript build қатесі жоқ |
| `pnpm --dir apps/web build` | Production Next build exit 0, барлық route generated |
| `pnpm --dir apps/web test` | **97 tests passed**, **11 test files**, exit 0 |
| `pnpm --dir apps/web lint` | Exit 0 |
| `pnpm verify:phase7` | **11 checks passed**, exit 0, толық own-resource cleanup |
| `pnpm verify:phase8` | **24 checks passed**, exit 0, толық own-resource cleanup |
| `pnpm verify:phase9` | **17 checks passed**, exit 0; isolated production web build, route HTML, real API flow және cleanup |

Phase 9 cleanup-ының бес категориясы өтті: own service/Next processes, own Redis keys, own RabbitMQ topology, marker-proven PostgreSQL databases, generated Next config restoration. Financial assertions valid decimal strings-ті canonicalize етеді: PostgreSQL `99.000000000000000000` пен `99` бір exact value ретінде салыстырылады. `Number` арқылы money conversion жоқ; raw blockchain integers exact string ретінде тексеріледі.

Міндетті final install/build pipeline толық **exit 0** аяқталды. Build/test/integration errors қалған жоқ. Existing dependency warnings — deprecated ESLint/subdependencies және API Gateway-дегі `tsconfck@3.1.6` peer range: TypeScript `^5` күтіледі, installed нұсқа **6.0.3**. Бөлек `pnpm peers check` осы mismatch үшін exit 1 берді; бұл нақты орындалған install/build/lint/unit/integration success нәтижелерін өзгертпейді. Web nested workspace/lock files алынып тасталғандықтан сол бұрынғы nested configuration warning жойылды. Git LF/CRLF conversion notices compile/runtime error емес.

Manual browser interaction/visual/hydration тексеруі орындалды деген claim жоқ: session-дағы browser surfaces inventory бос болды және in-app browser құру қолжетімсіз болды. Build, route HTML және нақты API checks browser rendering/interaction proof-ін алмастырмайды. Optional review flag browser surface бар ортада сақталған; frontend DOM/click/hydration usability-ді толық browser-де бөлек тексеруге болады.

## Phase 10 foundation

Typed resource APIs, browser-safe shared contracts, runtime decoders, session transport boundary және feature directory structure backend өзгергенде silent UI drift-ті азайтады. SVG charts precision semantics-ті сақтап, future performance/portfolio views-ке кеңейеді. Watchlist/alert forms пен events notification delivery интеграциясына дайын; cost basis енгізілсе true P&L тек жаңа backend contract арқылы қосылады. Cookie transport hardening немесе multi-chain UI config үшін existing boundaries қайта қолдануға болады.
