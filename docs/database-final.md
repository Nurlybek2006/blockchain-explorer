# Соңғы database архитектурасы

Бұл құжат нақты Drizzle schemas, migration SQL және repository query-леріне сүйенеді. Жобада **26 application table** бар: `identity_db` ішінде 2, `explorer_db` ішінде 13, `portfolio_db` ішінде 11. Әр database-та Drizzle өзінің migration journal кестесін бөлек сақтайды.

## Database ownership

| Database | Иесі | Connection variable | Production login |
|---|---|---|---|
| `identity_db` | API Gateway | `IDENTITY_DATABASE_URL` | `identity` |
| `explorer_db` | Indexer Service | `EXPLORER_DATABASE_URL` | `explorer` |
| `portfolio_db` | Portfolio Service | `PORTFOLIO_DATABASE_URL` | `portfolio` |

Gateway басқа service database-ына query жасамайды: Explorer және Portfolio мәліметтері internal HTTP арқылы алынады. Portfolio blockchain өзгерістерін RabbitMQ events арқылы қабылдайды. Cross-database JOIN және FK жоқ. Portfolio `user_id` JWT арқылы расталған identity-ді көрсетеді; wallet/token addresses — басқа database кестелеріне PostgreSQL FK емес, domain identifiers.

Production Compose fresh PostgreSQL volume үшін үш түрлі login жасайды және әр database-тың `PUBLIC CONNECT` құқығын қайтарып алады. Әр login өз database-ына ғана кіреді. Бұл application ownership-ты database connection деңгейінде де шектейді; admin credentials application containers-ға берілмейді. Қолданыстағы development database пен volume өзгертілмейді.

## Identity: API Gateway иелік ететін 2 кесте

| Table | Мақсаты және primary key | Маңызды FK | Маңызды indexes / constraints |
|---|---|---|---|
| `users` | Тіркелген user, bcrypt password hash, profile, role, active status және login timestamps. PK: `id UUID`. | Жоқ. | `users_email_unique` email бойынша unique; `users_role_idx`; `users_created_at_idx`. |
| `refresh_tokens` | Refresh JWT-дің hash-ы, session family, expiry және revocation history. PK: `id UUID`. Raw token сақталмайды. | `user_id → users.id`, `ON DELETE CASCADE`. | `refresh_tokens_token_hash_uq`; `refresh_tokens_user_id_idx`; `refresh_tokens_expires_at_idx`; `refresh_tokens_family_id_idx`. |

Login `users.email` unique lookup-ына сүйенеді. Refresh rotation token UUID және user UUID бойынша rows-ты `FOR UPDATE` арқылы бекітеді. Family revocation `user_id + family_id + revoked_at IS NULL` filter-ын қолданады; logout-all user-дің active sessions-тарын өзгертеді. Жаңа composite index бұл phase-та өлшемсіз қосылмады: existing user/family indexes сақталды.

## Explorer: Indexer Service иелік ететін 13 кесте

