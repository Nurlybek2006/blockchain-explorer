# Operations: іске қосу, бақылау және recovery

## Environment scopes

Development .env, core compose.yml, monitoring compose.observability.yml және production .env.production/compose.production.yml бөлек scopes қолданады. Existing development ENV мен volumes сақталсын. Stop commands volumes-ті қалдырады; data reset command қолданылмайды.

Node.js 24, pnpm 12.10.1, Docker daemon және Compose қажет. Windows-та Docker Desktop Linux containers қолданады. Командалар project root-тан орындалады. Docker build server/network resource-ін талап етеді; runtime Node package install жасамайды.

## Fresh development startup

Тек жаңа checkout-та .env.example-ді .env ретінде көшіріңіз. Бар .env-ді overwrite жасамаңыз. Үш DB URL, Redis/Rabbit credentials, actual Ethereum RPC URL, internal service token және екі distinct JWT secret толтырылады. Provider API keys optional behavior-ға сәйкес орнатылады.

~~~powershell
pnpm install
pnpm build:packages
pnpm infra:up
pnpm infra:ps
pnpm db:migrate
pnpm observability:up
~~~

Applications әрқайсысы бөлек terminal-да:

~~~powershell
pnpm dev:api
pnpm dev:indexer
pnpm dev:portfolio
pnpm dev:web
~~~

Default URLs: Gateway localhost:3000, Indexer health localhost:3001/health, Portfolio health localhost:3002/health, Web localhost:3003. Browser API URL Gateway-ге бағытталсын; internal database/provider credentials public ENV болмайды.

## Production configuration

.env.production.example-ден ignored .env.production жасаңыз. Passwords connection URL-ға кіретіндіктен cryptographic random hexadecimal strings қолданыңыз. JWT secret-тер екі distinct мән, кемінде 32 random bytes болсын. PHASE 12 template secrets бос және fail-fast Compose interpolation қолданады.

Төмендегі бір жол template көшірілгеннен кейін ғана бос secret field-терді random values-пен толтырады; мәндерді console-ға шығармайды, бар secrets-ті өзгертпейді:

~~~powershell
node -e "const f=require('node:fs'),c=require('node:crypto'),p='.env.production';let s=f.readFileSync(p,'utf8');for(const k of ['POSTGRES_PASSWORD','IDENTITY_DB_PASSWORD','EXPLORER_DB_PASSWORD','PORTFOLIO_DB_PASSWORD','REDIS_PASSWORD','RABBITMQ_PASSWORD','INTERNAL_SERVICE_TOKEN','JWT_ACCESS_SECRET','JWT_REFRESH_SECRET','GRAFANA_ADMIN_PASSWORD'])s=s.replace(new RegExp('^'+k+'=$','m'),k+'='+c.randomBytes(32).toString('hex'));f.writeFileSync(p,s,{mode:384});"
~~~

Unix mode 0600 Windows ACL protection-ын алмастырмайды. Actual Ethereum RPC URL-ды operator бөлек толтырады. WEB_ORIGIN exact origin, public API және WS URL browser-reachable болсын. NEXT_PUBLIC values web build кезінде бекітіледі, кейін өзгерсе image rebuild қажет.

API_RATE_LIMIT_ENABLED=true сақталады; auth quota production template-та 20/minute. TRUST_PROXY=false default. SECURITY_HSTS_ENABLED=false local HTTP үшін; operator HTTPS termination дайындағанда ғана true орнатады. Production Compose TLS endpoint немесе reverse proxy орнатпайды.

~~~powershell
pnpm prod:config
pnpm prod:build
pnpm prod:up
pnpm prod:ps
~~~

prod:config тек silent validation жасайды; full docker compose config output secrets-ті interpolate етуі мүмкін, оны public logs/report-қа көшірмеңіз. Production project development volume-ларын reuse етпейді. API/Web localhost bindings ғана жарияланады; PostgreSQL/Redis/Rabbit/Indexer/Portfolio private network ішінде.

## Startup dependencies және migrations

Fresh production PostgreSQL init identity/explorer/portfolio databases және бөлек owner roles жасайды. Migration one-shot services DB health-ті күтіп, ordered SQL migration journal қолданады. Applications migration success және required service health-тен кейін басталады.

