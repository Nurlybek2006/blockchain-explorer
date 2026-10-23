# Қазақша және English интерфейс

Frontend толық `kk` және `en` тілдерін қолдайды. Әдепкі тіл — қазақша (`kk`). Бұл өзгеріс Next.js App Router қолданбасындағы presentation layer-де жасалды: backend API, shared contracts, URLs, JWT және WebSocket event форматы өзгермейді. Жаңа dependency немесе i18n framework қосылған жоқ.

## Құрылымы және сөздіктер

`apps/web/src/i18n/locales/en.ts` — English source dictionary. `kk.ts` дәл сол key құрылымын сақтайды. Сөздіктер common/navigation, explorer/realtime, auth/portfolio/watchlists/alerts/settings, errors және transaction-based P&L (`pnl`) домендеріне бөлінген. Жаңа feature қосылған сайын толық key/placeholder parity автоматты тестпен тексеріледі.

`types.ts` ішіндегі `DictionaryShape` және `satisfies` қазақша сөздікте жетіспейтін не артық key болса TypeScript қатесін береді. `TranslationKey` тек бар dot-separated key-лерді қабылдайды; English шаблонындағы `{name}` сияқты параметрлер `Translator` аргументтеріне айналады. `translator.ts` missing key, бос мәтін немесе жетіспейтін interpolation параметрі үшін қате шығарады. Үндемей English мәтініне fallback жасалмайды.

Dictionary parity тесті толық key жиынын, әр аударманың бос еместігін және interpolation placeholder-лерінің екі тілде бірдей болуын тексереді. English singular/plural формалары `Intl.PluralRules` арқылы таңдалады; қазақша санау мәтінінде саннан кейін зат есімнің жекеше түрі сақталады.

## Әдепкі тіл, persistence және SSR

`config.ts` supported locales пен `DEFAULT_LOCALE = 'kk'` мәнін орталықтандырады. Басымдық: бұрын таңдалған жарамды `locale` cookie, одан кейін `kk`. Browser language қолданылмайды. Cookie жоқ, `ru` сияқты unsupported мән берілген немесе мән жарамсыз болса қазақша таңдалады.

Language switcher `locale=kk` немесе `locale=en` cookie жазады: `Path=/`, `SameSite=Lax`, `Max-Age=31536000`; HTTPS кезінде `Secure` қосылады. Бұл sensitive емес preference, сондықтан `HttpOnly` қажет емес. Cookie жазуға browser шектеу қойса, ағымдағы интерфейс бәрібір ауысады; кейінгі жүктеуде preference сақтау browser рұқсатына байланысты.

`server.ts` Next.js `cookies()` арқылы locale анықтайды. Root layout сол snapshot-ты `<html lang>` және `LocaleProvider.initialLocale` үшін қолданады. Алғашқы client render server берген locale-мен басталады: localStorage не browser language негізінде қайта есептелмейді. Cookie арқылы SSR жасау беттерді request кезінде render етуді талап етеді; production build оларды dynamic routes ретінде көрсетеді.

Provider тіл өзгергенде cookie, React context және `document.documentElement.lang` жаңартады. AppShell бет атауы мен description-ды жаңартады. `router.refresh()` немесе locale-ге байланысты subtree `key` қолданылмайды: auth session, форма мәндері, портфель/chart таңдауы және WebSocket connection тіл ауысуы үшін қайта құрылмайды. Backend request callbacks locale-ге тәуелді емес; realtime күй мәтіні render кезінде аударылады.

Root body-де бұрынғы browser extension attribute mismatch үшін қосылған `suppressHydrationWarning` сақталды. Localization-ның server/client сәйкестігі осы prop-қа сүйенбейді: бастапқы locale бір snapshot-тан беріледі.

## Hook және language switcher

Client component ішінде:

```tsx
const { t, locale, setLocale } = useTranslation();
t('navigation.blocks');
t('common.pageOf', { page: 2, total: 7 });
setLocale('en');
```

Server component және metadata үшін `await getServerTranslation()` қолданылады. Client/server UI мәтіні бір сөздіктерден алынады. Error немесе validation күйіне дайын аударманы сақтаудың орнына key не cause сақталады: тіл ауысқанда сол күй жаңа тілде көрсетіледі. Toast хабарламалары да key арқылы render етіледі.