| Table | Мақсаты және primary key | Маңызды FK | Маңызды indexes / constraints |
|---|---|---|---|
| `blocks` | Canonical block header, timestamp, gas және transaction count. PK: `number BIGINT`. | Жоқ. | `blocks_hash_unique`; `blocks_timestamp_idx`; `blocks_miner_idx`; number PK latest-block және pagination-ға жарайды. |
| `transactions` | Transaction payload, sender/recipient, amount, gas және block identity. PK: `hash VARCHAR(66)`. | `block_number → blocks.number`, cascade. | `transactions_block_number_idx`; `transactions_from_address_idx`; `transactions_to_address_idx`; `transactions_block_hash_idx`. |
| `receipts` | Execution success, gas usage, created contract address және logs bloom. PK: `transaction_hash`. | Transaction hash → `transactions.hash`; block number → `blocks.number`; екеуі де cascade. | Hash PK бір transaction receipt lookup-ын жабады. |
| `logs` | Contract event topics/data; ERC-20 events осы деректерден танылады. PK: `id UUID`. | Transaction және block → өз parent кестелері, cascade. | `logs_tx_log_index_uq(transaction_hash, log_index)`; `logs_address_idx`; `logs_topic0_idx`; `logs_block_number_idx`. |
| `tokens` | ERC-20 name/symbol/decimals/supply және metadata observation height. PK: `address VARCHAR(42)`. | Жоқ. | `tokens_symbol_idx`; address PK exact token search/detail үшін. |
| `token_transfers` | Token/from/to, raw amount, block, transaction/log ordering. PK: `id UUID`. | Transaction → `transactions.hash`; block → `blocks.number`; token → `tokens.address`; cascade. | `token_transfers_tx_log_uq`; `token_transfers_token_idx`; `token_transfers_from_idx`; `token_transfers_to_idx`; `token_transfers_block_idx`. |
| `addresses` | Address registry, contract flag, first/last seen height, aggregates және bounded code-detection retry state. PK: `address`. | Жоқ. First/last/code-check heights — observation metadata. | `addresses_last_seen_idx`; address PK detail/detection lookup үшін. |
| `sync_state` | Scanner progress, finalized height, last hash және state. PK: `chain_id INTEGER`. | Жоқ; cursor indexed rows-тан бөлек сақталады. | Chain PK. |
| `checkpoints` | Reorg салыстыруына арналған chain/height/hash observation. PK: `id UUID`. | Жоқ; reorg cleanup explicit орындалады. | `checkpoints_chain_block_uq(chain_id, block_number)`; `checkpoints_created_at_idx`. |
| `outbox_events` | Block transaction-ымен бірге committed event envelope, delivery state, attempts және next availability. PK: `id UUID`. | Жоқ; broker жеткізу state-і domain row-дан бөлек. | `outbox_status_idx`; `outbox_available_at_idx`. |
| `contract_verifications` | Etherscan source/ABI, compiler info, verification status, canonical discovery hash, attempts және cooldown. PK: `contract_address`. | Жоқ; reorg discovery metadata-ны explicit invalidates. | Address PK. Due-verification `status/next_attempt_at/attempts` scan-ына қосымша index осы phase-та қосылмады. |
| `transaction_trace_requests` | Durable BullMQ trace intent, canonical block hash, request status және retry time. PK: `transaction_hash`. | Transaction → `transactions.hash`; block → `blocks.number`; cascade. | `trace_requests_dispatch_idx(status, available_at)`. |
| `transaction_traces` | Flattened call tree: path, call type, from/to, raw value/gas/input/output/error. PK: `id UUID`. | Transaction және block → parent кестелер, cascade. | `transaction_traces_path_uq(transaction_hash, trace_address)`; `transaction_traces_block_idx`; `transaction_traces_from_idx`; `transaction_traces_to_idx`. |

Block number/hash және transaction hash exact lookup-тары unique/PK indexes арқылы орындалады. Receipt, log, transfer және traces бір canonical transaction/block identity-іне байланған. Fork block жойылғанда FK cascade dependent rows-ты тазалайды; addresses, verification және checkpoint metadata үшін Reorg Service explicit cleanup жасайды. Worker provider hash-ты және stored identity-ді тексеріп, ескі fork нәтижесін жаңа canonical transaction-ға жазбайды.

`blocks.number` жалғыз PK болғандықтан Explorer database бір configured chain-ға арналған. `sync_state.chain_id` болуы осы storage-ты толық multichain database етпейді. Басқа chain-ды бөлек dataset/database арқылы қосу қажет.

## Portfolio: Portfolio Service иелік ететін 11 кесте