Development migration commands root db:migrate немесе owner-specific db:migrate:api/indexer/portfolio. SQL generate әр service Drizzle schema-сына сүйенеді; generated migration-ды inspect жасап, backup/upgrade plan болғанда ғана target ортаға қолданыңыз. Existing migration file-ін applied database үшін retroactively өзгертпеңіз.

Production migrations қайта application rollout кезінде pending migrations-ті ғана қолданады. Init directory script existing initialized PostgreSQL volume үшін қайта орындалмайды; жаңа role/password policy-ді live DB-ге қолдану бөлек administrative migration/rotation талап етеді.

## Logs, stop және shutdown

~~~powershell
pnpm infra:logs
pnpm observability:logs
pnpm prod:logs
pnpm prod:down
pnpm observability:down
pnpm infra:down
~~~

Development application terminal-ында Ctrl+C беріңіз. Production application containers init-enabled, exec-form Node startup және 45-second stop grace period қолданады. Workers intake/dispatch-ті тоқтатып, active жұмысты аяқтау немесе provider abort арқылы connections-ті жабады; telemetry best-effort bounded flush жасайды.

Force kill required болса жаңа work қабылдамауы, DB transaction rollback және subsequent outbox/job recovery observed state арқылы тексерілсін. Rabbit/Bull redelivery possible болғандықтан idempotency safeguards қажет. Stop volumes-ті жоймайды.

## Health және operational signals

/health dependency readiness көрсетеді: healthy 200, unavailable dependency 503. Бұл liveness немесе барлық provider method capability кепілдігі емес. Redis cache fallback кезінде public reads healthy behavior бере алады, ал health dependency degraded және auth limiter 503 болады. Indexer status stopped/degraded және null lag honest unknown күйін береді.

Dashboard-та HTTP errors/latency, indexer lag/running state, RPC rate limits, DB pool waiting, outbox oldest age/backlog, BullMQ failures, price freshness/unpriced assets және socket churn-ды салыстырыңыз. Full database URLs/passwords немесе raw user bodies log-қа қосылмасын.

## Development monitoring URLs

| Component | URL / purpose |
| --- | --- |
| Grafana | http://localhost:3004, Viewer dashboards/Explore |
| Prometheus | http://localhost:9090, targets/rules/query |
| Loki | http://localhost:3100/ready, log backend |
| Tempo | http://localhost:3200/ready, trace backend |
| Collector | http://localhost:13133, readiness |
| OTLP HTTP | localhost:4318, exporters |
| RabbitMQ UI | local RABBITMQ_MANAGEMENT_PORT, template default 15672 |

Rabbit UI development username/password .env-ден алынады. Production management port жарияланбайды. Prometheus rules UI-де бағаланады; external notification receiver жоқ.

Loki Explore query:

~~~logql
{service_name="blockchain-explorer-api"} | json | level="error"
~~~

Tempo TraceQL:

~~~traceql
{ resource.service.name = "blockchain-explorer-api" }
~~~

Log trace link немесе Prometheus exemplar Tempo trace-ке апарады. No application traffic болса panels no data болуы қалыпты. Known trace ID арқылы direct lookup query indexing delay-ін ажыратуға болады.

## Production monitoring overlay

.env.production ішінде OTEL_ENABLED=true, GRAFANA_ADMIN_PASSWORD distinct random secret және appropriate sample ratio орнатыңыз:

~~~powershell
docker compose --env-file .env.production -f infrastructure/compose.production.yml -f infrastructure/compose.production.observability.yml up -d
~~~

Exporter endpoint Docker network ішінде otel-collector:4318 болады; host localhost емес. Monitoring project production application network-пен бір scope-та. Grafana anonymous access disabled; UI localhost:3004 default. Prometheus/Loki/Tempo/Collector dependency ports host-та ашылмайды. Overlay volumes monitoring history-ді сақтайды. Base-only prod:down monitoring orphan services-ті толық stop етпейді; overlay-ді тоқтату үшін екі file-мен compose down орындаңыз.

~~~powershell
docker compose --env-file .env.production -f infrastructure/compose.production.yml -f infrastructure/compose.production.observability.yml down
~~~

## Backup

Script matching official PostgreSQL container ішіндегі pg_dump қолданады; custom-format archives, SHA-256, byte size және final manifest жасайды. Әдепкіде identity_db, explorer_db, portfolio_db көшіріледі. Partial backup-та manifest жоқ, restore helper оны қабылдамайды.