`components/layout/language-switcher.tsx` header actions ішінде орналасқан. ҚАЗ / ENG шағын control Phase 9 dark design-мен үйлеседі, mobile өлшемде де қолжетімді. Native buttons keyboard арқылы жұмыс істейді; selected language `aria-pressed`, `lang`, localized `aria-label` және `title` арқылы анық беріледі.

## Аударылған бөлімдер

Navigation, skip link, footer, loading/error/empty states, таблицалар, pagination, copy feedback, modal/confirmation, toast және accessibility мәтіндері екі тілде.

Explorer: home, search және validation, блоктар/блок мәліметтері, транзакция, мекенжай, токендер/токен, contract verification/source/ABI labels, transaction trace/internal calls, live/reconnecting/indexer/reorg күйлері.

Жеке бөлімдер: login/register, frontend validation және API error feedback, portfolio forms/list/details/holdings, analytics/history/chart tooltip/keyboard accessibility, watchlists/items, alerts/rules/history/event details, settings/profile/logout-all. Route metadata, 404 және shared loading/error компоненттері де аударылды.

`Ethereum`, `Sepolia`, `ERC-20`, `JSON-RPC`, `ABI`, `Gas`, WebSocket және call type атаулары сақталған. Token names, user енгізген атаулар, hashes, addresses, source code, ABI JSON және calldata аударылмайды. Барлық бұрынғы URL сақталған; `/kk` не `/en` route prefix енгізілмеді.