| Table | Мақсаты және primary key | Маңызды FK | Маңызды indexes / constraints |
|---|---|---|---|
| `portfolios` | User-дің бақылайтын wallet-ы, chain, name, primary flag және archive state. PK: `id UUID`. | `user_id` — identity domain reference; cross-DB FK жоқ. | `portfolios_user_wallet_chain_uq(user_id, wallet_address, chain_id)`; `portfolios_user_id_idx`; `portfolios_wallet_idx`. |
| `holdings` | Native ETH/ERC-20 holdings, asset key, exact raw balance және observed height. PK: `id UUID`. | `portfolio_id → portfolios.id`, cascade. | `holdings_portfolio_asset_uq(portfolio_id, asset_key)`; `holdings_token_idx`. |
| `prices` | Asset-тің соңғы valid USD price/change/market-cap және fetched timestamp. PK: `asset_key`. | Жоқ; provider metadata мен token address domain identifiers. | `prices_fetched_at_idx`; asset PK. |
| `price_snapshots` | Asset price history; current price unavailable болса history сақталады. PK: `id UUID`. | Жоқ; snapshot current price row өміріне тәуелді емес. | `price_snapshots_asset_time_idx(asset_key, recorded_at)`. |
| `portfolio_snapshots` | Portfolio valuation history: USD/ETH totals және observation timestamp. PK: `id UUID`. | `portfolio_id → portfolios.id`, cascade. | `portfolio_snapshots_portfolio_time_idx(portfolio_id, recorded_at)`. |
| `watchlists` | User-owned watchlist name және creation time. PK: `id UUID`. | User — cross-DB domain reference. | `watchlists_user_idx`. |
| `watchlist_items` | Watched wallet/token address және optional label. PK: `id UUID`. | `watchlist_id → watchlists.id`, cascade. | `watchlist_items_unique_idx(watchlist_id, item_type, address)` duplicate-ті шектейді және parent lookup-қа leading prefix береді. |
| `alerts` | User-owned price/whale/wallet rules, threshold, enabled және crossing state. PK: `id UUID`. | User — cross-DB domain reference. | `alerts_user_idx`; `alerts_type_idx`. |
| `alert_events` | Rule trigger history, event key, payload және read timestamp. PK: `id UUID`. | `alert_id → alerts.id`, cascade. | `alert_events_alert_event_key_uq(alert_id, event_key)` idempotency үшін; `alert_events_alert_idx`; `alert_events_triggered_idx`. |
| `processed_events` | Already processed RabbitMQ envelope identity. PK: `event_id VARCHAR(64)`. | Жоқ. | Event PK duplicate delivery-дің business өзгерісін қайталауын тоқтатады. |
| `outbox_events` | Portfolio шығаратын committed envelopes және delivery/retry state. PK: `id UUID`. | Жоқ. | `portfolio_outbox_status_idx`; `portfolio_outbox_available_idx`. Қазіргі schema capability dispatcher-дің бар болуын өздігінен білдірмейді. |

Portfolio, watchlist және alert GET/PATCH/DELETE queries `user_id` ownership predicate-ін қолданады. Holdings/history queries parent portfolio-ға JOIN жасап, оның active/owned күйін тексереді. Alert events owner alert арқылы шектеледі. Бір user-дің UUID-сін білу екінші user-ге оның деректерін бермейді.

## Drizzle migration journal

Үш database-та да `drizzle.__drizzle_migrations` internal кестесі бар: PK — serial `id`; metadata — migration `hash` және `created_at BIGINT`; domain FK жоқ. Оны тек сол database-тың migration runner-ы басқарады. Public API бұл кестені шығармайды. Application schema table count-ына journal кірмейді.

Migration sequence:

| Database | SQL files |
|---|---|
| Identity | `0000_tranquil_zaladane`, `0001_military_mephistopheles` |
| Explorer | `0000_overrated_gwen_stacy`, `0001_milky_purifiers`, `0002_hard_luckman` |
| Portfolio | `0000_freezing_wrecking_crew`, `0001_odd_lilith`, `0002_lucky_rocket_racer` |

SQL, `_journal.json` және generated snapshots бірге сақталады. PHASE 12 жаңа schema/index migration қоспайды. Fresh database және previous migration sequence-тан upgrade disposable Testcontainers арқылы тексеріледі. Production one-off migration services runtime Drizzle migrator-ды advisory lock-пен қолданады; app startup migration success-қа тәуелді. Migration command database reset жасамайды.

## Frequent query және index audit

Төмендегі кесте қазіргі query shape-ты сипаттайды. Index-тің болуы planner оны әр dataset-та міндетті түрде қолданады дегенді білдірмейді: selectivity, row count және ordering шешімге әсер етеді.