~~~powershell
$postgresContainer = docker compose --env-file .env.production -f infrastructure/compose.production.yml ps -q postgres
node --env-file=.env.production infrastructure/scripts/backup.mjs --container $postgresContainer --directory backups --user blockchain_admin
~~~

POSTGRES_USER өзгеше болса --user соған сәйкес беріңіз. Password child environment арқылы беріледі; command argv/stdout-қа жазылмайды. Directory timestamp/random suffix-імен жасалады. Archives secrets/private identity/portfolio data қамтиды; access ACL, encrypted off-host copy және retention schedule operator-ға тиесілі.

Үш pg_dump бір ортақ cross-database snapshot емес. Әр database consistent dump алады; coordinated multi-service recovery event/idempotency және checkpoint state-ін бірге талдауды талап етеді. Бұл PITR/WAL archive implementation емес.

## Restore: explicit және empty target

Restore original database-ті автоматты overwrite/drop жасамайды. Target running official PostgreSQL container болуы, target application database алдын ала жасалған және tables/views/sequences жағынан бос болуы керек. Source manifest filename/size/hash дәл сәйкес тексеріледі; pg_restore single transaction және exit-on-error қолданады.

Disposable drill үшін ғана жаңа бос clone жасаңыз. Мысал target name original explorer_db емес:

~~~powershell
docker exec $postgresContainer createdb -U blockchain_admin restored_explorer
node --env-file=.env.production infrastructure/scripts/restore.mjs --container $postgresContainer --directory backups/BACKUP_DIRECTORY --database explorer_db --target restored_explorer --confirm "$postgresContainer/restored_explorer" --user blockchain_admin
~~~

BACKUP_DIRECTORY нақты generated directory болсын. Confirmation exact container string және target name-ге сәйкес келуі керек. Backup scripts --no-owner/--no-acl қолданады; restored object ownership restore user-ге тиесілі болады. Application-ды clone-ға ауыстыру алдында appropriate owner role/permissions және migration journal/checkpoint consistency тексерілсін.

Automated restore verification тек disposable Testcontainer databases-ке орындалады; user's local live DB-ге destructive restore жасалмайды. Drill clone cleanup operator нақты target-ті тексергеннен кейін бөлек орындайды.

## Common failures

| Symptom | Investigation / expected behavior |
| --- | --- |
| PostgreSQL unavailable | Health degraded; writes fail, successful checkpoint/outbox result жарияланбайды; URL/network/pool waiting тексеріңіз. |
| Redis unavailable | Explorer cache bypass; auth 503; queue enqueue/retry intents persisted; connectivity/recovery және noeviction memory usage тексеріңіз. |
| RabbitMQ unavailable | Outbox backlog/age өседі; indexing DB commit сақталады; broker қалпына келгенде publisher retry. |
| RPC 429/timeout | Client bounded retry/backoff; indexing head advance болмайды; provider quota/concurrency/configured chain тексеріңіз. |
| CoinGecko unavailable | Stored price stale немесе unavailable; fabricated zero жоқ; snapshots/price alerts fresh observation күтеді. |
| Etherscan key жоқ | Contract lookup unsupported; core explorer indexing жалғасады. |
| callTracer unsupported | Trace unsupported state; provider debug capability қажет, ordinary JSON-RPC health жеткіліксіз. |
| Collector unavailable | Telemetry degraded, core application continues; endpoint Docker hostname және export queue diagnostics тексеріңіз. |
| Socket disconnected | Heartbeat/reconnect/polling fallback; missed data REST refresh; public stream persistent ledger емес. |
| Migration failure | One-shot service logs және journal order inspect; app іске қоспай cause түзетіңіз, reset жасамаңыз. |

## Disk/data persistence және verification

PostgreSQL, Redis AOF, RabbitMQ және monitoring volumes disk пайдаланады. Docker logs bounded rotation қолданады; Prometheus/Loki/Tempo retention storage limits configured. Disk exhaustion transaction/broker persistence-ке әсер етеді: free space, volume growth және archive retention бақылаңыз. Backend stdout/OTLP redaction host archive ACL-ін алмастырмайды.

Use pnpm test:unit, test:contracts, test:integration, test:e2e және verify:phase12. Detailed benchmark options/results, migration/index review, Docker smoke, restore evidence және remaining warnings [Phase 12](phase-12-production-hardening.md) мен [production checklist](production-checklist.md) ішінде. Full browser visual/click/hydration QA HTTP smoke scope-ынан тыс.