Contract optimization `runs` мәні «Күтілетін орындалу саны» деп беріледі: бұл optimizer-дің қайталау саны емес, deployed code орындалуының болжамы. Мағынасы [Solidity optimizer құжаттамасымен](https://docs.soliditylang.org/en/latest/internals/optimizer.html#optimizer-parameter-runs) тексерілді.

## Сан, ақша және уақыт

`lib/format` helper-леріне UI ағымдағы `locale` мәнін береді. Қазақша `kk-KZ`, English сандар/ақша үшін `en-US`, English UTC date үшін `en-GB` пайдаланылады. Барлық күн/уақыт UTC-де көрсетіледі. Relative time `Intl.RelativeTimeFormat` арқылы екі тілде беріледі.

Ақша және blockchain integer мәндері `Number`-ға айналдырылмайды. Integer grouping `BigInt` + `Intl.NumberFormat` арқылы, currency орны/decimal separator `formatToParts` арқылы анықталады. USD және percentage бұрынғы display precision-мен көрсетіледі; raw exact мәндер tooltip/API деректерінде сақталады. `formatDecimal` толық decimal fraction-ды дөңгелектемей көрсетеді. Token amount decimal scale-і өзгермейді. `null` price нөл ретінде көрсетілмейді; нөлден үлкен sub-cent price `<0.01` шегімен ажыратылады.

Pure formatter-лердің optional locale default-ы бұрынғы English helper қолданыстарына compatibility үшін сақталған. User-facing компоненттер ағымдағы locale-ді explicit береді; қолданбаның default тілі `kk` болып қалады.

## Error localization

`i18n/errors.ts` ішіндегі `getApiErrorKey` / `getLocalizedApiError` code және HTTP status бойынша бір орталықта localized message таңдайды. Login `401`, register `409`, watchlist duplicate `409` өз контекстіне сәйкес беріледі. Network/timeout/invalid response/account change және 400/401/403/404/409/413/415/422/429/500/502/503/504 қолдауы бар.

Pure API/formatting/i18n helper-лері relative imports қолданады. Оларды басқа workspace package тесттері импорттағанда Next.js-ке тән `@/` alias қажет болмайды.

UI backend `error.message`, stack немесе provider detail мәтінін тікелей көрсетпейді. `ApiError` client diagnostic мәліметін сақтай алады; presentation тек mapped key қолданады. Alerts backend title/message мәтінін көрсетпейді: known type, қауіпсіз payload және ескі allowlisted transfer semantics негізінде localized summary жасалады. Белгісіз payload үшін қауіпсіз жалпы мәтін беріледі. Trace execution error да localized UI label арқылы көрсетіледі; source/code панелінің raw мазмұны өзгермейді.

## Жаңа мәтін қосу

1. Мәтінді тиісті `*.en.ts` domain dictionary-ге мағыналы key ретінде қосыңыз.
2. Дәл сол key-ді `*.kk.ts` файлына табиғи қазақша аудармамен қосыңыз. Placeholder атаулары бірдей болсын.
3. Component ішінде `t('domain.key')` қолданыңыз; parameter болса typed object беріңіз. Headings, aria-label, title, placeholder, validation, feedback және empty states те осы талапқа жатады.
4. Жаңа domain болса екі aggregate dictionary-ге қосыңыз. Жаңа route үшін server metadata және `localizedMetadata` client mapping-ті жаңартыңыз.
5. Validation күйіне key, API қатесіне cause, toast-қа key сақтаңыз. User енгізген атауды немесе technical raw мәнді translation key ретінде қолданбаңыз.
6. `pnpm verify:i18n` орындаңыз. Паритет, placeholder, strict types, audit, lint және build өтуі керек.

## Тексеру

`pnpm verify:i18n` strict typecheck, барлық frontend Vitest тесттері, TypeScript AST арқылы hardcoded JSX/presentation attribute audit, frontend lint және isolated production build орындайды. Техникалық атаулар audit allowlist-інде, CSS/API endpoints/test descriptions аударма ретінде саналмайды. Audit автоматты түрде барлық runtime деректің мағынасын анықтай алмайды; source review оны толықтырады.

Скрипт өз production server-ін random localhost port-та іске қосып, 19 route-ты төрт cookie жағдайында тексереді: default, English, Kazakh және invalid locale. 76 response status, `<html lang>`, navigation, selected language, login/404 мәтіні және missing translation болмауы тексеріледі. Өз server-і уақыт шегінде тоқтайды, тек өз build/config output-ын тазалайды. Есеп: `artifacts/i18n-verification.json`.

Тесттер default locale, екі тілдің render-і, cookie persistence/fallback/security, dictionary/placeholder parity, interpolation/runtime failure, number/currency/date/relative time, error mapping, search validation mapping, technical values, shared UI/a11y, alert semantics және analytics/chart presentation қамтиды.

Нақты browser click/hydration және mobile visual automation бұл ортада орындалмады: browser automation surface қолжетімсіз болды. SSR snapshot тесттері мен production HTTP тексеруі орындалды. Native button interaction және provider lifecycle кодпен тексерілді; бұл browser interaction coverage деп есептелмейді.

## Build және regression нәтижелері

Тексеру 2026-10-14/15 күндері осы workspace-та орындалды. Соңғы нәтижелер:

| Команда / тексеру | Нәтиже |
| --- | --- |
| `pnpm install` және Phase 12 frozen install | Өтті; lockfile өзгермеді, peer dependency issues жоқ |
| `pnpm build:packages` | Барлық төрт shared package өтті |
| `pnpm --dir apps/web build` | Production build өтті, TypeScript errors — 0 |
| `pnpm --dir apps/web lint` | Өтті, errors/warnings — 0 |
| Frontend unit tests | 20 файл, 223 тест өтті |
| Dictionary parity | EN/KK 623 key; missing/empty key және placeholder mismatch — 0 |
| Hardcoded UI AST audit + source review | Аударылмай қалған UI мәтіні табылмады; technical/raw мәндер сақталған |
| Үш backend `build` | API Gateway, Indexer және Portfolio — бәрі өтті |
| `pnpm verify:i18n` | 10 топ өтті; 19 route × 4 cookie жағдайы = 76 production SSR response |
| `pnpm verify:phase9` | 17 тексеріс өтті; owned fixtures тазаланды |
| `pnpm verify:phase10` | 17 тексеріс өтті; contract/trace/realtime және owned cleanup өтті |
| `pnpm verify:phase12` | 19 топ өтті; skipped checks — 0 |

Phase 12 ішінде 639 application/shared unit test, 17 contract test, 26 Testcontainers integration test және 46 real-app e2e test өтті. Coverage thresholds және SQL/HTTP/indexer/WebSocket performance smoke өтті. Төрт Docker image жиналды; production health/security/OTel/SIGTERM/SIGINT және owned cleanup — 12 тексеріс өтті. Monitoring 6/6 target, 3/3 datasource және 4/4 dashboard тексерілді.

E2e cross-package decoder import тексеруі алғашқы өтуде Next.js `@/` alias мәселесін тапты. Pure helper imports relative path-қа көшірілді; кейін Phase 12 толық қайта орындалып өтті. API/format/i18n helper runtime graph-та unresolved alias және import cycle жоқ.

Жаңа dependency, backend source/API өзгерісі және URL prefix жоқ. Бұрыннан өзгерген үш backend build cache файлы byte-for-byte бастапқы мазмұнына қайтарылды. Web compile/build/lint қатесі қалған жоқ. Backend test source-та бұрынғы `no-base-to-string` және `unbound-method` lint warnings сақталған; backend lint exit code — 0. Negative-path тесттеріндегі күтілетін WARN/ERROR logs test failure болып саналмайды.

Қайта орындалатын есептер: `artifacts/i18n-verification.json` және `artifacts/phase-12-verification.json`. Бұлар generated output ретінде git ignore-да.

## Өзгерген файлдар

Төмендегі inventory тек осы localization жұмысына жатады. Бұрыннан өзгерген backend `tsconfig.build.tsbuildinfo` файлдарының бастапқы мазмұны сақталады; backend source өзгермейді.

### Жасалған файлдар — 30

| Файл | Не қосылды |
| --- | --- |
| [apps/web/src/components/layout/app-shell.tsx](../apps/web/src/components/layout/app-shell.tsx) | Localized skip/footer және client metadata бар тұрақты shell шығарылды. |
| [apps/web/src/components/layout/language-switcher.tsx](../apps/web/src/components/layout/language-switcher.tsx) | Compact keyboard-accessible ҚАЗ/ENG header control қосылды. |
| [apps/web/src/features/alerts/alert-event-display.spec.ts](../apps/web/src/features/alerts/alert-event-display.spec.ts) | KK/EN presentation, formatting, validation немесе safe error regression assertions қосылды. |
| [apps/web/src/features/alerts/alert-event-display.ts](../apps/web/src/features/alerts/alert-event-display.ts) | Backend title/message орнына safe payload semantics-тан localized summary жасалады. |
| [apps/web/src/features/analytics/analytics-localization.spec.ts](../apps/web/src/features/analytics/analytics-localization.spec.ts) | KK/EN presentation, formatting, validation немесе safe error regression assertions қосылды. |
| [apps/web/src/hooks/use-translation.ts](../apps/web/src/hooks/use-translation.ts) | Reusable typed `useTranslation` hook экспортталды. |
| [apps/web/src/i18n/config.ts](../apps/web/src/i18n/config.ts) | Default/supported locale және cookie preference helpers орталықтандырылды. |
| [apps/web/src/i18n/errors.ts](../apps/web/src/i18n/errors.ts) | HTTP/client code және context үшін safe localized error mapping қосылды. |
| [apps/web/src/i18n/i18n.spec.ts](../apps/web/src/i18n/i18n.spec.ts) | KK/EN presentation, formatting, validation немесе safe error regression assertions қосылды. |
| [apps/web/src/i18n/index.ts](../apps/web/src/i18n/index.ts) | Localization public exports бір жерде жинақталды. |
| [apps/web/src/i18n/locales/common.en.ts](../apps/web/src/i18n/locales/common.en.ts) | KK/EN сөздігі exact key/placeholder parity арқылы тексеріледі. |
| [apps/web/src/i18n/locales/common.kk.ts](../apps/web/src/i18n/locales/common.kk.ts) | KK/EN сөздігі exact key/placeholder parity арқылы тексеріледі. |
| [apps/web/src/i18n/locales/en.ts](../apps/web/src/i18n/locales/en.ts) | KK/EN сөздігі exact key/placeholder parity арқылы тексеріледі. |
| [apps/web/src/i18n/locales/errors.en.ts](../apps/web/src/i18n/locales/errors.en.ts) | KK/EN сөздігі exact key/placeholder parity арқылы тексеріледі. |
| [apps/web/src/i18n/locales/errors.kk.ts](../apps/web/src/i18n/locales/errors.kk.ts) | KK/EN сөздігі exact key/placeholder parity арқылы тексеріледі. |
| [apps/web/src/i18n/locales/explorer.en.ts](../apps/web/src/i18n/locales/explorer.en.ts) | KK/EN сөздігі exact key/placeholder parity арқылы тексеріледі. |
| [apps/web/src/i18n/locales/explorer.kk.ts](../apps/web/src/i18n/locales/explorer.kk.ts) | KK/EN сөздігі exact key/placeholder parity арқылы тексеріледі. |
| [apps/web/src/i18n/locales/kk.ts](../apps/web/src/i18n/locales/kk.ts) | KK/EN сөздігі exact key/placeholder parity арқылы тексеріледі. |
| [apps/web/src/i18n/locales/product.en.ts](../apps/web/src/i18n/locales/product.en.ts) | KK/EN сөздігі exact key/placeholder parity арқылы тексеріледі. |
| [apps/web/src/i18n/locales/product.kk.ts](../apps/web/src/i18n/locales/product.kk.ts) | KK/EN сөздігі exact key/placeholder parity арқылы тексеріледі. |
| [apps/web/src/i18n/metadata.ts](../apps/web/src/i18n/metadata.ts) | Route title/description ағымдағы locale бойынша жаңартылады. |
| [apps/web/src/i18n/server.ts](../apps/web/src/i18n/server.ts) | Cookie SSR snapshot және server translator қосылды. |
| [apps/web/src/i18n/translator.ts](../apps/web/src/i18n/translator.ts) | Typed interpolation, missing key failure және plural helper қосылды. |
| [apps/web/src/i18n/types.ts](../apps/web/src/i18n/types.ts) | Typed locale, dictionary shape, keys/interpolation және plain toast key түрлері қосылды. |
| [apps/web/src/lib/api/api-error.ts](../apps/web/src/lib/api/api-error.ts) | ApiError бөлек module-ге шығарылып, import cycle жойылды. |
| [apps/web/src/providers/locale-provider.spec.ts](../apps/web/src/providers/locale-provider.spec.ts) | KK/EN presentation, formatting, validation немесе safe error regression assertions қосылды. |
| [apps/web/src/providers/locale-provider.tsx](../apps/web/src/providers/locale-provider.tsx) | SSR snapshot, locale state, cookie persistence және HTML language update қосылды. |
| [docs/localization-kz-en.md](../docs/localization-kz-en.md) | Архитектура, қолдану тәртібі, тексеру және толық файл inventory қазақша жазылды. |
| [scripts/audit-i18n.mjs](../scripts/audit-i18n.mjs) | Hardcoded JSX/presentation attribute AST audit қосылды. |
| [scripts/verify-i18n.mjs](../scripts/verify-i18n.mjs) | Strict tests/lint/build және 76 production SSR response тексеретін isolated verifier қосылды. |

### Өзгертілген файлдар — 68

| Файл | Не өзгерді |
| --- | --- |
| [.gitignore](../.gitignore) | Isolated i18n build/config output-тары ignore етіледі. |
| [README.md](../README.md) | KK/EN мүмкіндігі мен documentation/verification сілтемелері қосылды. |
| [apps/web/src/app/(auth)/login/page.tsx](../apps/web/src/app/(auth)/login/page.tsx) | Server metadata localized болды; page route сақталды. |
| [apps/web/src/app/(auth)/register/page.tsx](../apps/web/src/app/(auth)/register/page.tsx) | Server metadata localized болды; page route сақталды. |
| [apps/web/src/app/(dashboard)/alerts/page.tsx](../apps/web/src/app/(dashboard)/alerts/page.tsx) | Server metadata localized болды; page route сақталды. |
| [apps/web/src/app/(dashboard)/portfolio/[id]/page.tsx](../apps/web/src/app/(dashboard)/portfolio/[id]/page.tsx) | Server metadata localized болды; page route сақталды. |
| [apps/web/src/app/(dashboard)/portfolio/page.tsx](../apps/web/src/app/(dashboard)/portfolio/page.tsx) | Server metadata localized болды; page route сақталды. |
| [apps/web/src/app/(dashboard)/settings/page.tsx](../apps/web/src/app/(dashboard)/settings/page.tsx) | Server metadata localized болды; page route сақталды. |
| [apps/web/src/app/(dashboard)/watchlists/[id]/page.tsx](../apps/web/src/app/(dashboard)/watchlists/[id]/page.tsx) | Server metadata localized болды; page route сақталды. |
| [apps/web/src/app/(dashboard)/watchlists/page.tsx](../apps/web/src/app/(dashboard)/watchlists/page.tsx) | Server metadata localized болды; page route сақталды. |
| [apps/web/src/app/(explorer)/address/[address]/page.tsx](../apps/web/src/app/(explorer)/address/[address]/page.tsx) | Server metadata localized болды; page route сақталды. |
| [apps/web/src/app/(explorer)/blocks/[number]/page.tsx](../apps/web/src/app/(explorer)/blocks/[number]/page.tsx) | Server metadata localized болды; page route сақталды. |
| [apps/web/src/app/(explorer)/blocks/page.tsx](../apps/web/src/app/(explorer)/blocks/page.tsx) | Server metadata localized болды; page route сақталды. |
| [apps/web/src/app/(explorer)/contract/[address]/page.tsx](../apps/web/src/app/(explorer)/contract/[address]/page.tsx) | Server metadata localized болды; page route сақталды. |
| [apps/web/src/app/(explorer)/search/page.tsx](../apps/web/src/app/(explorer)/search/page.tsx) | Server metadata localized болды; page route сақталды. |
| [apps/web/src/app/(explorer)/token/[address]/page.tsx](../apps/web/src/app/(explorer)/token/[address]/page.tsx) | Server metadata localized болды; page route сақталды. |
| [apps/web/src/app/(explorer)/tokens/page.tsx](../apps/web/src/app/(explorer)/tokens/page.tsx) | Server metadata localized болды; page route сақталды. |
| [apps/web/src/app/(explorer)/tx/[hash]/page.tsx](../apps/web/src/app/(explorer)/tx/[hash]/page.tsx) | Server metadata localized болды; page route сақталды. |
| [apps/web/src/app/globals.css](../apps/web/src/app/globals.css) | Switcher dark theme және mobile responsive стильдері қосылды. |
| [apps/web/src/app/layout.tsx](../apps/web/src/app/layout.tsx) | SSR cookie locale, metadata және тұрақты LocaleProvider hierarchy қосылды. |
| [apps/web/src/app/not-found.tsx](../apps/web/src/app/not-found.tsx) | 404 мәтіндері мен home action аударылды. |
| [apps/web/src/app/page.tsx](../apps/web/src/app/page.tsx) | Server metadata localized болды; page route сақталды. |
| [apps/web/src/components/layout/navigation.tsx](../apps/web/src/components/layout/navigation.tsx) | Navigation/auth labels аударылып, header switcher енгізілді. |
| [apps/web/src/components/ui-base.tsx](../apps/web/src/components/ui-base.tsx) | States, badges, a11y, dialogs, pagination және copy feedback аударылды. |
| [apps/web/src/components/ui-controls.tsx](../apps/web/src/components/ui-controls.tsx) | States, badges, a11y, dialogs, pagination және copy feedback аударылды. |
| [apps/web/src/features/alerts/alert-event-details.tsx](../apps/web/src/features/alerts/alert-event-details.tsx) | UI/forms/actions/states/feedback/a11y аударылды; errors mapped key арқылы көрсетіледі. |
| [apps/web/src/features/alerts/alert-form-validation.spec.ts](../apps/web/src/features/alerts/alert-form-validation.spec.ts) | KK/EN presentation, formatting, validation немесе safe error regression assertions қосылды. |
| [apps/web/src/features/alerts/alert-form-validation.ts](../apps/web/src/features/alerts/alert-form-validation.ts) | Validation нәтиже мәтінінің орнына typed translation key қайтарады. |
| [apps/web/src/features/alerts/alert-form.tsx](../apps/web/src/features/alerts/alert-form.tsx) | UI/forms/actions/states/feedback/a11y аударылды; errors mapped key арқылы көрсетіледі. |
| [apps/web/src/features/alerts/alerts.tsx](../apps/web/src/features/alerts/alerts.tsx) | UI/forms/actions/states/feedback/a11y аударылды; errors mapped key арқылы көрсетіледі. |
| [apps/web/src/features/analytics/history-chart.tsx](../apps/web/src/features/analytics/history-chart.tsx) | Chart/analytics/tooltip/a11y аударылды; geometry, state және exact values сақталды. |
| [apps/web/src/features/analytics/portfolio-analytics.tsx](../apps/web/src/features/analytics/portfolio-analytics.tsx) | Chart/analytics/tooltip/a11y аударылды; geometry, state және exact values сақталды. |
| [apps/web/src/features/auth/auth-form.tsx](../apps/web/src/features/auth/auth-form.tsx) | UI/forms/actions/states/feedback/a11y аударылды; errors mapped key арқылы көрсетіледі. |
| [apps/web/src/features/auth/auth-gate.tsx](../apps/web/src/features/auth/auth-gate.tsx) | UI/forms/actions/states/feedback/a11y аударылды; errors mapped key арқылы көрсетіледі. |
| [apps/web/src/features/auth/profile.tsx](../apps/web/src/features/auth/profile.tsx) | UI/forms/actions/states/feedback/a11y аударылды; errors mapped key арқылы көрсетіледі. |
| [apps/web/src/features/explorer/address-page.tsx](../apps/web/src/features/explorer/address-page.tsx) | Explorer labels/states/a11y және locale formatting қосылды; raw blockchain data сақталды. |
| [apps/web/src/features/explorer/block-page.tsx](../apps/web/src/features/explorer/block-page.tsx) | Explorer labels/states/a11y және locale formatting қосылды; raw blockchain data сақталды. |
| [apps/web/src/features/explorer/blocks-page.tsx](../apps/web/src/features/explorer/blocks-page.tsx) | Explorer labels/states/a11y және locale formatting қосылды; raw blockchain data сақталды. |
| [apps/web/src/features/explorer/code-panel.tsx](../apps/web/src/features/explorer/code-panel.tsx) | Explorer labels/states/a11y және locale formatting қосылды; raw blockchain data сақталды. |
| [apps/web/src/features/explorer/contract-page.tsx](../apps/web/src/features/explorer/contract-page.tsx) | Explorer labels/states/a11y және locale formatting қосылды; raw blockchain data сақталды. |
| [apps/web/src/features/explorer/data-tables.tsx](../apps/web/src/features/explorer/data-tables.tsx) | Explorer labels/states/a11y және locale formatting қосылды; raw blockchain data сақталды. |
| [apps/web/src/features/explorer/overview.tsx](../apps/web/src/features/explorer/overview.tsx) | Explorer labels/states/a11y және locale formatting қосылды; raw blockchain data сақталды. |
| [apps/web/src/features/explorer/resource-view.tsx](../apps/web/src/features/explorer/resource-view.tsx) | Explorer labels/states/a11y және locale formatting қосылды; raw blockchain data сақталды. |
| [apps/web/src/features/explorer/search-form.tsx](../apps/web/src/features/explorer/search-form.tsx) | Explorer labels/states/a11y және locale formatting қосылды; raw blockchain data сақталды. |
| [apps/web/src/features/explorer/search-page.tsx](../apps/web/src/features/explorer/search-page.tsx) | Explorer labels/states/a11y және locale formatting қосылды; raw blockchain data сақталды. |
| [apps/web/src/features/explorer/token-page.tsx](../apps/web/src/features/explorer/token-page.tsx) | Explorer labels/states/a11y және locale formatting қосылды; raw blockchain data сақталды. |
| [apps/web/src/features/explorer/tokens-page.tsx](../apps/web/src/features/explorer/tokens-page.tsx) | Explorer labels/states/a11y және locale formatting қосылды; raw blockchain data сақталды. |
| [apps/web/src/features/explorer/trace-view.tsx](../apps/web/src/features/explorer/trace-view.tsx) | Explorer labels/states/a11y және locale formatting қосылды; raw blockchain data сақталды. |
| [apps/web/src/features/explorer/transaction-page.tsx](../apps/web/src/features/explorer/transaction-page.tsx) | Explorer labels/states/a11y және locale formatting қосылды; raw blockchain data сақталды. |
| [apps/web/src/features/portfolio/forms.tsx](../apps/web/src/features/portfolio/forms.tsx) | UI/forms/actions/states/feedback/a11y аударылды; errors mapped key арқылы көрсетіледі. |
| [apps/web/src/features/portfolio/portfolio-detail.tsx](../apps/web/src/features/portfolio/portfolio-detail.tsx) | UI/forms/actions/states/feedback/a11y аударылды; errors mapped key арқылы көрсетіледі. |
| [apps/web/src/features/portfolio/portfolio-display.spec.ts](../apps/web/src/features/portfolio/portfolio-display.spec.ts) | KK/EN presentation, formatting, validation немесе safe error regression assertions қосылды. |
| [apps/web/src/features/portfolio/portfolio-display.ts](../apps/web/src/features/portfolio/portfolio-display.ts) | Presentation helper locale-aware мәтін және formatting қолданады. |
| [apps/web/src/features/portfolio/portfolio-list.tsx](../apps/web/src/features/portfolio/portfolio-list.tsx) | UI/forms/actions/states/feedback/a11y аударылды; errors mapped key арқылы көрсетіледі. |
| [apps/web/src/features/realtime/live-status.tsx](../apps/web/src/features/realtime/live-status.tsx) | Live/indexer/reorg status аударылды; connection lifecycle өзгермейді. |
| [apps/web/src/features/realtime/status-display.spec.ts](../apps/web/src/features/realtime/status-display.spec.ts) | KK/EN presentation, formatting, validation немесе safe error regression assertions қосылды. |
| [apps/web/src/features/realtime/status-display.ts](../apps/web/src/features/realtime/status-display.ts) | Presentation helper locale-aware мәтін және formatting қолданады. |
| [apps/web/src/features/watchlists/watchlist-detail.tsx](../apps/web/src/features/watchlists/watchlist-detail.tsx) | UI/forms/actions/states/feedback/a11y аударылды; errors mapped key арқылы көрсетіледі. |
| [apps/web/src/features/watchlists/watchlists.tsx](../apps/web/src/features/watchlists/watchlists.tsx) | UI/forms/actions/states/feedback/a11y аударылды; errors mapped key арқылы көрсетіледі. |
| [apps/web/src/lib/api/client.ts](../apps/web/src/lib/api/client.ts) | UI errorMessage localized mapping-ке көшті; ApiError compatibility export сақталды. |
| [apps/web/src/lib/auth/validation.spec.ts](../apps/web/src/lib/auth/validation.spec.ts) | KK/EN presentation, formatting, validation немесе safe error regression assertions қосылды. |
| [apps/web/src/lib/auth/validation.ts](../apps/web/src/lib/auth/validation.ts) | Validation нәтиже мәтінінің орнына typed translation key қайтарады. |
| [apps/web/src/lib/format/format.spec.ts](../apps/web/src/lib/format/format.spec.ts) | KK/EN presentation, formatting, validation немесе safe error regression assertions қосылды. |
| [apps/web/src/lib/format/index.ts](../apps/web/src/lib/format/index.ts) | Intl formatting қосылды; BigInt/exact decimal precision және UTC сақталды. |
| [apps/web/src/lib/utils/search.test.ts](../apps/web/src/lib/utils/search.test.ts) | KK/EN presentation, formatting, validation немесе safe error regression assertions қосылды. |
| [apps/web/src/lib/utils/search.ts](../apps/web/src/lib/utils/search.ts) | Validation нәтиже мәтінінің орнына typed translation key қайтарады. |
| [apps/web/src/providers/toast-provider.tsx](../apps/web/src/providers/toast-provider.tsx) | Toast typed key сақтайды; белсенді хабарлама тіл ауысқанда жаңарады. |
| [package.json](../package.json) | `verify:i18n` командасы қосылды; dependencies өзгермейді. |