| Query path | Нақты filter / order | Қазіргі index және шешім |
|---|---|---|
| Blocks list/detail/hash/search | Number descending page; number/hash equality; timestamp/miner metadata | Number PK, hash unique, timestamp/miner indexes сақталды. Latest block PK backward scan-мен алынады. |
| Block transactions | `block_number = ?`, `transaction_index ASC` | Block index filter-ды жабады; шағын block ішіндегі sort сақталды. |
| Transaction detail | Hash equality; receipt hash; logs/transfers transaction hash және log index | Transaction/receipt PK; composite transaction/log unique indexes. Fixed number of queries. |
| Address activity | `from_address = ? OR to_address = ?`, latest block order; бөлек counts | From/to indexes және block index. Selective case-та BitmapOr, ordering case-та backward block scan болуы мүмкін. |
| Log lookup | Transaction/address/topic0/block equality | Transaction/log unique және three secondary indexes бар. |
| Tokens/detail/search | Address equality; list `last_updated_block DESC`; symbol metadata | Address PK және symbol index бар. Last-updated list sort-ына өлшемсіз жаңа index қосылмады. |
| Token transfer history | Token equality, `block_number DESC`, LIMIT/OFFSET | Token және block indexes. Candidate `(token_address, block_number)` тесттелді; measured gain болмағандықтан migration жасалмады. |
| Address registry / contract | Address equality; detection `is_contract=false`, unchecked code, due retry time | PK direct reads; code detection bounded batches. Code-check dispatcher index кеңейтудің қажеті dataset өскенде өлшенеді. |
| Verification / trace dispatch | Status plus due time / attempts; fixed batch limit | Verification PK; trace requests `(status, available_at)` index. Verification scheduler compound index осы phase-та қосылмады. |
| Trace page / rollback | Transaction equality; path tree; block deletion | Transaction/path unique prefix; block/from/to indexes; tree rows бір query-мен алынады. |
| Owned portfolio CRUD | User+ID; active user list; wallet+chain duplicate/event target lookup | PK, user/wallet indexes, unique user/wallet/chain. |
| Holdings | Portfolio equality, asset order/upsert; token lookup | Unique portfolio/asset және token index. |
| Valuation / history / analytics | Owned portfolio JOIN; cold price misses үшін `asset_key IN (...)`; portfolio+time range; latest baseline | Holdings leading portfolio prefix; prices PK; snapshot portfolio/time index; SQL window sampling bounded history output береді. |
| Watchlists | User list; parent ID JOIN; duplicate parent/type/address | User index және item unique composite prefix. Mixed-case legacy duplicate check parent lock ішінде. |
| Alerts | User list; enabled type/token evaluation; owned event history | User/type indexes; alert/event-key unique; event alert/time indexes. Row locks crossing state-ті atomically өзгертеді. |
| Refresh sessions | User/token PK locking; family/user active revocation; expiry metadata | PK, user/family/expiry indexes. |
| Consumer idempotency | `processed_events.event_id = ?` және conflict-safe insert | Event PK; business transaction duplicate marker-мен бірге commit жасайды. |
| Indexer outbox | Pending status + due availability, creation order, limit; stale processing recovery | Status және available indexes. Claim conditional update арқылы орындалады; status/available candidate measured benefit бермеді. |
| Portfolio outbox | Persisted event delivery fields | Existing status/availability indexes сақталды; future dispatcher осы schema-ны reuse ете алады. |

## Нақты EXPLAIN ANALYZE нәтижесі

Evidence: [system benchmark artifact](../artifacts/performance/system.json), `generatedAt=2026-10-14T17:23:32.892Z`. `EXPLAIN (ANALYZE, BUFFERS)` disposable PostgreSQL dataset-ында орындалды: **200 blocks, 10 000 transactions, 10 000 transfers, 10 100 outbox rows, 2 000 snapshots, 200 alerts**. Synthetic rows және candidate indexes transaction rollback арқылы тазаланды. User-дің local database-ы benchmark target болған жоқ.

| Query / experiment | Execution, ms | Planner observation |
|---|---:|---|
| Token history, before | 0.742 | `token_transfers_block_idx` backward scan; token filter. |
| Token history, candidate after | 0.849 | Planner existing block index-ті сақтады; new composite index gain көрсетпеді. |
| Pending outbox, before | 0.082 | `outbox_status_idx`, шағын creation-time sort. |
| Pending outbox, candidate after | 0.145 | Sub-ms query; new candidate meaningful improvement бермеді. |
| Stale outbox recovery | 0.024 | Existing indexes жеткілікті. |
| Block page | 0.033 | Number primary key ordering. |
| Address transaction page | 0.440 | `transactions_block_number_idx` backward scan plus from/to filter. |
| Portfolio snapshot range | 0.068 | `portfolio_snapshots_portfolio_time_idx` backward scan, portfolio/time index condition. |
| Owned alert list | 0.089 | 200 rows-тың user filter-ы осы fixture-та dense болғандықтан Seq Scan + sort таңдалды. |

Бұл бір local run; absolute production SLA немесе барлық cardinality үшін planner кепілдігі емес. Сондықтан PHASE 12 indexes өзгертпейді. Write-heavy indexing-ке қосымша write/WAL/storage cost енгізу үшін representative workload-та қайталанатын пайда керек. Терең OFFSET, exact total counts және үлкен verification backlog болашақта қайта өлшенетін жерлер.

## N+1 және batching review

Explorer lists returned row сайын additional SQL орындамайды: block, transaction, token және address responses fixed queries/`Promise.all` арқылы құралады. Transaction receipt/log/transfer queries parallel, block transactions бір set query. Contract detail екі негізгі PK read жасайды; legacy missing intent үшін bounded extra reads/writes бар. Trace page барлық call rows-ты бір query-мен алып, tree/path сұрыптауын memory-де орындайды.

Portfolio holdings owner-filtered JOIN арқылы бір set ретінде оқылады. History SQL window functions арқылы rank buckets таңдайды; мыңдаған snapshots-ты browser-ға толық көшірмейді. Alert event lists owner JOIN қолданады. Price scheduler active holdings, watchlist tokens және alert tokens-ты three set queries арқылы жинап, duplicate asset keys-ті алып тастайды.

PHASE 12-де нақты cold-price N+1 түзетілді: `PricesService.getPrices()` validated asset keys-ті deduplicate жасайды, cache observations-ты parallel алады, барлық misses-ті `PricesRepository.findMany()` арқылы **бір `WHERE asset_key IN (...)` SQL query**-ге жинайды. Толық warm cache болса SQL орындалмайды. Duplicate inputs пен result order, exact decimal strings, stale status және missing/stale asset refresh behavior сақталады; three focused unit cases осы semantics-ті тексереді.

Қалған scaling hotspots ашық көрсетіледі: background valuation refresh active portfolios-ты кезекпен оқиды. Price crossing evaluation matching rules-ты бір query/transaction ішінде lock жасайды, кейін әр changed rule үшін update және conditional event insert жасайды. Бұл тәсілдер ownership, monotonic source timestamp және idempotency semantics-ті сақтайды; өте үлкен workloads үшін bounded portfolio scheduling және rule processing өлшеммен бағалануы тиіс. Осы phase барлық per-rule/background operations жойылды деп мәлімдемейді.

## Connection pool

Үш backend [shared pool configuration](../packages/contracts/src/config/database-pool.config.ts) helper-ын қолданады. Invalid, empty, non-integer, negative немесе out-of-range settings startup-та fail fast болады; infinite connection wait-қа рұқсат жоқ.

| ENV | Default | Allowed range |
|---|---:|---:|
| `DB_POOL_MAX` | 10 | 1–100 |
| `DB_IDLE_TIMEOUT_MS` | 30 000 ms | 0–300 000 ms; 0 idle timeout-ты өшіреді. |
| `DB_CONNECTION_TIMEOUT_MS` | 5 000 ms | 100–60 000 ms |

Default үш app instance ең көбі 30 PostgreSQL connections ашады; migrations және operator sessions үшін бөлек budget керек. Replicas көбейгенде жалпы pool budget PostgreSQL `max_connections` мәніне сай жоспарланады. PHASE 11 metrics pool total/idle/waiting және saturation observations береді; metric labels user/portfolio IDs ұстамайды. Shutdown pool-ды жабады; production SIGTERM smoke төрт app-тың белгіленген 45 секундтан бұрын тоқтайтынын тексерді.

## Precision, consistency және operational boundary

Ethereum raw balances/value/gas `NUMERIC(78,0)` ретінде сақталады және API-де decimal strings арқылы беріледі. Heights `BIGINT`/`bigint`; public numeric validation PostgreSQL signed-64-bit storage шегін ескереді. Financial price/snapshot storage precision schema-да explicit; calculations Decimal arithmetic қолданады. Timestamps — timezone-aware PostgreSQL timestamps. Unknown provider value valid zero ретінде шығарылмайды.

Block persistence және Indexer outbox бір database transaction-да committed болады. RabbitMQ delivery at-least-once; Portfolio processed-event PK duplicate бизнес өзгерісін тоқтатады. Portfolio repeatable-read state/list transactions related rows-ты бір snapshot-тан алады. Explorer page/count parallel queries continuous indexing кезінде өзгерген dataset-ты көрсетуі мүмкін; current API backward compatibility сақталған.

Backup custom-format `pg_dump` арқылы үш database-ты бөлек timestamped archives-қа жазады. Manifest size/SHA-256 checks restore path-ын тексереді; passwords argv немесе logs ішінде жоқ. Restore exact container/database confirmation және existing empty target талап етеді, `--clean`/database drop қолданбайды. PostgreSQL ownership roles server-level objects болғандықтан application data archives оларды өздігінен жасамайды: fresh production init немесе operator provisioning алдын ала қажет. Толық backup/restore тәртібі [operations document](operations-final.md) ішінде.
